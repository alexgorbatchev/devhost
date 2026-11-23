use std::{
    fmt::Display,
    fs::{self, File, OpenOptions},
    io::{self, IsTerminal, Read, Seek, SeekFrom, Write},
    os::unix::process::CommandExt,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::Duration,
};

use cli_command_kit::Mode;

use crate::{
    Failure,
    config::{self, CaddySettings},
    machine,
    paths::clean,
};

pub mod devtools_origin;
pub mod files;
pub mod output;
pub mod routes;
pub mod stacks;
pub mod trust;

pub fn ensure_managed_caddy_config(
    directory: &Path,
    settings: &CaddySettings,
) -> Result<(), String> {
    files::prepare_directories(directory)?;
    let _lock = route_lock(directory)?;
    let running = files::read_running_settings(directory, settings)?;
    files::write_config(directory, &running)
}

pub fn ensure_admin_available(admin_address: &str) -> Result<(), Failure> {
    let address = resolve_admin_address(admin_address);
    let url = format!("http://{address}/config/");
    let agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(1)))
        .max_redirects(0)
        .http_status_as_error(false)
        .proxy(None)
        .build()
        .new_agent();
    let detail = match agent.get(&url).call() {
        Ok(response) if response.status().is_success() => return Ok(()),
        Ok(response) => {
            let status = response.status();
            let reason = status.canonical_reason().unwrap_or("");
            format!("HTTP {} {reason}", status.as_u16())
                .trim()
                .to_owned()
        }
        Err(error) => error
            .to_string()
            .replace(" Is the computer able to access the url?", "")
            .trim()
            .to_owned(),
    };
    let base = "Caddy admin API is not available. Run 'devhost caddy start' first.";
    let message = if detail.is_empty() {
        base.to_owned()
    } else {
        format!("{base}\ndetail: {detail}")
    };
    Err(Failure {
        message,
        summary: Some("Caddy is not available.".to_owned()),
        hint: Some("Run 'devhost caddy start' first.".to_owned()),
    })
}

pub fn root_certificate_trust_warning(directory: &Path) -> Option<String> {
    let root_cert = directory.join("storage/pki/authorities/local/root.crt");
    match trust::read_root_certificate_trust(&root_cert) {
        Ok(trust::RootCertificateTrust::Untrusted) => {
            Some(trust::UNTRUSTED_ROOT_CERTIFICATE_WARNING.to_owned())
        }
        Ok(_) => None,
        Err(error) => Some(trust::trust_check_warning(&error)),
    }
}

const FOREIGN_MANAGED_CADDY_ERROR: &str = "A Caddy admin API is already listening on the devhost-managed address, but it was not started by devhost.";

pub struct CommandOutput {
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
    pub success: bool,
}

pub(crate) fn ctx<T, E: Display>(result: Result<T, E>, label: &str) -> Result<T, String> {
    match result {
        Ok(value) => Ok(value),
        Err(error) => Err(format!("{label}: {error}")),
    }
}

pub(crate) fn path_ctx<T, E: Display>(
    result: Result<T, E>,
    label: &str,
    path: &Path,
) -> Result<T, String> {
    match result {
        Ok(value) => Ok(value),
        Err(error) => Err(format!("{label} {}: {error}", path.display())),
    }
}

pub fn start(mode: Mode, output: &mut impl Write, quiet: bool) -> Result<(), Failure> {
    let directory = clean(&machine::state_directory()?.join("caddy"));
    let settings = config::read()?.caddy;
    start_in_directory(&directory, &settings, mode, output, quiet)
}

pub fn start_in_directory(
    directory: &Path,
    settings: &CaddySettings,
    mode: Mode,
    output: &mut impl Write,
    quiet: bool,
) -> Result<(), Failure> {
    let running = prepare_lifecycle(directory, settings)?;
    let address = resolve_admin_address(&running.admin_address);
    let pid_path = directory.join("caddy.pid");
    let caddyfile_path = directory.join("Caddyfile");
    if is_running(address) {
        if !pid_path.exists() {
            return Err(FOREIGN_MANAGED_CADDY_ERROR.to_owned().into());
        }
        log_labeled(
            mode,
            output,
            "devhost",
            &format!(
                "managed caddy is already running with {}",
                caddyfile_path.display()
            ),
        )?;
        trust_after_start(directory, address, mode, output, quiet)?;
        return Ok(());
    }

    let result = start_process(directory, settings)?;
    if !result.success {
        let (failure, handled) = start_failure(&result, directory);
        if !handled || mode == Mode::Agent {
            write_command_output(mode, output, &result)?;
        }
        return Err(failure);
    }
    if !quiet {
        write_command_output(mode, output, &result)?;
    }
    log_labeled(
        mode,
        output,
        "devhost",
        &format!("managed caddy started with {}", caddyfile_path.display()),
    )?;
    trust_after_start(directory, address, mode, output, quiet)?;
    Ok(())
}

pub fn stop(mode: Mode, output: &mut impl Write) -> Result<(), Failure> {
    let directory = clean(&machine::state_directory()?.join("caddy"));
    let settings = config::read()?.caddy;
    stop_in_directory(&directory, &settings, mode, output)
}

pub fn stop_in_directory(
    directory: &Path,
    settings: &CaddySettings,
    mode: Mode,
    output: &mut impl Write,
) -> Result<(), Failure> {
    let running = prepare_lifecycle(directory, settings)?;
    let address = resolve_admin_address(&running.admin_address);
    let pid = directory.join("caddy.pid");
    let applied = directory.join("applied.json");
    let managed = pid.exists();
    if !is_running(address) {
        if managed {
            ctx(
                forget(&pid, &applied),
                "remove stale managed caddy pid file",
            )?;
            log_labeled(
                mode,
                output,
                "devhost",
                "managed caddy is not running. Removed the stale pid file.",
            )?;
            return Ok(());
        }
        log_labeled(mode, output, "devhost", "managed caddy is not running.")?;
        return Ok(());
    }
    if !managed {
        return Err(FOREIGN_MANAGED_CADDY_ERROR.to_owned().into());
    }

    let result = run_managed_command(directory, &["stop"], Some(address), &[], false)?;
    if !result.success {
        write_command_output(mode, output, &result)?;
        return Err("Caddy stop failed. Check the Caddy diagnostics above."
            .to_owned()
            .into());
    }
    write_command_output(mode, output, &result)?;
    ctx(
        forget(&pid, &applied),
        "remove managed caddy pid file after stop",
    )?;
    log_labeled(mode, output, "devhost", "managed caddy stopped.")?;
    Ok(())
}

pub fn trust_ca(mode: Mode, output: &mut impl Write) -> Result<(), Failure> {
    let directory = clean(&machine::state_directory()?.join("caddy"));
    let settings = config::read()?.caddy;
    trust_in_directory(&directory, &settings, mode, output)
}

pub fn trust_in_directory(
    directory: &Path,
    settings: &CaddySettings,
    mode: Mode,
    output: &mut impl Write,
) -> Result<(), Failure> {
    let running = prepare_lifecycle(directory, settings)?;
    let address = resolve_admin_address(&running.admin_address);
    if !is_running(address) {
        return Err(
            "Managed Caddy is not running. Run 'devhost caddy start' first."
                .to_owned()
                .into(),
        );
    }
    if !directory.join("caddy.pid").exists() {
        return Err(FOREIGN_MANAGED_CADDY_ERROR.to_owned().into());
    }

    let root_cert = directory.join("storage/pki/authorities/local/root.crt");
    let state = trust::read_root_certificate_trust(&root_cert)?;
    if state == trust::RootCertificateTrust::Trusted {
        log_labeled(
            mode,
            output,
            "devhost",
            "managed caddy local CA is already trusted.",
        )?;
        return Ok(());
    }

    let result = install_trust(directory, address, mode, output)?;
    if !result.success {
        write_command_output(mode, output, &result)?;
        return Err("Caddy trust failed. Check the Caddy diagnostics above."
            .to_owned()
            .into());
    }
    write_command_output(mode, output, &result)?;
    log_labeled(mode, output, "devhost", "managed caddy local CA trusted.")?;
    Ok(())
}

pub fn download(mode: Mode, output: &mut impl Write) -> Result<(), Failure> {
    let directory = clean(&machine::state_directory()?.join("caddy"));
    download_from_base(
        &directory,
        std::env::consts::OS,
        std::env::consts::ARCH,
        "https://caddyserver.com/api/download",
        mode,
        output,
    )
}

pub fn download_from_base(
    directory: &Path,
    runtime_os: &str,
    runtime_arch: &str,
    base_url: &str,
    mode: Mode,
    output: &mut impl Write,
) -> Result<(), Failure> {
    let target_os = match runtime_os {
        "macos" | "darwin" => "darwin",
        "linux" => "linux",
        "windows" | "win32" => "windows",
        other => return Err(format!("Unsupported OS: {other}").into()),
    };
    let target_arch = match runtime_arch {
        "x86_64" | "amd64" | "x64" => "amd64",
        "aarch64" | "arm64" => "arm64",
        "arm" => "arm",
        other => return Err(format!("Unsupported Architecture: {other}").into()),
    };
    let destination = if target_os == "windows" {
        directory.join("caddy.exe")
    } else {
        directory.join("caddy")
    };
    let url = format!("{base_url}?os={target_os}&arch={target_arch}");
    log_labeled(
        mode,
        output,
        "devhost",
        &format!("Downloading Caddy for {target_os}-{target_arch} from {url}..."),
    )?;
    path_ctx(
        fs::create_dir_all(directory),
        "create caddy directory",
        directory,
    )?;

    let agent = ureq::Agent::config_builder()
        .http_status_as_error(false)
        .build()
        .new_agent();
    let mut response = ctx(agent.get(&url).call(), "download caddy")?;
    let status = response.status();
    if !status.is_success() {
        let reason = status.canonical_reason().unwrap_or("");
        return Err(format!(
            "Failed to download Caddy: {} {} {reason}",
            status.as_u16(),
            status.as_u16()
        )
        .trim_end()
        .to_owned()
        .into());
    }
    let bytes = ctx(
        response.body_mut().read_to_vec(),
        "read caddy download response",
    )?;
    path_ctx(
        fs::write(&destination, &bytes),
        "write caddy binary",
        &destination,
    )?;
    #[cfg(unix)]
    if target_os != "windows" {
        use std::os::unix::fs::PermissionsExt;
        path_ctx(
            fs::set_permissions(&destination, fs::Permissions::from_mode(0o755)),
            "chmod caddy binary",
            &destination,
        )?;
    }
    log_labeled(
        mode,
        output,
        "devhost",
        &format!("Caddy downloaded to {}", destination.display()),
    )?;
    Ok(())
}

pub fn privileged_ports(mode: Mode, output: &mut impl Write) -> Result<(), Failure> {
    let directory = clean(&machine::state_directory()?.join("caddy"));
    privileged_ports_for(
        &directory,
        std::env::consts::OS,
        std::env::consts::ARCH,
        mode,
        output,
    )
}

pub fn privileged_ports_for(
    directory: &Path,
    runtime_os: &str,
    runtime_arch: &str,
    mode: Mode,
    output: &mut impl Write,
) -> Result<(), Failure> {
    if matches!(runtime_os, "macos" | "darwin") {
        log_labeled(
            mode,
            output,
            "devhost",
            "managed caddy does not need privileged-port setup on macOS.",
        )?;
        return Ok(());
    }
    if runtime_os != "linux" {
        return Err(
            "Managed Caddy privileged-port setup is currently supported on Linux only."
                .to_owned()
                .into(),
        );
    }
    let executable = directory.join("caddy");
    if !executable.exists() {
        log_labeled(
            mode,
            output,
            "devhost",
            &format!(
                "managed caddy binary not found at {}. Downloading it first.",
                executable.display()
            ),
        )?;
        download_from_base(
            directory,
            runtime_os,
            runtime_arch,
            "https://caddyserver.com/api/download",
            mode,
            output,
        )?;
    }
    log_labeled(
        mode,
        output,
        "devhost",
        "managed caddy privileged-port setup may prompt for your password because granting low-port bind capability is privileged.",
    )?;
    let is_root = {
        #[cfg(unix)]
        {
            // SAFETY: geteuid has no preconditions and cannot fail.
            unsafe { libc::geteuid() == 0 }
        }
        #[cfg(not(unix))]
        {
            false
        }
    };
    let mut cmd = if is_root {
        let mut c = Command::new("setcap");
        c.arg("cap_net_bind_service=+ep").arg(&executable);
        c
    } else {
        let mut c = Command::new("sudo");
        c.args(["setcap", "cap_net_bind_service=+ep"])
            .arg(&executable);
        c
    };
    let ok = cmd
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .status()
        .is_ok_and(|status| status.success());
    if !ok {
        return Err("Managed Caddy privileged-port setup failed. Check that `sudo` and `setcap` are available, then try again.".to_owned().into());
    }
    log_labeled(
        mode,
        output,
        "devhost",
        &format!(
            "managed caddy low-port binding enabled for {}",
            executable.display()
        ),
    )?;
    Ok(())
}

pub(crate) fn reload_managed_caddy(
    directory: &Path,
    admin_address: &str,
    mode: Mode,
    output: &mut impl Write,
    quiet: bool,
) -> Result<(), String> {
    let address = resolve_admin_address(admin_address);
    let result = run_managed_command(directory, &["reload"], Some(address), &[], false)?;
    if result.success {
        if !quiet {
            write_command_output(mode, output, &result)?;
        }
        return Ok(());
    }
    write_command_output(mode, output, &result)?;
    Err("Caddy reload failed. Check the Caddy diagnostics above.".to_owned())
}

fn prepare_lifecycle(directory: &Path, settings: &CaddySettings) -> Result<CaddySettings, String> {
    files::prepare_directories(directory)?;
    let _lock = route_lock(directory)?;
    let running = files::read_running_settings(directory, settings)?;
    files::write_config(directory, &running)?;
    Ok(running)
}

fn start_process(directory: &Path, settings: &CaddySettings) -> Result<CommandOutput, String> {
    let _lock = route_lock(directory)?;
    routes::render_managed_settings(directory, settings)?;
    let pid_file = directory.join("caddy.pid");
    let pid_str = pid_file.to_string_lossy().into_owned();
    let result = run_managed_command(
        directory,
        &["start", "--pidfile", &pid_str],
        None,
        &[],
        true,
    )?;
    if result.success {
        files::write_applied_settings(directory, settings)?;
    }
    Ok(result)
}

fn trust_after_start(
    directory: &Path,
    address: &str,
    mode: Mode,
    output: &mut impl Write,
    quiet: bool,
) -> Result<(), String> {
    let root_cert = directory.join("storage/pki/authorities/local/root.crt");
    let state = match trust::read_root_certificate_trust(&root_cert) {
        Ok(state) => state,
        Err(error) => return warn_labeled(mode, output, &trust::trust_check_warning(&error)),
    };
    if state != trust::RootCertificateTrust::Untrusted {
        return Ok(());
    }
    if mode == Mode::Agent || !io::stdin().is_terminal() {
        return warn_labeled(mode, output, trust::UNTRUSTED_ROOT_CERTIFICATE_WARNING);
    }
    let result = install_trust(directory, address, mode, output)?;
    if !result.success {
        write_command_output(mode, output, &result)?;
        return warn_labeled(mode, output, trust::UNTRUSTED_ROOT_CERTIFICATE_WARNING);
    }
    if !quiet {
        write_command_output(mode, output, &result)?;
    }
    log_labeled(mode, output, "devhost", "managed caddy local CA trusted.")
}

fn install_trust(
    directory: &Path,
    address: &str,
    mode: Mode,
    output: &mut impl Write,
) -> Result<CommandOutput, String> {
    log_labeled(
        mode,
        output,
        "devhost",
        "managed caddy is installing its local CA into the system trust store so browsers accept devhost HTTPS certificates. This may ask for your password.",
    )?;
    let prefix = label_prefix(mode, "caddy");
    let prompt = format!("{}Password: ", prefix.replace('%', "%%"));
    let env = [("SUDO_PROMPT", prompt.as_str())];
    run_managed_command(directory, &["trust"], Some(address), &env, false)
}

fn start_failure(result: &CommandOutput, directory: &Path) -> (Failure, bool) {
    let combined = format!(
        "{}\n{}",
        String::from_utf8_lossy(&result.stderr),
        String::from_utf8_lossy(&result.stdout)
    );
    let handled = combined.contains(":443: bind: permission denied");
    let (summary, hint) = if handled {
        if cfg!(target_os = "macos") {
            (
                "Caddy cannot bind HTTPS port 443 to loopback without privileges on macOS."
                    .to_owned(),
                "Use wildcard listeners by leaving bindHost out of the [caddy] table of config.toml, or use a privileged launcher for loopback-only HTTPS."
                    .to_owned(),
            )
        } else {
            (
                "Caddy cannot listen on HTTPS port 443 without privileged-port setup.".to_owned(),
                "Run 'devhost caddy privileged-ports', then 'devhost caddy start'.".to_owned(),
            )
        }
    } else {
        (
            "Caddy start failed.".to_owned(),
            format!("Check the Caddy logs in {}.", directory.display()),
        )
    };
    let message = format!("{summary} {hint}");
    (
        Failure {
            message,
            summary: Some(summary),
            hint: Some(hint),
        },
        handled,
    )
}

pub(crate) fn route_lock(directory: &Path) -> Result<File, String> {
    let mut options = OpenOptions::new();
    options.create(true).truncate(false).read(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let lock = ctx(
        options.open(directory.join("routes.lock")),
        "open managed Caddy routes lock",
    )?;
    ctx(lock.lock(), "lock managed Caddy routes")?;
    Ok(lock)
}

fn resolve_admin_address(configured: &str) -> &str {
    let trimmed = configured.trim();
    if trimmed.is_empty() {
        "127.0.0.1:20197"
    } else {
        trimmed
    }
}

pub(crate) fn is_running(address: &str) -> bool {
    let agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(1)))
        .max_redirects(0)
        .proxy(None)
        .build()
        .new_agent();
    agent
        .get(format!("http://{address}/config/"))
        .call()
        .is_ok_and(|response| response.status().is_success())
}

fn run_managed_command(
    directory: &Path,
    args: &[&str],
    admin_address: Option<&str>,
    extra_env: &[(&str, &str)],
    background: bool,
) -> Result<CommandOutput, String> {
    let executable = if cfg!(windows) { "caddy.exe" } else { "caddy" };
    let canonical = path_ctx(
        fs::canonicalize(directory),
        "resolve managed Caddy directory",
        directory,
    )?;
    let bundled = canonical.join(executable);
    let binary = if bundled.exists() {
        bundled
    } else {
        PathBuf::from(executable)
    };
    let mut command = Command::new(binary);
    command.current_dir(&canonical).args(args);
    if let Some(address) = admin_address
        && !address.trim().is_empty()
    {
        command.args(["--address", address.trim()]);
    }
    command
        .arg("--config")
        .arg(canonical.join("Caddyfile"))
        .args(["--adapter", "caddyfile"]);
    for (key, value) in extra_env {
        command.env(key, value);
    }

    if background {
        return run_background_command(&mut command, &canonical);
    }
    let output = command.stdin(Stdio::inherit()).output();
    match output {
        Ok(output) => {
            let success = output.status.success();
            Ok(CommandOutput {
                stdout: output.stdout,
                stderr: output.stderr,
                success,
            })
        }
        Err(error) => Ok(CommandOutput {
            stdout: Vec::new(),
            stderr: error.to_string().into_bytes(),
            success: false,
        }),
    }
}

fn run_background_command(
    command: &mut Command,
    directory: &Path,
) -> Result<CommandOutput, String> {
    let runtime_path = directory.join("caddy.runtime.log");
    let prev_runtime_len = fs::metadata(&runtime_path).ok().map(|meta| meta.len());

    let stdout_file = open_private_rw(&directory.join("caddy.stdout.log"))?;
    let stderr_file = open_private_rw(&directory.join("caddy.stderr.log"))?;
    let stdout_dup = ctx(stdout_file.try_clone(), "duplicate stdout log")?;
    let stderr_dup = ctx(stderr_file.try_clone(), "duplicate stderr log")?;

    let status = command
        // The background server outlives the command that starts it. Terminal
        // interrupts must reach that command without stopping shared routing.
        .process_group(0)
        .stdin(Stdio::inherit())
        .stdout(Stdio::from(stdout_dup))
        .stderr(Stdio::from(stderr_dup))
        .status();

    let out = read_file_from(stdout_file, 0)?;
    let mut err_out = read_file_from(stderr_file, 0)?;
    if let Ok(runtime_file) = File::open(&runtime_path) {
        let len = runtime_file.metadata().map(|meta| meta.len()).unwrap_or(0);
        let offset = prev_runtime_len.filter(|&prev| len >= prev).unwrap_or(0);
        if let Ok(delta) = read_file_from(runtime_file, offset) {
            err_out.extend_from_slice(&delta);
        }
    }
    match status {
        Ok(status) => {
            let success = status.success();
            if !success && err_out.is_empty() {
                err_out = format!("exit status: {status}").into_bytes();
            }
            Ok(CommandOutput {
                stdout: out,
                stderr: err_out,
                success,
            })
        }
        Err(error) => {
            if err_out.is_empty() {
                err_out = error.to_string().into_bytes();
            }
            Ok(CommandOutput {
                stdout: out,
                stderr: err_out,
                success: false,
            })
        }
    }
}

fn open_private_rw(path: &Path) -> Result<File, String> {
    let mut options = OpenOptions::new();
    options.create(true).read(true).write(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    path_ctx(options.open(path), "capture Caddy output", path)
}

fn read_file_from(mut file: File, offset: u64) -> Result<Vec<u8>, String> {
    ctx(file.seek(SeekFrom::Start(offset)), "seek Caddy log")?;
    let mut buffer = Vec::new();
    ctx(file.read_to_end(&mut buffer), "read Caddy log")?;
    Ok(buffer)
}

fn write_command_output(
    mode: Mode,
    output: &mut impl Write,
    result: &CommandOutput,
) -> Result<(), String> {
    output::write_caddy_output(mode, output, &result.stderr, !result.success)?;
    output::write_caddy_output(mode, output, &result.stdout, !result.success)
}

fn forget(pid: &Path, applied: &Path) -> io::Result<()> {
    for file in [pid, applied] {
        match fs::remove_file(file) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
    }
    Ok(())
}

fn label_prefix(mode: Mode, label: &str) -> String {
    match mode {
        Mode::Agent => format!("{label}: "),
        Mode::Human => {
            let width = "devhost".len();
            let padding = width.saturating_sub(label.len());
            format!("{label}{} | ", " ".repeat(padding))
        }
    }
}

pub(crate) fn log_labeled(
    mode: Mode,
    output: &mut impl Write,
    label: &str,
    message: &str,
) -> Result<(), String> {
    let prefix = label_prefix(mode, label);
    let rendered = cli_command_kit::display_message(message);
    for line in rendered.strip_suffix('\n').unwrap_or(&rendered).split('\n') {
        ctx(
            writeln!(output, "{prefix}{line}"),
            "write managed Caddy log",
        )?;
    }
    Ok(())
}

fn warn_labeled(mode: Mode, output: &mut impl Write, message: &str) -> Result<(), String> {
    let tagged = match mode {
        Mode::Agent => format!("WARN: {message}"),
        Mode::Human => format!("[WARN] {message}"),
    };
    log_labeled(mode, output, "devhost", &tagged)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn start_failure_and_trust_warnings_format_messages_for_both_modes() {
        let dir = Path::new("/tmp/caddy-dir");
        let perm = CommandOutput {
            stdout: Vec::new(),
            stderr: b"listen tcp :443: bind: permission denied\n".to_vec(),
            success: false,
        };
        let (failure, handled) = start_failure(&perm, dir);
        assert!(handled);
        assert!(failure.message.contains("443"));

        let generic = CommandOutput {
            stdout: b"out".to_vec(),
            stderr: b"address already in use".to_vec(),
            success: false,
        };
        let (failure, handled) = start_failure(&generic, dir);
        assert!(!handled);
        assert!(failure.message.contains("/tmp/caddy-dir"));

        let fixture = tempfile::tempdir().unwrap();
        let caddy_dir = fixture.path().join("caddy");
        let cert_path = caddy_dir.join("storage/pki/authorities/local/root.crt");
        fs::create_dir_all(cert_path.parent().unwrap()).unwrap();
        fs::write(&cert_path, "not a pem").unwrap();
        let mut out = Vec::new();
        trust_after_start(&caddy_dir, "127.0.0.1:0", Mode::Agent, &mut out, false).unwrap();
        assert!(
            String::from_utf8(out)
                .unwrap()
                .contains("WARN: managed caddy could not check")
        );

        let mut human_out = Vec::new();
        warn_labeled(Mode::Human, &mut human_out, "careful").unwrap();
        assert_eq!(
            String::from_utf8(human_out).unwrap(),
            "devhost | [WARN] careful\n"
        );

        // ensure_managed_caddy_config creates layout, and ensure_admin_available reports HTTP non-2xx.
        let cfg_dir = fixture.path().join("cfg-caddy");
        ensure_managed_caddy_config(&cfg_dir, &CaddySettings::default()).unwrap();
        assert!(cfg_dir.join("Caddyfile").exists());
        assert!(root_certificate_trust_warning(&caddy_dir).is_some());

        let http_listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let http_port = http_listener.local_addr().unwrap().port();
        let srv = std::thread::spawn(move || {
            if let Ok((mut s, _)) = http_listener.accept() {
                let mut b = [0u8; 256];
                let _ = std::io::Read::read(&mut s, &mut b);
                let _ =
                    s.write_all(b"HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\n\r\n");
            }
        });
        let admin_err = ensure_admin_available(&format!("127.0.0.1:{http_port}")).unwrap_err();
        srv.join().unwrap();
        assert!(admin_err.message.contains("503"));
    }

    #[test]
    fn background_command_reads_runtime_log_delta_and_handles_missing_binary() {
        let fixture = tempfile::tempdir().unwrap();
        let dir = fixture.path();
        fs::write(dir.join("caddy.runtime.log"), "old-line\n").unwrap();
        let mut cmd = Command::new("sh");
        cmd.args([
            "-c",
            "echo new-runtime >> caddy.runtime.log; echo out-line; exit 1",
        ])
        .current_dir(dir);
        let result = run_background_command(&mut cmd, dir).unwrap();
        assert!(!result.success);
        assert_eq!(String::from_utf8_lossy(&result.stdout), "out-line\n");
        let stderr = String::from_utf8_lossy(&result.stderr);
        assert!(stderr.contains("new-runtime"), "{stderr}");
        assert!(!stderr.contains("old-line"), "{stderr}");

        let mut missing = Command::new("/nonexistent-devhost-caddy-bin");
        let result = run_background_command(&mut missing, dir).unwrap();
        assert!(!result.success);
        assert!(!result.stderr.is_empty());
    }
}
