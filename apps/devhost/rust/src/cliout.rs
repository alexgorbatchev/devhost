use std::{
    env,
    io::{self, Write},
    path::Path,
    sync::{Arc, Mutex},
};

use cli_command_kit::Mode;

use crate::{Failure, paths::clean};

const SERVICE_SEPARATOR: &str = " | ";

#[derive(Debug)]
struct LayoutState {
    mode: Mode,
    width: usize,
}

#[derive(Clone)]
pub struct ServiceOutput {
    layout: Arc<Mutex<LayoutState>>,
    stdout: Arc<Mutex<Box<dyn Write + Send>>>,
    stderr: Arc<Mutex<Box<dyn Write + Send>>>,
}

impl ServiceOutput {
    pub fn new(
        mode: Mode,
        stdout: Box<dyn Write + Send>,
        stderr: Box<dyn Write + Send>,
        names: &[&str],
    ) -> Self {
        let mut width = 0usize;
        for name in names {
            let trimmed = name.trim();
            if !trimmed.is_empty() {
                width = width.max(trimmed.chars().count());
            }
        }
        Self {
            layout: Arc::new(Mutex::new(LayoutState { mode, width })),
            stdout: Arc::new(Mutex::new(stdout)),
            stderr: Arc::new(Mutex::new(stderr)),
        }
    }

    pub fn stdio(mode: Mode, names: &[&str]) -> Self {
        Self::new(mode, Box::new(io::stdout()), Box::new(io::stderr()), names)
    }

    pub fn mode(&self) -> Mode {
        self.layout.lock().expect("layout lock").mode
    }

    pub fn log_stdout(&self, label: &str, message: &str) {
        self.write_log(&self.stdout, label, message);
    }

    pub fn log_stderr(&self, label: &str, message: &str) {
        self.write_log(&self.stderr, label, message);
    }

    pub fn write_child_stdout(&self, label: &str, line: &str) {
        self.write_formatted(&self.stdout, label, line);
    }

    pub fn write_child_stderr(&self, label: &str, line: &str) {
        self.write_formatted(&self.stderr, label, line);
    }

    pub fn write_caddy_raw(&self, label_text: &[u8]) {
        let mut stderr = self.stderr.lock().expect("stderr lock");
        let _ = stderr.write_all(label_text);
        let _ = stderr.flush();
    }

    pub fn caddy_stderr_writer(&self) -> CaddyBridgeWriter {
        CaddyBridgeWriter {
            target: self.stderr.clone(),
            layout: self.layout.clone(),
            buffer: Vec::new(),
        }
    }

    fn write_log(&self, target: &Arc<Mutex<Box<dyn Write + Send>>>, label: &str, message: &str) {
        let folded = fold_paths(message);
        let trimmed = folded.strip_suffix('\n').unwrap_or(&folded);
        for line in trimmed.split('\n') {
            self.write_formatted(target, label, line);
        }
    }

    fn write_formatted(&self, target: &Arc<Mutex<Box<dyn Write + Send>>>, label: &str, line: &str) {
        let prefix = self.prefix_for(label);
        let mut writer = target.lock().expect("output lock");
        let _ = writeln!(writer, "{prefix}{line}");
        let _ = writer.flush();
    }

    pub fn prefix_for(&self, label: &str) -> String {
        let name = match label.trim() {
            "" => "devhost",
            other => other,
        };
        let mut layout = self.layout.lock().expect("layout lock");
        match layout.mode {
            Mode::Agent => format!("{name}: "),
            Mode::Human => {
                let len = name.chars().count();
                if len > layout.width {
                    layout.width = len;
                }
                let padding = " ".repeat(layout.width - len);
                format!("{name}{padding}{SERVICE_SEPARATOR}")
            }
        }
    }
}

pub struct CaddyBridgeWriter {
    target: Arc<Mutex<Box<dyn Write + Send>>>,
    layout: Arc<Mutex<LayoutState>>,
    buffer: Vec<u8>,
}

impl Write for CaddyBridgeWriter {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.buffer.extend_from_slice(buf);
        while let Some(pos) = self.buffer.iter().position(|&b| b == b'\n') {
            let line_bytes: Vec<u8> = self.buffer.drain(..=pos).collect();
            let line = String::from_utf8_lossy(&line_bytes);
            let formatted = self.reformat_line(&line);
            let mut writer = self.target.lock().expect("bridge lock");
            writer.write_all(formatted.as_bytes())?;
            writer.flush()?;
        }
        Ok(buf.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        if !self.buffer.is_empty() {
            let line = String::from_utf8_lossy(&self.buffer).into_owned();
            self.buffer.clear();
            let formatted = self.reformat_line(&line);
            let mut writer = self.target.lock().expect("bridge lock");
            writer.write_all(formatted.as_bytes())?;
            writer.flush()?;
        }
        Ok(())
    }
}

impl CaddyBridgeWriter {
    fn reformat_line(&self, line: &str) -> String {
        let mut layout = self.layout.lock().expect("layout lock");
        if layout.mode == Mode::Agent {
            return line.to_owned();
        }
        if let Some((raw_label, rest)) = line.split_once(SERVICE_SEPARATOR) {
            let name = raw_label.trim();
            if !name.is_empty() && !name.contains(' ') {
                let len = name.chars().count();
                if len > layout.width {
                    layout.width = len;
                }
                let padding = " ".repeat(layout.width - len);
                return format!("{name}{padding}{SERVICE_SEPARATOR}{rest}");
            }
        }
        line.to_owned()
    }
}

pub fn warning(mode: Mode, message: &str) -> String {
    match mode {
        Mode::Agent => format!("WARN: {message}"),
        Mode::Human => format!("[WARN] {message}"),
    }
}

pub fn write_failure(mode: Mode, stderr: &mut impl Write, failure: &Failure) -> io::Result<()> {
    let (prefix, tag, message) = match mode {
        Mode::Agent => ("devhost:", "ERR:", failure.message.as_str()),
        Mode::Human => (
            "devhost |",
            "[ERROR]",
            failure.summary.as_deref().unwrap_or(&failure.message),
        ),
    };
    let folded = fold_paths(message);
    for (index, line) in folded
        .strip_suffix('\n')
        .unwrap_or(&folded)
        .split('\n')
        .enumerate()
    {
        if index == 0 {
            writeln!(stderr, "{prefix} {tag} {line}")?;
        } else {
            writeln!(stderr, "{prefix} {line}")?;
        }
    }
    if mode == Mode::Human
        && let Some(hint) = failure.hint.as_deref()
    {
        writeln!(stderr, "{prefix} [INFO] {}", fold_paths(hint))?;
    }
    Ok(())
}

pub fn fold_paths(message: &str) -> String {
    let Some(home) = user_home_dir() else {
        return message.to_owned();
    };
    if home == "/" || home.is_empty() {
        return message.to_owned();
    }
    let mut output = String::with_capacity(message.len());
    let mut offset = 0usize;
    let bytes = message.as_bytes();
    while offset < message.len() {
        let Some(rel) = message[offset..].find(&home) else {
            output.push_str(&message[offset..]);
            break;
        };
        let index = offset + rel;
        let end = index + home.len();
        let left = index == 0 || is_left_boundary(bytes[index - 1]);
        let right = end == message.len()
            || bytes[end] == std::path::MAIN_SEPARATOR as u8
            || is_right_boundary(bytes[end]);
        output.push_str(&message[offset..index]);
        if left && right {
            output.push('~');
        } else {
            output.push_str(&home);
        }
        offset = end;
    }
    output
}

pub fn display_path(path: &str) -> String {
    let Some(home) = user_home_dir() else {
        return path.to_owned();
    };
    if home == "/" || home.is_empty() {
        return path.to_owned();
    }
    if path == home {
        return "~".to_owned();
    }
    let prefix = format!("{}{}", home.trim_end_matches('/'), '/');
    if let Some(rest) = path.strip_prefix(&prefix) {
        return format!("~/{rest}");
    }
    path.to_owned()
}

pub fn shell_path(path: &str) -> String {
    let displayed = display_path(path);
    if displayed == "~" {
        return displayed;
    }
    let (prefix, body) = match displayed.strip_prefix("~/") {
        Some(rest) => ("~/", rest),
        None => ("", displayed.as_str()),
    };
    format!("{prefix}'{}'", body.replace('\'', "'\"'\"'"))
}

fn user_home_dir() -> Option<String> {
    let raw = env::var_os("HOME")?;
    let text = raw.to_str()?;
    if text.is_empty() {
        return None;
    }
    Some(clean(Path::new(text)).to_string_lossy().into_owned())
}

fn is_left_boundary(byte: u8) -> bool {
    matches!(
        byte,
        b' ' | b'\t' | b'\r' | b'\n' | b'"' | b'\'' | b'`' | b'=' | b'(' | b'[' | b'{' | b':'
    )
}

fn is_right_boundary(byte: u8) -> bool {
    matches!(
        byte,
        b' ' | b'\t'
            | b'\r'
            | b'\n'
            | b'"'
            | b'\''
            | b'`'
            | b':'
            | b','
            | b';'
            | b'.'
            | b')'
            | b']'
            | b'}'
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Clone, Default)]
    struct SharedBuf(Arc<Mutex<Vec<u8>>>);

    impl Write for SharedBuf {
        fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
            self.0.lock().unwrap().extend_from_slice(buf);
            Ok(buf.len())
        }

        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    #[test]
    fn formats_human_and_agent_output_and_paths() {
        let out = SharedBuf::default();
        let err = SharedBuf::default();
        let writer = ServiceOutput::new(
            Mode::Human,
            Box::new(out.clone()),
            Box::new(err.clone()),
            &["devhost", "api", "frontend"],
        );
        writer.log_stdout("api", "ready\nline two\n");
        writer.write_child_stderr("", "oops");
        let mut bridge = writer.caddy_stderr_writer();
        writeln!(bridge, "caddy   | reloaded").unwrap();
        bridge.flush().unwrap();

        let stdout_text = String::from_utf8(out.0.lock().unwrap().clone()).unwrap();
        assert_eq!(stdout_text, "api      | ready\napi      | line two\n");
        let stderr_text = String::from_utf8(err.0.lock().unwrap().clone()).unwrap();
        assert_eq!(stderr_text, "devhost  | oops\ncaddy    | reloaded\n");

        let agent_out = SharedBuf::default();
        let agent_err = SharedBuf::default();
        let agent = ServiceOutput::new(
            Mode::Agent,
            Box::new(agent_out.clone()),
            Box::new(agent_err.clone()),
            &["devhost"],
        );
        agent.log_stdout("api", &warning(Mode::Agent, "check"));
        assert_eq!(
            String::from_utf8(agent_out.0.lock().unwrap().clone()).unwrap(),
            "api: WARN: check\n"
        );
        assert_eq!(warning(Mode::Human, "x"), "[WARN] x");

        if let Some(home) = user_home_dir() {
            assert_eq!(display_path(&home), "~");
            assert_eq!(display_path(&format!("{home}/a/b")), "~/a/b");
            assert_eq!(display_path(&format!("{home}2/a")), format!("{home}2/a"));
            assert_eq!(shell_path(&home), "~");
            assert_eq!(shell_path(&format!("{home}/a'b")), "~/'a'\"'\"'b'");
            assert_eq!(
                fold_paths(&format!("in {home}/repo and {home}extra")),
                format!("in ~/repo and {home}extra")
            );
        }

        let mut fail_buf = Vec::new();
        write_failure(
            Mode::Human,
            &mut fail_buf,
            &Failure {
                message: "full".to_owned(),
                summary: Some("short\nmore".to_owned()),
                hint: Some("try again".to_owned()),
            },
        )
        .unwrap();
        assert_eq!(
            String::from_utf8(fail_buf).unwrap(),
            "devhost | [ERROR] short\ndevhost | more\ndevhost | [INFO] try again\n"
        );
    }
}
