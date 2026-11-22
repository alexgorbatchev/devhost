use std::{
    fmt::Display,
    fs::{self, File, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::Duration,
};

use cli_command_kit::Mode;

use crate::{
    config::{self, AppliedCaddySettings, CaddySettings},
    machine,
    paths::clean,
};

mod files;

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

pub(crate) fn stop(mode: Mode, output: &mut impl Write) -> Result<(), String> {
    let directory = clean(&machine::state_directory()?.join("caddy"));
    let settings = config::read()?.caddy;
    files::prepare_directories(&directory)?;
    let _lock = route_lock(&directory)?;
    let applied = directory.join("applied.json");
    let settings = running_settings(&applied)?.unwrap_or(settings);
    files::write_config(&directory, &settings)?;
    let address = settings.admin_address.trim();
    let address = if address.is_empty() {
        "127.0.0.1:20197"
    } else {
        address
    };
    let pid = directory.join("caddy.pid");
    let managed = pid.exists();
    if !is_running(address) {
        if managed {
            ctx(
                forget(&pid, &applied),
                "remove stale managed caddy pid file",
            )?;
            return log(
                mode,
                output,
                "devhost",
                "managed caddy is not running. Removed the stale pid file.",
            );
        }
        return log(mode, output, "devhost", "managed caddy is not running.");
    }
    if !managed {
        return Err("A Caddy admin API is already listening on the devhost-managed address, but it was not started by devhost.".to_owned());
    }

    let result = run_stop(&directory, address)?;
    if !result.status.success() {
        for stream in [&result.stderr, &result.stdout] {
            for line in String::from_utf8_lossy(stream)
                .lines()
                .filter(|line| !line.trim().is_empty())
            {
                log(mode, output, "caddy", line)?;
            }
        }
        return Err("Caddy stop failed. Check the Caddy diagnostics above.".to_owned());
    }
    ctx(
        forget(&pid, &applied),
        "remove managed caddy pid file after stop",
    )?;
    log(mode, output, "devhost", "managed caddy stopped.")
}

fn route_lock(directory: &Path) -> Result<File, String> {
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

fn running_settings(path: &Path) -> Result<Option<CaddySettings>, String> {
    match fs::read(path) {
        Ok(contents) => {
            let applied: AppliedCaddySettings = path_ctx(
                serde_json::from_slice(&contents),
                "parse applied managed Caddy settings",
                path,
            )?;
            Ok(Some(applied.into()))
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("read applied managed Caddy settings: {error}")),
    }
}

fn is_running(address: &str) -> bool {
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

fn run_stop(directory: &Path, address: &str) -> Result<std::process::Output, String> {
    let executable = if cfg!(windows) { "caddy.exe" } else { "caddy" };
    let directory = path_ctx(
        fs::canonicalize(directory),
        "resolve managed Caddy directory",
        directory,
    )?;
    let bundled = directory.join(executable);
    let binary = if bundled.exists() {
        bundled
    } else {
        PathBuf::from(executable)
    };
    ctx(
        Command::new(binary)
            .current_dir(&directory)
            .args(["stop", "--address", address, "--config"])
            .arg(directory.join("Caddyfile"))
            .args(["--adapter", "caddyfile"])
            .stdin(Stdio::inherit())
            .output(),
        "run Caddy stop",
    )
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

fn log(mode: Mode, output: &mut impl Write, label: &str, message: &str) -> Result<(), String> {
    let separator = match mode {
        Mode::Agent => ":",
        Mode::Human => " |",
    };
    ctx(
        writeln!(
            output,
            "{label}{separator} {}",
            cli_command_kit::display_message(message)
        ),
        "write managed Caddy log",
    )
}
