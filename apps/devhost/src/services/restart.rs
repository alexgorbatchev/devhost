#[cfg(any(target_os = "linux", test))]
use std::os::unix::ffi::OsStringExt;
use std::{
    ffi::{CString, OsString},
    fs::{self, DirBuilder, File, OpenOptions},
    os::unix::{
        ffi::OsStrExt,
        fs::{DirBuilderExt, OpenOptionsExt, PermissionsExt},
        process::CommandExt,
    },
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

use super::detach::{DETACHED_LOG_ENV, STACK_LOG_ENV};
use std::collections::{BTreeMap, BTreeSet};
#[cfg(any(target_os = "macos", test))]
mod macos;
use crate::{
    caddy::stacks::{LiveStack, read_live_stacks, signal_live_stack},
    cliout::{self, ServiceOutput},
    daemon::{
        self,
        protocol::{LaunchKind, StoredLaunchSpec},
    },
    paths::manifest_identity,
};

const POLL_INTERVAL: Duration = Duration::from_millis(100);
const STOP_TIMEOUT: Duration = Duration::from_secs(15);
const REGISTRATION_TIMEOUT: Duration = Duration::from_secs(30);

struct RestartLock(File);

impl Drop for RestartLock {
    fn drop(&mut self) {
        // Closing alone can leave flock held by a concurrent fork until exec.
        let _ = self.0.unlock();
    }
}

struct StackLaunch {
    stack: LiveStack,
    args: Vec<OsString>,
    directory: PathBuf,
    environment: Vec<(OsString, OsString)>,
    log: File,
    log_path: PathBuf,
}

enum RestartAction {
    Replace(StackLaunch),
    Retire(LiveStack),
    Preserve(LiveStack, String),
}

enum DaemonRestartAction {
    Replace {
        stack: LiveStack,
        spec: StoredLaunchSpec,
        record_log: bool,
        log_path: PathBuf,
        daemon_exe_identity: String,
        daemon_stack_count: usize,
    },
    Retire(LiveStack),
    Preserve(LiveStack, String),
}

/// Replace selected supervisors with the current executable. `None` selects
/// every stack in the state directory; a manifest selects only that project.
pub fn restart_stacks(
    manifest: Option<&Path>,
    state_dir: &Path,
    output: &ServiceOutput,
) -> Result<(), String> {
    let caddy_dir = state_dir.join("caddy");
    DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(state_dir)
        .map_err(|error| format!("create restart directory: {error}"))?;
    let lock = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .mode(0o600)
        .open(state_dir.join("restart.lock"))
        .map_err(|error| format!("open restart lock: {error}"))?;
    lock.try_lock()
        .map_err(|error| format!("another stack restart is in progress: {error}"))?;
    let _lock = RestartLock(lock);
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    let c_executable =
        CString::new(executable.as_os_str().as_bytes()).map_err(|error| error.to_string())?;
    // SAFETY: the CString is NUL terminated and valid for this call.
    if unsafe { libc::access(c_executable.as_ptr(), libc::X_OK) } != 0 {
        return Err(format!(
            "replacement executable unavailable; no stacks were stopped: {}",
            std::io::Error::last_os_error()
        ));
    }
    let identity = manifest.map(manifest_identity);
    let stacks: Vec<_> = read_live_stacks(&caddy_dir)?
        .into_iter()
        .filter(|stack| {
            identity.as_ref().is_none_or(|manifest| {
                manifest_identity(Path::new(&stack.manifest_path)) == *manifest
            })
        })
        .collect();
    if stacks.is_empty() {
        return output
            .log_stdout_checked("devhost", "No running stacks to restart.")
            .map_err(|error| error.to_string());
    }
    let directory = tempfile::Builder::new()
        .prefix("restart-")
        .permissions(fs::Permissions::from_mode(0o700))
        .tempdir_in(state_dir)
        .map_err(|error| format!("create restart logs: {error}"))?;

    let mut legacy_launches = Vec::new();
    let mut daemon_actions = Vec::new();
    let mut daemon_specs_cache: BTreeMap<String, daemon::client::ExportedDaemonSpecs> =
        BTreeMap::new();

    for stack in stacks {
        if !stack.daemon_socket.is_empty() {
            if let Err(error) = check_not_ancestor(stack.pid) {
                return Err(format!(
                    "capture {} (PID {}); no stacks were stopped: {error}",
                    stack.name, stack.pid
                ));
            }
            if !daemon_specs_cache.contains_key(&stack.daemon_socket) {
                let exported = daemon::client::export_specs(Path::new(&stack.daemon_socket))
                    .map_err(|error| {
                        format!(
                            "capture {} (PID {}); no stacks were stopped: {error}",
                            stack.name, stack.pid
                        )
                    })?;
                daemon_specs_cache.insert(stack.daemon_socket.clone(), exported);
            }
            let daemon_info = daemon_specs_cache
                .get(&stack.daemon_socket)
                .expect("cached daemon specs");
            let Some(exported) = daemon_info
                .stacks
                .iter()
                .find(|entry| entry.stack_id == stack.stack_id)
            else {
                return Err(format!(
                    "capture {} (PID {}); no stacks were stopped: stack record was not found in its daemon",
                    stack.name, stack.pid
                ));
            };
            let dir_exists =
                launch_directory_exists(&exported.spec.cwd, &stack, manifest.is_none()).map_err(
                    |error| {
                        format!(
                            "capture {} (PID {}); no stacks were stopped: {error}",
                            stack.name, stack.pid
                        )
                    },
                )?;
            if !dir_exists {
                daemon_actions.push(DaemonRestartAction::Retire(stack));
                continue;
            }
            if let LaunchKind::Serve {
                directory: ref serve_dir,
                port: None,
                ..
            } = exported.spec.kind
            {
                let root = if serve_dir.is_absolute() {
                    serve_dir.clone()
                } else {
                    exported.spec.cwd.join(serve_dir)
                };
                if let Err(error) =
                    crate::files::FileHandler::open(&root)
                        .map(drop)
                        .map_err(|err| {
                            format!("{}: {err}", cliout::display_path(&root.to_string_lossy()))
                        })
                {
                    daemon_actions.push(DaemonRestartAction::Preserve(stack, error));
                    continue;
                }
            }
            let mut spec = exported.spec.clone();
            if let LaunchKind::Manifest {
                ref mut local,
                ref mut remote,
                ..
            } = spec.kind
            {
                *remote = stack.remote;
                *local = !stack.remote;
            }
            let log_name = if stack.stack_id.is_empty() {
                format!("{}.log", stack.pid)
            } else {
                format!("{}.log", stack.stack_id)
            };
            let log_path = directory.path().join(log_name);
            OpenOptions::new()
                .create_new(true)
                .write(true)
                .mode(0o600)
                .open(&log_path)
                .map_err(|error| format!("create restart log: {error}"))?;
            let record_log = !exported.spec.log_path.is_empty();
            daemon_actions.push(DaemonRestartAction::Replace {
                stack,
                spec,
                record_log,
                log_path,
                daemon_exe_identity: daemon_info.exe_identity.clone(),
                daemon_stack_count: daemon_info.stacks.len(),
            });
            continue;
        }

        let captured = capture_launch(&stack, manifest.is_none()).map_err(|error| {
            format!(
                "capture {} (PID {}); no stacks were stopped: {error}",
                stack.name, stack.pid
            )
        })?;
        let Some((args, cwd, environment)) = captured else {
            legacy_launches.push(RestartAction::Retire(stack));
            continue;
        };
        if let Err(error) = validate_serve_launch(&args, &cwd) {
            legacy_launches.push(RestartAction::Preserve(stack, error));
            continue;
        }
        let log_path = directory.path().join(format!("{}.log", stack.pid));
        let log = OpenOptions::new()
            .create_new(true)
            .write(true)
            .mode(0o600)
            .open(&log_path)
            .map_err(|error| format!("create restart log: {error}"))?;
        legacy_launches.push(RestartAction::Replace(StackLaunch {
            stack,
            args,
            directory: cwd,
            environment,
            log,
            log_path,
        }));
    }

    // Runtime logs remain available to the replacement and for failure diagnosis.
    let _retained_logs = directory.keep();
    let mut errors = Vec::new();
    let current_exe_id = daemon::exe_identity(&executable);

    if manifest.is_some() {
        for action in daemon_actions {
            let DaemonRestartAction::Replace {
                stack,
                spec,
                record_log,
                log_path,
                daemon_exe_identity,
                daemon_stack_count,
            } = action
            else {
                continue;
            };
            output
                .log_stdout_checked(
                    "devhost",
                    &format!(
                        "Restarting {} (PID {}); log: {}",
                        stack.name,
                        stack.pid,
                        cliout::display_path(&log_path.to_string_lossy())
                    ),
                )
                .map_err(|error| error.to_string())?;
            let binary_changed =
                !daemon_exe_identity.is_empty() && daemon_exe_identity != current_exe_id;
            let result = if binary_changed && daemon_stack_count == 1 {
                daemon::client::drain_daemon(
                    Path::new(&stack.daemon_socket),
                    stack.pid,
                    Vec::new(),
                    STOP_TIMEOUT,
                )
                .and_then(|drain| {
                    if !drain.errors.is_empty() {
                        Err(drain.errors.join("; "))
                    } else {
                        daemon::client::start_replaced_in_daemon(
                            state_dir,
                            &executable,
                            spec,
                            &log_path,
                            record_log,
                            output.mode(),
                        )
                    }
                })
            } else {
                if binary_changed {
                    output.log_stderr(
                        "devhost",
                        &cliout::warning(
                            output.mode(),
                            &format!(
                                "shared daemon PID {} hosts other stacks; run \"devhost restart-all\" to switch it to the new binary",
                                stack.pid
                            ),
                        ),
                    );
                }
                daemon::client::restart_stack_in_daemon(
                    Path::new(&stack.daemon_socket),
                    &stack.stack_id,
                    &log_path,
                    record_log,
                )
            };
            match result {
                Ok((_, new_pid, new_name)) => output
                    .log_stdout_checked(
                        "devhost",
                        &format!(
                            "Restarted {new_name} (PID {new_pid}); services may still be starting."
                        ),
                    )
                    .map_err(|error| error.to_string())?,
                Err(error) => errors.push(format!(
                    "restart {} (PID {}), log {}: {error}",
                    stack.name,
                    stack.pid,
                    cliout::display_path(&log_path.to_string_lossy())
                )),
            }
        }
    } else if !daemon_actions.is_empty() {
        struct PendingReplace {
            stack: LiveStack,
            spec: StoredLaunchSpec,
            record_log: bool,
            log_path: PathBuf,
        }
        #[derive(Default)]
        struct DaemonDrainGroup {
            daemon_pid: i32,
            preserve_ids: Vec<String>,
            retire_list: Vec<LiveStack>,
            replace_list: Vec<PendingReplace>,
        }
        let mut by_socket: BTreeMap<String, DaemonDrainGroup> = BTreeMap::new();
        for action in daemon_actions {
            match action {
                DaemonRestartAction::Preserve(stack, error) => {
                    errors.push(format!(
                        "restart {} (PID {}), left running: {error}",
                        stack.name, stack.pid
                    ));
                    let entry = by_socket.entry(stack.daemon_socket.clone()).or_default();
                    entry.daemon_pid = stack.pid;
                    entry.preserve_ids.push(stack.stack_id.clone());
                }
                DaemonRestartAction::Retire(stack) => {
                    let entry = by_socket.entry(stack.daemon_socket.clone()).or_default();
                    entry.daemon_pid = stack.pid;
                    entry.retire_list.push(stack);
                }
                DaemonRestartAction::Replace {
                    stack,
                    spec,
                    record_log,
                    log_path,
                    ..
                } => {
                    let entry = by_socket.entry(stack.daemon_socket.clone()).or_default();
                    entry.daemon_pid = stack.pid;
                    entry.replace_list.push(PendingReplace {
                        stack,
                        spec,
                        record_log,
                        log_path,
                    });
                }
            }
        }

        let mut ready_to_start = Vec::new();
        for (
            socket,
            DaemonDrainGroup {
                daemon_pid,
                preserve_ids,
                retire_list,
                replace_list,
            },
        ) in by_socket
        {
            if retire_list.is_empty() && replace_list.is_empty() {
                continue;
            }
            for item in &replace_list {
                output
                    .log_stdout_checked(
                        "devhost",
                        &format!(
                            "Restarting {} (PID {}); log: {}",
                            item.stack.name,
                            item.stack.pid,
                            cliout::display_path(&item.log_path.to_string_lossy())
                        ),
                    )
                    .map_err(|error| error.to_string())?;
            }
            match daemon::client::drain_daemon(
                Path::new(&socket),
                daemon_pid,
                preserve_ids,
                STOP_TIMEOUT,
            ) {
                Ok(drain) => {
                    let stopped: BTreeSet<String> = drain.stopped.into_iter().collect();
                    for err in drain.errors {
                        errors.push(err);
                    }
                    for stack in retire_list {
                        if stopped.contains(&stack.stack_id) {
                            output
                                .log_stdout_checked(
                                    "devhost",
                                    &format!(
                                        "Stopped {} (PID {}) because its launch directory was removed.",
                                        stack.name, stack.pid
                                    ),
                                )
                                .map_err(|error| error.to_string())?;
                        }
                    }
                    for item in replace_list {
                        if stopped.contains(&item.stack.stack_id) {
                            ready_to_start.push(item);
                        }
                    }
                }
                Err(error) => {
                    for stack in retire_list {
                        errors.push(format!(
                            "stop {} (PID {}) with missing launch directory: {error}",
                            stack.name, stack.pid
                        ));
                    }
                    for item in replace_list {
                        errors.push(format!(
                            "restart {} (PID {}), log {}: {error}",
                            item.stack.name,
                            item.stack.pid,
                            cliout::display_path(&item.log_path.to_string_lossy())
                        ));
                    }
                }
            }
        }

        for item in ready_to_start {
            match daemon::client::start_replaced_in_daemon(
                state_dir,
                &executable,
                item.spec,
                &item.log_path,
                item.record_log,
                output.mode(),
            ) {
                Ok((_, new_pid, new_name)) => output
                    .log_stdout_checked(
                        "devhost",
                        &format!(
                            "Restarted {new_name} (PID {new_pid}); services may still be starting."
                        ),
                    )
                    .map_err(|error| error.to_string())?,
                Err(error) => errors.push(format!(
                    "restart {} (PID {}), log {}: {error}",
                    item.stack.name,
                    item.stack.pid,
                    cliout::display_path(&item.log_path.to_string_lossy())
                )),
            }
        }
    }

    for action in legacy_launches {
        let launch = match action {
            RestartAction::Replace(launch) => launch,
            RestartAction::Preserve(stack, error) => {
                errors.push(format!(
                    "restart {} (PID {}), left running: {error}",
                    stack.name, stack.pid
                ));
                continue;
            }
            RestartAction::Retire(stack) => {
                match stop_stack(&stack, &caddy_dir) {
                    Ok(()) => output
                        .log_stdout_checked(
                            "devhost",
                            &format!(
                                "Stopped {} (PID {}) because its launch directory was removed.",
                                stack.name, stack.pid
                            ),
                        )
                        .map_err(|error| error.to_string())?,
                    Err(error) => errors.push(format!(
                        "stop {} (PID {}) with missing launch directory: {error}",
                        stack.name, stack.pid
                    )),
                }
                continue;
            }
        };
        output
            .log_stdout_checked(
                "devhost",
                &format!(
                    "Restarting {} (PID {}); log: {}",
                    launch.stack.name,
                    launch.stack.pid,
                    cliout::display_path(&launch.log_path.to_string_lossy())
                ),
            )
            .map_err(|error| error.to_string())?;
        if let Err(error) = replace_stack(&launch, &caddy_dir, &executable, output) {
            errors.push(format!(
                "restart {} (PID {}), log {}: {error}",
                launch.stack.name,
                launch.stack.pid,
                cliout::display_path(&launch.log_path.to_string_lossy())
            ));
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("\n"))
    }
}

#[cfg(target_os = "linux")]
fn check_not_ancestor(target_pid: i32) -> Result<(), String> {
    let mut ancestor = std::process::id() as i32;
    while ancestor > 1 {
        if ancestor == target_pid {
            return Err(
                "cannot restart an ancestor of this command; run it from a separate terminal"
                    .to_owned(),
            );
        }
        ancestor = crate::procid::read_linux_stat(ancestor)
            .map_err(|error| error.to_string())?
            .parent_pid;
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn check_not_ancestor(target_pid: i32) -> Result<(), String> {
    let mut ancestor = std::process::id() as i32;
    while ancestor > 1 {
        if ancestor == target_pid {
            return Err(
                "cannot restart an ancestor of this command; run it from a separate terminal"
                    .to_owned(),
            );
        }
        ancestor = crate::procid::read_macos_info(ancestor)
            .map_err(|error| error.to_string())?
            .pbi_ppid as i32;
    }
    Ok(())
}

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
fn check_not_ancestor(_target_pid: i32) -> Result<(), String> {
    Ok(())
}

type CapturedLaunch = (Vec<OsString>, PathBuf, Vec<(OsString, OsString)>);

fn validate_serve_launch(args: &[OsString], cwd: &Path) -> Result<(), String> {
    if args.first().is_none_or(|arg| arg != "serve") {
        return Ok(());
    }
    let parsed = crate::cli::serve_command()
        .try_get_matches_from(args)
        .map_err(|error| error.to_string())?;
    if parsed.get_one::<i32>("port").is_some() || parsed.get_many::<String>("command").is_some() {
        return Ok(());
    }
    let root = cwd.join(
        parsed
            .get_one::<PathBuf>("dir")
            .map(PathBuf::as_path)
            .unwrap_or(Path::new(".")),
    );
    crate::files::FileHandler::open(&root)
        .map(drop)
        .map_err(|error| format!("{}: {error}", cliout::display_path(&root.to_string_lossy())))
}

fn launch_directory_exists(
    directory: &Path,
    stack: &LiveStack,
    retire_missing: bool,
) -> Result<bool, String> {
    match fs::metadata(directory) {
        Ok(info) if info.is_dir() => Ok(true),
        Ok(_) => Err("launch working directory is not a directory".to_owned()),
        Err(error) if retire_missing && error.kind() == std::io::ErrorKind::NotFound => {
            if !stack.is_alive() {
                return Err("stack process changed during capture".to_owned());
            }
            Ok(false)
        }
        Err(error) => Err(format!("read launch working directory: {error}")),
    }
}

fn preserve_serve_session(mut args: Vec<OsString>, stack: &LiveStack) -> Vec<OsString> {
    if !stack.manifest_path.is_empty() || args.first().is_none_or(|arg| arg != "serve") {
        return args;
    }
    if args.iter().take_while(|arg| *arg != "--").any(|arg| {
        let arg = arg.as_bytes();
        arg == b"--session-id"
            || arg.starts_with(b"--session-id=")
            || arg == b"--domain"
            || arg.starts_with(b"--domain=")
            || arg.starts_with(b"-d")
    }) {
        return args;
    }
    args.splice(
        1..1,
        [OsString::from("--session-id"), OsString::from(&stack.name)],
    );
    args
}

#[cfg(target_os = "linux")]
fn capture_launch(
    stack: &LiveStack,
    retire_missing: bool,
) -> Result<Option<CapturedLaunch>, String> {
    let mut ancestor = std::process::id() as i32;
    while ancestor > 1 {
        if ancestor == stack.pid {
            return Err(
                "cannot restart an ancestor of this command; run it from a separate terminal"
                    .to_owned(),
            );
        }
        ancestor = crate::procid::read_linux_stat(ancestor)
            .map_err(|error| error.to_string())?
            .parent_pid;
    }
    let directory = PathBuf::from(format!("/proc/{}", stack.pid));
    let command = fs::read(directory.join("cmdline"))
        .map_err(|error| format!("read launch arguments: {error}"))?;
    let args: Vec<_> = nul_entries(&command).map(OsString::from_vec).collect();
    if args.len() < 2 || (args[1] != "start" && args[1] != "serve") {
        return Err("expected a devhost start or serve process".to_owned());
    }
    let cwd = fs::read_link(directory.join("cwd"))
        .map_err(|error| format!("read launch working directory: {error}"))?;
    if !launch_directory_exists(&cwd, stack, retire_missing)? {
        return Ok(None);
    }
    let bytes = fs::read(directory.join("environ"))
        .map_err(|error| format!("read launch environment: {error}"))?;
    let environment: Vec<_> = nul_entries(&bytes)
        .filter_map(|entry| {
            let index = entry.iter().position(|byte| *byte == b'=')?;
            Some((
                OsString::from_vec(entry[..index].to_vec()),
                OsString::from_vec(entry[index + 1..].to_vec()),
            ))
        })
        .collect();
    if environment.is_empty() {
        return Err("the operating system did not provide the launch environment".to_owned());
    }
    if !stack.is_alive() {
        return Err("stack process changed during capture".to_owned());
    }
    Ok(Some((
        preserve_serve_session(preserve_launch_mode(&args[1..], stack.remote), stack),
        cwd,
        environment,
    )))
}

#[cfg(target_os = "macos")]
fn capture_launch(
    stack: &LiveStack,
    retire_missing: bool,
) -> Result<Option<CapturedLaunch>, String> {
    use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};

    let mut ancestor = std::process::id() as i32;
    while ancestor > 1 {
        if ancestor == stack.pid {
            return Err(
                "cannot restart an ancestor of this command; run it from a separate terminal"
                    .to_owned(),
            );
        }
        ancestor = crate::procid::read_macos_info(ancestor)
            .map_err(|error| error.to_string())?
            .pbi_ppid as i32;
    }
    let pid = Pid::from_u32(stack.pid as u32);
    let mut system = System::new();
    system.refresh_processes_specifics(
        ProcessesToUpdate::Some(&[pid]),
        true,
        ProcessRefreshKind::nothing()
            .without_tasks()
            .with_cwd(UpdateKind::Always),
    );
    let process = system
        .process(pid)
        .ok_or("read launch arguments: process unavailable")?;
    let launch = macos::read_launch(stack.pid)
        .map_err(|error| format!("read launch arguments and environment: {error}"))?;
    let args = &launch.args;
    if args.len() < 2 || (args[1] != "start" && args[1] != "serve") {
        return Err("expected a devhost start or serve process".to_owned());
    }
    let cwd = process
        .cwd()
        .ok_or("read launch working directory: unavailable")?;
    if !launch_directory_exists(cwd, stack, retire_missing)? {
        return Ok(None);
    }
    let environment = launch.environment;
    if environment.is_empty() {
        return Err("the operating system did not provide the launch environment".to_owned());
    }
    if !stack.is_alive() {
        return Err("stack process changed during capture".to_owned());
    }
    Ok(Some((
        preserve_serve_session(preserve_launch_mode(&args[1..], stack.remote), stack),
        cwd.to_owned(),
        environment,
    )))
}

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
fn capture_launch(
    _stack: &LiveStack,
    _retire_missing: bool,
) -> Result<Option<CapturedLaunch>, String> {
    Err("capturing a running stack launch is not implemented for this platform".to_owned())
}

#[cfg(target_os = "linux")]
fn nul_entries(bytes: &[u8]) -> impl Iterator<Item = Vec<u8>> + '_ {
    // Remove exactly the trailing terminator, retaining empty argument values.
    bytes
        .strip_suffix(&[0])
        .unwrap_or(bytes)
        .split(|byte| *byte == 0)
        .filter(|entry| !bytes.is_empty() || !entry.is_empty())
        .map(<[u8]>::to_vec)
}

fn preserve_launch_mode(args: &[OsString], remote: bool) -> Vec<OsString> {
    let mut args = args.to_vec();
    if args.first().is_none_or(|arg| arg != "start") {
        return args;
    }
    let index = args
        .iter()
        .position(|arg| arg == "--")
        .unwrap_or(args.len());
    let start = if index >= 2
        && args[index - 2].as_bytes().starts_with(b"--remote=")
        && args[index - 1].as_bytes().starts_with(b"--local=")
    {
        index - 2
    } else {
        index
    };
    args.splice(
        start..index,
        [
            format!("--remote={remote}").into(),
            format!("--local={}", !remote).into(),
        ],
    );
    args
}

fn replace_launch_log(
    environment: &[(OsString, OsString)],
    log: &Path,
) -> Vec<(OsString, OsString)> {
    let mut recorded = false;
    let mut environment: Vec<_> = environment
        .iter()
        .filter(|(key, _)| {
            if key == DETACHED_LOG_ENV || key == STACK_LOG_ENV {
                recorded = true;
                false
            } else {
                true
            }
        })
        .cloned()
        .collect();
    if recorded {
        environment.push((STACK_LOG_ENV.into(), log.as_os_str().to_owned()));
    }
    environment
}

fn replace_stack(
    launch: &StackLaunch,
    caddy_dir: &Path,
    executable: &Path,
    output: &ServiceOutput,
) -> Result<(), String> {
    stop_stack(&launch.stack, caddy_dir)?;
    start_replacement(launch, caddy_dir, executable, output)
}

fn stop_stack(stack: &LiveStack, caddy_dir: &Path) -> Result<(), String> {
    signal_live_stack(caddy_dir, stack)?;
    let deadline = Instant::now() + STOP_TIMEOUT;
    while stack.is_alive() {
        if Instant::now() >= deadline {
            return Err(
                "stack is still stopping after 15s; replacement was not started".to_owned(),
            );
        }
        thread::sleep(POLL_INTERVAL);
    }
    Ok(())
}

fn start_replacement(
    launch: &StackLaunch,
    caddy_dir: &Path,
    executable: &Path,
    output: &ServiceOutput,
) -> Result<(), String> {
    let mut command = Command::new(executable);
    command
        .args(&launch.args)
        .current_dir(&launch.directory)
        .env_clear()
        .envs(replace_launch_log(&launch.environment, &launch.log_path))
        .stdin(Stdio::null())
        .stdout(launch.log.try_clone().map_err(|error| error.to_string())?)
        .stderr(launch.log.try_clone().map_err(|error| error.to_string())?);
    // SAFETY: setsid is async-signal-safe and the closure touches no shared data.
    unsafe {
        command.pre_exec(|| {
            if libc::setsid() < 0 {
                Err(std::io::Error::last_os_error())
            } else {
                Ok(())
            }
        });
    }
    let mut child = command
        .spawn()
        .map_err(|error| format!("start replacement: {error}"))?;
    let pid = child.id() as i32;
    let deadline = Instant::now() + REGISTRATION_TIMEOUT;
    loop {
        for stack in read_live_stacks(caddy_dir)? {
            if stack.pid == pid && stack.control_port > 0 {
                return output
                    .log_stdout_checked(
                        "devhost",
                        &format!(
                            "Restarted {} (PID {}); services may still be starting.",
                            stack.name, stack.pid
                        ),
                    )
                    .map_err(|error| error.to_string());
            }
        }
        if let Some(status) = child.try_wait().map_err(|error| error.to_string())? {
            return Err(format!(
                "replacement exited before its control server registered: {status}"
            ));
        }
        if Instant::now() >= deadline {
            return Err(format!(
                "replacement PID {pid} has not registered after 30s; it remains running, inspect its log"
            ));
        }
        thread::sleep(POLL_INTERVAL);
    }
}

#[cfg(all(test, any(target_os = "linux", target_os = "macos")))]
mod tests {
    use super::*;
    use cli_command_kit::Mode;
    use serde_json::json;
    use std::{io, process::Child};

    #[test]
    fn restart_preflight_uses_serve_arguments_and_opens_only_file_roots() {
        let fixture = tempfile::tempdir().unwrap();
        let root = fixture.path();
        fs::create_dir(root.join("public")).unwrap();
        for args in [
            vec!["start"],
            vec!["serve", "-d", "files.localhost"],
            vec!["serve", "--dir=public", "-d", "files.localhost"],
            vec!["serve", "-p", "1234", "-d", "port.localhost"],
            vec!["serve", "--name", "worker", "--", "echo", "--dir=missing"],
        ] {
            let args: Vec<_> = args.into_iter().map(OsString::from).collect();
            validate_serve_launch(&args, root).unwrap();
        }
        for directory in [root.join("missing"), root.join("public/absent")] {
            let error = validate_serve_launch(
                &[
                    "serve".into(),
                    "--dir".into(),
                    directory.clone().into_os_string(),
                ],
                root,
            )
            .unwrap_err();
            assert!(error.contains(directory.to_str().unwrap()), "{error}");
        }
        assert!(validate_serve_launch(&["serve".into(), "--unknown".into()], root).is_err());
    }

    struct Process(Child);
    impl Drop for Process {
        fn drop(&mut self) {
            let group = -(self.0.id() as i32);
            // SAFETY: this fixture created and owns the child's session.
            unsafe {
                libc::kill(group, libc::SIGTERM);
            }
            let deadline = Instant::now() + Duration::from_secs(3);
            while self.0.try_wait().ok().flatten().is_none() && Instant::now() < deadline {
                thread::sleep(Duration::from_millis(10));
            }
            // SAFETY: terminate any surviving members of the owned session.
            unsafe {
                libc::kill(group, libc::SIGKILL);
            }
            let _ = self.0.wait();
        }
    }

    fn process(root: &Path, empty_environment: bool) -> Process {
        // Keep sh's launch vector in /proc rather than exec'ing sleep.
        fs::write(
            root.join("start"),
            "trap 'exit 0' TERM; printf ready > ready.$$; while :; do sleep 0.05; done\n",
        )
        .unwrap();
        let mut command = Command::new("sh");
        command
            .arg("start")
            .current_dir(root)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        if empty_environment {
            command.env_clear();
        }
        // SAFETY: setsid is async-signal-safe and uses no shared Rust state.
        unsafe {
            command.pre_exec(|| {
                if libc::setsid() < 0 {
                    Err(io::Error::last_os_error())
                } else {
                    Ok(())
                }
            });
        }
        let child = Process(command.spawn().unwrap());
        let ready = root.join(format!("ready.{}", child.0.id()));
        let deadline = Instant::now() + Duration::from_secs(3);
        while !ready.exists() {
            assert!(Instant::now() < deadline, "shell did not open its script");
            thread::sleep(Duration::from_millis(5));
        }
        fs::remove_file(ready).unwrap();
        child
    }

    fn stack(pid: i32) -> LiveStack {
        LiveStack {
            stack_id: String::new(),
            daemon_socket: String::new(),
            remote: false,
            ready: false,
            urls: vec![],
            log_path: String::new(),
            name: "capture".to_owned(),
            pid,
            manifest_path: "/example/devhost.toml".to_owned(),
            manifest_files: vec!["/example/devhost.toml".to_owned()],
            started_at: "now".to_owned(),
            control_port: 0,
            owner_start_identity: crate::procid::start_identity(pid).unwrap_or_default(),
        }
    }

    fn output() -> ServiceOutput {
        ServiceOutput::new(
            Mode::Agent,
            Box::new(Vec::new()),
            Box::new(Vec::new()),
            &["devhost"],
        )
    }

    fn record(dir: &Path, stack: &LiveStack) {
        fs::create_dir_all(dir.join("stacks")).unwrap();
        fs::write(dir.join(format!("stacks/{}.json", stack.pid)), serde_json::to_vec(&json!({"remote":stack.remote,"createdAt":stack.started_at,"manifestPath":stack.manifest_path,"manifestFiles":stack.manifest_files,"ownerPid":stack.pid,"ownerStartIdentity":stack.owner_start_identity,"stackName":stack.name})).unwrap()).unwrap();
    }

    #[test]
    fn launch_mode_and_private_environment_preserve_os_values() {
        let args = vec![
            "start".into(),
            "--remote".into(),
            "--".into(),
            "worker".into(),
            OsString::from_vec(vec![0xff]),
        ];
        let once = preserve_launch_mode(&args, false);
        assert_eq!(
            &once[..4],
            &["start", "--remote", "--remote=false", "--local=true"]
        );
        assert_eq!(once[5..], args[3..]);
        assert_eq!(preserve_launch_mode(&once, false), once);
        let remote = preserve_launch_mode(&once, true);
        assert_eq!(&remote[2..4], &["--remote=true", "--local=false"]);
        assert_eq!(preserve_launch_mode(&[], true), Vec::<OsString>::new());
        let serve = vec!["serve".into(), "--dir".into(), "space here".into()];
        assert_eq!(preserve_launch_mode(&serve, true), serve);
        let value = OsString::from_vec(vec![b'a', 0xff, b'=', b'\n']);
        let env = vec![
            ("TOKEN".into(), value.clone()),
            (DETACHED_LOG_ENV.into(), "old".into()),
            (STACK_LOG_ENV.into(), "old2".into()),
        ];
        assert_eq!(
            replace_launch_log(&env, Path::new("new log")),
            vec![
                ("TOKEN".into(), value),
                (STACK_LOG_ENV.into(), "new log".into())
            ]
        );
        assert!(replace_launch_log(&[], Path::new("new")).is_empty());
        #[cfg(target_os = "linux")]
        assert_eq!(
            nul_entries(b"one\0\0three\0").collect::<Vec<_>>(),
            vec![b"one".to_vec(), vec![], b"three".to_vec()]
        );
        #[cfg(target_os = "linux")]
        assert_eq!(nul_entries(b"").count(), 0);
    }

    #[test]
    fn captures_os_launch_and_refuses_unrecoverable_or_changed_processes() {
        let fixture = tempfile::tempdir().unwrap();
        let child = process(fixture.path(), false);
        let mut live = stack(child.0.id() as i32);
        let (args, directory, environment) = capture_launch(&live, false).unwrap().unwrap();
        assert_eq!(args, ["start", "--remote=false", "--local=true"]);
        assert_eq!(directory, fixture.path());
        assert!(!environment.is_empty());
        live.owner_start_identity = "wrong-process".to_owned();
        assert_eq!(
            capture_launch(&live, false).unwrap_err(),
            "stack process changed during capture"
        );
        assert!(
            capture_launch(&stack(std::process::id() as i32), false)
                .unwrap_err()
                .contains("cannot restart an ancestor")
        );
        assert!(
            capture_launch(&stack(i32::MAX), false)
                .unwrap_err()
                .contains("read launch arguments")
        );
        let empty = process(fixture.path(), true);
        assert!(
            capture_launch(&stack(empty.0.id() as i32), false)
                .unwrap_err()
                .contains("did not provide the launch environment")
        );
        let removed = fixture.path().join("removed");
        fs::create_dir(&removed).unwrap();
        let lost = process(&removed, false);
        fs::remove_file(removed.join("start")).unwrap();
        fs::remove_dir(&removed).unwrap();
        assert!(
            capture_launch(&stack(lost.0.id() as i32), false)
                .unwrap_err()
                .contains("working directory")
        );
        assert!(
            capture_launch(&stack(lost.0.id() as i32), true)
                .unwrap()
                .is_none()
        );
    }

    #[test]
    fn capture_failure_stops_nothing_and_removes_partial_logs() {
        let fixture = tempfile::tempdir().unwrap();
        let root = fixture.path();
        let child = process(root, false);
        let first = stack(child.0.id() as i32);
        record(&root.join("caddy"), &first);
        let mut invalid = Command::new("sleep").arg("300").spawn().unwrap();
        let mut last = stack(invalid.id() as i32);
        last.name = "z-invalid".to_owned();
        record(&root.join("caddy"), &last);
        let error = restart_stacks(None, root, &output()).unwrap_err();
        let _ = invalid.kill();
        let _ = invalid.wait();
        assert!(error.contains("no stacks were stopped"), "{error}");
        assert!(error.contains("expected a devhost start or serve process"));
        assert!(first.is_alive());
        assert!(
            !fs::read_dir(root)
                .unwrap()
                .flatten()
                .any(|entry| entry.file_name().as_bytes().starts_with(b"restart-"))
        );
        let lock = OpenOptions::new()
            .read(true)
            .write(true)
            .open(root.join("restart.lock"))
            .unwrap();
        lock.try_lock().unwrap();
        assert!(
            restart_stacks(None, root, &output())
                .unwrap_err()
                .contains("another stack restart")
        );
        lock.unlock().unwrap();
        drop(lock);
        fs::remove_dir_all(root.join("caddy/stacks")).unwrap();
        assert!(restart_stacks(None, root, &output()).is_ok());
        let not_directory = root.join("file");
        fs::write(&not_directory, "file").unwrap();
        assert!(
            restart_stacks(None, &not_directory, &output())
                .unwrap_err()
                .contains("create restart directory")
        );
    }

    #[test]
    fn preflight_io_failures_never_stop_a_stack() {
        struct BrokenOutput;
        impl io::Write for BrokenOutput {
            fn write(&mut self, _bytes: &[u8]) -> io::Result<usize> {
                Err(io::Error::new(io::ErrorKind::BrokenPipe, "output closed"))
            }

            fn flush(&mut self) -> io::Result<()> {
                Ok(())
            }
        }
        let fixture = tempfile::tempdir().unwrap();
        let root = fixture.path();
        fs::create_dir(root.join("restart.lock")).unwrap();
        assert!(
            restart_stacks(None, root, &output())
                .unwrap_err()
                .contains("open restart lock")
        );
        fs::remove_dir(root.join("restart.lock")).unwrap();
        let broken = ServiceOutput::new(
            Mode::Agent,
            Box::new(BrokenOutput),
            Box::new(Vec::new()),
            &["devhost"],
        );
        assert!(
            restart_stacks(None, root, &broken)
                .unwrap_err()
                .contains("output closed")
        );
        let child = process(root, false);
        let live = stack(child.0.id() as i32);
        record(&root.join("caddy"), &live);
        assert!(
            restart_stacks(None, root, &broken)
                .unwrap_err()
                .contains("output closed")
        );
        assert!(live.is_alive());
    }

    #[test]
    fn replacement_revalidates_registration_before_signaling() {
        let fixture = tempfile::tempdir().unwrap();
        let child = process(fixture.path(), false);
        let stack = stack(child.0.id() as i32);
        let launch = StackLaunch {
            stack,
            args: vec![],
            directory: fixture.path().to_owned(),
            environment: vec![],
            log_path: fixture.path().join("log"),
            log: File::create(fixture.path().join("log")).unwrap(),
        };
        assert!(
            replace_stack(&launch, fixture.path(), Path::new("/missing"), &output())
                .unwrap_err()
                .contains("registration changed")
        );
        for field in ["manifest", "inputs", "timestamp", "identity"] {
            let mut changed = launch.stack.clone();
            match field {
                "manifest" => changed.manifest_path = "/changed/devhost.toml".to_owned(),
                "inputs" => changed
                    .manifest_files
                    .push("/included/devhost.toml".to_owned()),
                "timestamp" => changed.started_at = "later".to_owned(),
                "identity" => changed.owner_start_identity = "different-process".to_owned(),
                _ => unreachable!(),
            }
            record(fixture.path(), &changed);
            assert!(
                replace_stack(&launch, fixture.path(), Path::new("/missing"), &output())
                    .unwrap_err()
                    .contains("registration changed"),
                "accepted a changed {field}"
            );
            assert!(launch.stack.is_alive());
        }
        let mut unidentified = launch.stack.clone();
        unidentified.owner_start_identity.clear();
        record(fixture.path(), &unidentified);
        assert!(
            signal_live_stack(fixture.path(), &unidentified)
                .unwrap_err()
                .contains("process changed")
        );
        let mut own = launch.stack.clone();
        own.pid = std::process::id() as i32;
        assert!(
            signal_live_stack(fixture.path(), &own)
                .unwrap_err()
                .contains("cannot stop")
        );
        assert!(launch.stack.is_alive());
        record(fixture.path(), &launch.stack);
        assert!(
            replace_stack(&launch, fixture.path(), Path::new("/missing"), &output())
                .unwrap_err()
                .contains("start replacement")
        );
        assert!(!launch.stack.is_alive());
    }
}
