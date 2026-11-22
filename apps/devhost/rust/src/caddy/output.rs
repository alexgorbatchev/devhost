use std::io::Write;

use cli_command_kit::Mode;

use super::log_labeled;

const SCREENED_CADDY_MESSAGES: &[&str] = &[
    "Successfully started Caddy",
    "not NSS security databases found",
    "define JAVA_HOME environment variable to use the Java trust",
    "installing root certificate (you might be prompted for password)",
    "root certificate is already trusted by system",
    "certificate installed properly in",
    "root certificate trust store installation disabled",
    "Caddyfile input is not formatted",
    "on-demand TLS is enabled, but no protections are in place",
    "No files matching import glob pattern",
];

struct CaddyLogEntry {
    level: String,
    text: String,
}

pub(crate) fn write_caddy_output(
    mode: Mode,
    output: &mut impl Write,
    bytes: &[u8],
    failed: bool,
) -> Result<(), String> {
    let text = String::from_utf8_lossy(bytes);
    for line in text.split('\n') {
        let entry = parse_caddy_log_line(line.strip_suffix('\r').unwrap_or(line));
        if entry.text.trim().is_empty() || is_screened(&entry.text) {
            continue;
        }
        if !failed && matches!(entry.level.as_str(), "DEBUG" | "INFO") {
            continue;
        }
        let formatted =
            if !entry.level.is_empty() && !matches!(entry.level.as_str(), "DEBUG" | "INFO") {
                format!("{} {}", entry.level, entry.text)
            } else {
                entry.text
            };
        log_labeled(mode, output, "caddy", &formatted)?;
    }
    Ok(())
}

fn is_screened(text: &str) -> bool {
    SCREENED_CADDY_MESSAGES
        .iter()
        .any(|message| text.contains(message))
}

fn parse_caddy_log_line(line: &str) -> CaddyLogEntry {
    if line.starts_with('{')
        && let Ok(serde_json::Value::Object(fields)) = serde_json::from_str(line)
        && let Some(entry) = parse_json_entry(&fields)
    {
        return entry;
    }
    if let Some(entry) = parse_console_line(line) {
        return entry;
    }
    CaddyLogEntry {
        level: String::new(),
        text: line.trim_end_matches([' ', '\t']).to_owned(),
    }
}

fn parse_json_entry(fields: &serde_json::Map<String, serde_json::Value>) -> Option<CaddyLogEntry> {
    let level = fields.get("level")?.as_str()?;
    let message = fields.get("msg")?.as_str()?;
    let mut text = match fields.get("logger").and_then(serde_json::Value::as_str) {
        Some(logger) if !logger.is_empty() => format!("{logger}: {message}"),
        _ => message.to_owned(),
    };
    let mut keys: Vec<&str> = fields
        .keys()
        .map(String::as_str)
        .filter(|key| !matches!(*key, "level" | "ts" | "logger" | "msg"))
        .collect();
    keys.sort_unstable();
    for key in keys {
        text.push(' ');
        text.push_str(key);
        text.push('=');
        match &fields[key] {
            serde_json::Value::String(value) => text.push_str(value),
            other => text.push_str(&other.to_string()),
        }
    }
    Some(CaddyLogEntry {
        level: level.to_ascii_uppercase(),
        text,
    })
}

fn parse_console_line(line: &str) -> Option<CaddyLogEntry> {
    // Format: YYYY/MM/DD HH:MM:SS[.frac]<ws>LEVEL<ws>rest
    let bytes = line.as_bytes();
    if bytes.len() < 20
        || bytes[4] != b'/'
        || bytes[7] != b'/'
        || bytes[10] != b' '
        || bytes[13] != b':'
        || bytes[16] != b':'
    {
        return None;
    }
    if !bytes[0..4].iter().all(u8::is_ascii_digit)
        || !bytes[5..7].iter().all(u8::is_ascii_digit)
        || !bytes[8..10].iter().all(u8::is_ascii_digit)
        || !bytes[11..13].iter().all(u8::is_ascii_digit)
        || !bytes[14..16].iter().all(u8::is_ascii_digit)
        || !bytes[17..19].iter().all(u8::is_ascii_digit)
    {
        return None;
    }
    let mut idx = 19;
    if bytes.get(idx) == Some(&b'.') {
        idx += 1;
        let frac_start = idx;
        while bytes.get(idx).is_some_and(u8::is_ascii_digit) {
            idx += 1;
        }
        if idx == frac_start {
            return None;
        }
    }
    let ws_start = idx;
    while bytes.get(idx).is_some_and(u8::is_ascii_whitespace) {
        idx += 1;
    }
    if idx == ws_start {
        return None;
    }
    let rest = &line[idx..];
    for level in ["DEBUG", "INFO", "WARN", "ERROR", "DPANIC", "PANIC", "FATAL"] {
        if let Some(after) = rest.strip_prefix(level) {
            let trimmed = after.trim_start_matches([' ', '\t']);
            if trimmed.len() < after.len() {
                return Some(CaddyLogEntry {
                    level: level.to_owned(),
                    text: trimmed.replace('\t', " "),
                });
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filters_screened_and_info_lines_on_success_and_preserves_warnings() {
        let mut out = Vec::new();
        let input = concat!(
            "Successfully started Caddy (pid=1)\n",
            "{\"level\":\"info\",\"ts\":1,\"logger\":\"admin\",\"msg\":\"admin endpoint started\"}\n",
            "{\"level\":\"warn\",\"ts\":1,\"logger\":\"tls\",\"msg\":\"storage is slow\",\"count\":2,\"dir\":\"/tmp\"}\n",
            "2026/10/19 23:31:49.199\tINFO\tnot NSS security databases found\n",
            "2026/10/19 23:31:49\tERROR\tbind\tfailed\n",
            "plain line  \r\n"
        );
        write_caddy_output(Mode::Agent, &mut out, input.as_bytes(), false).unwrap();
        let rendered = String::from_utf8(out).unwrap();
        assert_eq!(
            rendered,
            concat!(
                "caddy: WARN tls: storage is slow count=2 dir=/tmp\n",
                "caddy: ERROR bind failed\n",
                "caddy: plain line\n",
            )
        );

        let mut failed_out = Vec::new();
        write_caddy_output(
            Mode::Human,
            &mut failed_out,
            b"{\"level\":\"info\",\"msg\":\"booting\"}\n",
            true,
        )
        .unwrap();
        assert_eq!(
            String::from_utf8(failed_out).unwrap(),
            "caddy   | booting\n"
        );
    }
}
