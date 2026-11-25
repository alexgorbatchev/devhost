use std::{
    env,
    fs::{self, DirBuilder, OpenOptions},
    io::{self, BufReader, Write},
    os::unix::{
        fs::{DirBuilderExt, OpenOptionsExt, PermissionsExt},
        net::UnixStream,
        process::CommandExt,
    },
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        Arc,
        atomic::{AtomicI32, Ordering},
    },
    thread,
    time::{Duration, Instant},
};

use base64::{Engine, engine::general_purpose::STANDARD};
use cli_command_kit::Mode;
use sha2::{Digest, Sha256};

use super::{
    PROTOCOL_VERSION, acquire_daemon_lock, daemon_log_path, daemon_socket_path, ensure_state_dir,
    exe_identity, read_live_daemon, remove_daemon_record_if_pid,
};
use crate::{
    Failure,
    caddy::stacks::{LiveStack, ManifestOverlapError},
    cliout::{self, ServiceOutput},
    daemon::protocol::{
        ExportedStack, OutputStream, Request, ServerEvent, StoredLaunchSpec, read_frame,
        write_frame,
    },
    procid,
    services::{
        detach::{
            DETACHED_POLL_INTERVAL, DetachSignalGuard, SignalSource, acquire_detached_lock,
            await_earlier_start, check_detach_platform, describe_signal, detached_cleanup_timeout,
            detached_failure, detached_failure_path, detached_setup_failure,
            detached_startup_timeout, find_detached_stack, format_go_duration, launch_identity,
            read_detached_failure, remove_detached_failure, report_detached_stack, still_stopping,
            write_detached_log_tail,
        },
        resolve::ResolvedManifest,
        stack::StartStackError,
    },
};

const DAEMON_START_TIMEOUT: Duration = Duration::from_secs(10);
const DAEMON_LOCK_TIMEOUT: Duration = Duration::from_secs(15);
const DAEMON_EXIT_WAIT: Duration = Duration::from_secs(3);

static FOREGROUND_SIGNAL: AtomicI32 = AtomicI32::new(0);

extern "C" fn handle_foreground_signal(sig: libc::c_int) {
    let _ = FOREGROUND_SIGNAL.compare_exchange(0, sig, Ordering::SeqCst, Ordering::SeqCst);
}

struct ForegroundSignalGuard {
    previous: Vec<(libc::c_int, libc::sigaction)>,
}

impl ForegroundSignalGuard {
    fn install() -> Self {
        FOREGROUND_SIGNAL.store(0, Ordering::SeqCst);
        let mut previous = Vec::new();
        for sig in [libc::SIGINT, libc::SIGHUP, libc::SIGTERM] {
            // SAFETY: signal handler only stores an integer into a static AtomicI32.
            unsafe {
                let mut action: libc::sigaction = std::mem::zeroed();
                action.sa_sigaction = handle_foreground_signal as *const () as usize;
                libc::sigemptyset(&mut action.sa_mask);
                action.sa_flags = 0;
                let mut old: libc::sigaction = std::mem::zeroed();
                if libc::sigaction(sig, &action, &mut old) == 0 {
                    previous.push((sig, old));
                }
            }
        }
        Self { previous }
    }
}

impl Drop for ForegroundSignalGuard {
    fn drop(&mut self) {
        for (sig, old) in &self.previous {
            // SAFETY: restores the prior sigaction returned by sigaction().
            unsafe {
                let _ = libc::sigaction(*sig, old, std::ptr::null_mut());
            }
        }
    }
}

#[derive(Debug, Clone)]
pub struct DaemonEndpoint {
    pub pid: i32,
    pub socket_path: PathBuf,
    pub exe_identity: String,
    pub version: String,
}

#[derive(Debug, Clone)]
pub struct ExportedDaemonSpecs {
    pub pid: i32,
    pub exe_identity: String,
    pub stacks: Vec<ExportedStack>,
}

#[derive(Debug, Clone)]
pub struct DrainResult {
    pub stopped: Vec<String>,
    pub errors: Vec<String>,
    pub remaining: usize,
    pub daemon_exiting: bool,
}

pub fn ensure_daemon(
    state_dir: &Path,
    executable: Option<&Path>,
    warning_output: Option<&ServiceOutput>,
    mode: Mode,
) -> Result<DaemonEndpoint, Failure> {
    ensure_state_dir(state_dir).map_err(Failure::from)?;
    let _lock = acquire_daemon_lock(state_dir, DAEMON_LOCK_TIMEOUT).map_err(Failure::from)?;

    let exe_path = match executable {
        Some(path) => path.to_path_buf(),
        None => match env::current_exe() {
            Ok(path) => path,
            Err(error) => {
                return Err(Failure {
                    message: format!("devhost could not find its own executable: {error}"),
                    summary: Some("devhost could not find its own executable".to_owned()),
                    hint: None,
                });
            }
        },
    };
    let current_exe_id = exe_identity(&exe_path);

    if let Some(record) = read_live_daemon(state_dir) {
        let sock = PathBuf::from(&record.socket_path);
        match send_hello(&sock) {
            Ok(HelloReply::Ready {
                protocol_version,
                pid,
                version,
                exe_identity: daemon_exe_id,
            }) => {
                if protocol_version != PROTOCOL_VERSION {
                    return Err(Failure {
                        message: format!(
                            "running devhost daemon (PID {pid}) uses incompatible protocol version {protocol_version} (expected {PROTOCOL_VERSION})"
                        ),
                        summary: None,
                        hint: Some(
                            "Run \"devhost restart-all\" to switch to the current devhost binary."
                                .to_owned(),
                        ),
                    });
                }
                if !daemon_exe_id.is_empty()
                    && daemon_exe_id != current_exe_id
                    && let Some(output) = warning_output
                {
                    output.log_stderr(
                        "devhost",
                        &cliout::warning(
                            mode,
                            &format!(
                                "running devhost daemon (PID {pid}) uses a different executable; run \"devhost restart-all\" to switch to this binary"
                            ),
                        ),
                    );
                }
                return Ok(DaemonEndpoint {
                    pid,
                    socket_path: sock,
                    exe_identity: daemon_exe_id,
                    version,
                });
            }
            Ok(HelloReply::Draining) | Err(_) => {
                if !procid::is_record_owner_alive(record.pid, &record.start_identity) {
                    remove_daemon_record_if_pid(state_dir, record.pid);
                }
            }
        }
    }

    spawn_daemon(state_dir, &exe_path)
}

enum HelloReply {
    Ready {
        protocol_version: u32,
        pid: i32,
        version: String,
        exe_identity: String,
    },
    Draining,
}

fn send_hello(socket_path: &Path) -> io::Result<HelloReply> {
    let mut stream = UnixStream::connect(socket_path)?;
    let _ = stream.set_read_timeout(Some(Duration::from_secs(3)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(3)));
    write_frame(&mut stream, &Request::Hello)?;
    let mut reader = BufReader::new(stream);
    match read_frame::<_, ServerEvent>(&mut reader)? {
        Some(ServerEvent::Hello {
            protocol_version,
            pid,
            version,
            exe_identity,
            draining,
            ..
        }) => {
            if draining {
                Ok(HelloReply::Draining)
            } else {
                Ok(HelloReply::Ready {
                    protocol_version,
                    pid,
                    version,
                    exe_identity,
                })
            }
        }
        _ => Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "unexpected response to daemon Hello",
        )),
    }
}

fn spawn_daemon(state_dir: &Path, executable: &Path) -> Result<DaemonEndpoint, Failure> {
    let log_path = daemon_log_path(state_dir);
    let log_file = match OpenOptions::new()
        .create(true)
        .append(true)
        .mode(0o600)
        .open(&log_path)
    {
        Ok(file) => file,
        Err(error) => {
            return Err(Failure::from(format!(
                "open daemon log {}: {error}",
                log_path.display()
            )));
        }
    };
    let stderr_log = match log_file.try_clone() {
        Ok(file) => file,
        Err(error) => {
            return Err(Failure::from(format!(
                "open daemon log {}: {error}",
                log_path.display()
            )));
        }
    };

    let mut command = Command::new(executable);
    command
        .arg("_daemon")
        .arg("--state-dir")
        .arg(state_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::from(log_file))
        .stderr(Stdio::from(stderr_log));
    // SAFETY: setsid() detaches the shared daemon into its own session before exec.
    unsafe {
        command.pre_exec(|| {
            if libc::setsid() < 0 {
                Err(io::Error::last_os_error())
            } else {
                Ok(())
            }
        });
    }
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            return Err(Failure::from(format!(
                "the stack supervisor could not be launched: {error}"
            )));
        }
    };
    let pid = child.id() as i32;
    let socket_path = daemon_socket_path(state_dir, pid);
    let deadline = Instant::now() + DAEMON_START_TIMEOUT;

    loop {
        if let Ok(HelloReply::Ready {
            pid: hello_pid,
            version,
            exe_identity,
            ..
        }) = send_hello(&socket_path)
        {
            return Ok(DaemonEndpoint {
                pid: hello_pid,
                socket_path,
                exe_identity,
                version,
            });
        }
        if let Ok(Some(status)) = child.try_wait() {
            return Err(Failure::from(format!(
                "the stack supervisor could not be launched: daemon exited early ({status}); see {}",
                log_path.display()
            )));
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err(Failure::from(format!(
                "the stack supervisor could not be launched: daemon PID {pid} did not become ready within {}s; see {}",
                DAEMON_START_TIMEOUT.as_secs(),
                log_path.display()
            )));
        }
        thread::sleep(Duration::from_millis(20));
    }
}

pub fn run_foreground(
    state_dir: &Path,
    spec: StoredLaunchSpec,
    mode: Mode,
) -> Result<i32, StartStackError> {
    let _signal_guard = ForegroundSignalGuard::install();
    let warning_out = ServiceOutput::stdio(mode, &["devhost"]);

    let mut attempt = 0u8;
    loop {
        attempt += 1;
        let endpoint = ensure_daemon(state_dir, None, Some(&warning_out), mode)?;
        let mut stream = match UnixStream::connect(&endpoint.socket_path) {
            Ok(stream) => stream,
            Err(_) if attempt < 2 => continue,
            Err(error) => {
                return Err(StartStackError::Failure(Failure::from(format!(
                    "connect to devhost daemon: {error}"
                ))));
            }
        };
        if let Err(error) = write_frame(
            &mut stream,
            &Request::Start {
                spec: spec.clone(),
                wait_for_ready: false,
                attach_output: true,
            },
        ) {
            if attempt < 2 {
                continue;
            }
            return Err(StartStackError::Failure(Failure::from(format!(
                "send start request to devhost daemon: {error}"
            ))));
        }

        let write_clone = match stream.try_clone() {
            Ok(clone) => clone,
            Err(error) => {
                return Err(StartStackError::Failure(Failure::from(format!(
                    "clone daemon stream: {error}"
                ))));
            }
        };
        let mut writer = write_clone;
        let _ = stream.set_read_timeout(Some(Duration::from_millis(50)));
        let mut reader = BufReader::new(stream);
        let mut stack_id = String::new();
        let mut cancel_sent = false;

        let mut stdout = io::stdout();
        let mut stderr = io::stderr();

        loop {
            if !cancel_sent && !stack_id.is_empty() {
                let sig = FOREGROUND_SIGNAL.swap(0, Ordering::SeqCst);
                if sig != 0 {
                    cancel_sent = true;
                    let _ = write_frame(
                        &mut writer,
                        &Request::CancelStack {
                            stack_id: stack_id.clone(),
                            signal: sig,
                        },
                    );
                }
            }

            match read_frame::<_, ServerEvent>(&mut reader) {
                Ok(Some(ServerEvent::Started { stack_id: id, .. })) => {
                    stack_id = id;
                    let sig = FOREGROUND_SIGNAL.swap(0, Ordering::SeqCst);
                    if sig != 0 && !cancel_sent {
                        cancel_sent = true;
                        let _ = write_frame(
                            &mut writer,
                            &Request::CancelStack {
                                stack_id: stack_id.clone(),
                                signal: sig,
                            },
                        );
                    }
                }
                Ok(Some(ServerEvent::Output {
                    stream: out_stream,
                    data,
                })) => {
                    if let Ok(bytes) = STANDARD.decode(data) {
                        match out_stream {
                            OutputStream::Stdout => {
                                let _ = stdout.write_all(&bytes);
                                let _ = stdout.flush();
                            }
                            OutputStream::Stderr => {
                                let _ = stderr.write_all(&bytes);
                                let _ = stderr.flush();
                            }
                        }
                    }
                }
                Ok(Some(ServerEvent::Finished {
                    exit_code,
                    failure,
                    overlap,
                    daemon_exiting,
                })) => {
                    drop(reader);
                    drop(writer);
                    if daemon_exiting {
                        wait_for_pid_exit(endpoint.pid, Duration::from_millis(500));
                    }
                    if let Some(overlap) = overlap {
                        return Err(StartStackError::Overlap(ManifestOverlapError::from(
                            overlap,
                        )));
                    }
                    if let Some(failure) = failure {
                        return Err(StartStackError::Failure(Failure::from(failure)));
                    }
                    return Ok(exit_code);
                }
                Ok(Some(ServerEvent::Error {
                    message,
                    draining: true,
                })) if attempt < 2 => {
                    let _ = message;
                    break;
                }
                Ok(Some(ServerEvent::Error { message, .. })) => {
                    return Err(StartStackError::Failure(Failure::from(message)));
                }
                Ok(Some(_)) => {}
                Ok(None) => {
                    if stack_id.is_empty() && attempt < 2 {
                        break;
                    }
                    return Err(StartStackError::Failure(Failure::from(
                        "devhost daemon closed connection unexpectedly".to_owned(),
                    )));
                }
                Err(error)
                    if matches!(
                        error.kind(),
                        io::ErrorKind::WouldBlock
                            | io::ErrorKind::TimedOut
                            | io::ErrorKind::Interrupted
                    ) => {}
                Err(error) => {
                    if stack_id.is_empty() && attempt < 2 {
                        break;
                    }
                    return Err(StartStackError::Failure(Failure::from(format!(
                        "read from devhost daemon: {error}"
                    ))));
                }
            }
        }
    }
}

pub struct DetachedDaemonStartOptions {
    pub manifest: ResolvedManifest,
    pub spec: StoredLaunchSpec,
    pub state_dir: PathBuf,
    pub output: ServiceOutput,
    pub startup_timeout: Option<Duration>,
    pub cleanup_timeout: Option<Duration>,
    pub target_os: Option<String>,
    pub external_signal: Option<Arc<AtomicI32>>,
    pub install_signal_handlers: bool,
}

pub fn run_detached(options: DetachedDaemonStartOptions) -> Result<(), Failure> {
    let os_name = options.target_os.as_deref().unwrap_or(std::env::consts::OS);
    check_detach_platform(os_name)?;

    let _signal_guard = options
        .install_signal_handlers
        .then(DetachSignalGuard::install);
    let signal_src = SignalSource {
        external: options.external_signal.as_ref(),
        use_process: options.install_signal_handlers,
    };

    let caddy_dir = options.state_dir.join("caddy");
    let canonical = launch_identity(&options.manifest.manifest_path, &options.manifest.name);
    let log_dir = options.state_dir.join("logs");
    let state_hint = format!(
        "Check that you can read and write devhost's state directory, {}.",
        options.state_dir.display()
    );
    let existed = log_dir.exists();
    if let Err(err) = DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(&log_dir)
    {
        return Err(detached_setup_failure(
            "the stack log directory could not be created",
            &err.to_string(),
            &state_hint,
        ));
    }
    if !existed {
        let _ = fs::set_permissions(&log_dir, fs::Permissions::from_mode(0o700));
    }

    let digest = Sha256::digest(canonical.as_bytes());
    let mut stem = String::from("stack-");
    for byte in digest {
        use std::fmt::Write as _;
        let _ = write!(stem, "{byte:02x}");
    }
    let log_path = log_dir.join(format!("{stem}.log"));
    let log_path_str = log_path.to_string_lossy().into_owned();
    let lock_path = log_dir.join(format!("{stem}.lock"));

    let lock_file = match OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .mode(0o600)
        .open(&lock_path)
    {
        Ok(file) => file,
        Err(err) => {
            return Err(detached_setup_failure(
                "the start lock could not be opened",
                &err.to_string(),
                &state_hint,
            ));
        }
    };

    let limit = match options.startup_timeout {
        Some(timeout) => timeout,
        None => detached_startup_timeout(&options.manifest),
    };
    let deadline = Instant::now() + limit;

    if let Err(err) = acquire_detached_lock(&lock_file, deadline, limit, &signal_src) {
        return Err(detached_failure(err, &log_path_str, ""));
    }

    if let Some(existing) = await_earlier_start(
        &caddy_dir,
        &canonical,
        &log_path_str,
        &options.state_dir,
        deadline,
        limit,
        &signal_src,
    )? {
        if existing.remote != options.manifest.remote.is_some() {
            return Err(Failure {
                message: "the running stack uses a different remote preview mode".to_owned(),
                summary: None,
                hint: Some(
                    "Stop this stack with devhost stop, then start it again with --local or the configured relay mode."
                        .to_owned(),
                ),
            });
        }
        return match report_detached_stack(&options.output, &existing, true) {
            Ok(()) => Ok(()),
            Err(err) => Err(Failure::from(err.to_string())),
        };
    }

    let failure_path = detached_failure_path(&log_path);
    if let Err(err) = remove_detached_failure(&failure_path) {
        return Err(detached_setup_failure(
            "the failure record of the previous start could not be removed",
            &err,
            &state_hint,
        ));
    }

    let log_file = match OpenOptions::new()
        .create(true)
        .append(true)
        .mode(0o600)
        .open(&log_path)
    {
        Ok(file) => file,
        Err(err) => {
            return Err(detached_setup_failure(
                "the stack log could not be opened",
                &err.to_string(),
                &state_hint,
            ));
        }
    };
    let log_offset = match log_file.metadata() {
        Ok(meta) => meta.len(),
        Err(err) => {
            return Err(detached_setup_failure(
                "the stack log could not be read",
                &err.to_string(),
                &state_hint,
            ));
        }
    };
    drop(log_file);

    let mut spec = options.spec;
    spec.detached = true;
    spec.log_path = log_path_str.clone();

    let cleanup_timeout = match options.cleanup_timeout {
        Some(timeout) => timeout,
        None => detached_cleanup_timeout(&options.manifest),
    };
    let mode = options.output.mode();

    let mut attempt = 0u8;
    let (endpoint, mut reader, mut writer, stack_id) = loop {
        attempt += 1;
        let endpoint = match ensure_daemon(&options.state_dir, None, Some(&options.output), mode) {
            Ok(ep) => ep,
            Err(err) => return Err(detached_failure(err, &log_path_str, "")),
        };
        let mut stream = match UnixStream::connect(&endpoint.socket_path) {
            Ok(stream) => stream,
            Err(_) if attempt < 2 => continue,
            Err(error) => {
                return Err(detached_failure(
                    format!("the stack supervisor could not be launched: {error}").into(),
                    &log_path_str,
                    "",
                ));
            }
        };
        if let Err(error) = write_frame(
            &mut stream,
            &Request::Start {
                spec: spec.clone(),
                wait_for_ready: true,
                attach_output: false,
            },
        ) {
            if attempt < 2 {
                continue;
            }
            return Err(detached_failure(
                format!("the stack supervisor could not be launched: {error}").into(),
                &log_path_str,
                "",
            ));
        }
        let writer = match stream.try_clone() {
            Ok(writer) => writer,
            Err(error) => {
                return Err(detached_failure(
                    format!("the stack supervisor could not be launched: {error}").into(),
                    &log_path_str,
                    "",
                ));
            }
        };
        let _ = stream.set_read_timeout(Some(DETACHED_POLL_INTERVAL));
        let mut reader = BufReader::new(stream);
        match read_started(&mut reader, deadline, &signal_src) {
            Ok(StartAck::Started(stack_id)) => break (endpoint, reader, writer, stack_id),
            Ok(StartAck::Draining) if attempt < 2 => continue,
            Ok(StartAck::Draining) => {
                return Err(detached_failure(
                    "the stack supervisor could not be launched: daemon is shutting down"
                        .to_owned()
                        .into(),
                    &log_path_str,
                    "",
                ));
            }
            Err(cause) => {
                let _ = remove_detached_failure(&failure_path);
                write_detached_log_tail(&options.output, &log_path, log_offset);
                return Err(detached_failure(cause, &log_path_str, ""));
            }
        }
    };

    let wait_outcome = wait_detached_ready(
        &mut reader,
        &DetachedReadyWait {
            caddy_dir: &caddy_dir,
            canonical: &canonical,
            failure_path: &failure_path,
            stack_id: &stack_id,
            daemon_pid: endpoint.pid,
            deadline,
            limit,
        },
        &signal_src,
    );

    let failure_ctx = DetachedFailureContext {
        stack_id: &stack_id,
        daemon_pid: endpoint.pid,
        cleanup_timeout,
        log_path: &log_path,
        log_offset,
        output: &options.output,
    };

    match wait_outcome {
        Ok(stack) => match report_detached_stack(&options.output, &stack, false) {
            Ok(()) => Ok(()),
            Err(err) => Err(finish_daemon_detached_failure(
                Failure::from(format!("reporting the started stack failed: {err}")),
                false,
                false,
                &mut reader,
                &mut writer,
                &failure_ctx,
                &signal_src,
            )),
        },
        Err((cause, was_not_ready, already_finished)) => Err(finish_daemon_detached_failure(
            cause,
            was_not_ready,
            already_finished,
            &mut reader,
            &mut writer,
            &failure_ctx,
            &signal_src,
        )),
    }
}

enum StartAck {
    Started(String),
    Draining,
}

fn read_started(
    reader: &mut BufReader<UnixStream>,
    deadline: Instant,
    signals: &SignalSource<'_>,
) -> Result<StartAck, Failure> {
    loop {
        if let Some(sig) = signals.take() {
            return Err(format!(
                "received {} before the stack was ready",
                describe_signal(sig)
            )
            .into());
        }
        if Instant::now() >= deadline {
            return Err("timed out waiting for daemon to start stack"
                .to_owned()
                .into());
        }
        match read_frame::<_, ServerEvent>(reader) {
            Ok(Some(ServerEvent::Started { stack_id, .. })) => {
                return Ok(StartAck::Started(stack_id));
            }
            Ok(Some(ServerEvent::Error { draining: true, .. })) => {
                return Ok(StartAck::Draining);
            }
            Ok(Some(ServerEvent::Error { message, .. })) => {
                return Err(Failure::from(message));
            }
            Ok(Some(_)) => {}
            Ok(None) => return Ok(StartAck::Draining),
            Err(error)
                if matches!(
                    error.kind(),
                    io::ErrorKind::WouldBlock
                        | io::ErrorKind::TimedOut
                        | io::ErrorKind::Interrupted
                ) => {}
            Err(error) => {
                return Err(Failure::from(format!(
                    "the stack supervisor could not be launched: {error}"
                )));
            }
        }
    }
}

struct DetachedReadyWait<'a> {
    caddy_dir: &'a Path,
    canonical: &'a str,
    failure_path: &'a Path,
    stack_id: &'a str,
    daemon_pid: i32,
    deadline: Instant,
    limit: Duration,
}

fn wait_detached_ready(
    reader: &mut BufReader<UnixStream>,
    wait: &DetachedReadyWait<'_>,
    signals: &SignalSource<'_>,
) -> Result<LiveStack, (Failure, bool, bool)> {
    let DetachedReadyWait {
        caddy_dir,
        canonical,
        failure_path,
        stack_id,
        daemon_pid,
        deadline,
        limit,
    } = *wait;
    loop {
        if let Some(sig) = signals.take() {
            return Err((
                format!(
                    "received {} before the stack was ready",
                    describe_signal(sig)
                )
                .into(),
                false,
                false,
            ));
        }
        if Instant::now() >= deadline {
            return Err((
                format!(
                    "the stack was not ready within {}",
                    format_go_duration(limit)
                )
                .into(),
                false,
                false,
            ));
        }
        if let Some(service) = read_detached_failure(failure_path) {
            return Err((
                format!("service {service} did not become ready").into(),
                true,
                false,
            ));
        }

        match read_frame::<_, ServerEvent>(reader) {
            Ok(Some(ServerEvent::Ready {
                pid,
                name,
                urls,
                log_path,
                remote,
                ..
            })) => {
                if let Ok(Some(stack)) = find_detached_stack(caddy_dir, canonical)
                    && stack.stack_id == stack_id
                {
                    return Ok(stack);
                }
                return Ok(LiveStack {
                    stack_id: stack_id.to_owned(),
                    daemon_socket: String::new(),
                    remote,
                    ready: true,
                    urls,
                    log_path,
                    name,
                    pid,
                    manifest_path: String::new(),
                    manifest_files: Vec::new(),
                    started_at: String::new(),
                    control_port: 0,
                    owner_start_identity: String::new(),
                });
            }
            Ok(Some(ServerEvent::Finished {
                exit_code,
                failure,
                overlap,
                ..
            })) => {
                if let Some(service) = read_detached_failure(failure_path) {
                    return Err((
                        format!("service {service} did not become ready").into(),
                        true,
                        true,
                    ));
                }
                let _ = (failure, overlap);
                return Err((
                    format!("the stack exited before it was ready (exit code {exit_code})").into(),
                    false,
                    true,
                ));
            }
            Ok(Some(ServerEvent::Error { message, .. })) => {
                return Err((Failure::from(message), false, true));
            }
            Ok(Some(_)) => {}
            Ok(None) => {
                if let Some(service) = read_detached_failure(failure_path) {
                    return Err((
                        format!("service {service} did not become ready").into(),
                        true,
                        true,
                    ));
                }
                return Err((
                    format!(
                        "the stack exited before it was ready (daemon PID {daemon_pid} disconnected)"
                    )
                    .into(),
                    false,
                    true,
                ));
            }
            Err(error)
                if matches!(
                    error.kind(),
                    io::ErrorKind::WouldBlock
                        | io::ErrorKind::TimedOut
                        | io::ErrorKind::Interrupted
                ) => {}
            Err(error) => {
                return Err((
                    Failure::from(format!("waiting for detached stack failed: {error}")),
                    false,
                    false,
                ));
            }
        }
    }
}

struct DetachedFailureContext<'a> {
    stack_id: &'a str,
    daemon_pid: i32,
    cleanup_timeout: Duration,
    log_path: &'a Path,
    log_offset: u64,
    output: &'a ServiceOutput,
}

fn finish_daemon_detached_failure(
    mut err_failure: Failure,
    was_not_ready: bool,
    already_finished: bool,
    reader: &mut BufReader<UnixStream>,
    writer: &mut UnixStream,
    ctx: &DetachedFailureContext<'_>,
    signals: &SignalSource<'_>,
) -> Failure {
    let DetachedFailureContext {
        stack_id,
        daemon_pid,
        cleanup_timeout,
        log_path,
        log_offset,
        output,
    } = *ctx;
    let mut stopped = already_finished;
    if !stopped {
        if !was_not_ready
            && let Err(os_err) = write_frame(
                writer,
                &Request::CancelStack {
                    stack_id: stack_id.to_owned(),
                    signal: libc::SIGTERM,
                },
            )
        {
            err_failure.message = format!(
                "{}; signaling the stack failed: {os_err}",
                err_failure.message
            );
            err_failure.summary = None;
        }
        let deadline = Instant::now() + cleanup_timeout;
        loop {
            if signals.take().is_some() || Instant::now() >= deadline {
                break;
            }
            match read_frame::<_, ServerEvent>(reader) {
                Ok(Some(ServerEvent::Finished { .. })) | Ok(None) => {
                    stopped = true;
                    break;
                }
                Ok(Some(_)) => {}
                Err(error)
                    if matches!(
                        error.kind(),
                        io::ErrorKind::WouldBlock
                            | io::ErrorKind::TimedOut
                            | io::ErrorKind::Interrupted
                    ) => {}
                Err(_) => {
                    stopped = true;
                    break;
                }
            }
        }
    }

    let failure_path = detached_failure_path(log_path);
    if !was_not_ready && let Some(service) = read_detached_failure(&failure_path) {
        err_failure = format!("service {service} did not become ready").into();
    }
    let _ = remove_detached_failure(&failure_path);
    write_detached_log_tail(output, log_path, log_offset);
    let log_str = log_path.to_string_lossy();
    if !stopped {
        let stopping = still_stopping(err_failure, daemon_pid);
        return detached_failure(
            stopping,
            &log_str,
            "Run \"devhost stack list\" to see when it has stopped.",
        );
    }
    detached_failure(err_failure, &log_str, "")
}

fn send_rpc_on_stream(
    mut stream: UnixStream,
    request: &Request,
    read_timeout: Duration,
    action: &str,
) -> Result<ServerEvent, String> {
    let _ = stream.set_read_timeout(Some(read_timeout));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(5)));
    if let Err(error) = write_frame(&mut stream, request) {
        return Err(format!("send {action} request to daemon: {error}"));
    }
    let mut reader = BufReader::new(stream);
    match read_frame::<_, ServerEvent>(&mut reader) {
        Ok(Some(event)) => Ok(event),
        Ok(None) => Err(format!("devhost daemon closed connection during {action}")),
        Err(error) => Err(format!("read {action} response from daemon: {error}")),
    }
}

fn send_rpc(
    socket_path: &Path,
    request: &Request,
    read_timeout: Duration,
    action: &str,
) -> Result<ServerEvent, String> {
    let stream = match UnixStream::connect(socket_path) {
        Ok(stream) => stream,
        Err(error) => {
            return Err(format!(
                "connect to devhost daemon {}: {error}",
                socket_path.display()
            ));
        }
    };
    send_rpc_on_stream(stream, request, read_timeout, action)
}

pub fn stop_live_stack(
    socket_path: &Path,
    stack_id: &str,
    daemon_pid: i32,
    signal: i32,
    grace: Duration,
) -> Result<bool, String> {
    let stream = match UnixStream::connect(socket_path) {
        Ok(stream) => stream,
        Err(error)
            if matches!(
                error.kind(),
                io::ErrorKind::NotFound | io::ErrorKind::ConnectionRefused
            ) =>
        {
            return Ok(true);
        }
        Err(error) => {
            return Err(format!(
                "connect to devhost daemon {}: {error}",
                socket_path.display()
            ));
        }
    };
    match send_rpc_on_stream(
        stream,
        &Request::StopStack {
            stack_id: stack_id.to_owned(),
            signal,
            grace_ms: grace.as_millis() as u64,
        },
        grace + Duration::from_secs(5),
        "stop",
    )? {
        ServerEvent::Stopped {
            already_stopped,
            daemon_exiting,
        } => {
            if daemon_exiting {
                wait_for_pid_exit(daemon_pid, DAEMON_EXIT_WAIT);
            }
            Ok(already_stopped)
        }
        ServerEvent::Error { message, .. } => Err(message),
        _ => Err("unexpected response while stopping stack in daemon".to_owned()),
    }
}

pub fn export_specs(socket_path: &Path) -> Result<ExportedDaemonSpecs, String> {
    match send_rpc(
        socket_path,
        &Request::ExportSpecs,
        Duration::from_secs(10),
        "export-specs",
    )? {
        ServerEvent::Specs {
            pid,
            exe_identity,
            stacks,
        } => Ok(ExportedDaemonSpecs {
            pid,
            exe_identity,
            stacks,
        }),
        ServerEvent::Error { message, .. } => Err(message),
        _ => Err("unexpected response while reading stack specs from daemon".to_owned()),
    }
}

pub fn restart_stack_in_daemon(
    socket_path: &Path,
    stack_id: &str,
    output_log_path: &Path,
    record_log: bool,
) -> Result<(String, i32, String), String> {
    match send_rpc(
        socket_path,
        &Request::RestartStack {
            stack_id: stack_id.to_owned(),
            output_log_path: output_log_path.to_path_buf(),
            record_log,
        },
        Duration::from_secs(60),
        "restart",
    )? {
        ServerEvent::Restarted {
            stack_id,
            pid,
            name,
        } => Ok((stack_id, pid, name)),
        ServerEvent::Error { message, .. } => Err(message),
        _ => Err("unexpected response while restarting stack in daemon".to_owned()),
    }
}

pub fn drain_daemon(
    socket_path: &Path,
    daemon_pid: i32,
    preserve_stack_ids: Vec<String>,
    stop_timeout: Duration,
) -> Result<DrainResult, String> {
    match send_rpc(
        socket_path,
        &Request::Drain {
            preserve_stack_ids,
            stop_timeout_ms: stop_timeout.as_millis() as u64,
        },
        stop_timeout + Duration::from_secs(10),
        "drain",
    )? {
        ServerEvent::Drained {
            stopped,
            errors,
            remaining,
            daemon_exiting,
        } => {
            if daemon_exiting {
                wait_for_pid_exit(daemon_pid, DAEMON_EXIT_WAIT);
            }
            Ok(DrainResult {
                stopped,
                errors,
                remaining,
                daemon_exiting,
            })
        }
        ServerEvent::Error { message, .. } => Err(message),
        _ => Err("unexpected response while draining daemon".to_owned()),
    }
}

pub fn start_replaced_in_daemon(
    state_dir: &Path,
    executable: &Path,
    spec: StoredLaunchSpec,
    output_log_path: &Path,
    record_log: bool,
    mode: Mode,
) -> Result<(String, i32, String), String> {
    let mut attempt = 0u8;
    loop {
        attempt += 1;
        let endpoint = ensure_daemon(state_dir, Some(executable), None, mode)
            .map_err(|failure| failure.message)?;
        let reply = send_rpc(
            &endpoint.socket_path,
            &Request::StartReplaced {
                spec: spec.clone(),
                output_log_path: output_log_path.to_path_buf(),
                record_log,
            },
            Duration::from_secs(45),
            "start-replaced",
        );
        match reply {
            Ok(ServerEvent::Restarted {
                stack_id,
                pid,
                name,
            }) => return Ok((stack_id, pid, name)),
            Ok(ServerEvent::Error { draining: true, .. }) if attempt < 2 => continue,
            Ok(ServerEvent::Error { message, .. }) => return Err(message),
            Ok(_) => {
                return Err(
                    "unexpected response while starting replacement stack in daemon".to_owned(),
                );
            }
            Err(_) if attempt < 2 => continue,
            Err(error) => return Err(error),
        }
    }
}

fn wait_for_pid_exit(pid: i32, timeout: Duration) {
    let deadline = Instant::now() + timeout;
    while procid::is_process_alive(pid) && Instant::now() < deadline {
        thread::sleep(Duration::from_millis(20));
    }
}

#[cfg(test)]
mod tests {
    use std::os::unix::net::UnixListener;

    use super::*;
    use crate::daemon::{DaemonRecord, write_daemon_record};

    fn mock_single_reply(sock: &Path, reply: ServerEvent) -> thread::JoinHandle<()> {
        let listener = UnixListener::bind(sock).unwrap();
        thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let _req: Option<Request> = read_frame(&mut reader).unwrap();
            write_frame(&mut stream, &reply).unwrap();
        })
    }

    #[test]
    fn rpc_helpers_handle_missing_socket_errors_and_unexpected_replies() {
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("missing.sock");
        // Missing socket means stack is already stopped.
        assert!(
            stop_live_stack(
                &missing,
                "stk-1",
                999_999,
                libc::SIGTERM,
                Duration::from_secs(1)
            )
            .unwrap()
        );
        assert!(export_specs(&missing).is_err());

        // Error reply on StopStack, ExportSpecs, RestartStack, Drain.
        let err_sock = dir.path().join("err.sock");
        for check in [0u8, 1, 2, 3] {
            let _ = fs::remove_file(&err_sock);
            let h = mock_single_reply(
                &err_sock,
                ServerEvent::Error {
                    message: "boom".to_owned(),
                    draining: false,
                },
            );
            let res = match check {
                0 => stop_live_stack(&err_sock, "stk-1", 1, libc::SIGTERM, Duration::from_secs(1))
                    .map(|_| ()),
                1 => export_specs(&err_sock).map(|_| ()),
                2 => restart_stack_in_daemon(&err_sock, "stk-1", Path::new("/tmp/a.log"), false)
                    .map(|_| ()),
                _ => drain_daemon(&err_sock, 1, vec![], Duration::from_secs(1)).map(|_| ()),
            };
            h.join().unwrap();
            assert_eq!(res.unwrap_err(), "boom");
        }

        // Unexpected Ok reply on each helper produces an error.
        for check in [0u8, 1, 2, 3] {
            let _ = fs::remove_file(&err_sock);
            let h = mock_single_reply(&err_sock, ServerEvent::Ok);
            let res = match check {
                0 => stop_live_stack(&err_sock, "stk-1", 1, libc::SIGTERM, Duration::from_secs(1))
                    .map(|_| ()),
                1 => export_specs(&err_sock).map(|_| ()),
                2 => restart_stack_in_daemon(&err_sock, "stk-1", Path::new("/tmp/a.log"), false)
                    .map(|_| ()),
                _ => drain_daemon(&err_sock, 1, vec![], Duration::from_secs(1)).map(|_| ()),
            };
            h.join().unwrap();
            assert!(res.unwrap_err().contains("unexpected response"));
        }

        // Early daemon exit reports failure cleanly.
        let fail_state = dir.path().join("early-exit");
        let early = ensure_daemon(
            &fail_state,
            Some(Path::new("/bin/false")),
            None,
            Mode::Agent,
        )
        .unwrap_err();
        assert!(
            early
                .message
                .contains("the stack supervisor could not be launched"),
            "{early:?}"
        );

        // Draining Hello triggers respawn attempt (fails on /bin/false).
        let drain_state = dir.path().join("draining-hello");
        fs::create_dir_all(&drain_state).unwrap();
        let drain_sock = drain_state.join("d.sock");
        let pid = std::process::id() as i32;
        write_daemon_record(
            &drain_state,
            &DaemonRecord {
                protocol_version: PROTOCOL_VERSION,
                pid,
                start_identity: String::new(),
                socket_path: drain_sock.to_string_lossy().into_owned(),
                version: "0.0.1".to_owned(),
                exe_path: "/bin/false".to_owned(),
                exe_identity: "x".to_owned(),
            },
        )
        .unwrap();
        let h = mock_single_reply(
            &drain_sock,
            ServerEvent::Hello {
                protocol_version: PROTOCOL_VERSION,
                pid,
                version: "0.0.1".to_owned(),
                exe_path: "/bin/false".to_owned(),
                exe_identity: "x".to_owned(),
                draining: true,
            },
        );
        let res = ensure_daemon(
            &drain_state,
            Some(Path::new("/bin/false")),
            None,
            Mode::Agent,
        );
        h.join().unwrap();
        assert!(res.is_err());

        // Nonexistent daemon binary reports launch failure cleanly.
        let bad_exe = ensure_daemon(
            &dir.path().join("bad-exe"),
            Some(Path::new("/nonexistent/devhost-bin")),
            None,
            Mode::Agent,
        )
        .unwrap_err();
        assert!(
            bad_exe
                .message
                .contains("the stack supervisor could not be launched")
        );

        // Unexpected Hello reply returns InvalidData.
        let bad_hello_sock = dir.path().join("bad-hello.sock");
        let h = mock_single_reply(&bad_hello_sock, ServerEvent::Ok);
        assert!(send_hello(&bad_hello_sock).is_err());
        h.join().unwrap();
    }

    #[test]
    fn run_foreground_and_detached_handle_mock_daemon_outcomes() {
        use crate::daemon::protocol::{FailureWire, LaunchKind, OverlapWire};
        use crate::services::resolve::ResolvedManifest;

        let dir = tempfile::tempdir().unwrap();
        let sock = dir.path().join("mock-fg.sock");
        let pid = std::process::id() as i32;
        write_daemon_record(
            dir.path(),
            &DaemonRecord {
                protocol_version: PROTOCOL_VERSION,
                pid,
                start_identity: String::new(),
                socket_path: sock.to_string_lossy().into_owned(),
                version: "test".to_owned(),
                exe_path: String::new(),
                exe_identity: String::new(),
            },
        )
        .unwrap();

        let make_spec = || StoredLaunchSpec {
            kind: LaunchKind::Serve {
                directory: dir.path().to_path_buf(),
                domain: "mock.localhost".to_owned(),
                port: Some(12345),
            },
            cwd: dir.path().to_path_buf(),
            environment: Default::default(),
            mode: Mode::Agent.into(),
            detached: false,
            log_path: String::new(),
        };

        // 1. Foreground receives Output (stdout + stderr) then Overlap error.
        let listener = UnixListener::bind(&sock).unwrap();
        let server = thread::spawn(move || {
            // Connection 1: Hello
            let (mut s, _) = listener.accept().unwrap();
            let mut r = BufReader::new(s.try_clone().unwrap());
            let _: Option<Request> = read_frame(&mut r).unwrap();
            write_frame(
                &mut s,
                &ServerEvent::Hello {
                    protocol_version: PROTOCOL_VERSION,
                    pid,
                    version: "test".to_owned(),
                    exe_path: String::new(),
                    exe_identity: String::new(),
                    draining: false,
                },
            )
            .unwrap();
            // Connection 2: Start -> Started, Output, Finished(Overlap)
            let (mut s, _) = listener.accept().unwrap();
            let mut r = BufReader::new(s.try_clone().unwrap());
            let _: Option<Request> = read_frame(&mut r).unwrap();
            write_frame(
                &mut s,
                &ServerEvent::Started {
                    stack_id: "stk-m1".to_owned(),
                    pid,
                },
            )
            .unwrap();
            write_frame(
                &mut s,
                &ServerEvent::Output {
                    stream: OutputStream::Stderr,
                    data: STANDARD.encode(b""),
                },
            )
            .unwrap();
            write_frame(
                &mut s,
                &ServerEvent::Finished {
                    exit_code: 1,
                    failure: None,
                    overlap: Some(OverlapWire {
                        manifest_path: "/a/devhost.toml".to_owned(),
                        owner_manifest_path: "/a/devhost.toml".to_owned(),
                        owner_pid: pid,
                        stack_name: "a".to_owned(),
                    }),
                    daemon_exiting: false,
                },
            )
            .unwrap();
            // Connection 3: Hello for Failure test
            let (mut s, _) = listener.accept().unwrap();
            let mut r = BufReader::new(s.try_clone().unwrap());
            let _: Option<Request> = read_frame(&mut r).unwrap();
            write_frame(
                &mut s,
                &ServerEvent::Hello {
                    protocol_version: PROTOCOL_VERSION,
                    pid,
                    version: "test".to_owned(),
                    exe_path: String::new(),
                    exe_identity: String::new(),
                    draining: false,
                },
            )
            .unwrap();
            // Connection 4: Start -> Finished(Failure)
            let (mut s, _) = listener.accept().unwrap();
            let mut r = BufReader::new(s.try_clone().unwrap());
            let _: Option<Request> = read_frame(&mut r).unwrap();
            write_frame(
                &mut s,
                &ServerEvent::Finished {
                    exit_code: 1,
                    failure: Some(FailureWire {
                        message: "failed start".to_owned(),
                        summary: None,
                        hint: None,
                    }),
                    overlap: None,
                    daemon_exiting: false,
                },
            )
            .unwrap();
            // Connection 5: Hello for Error test
            let (mut s, _) = listener.accept().unwrap();
            let mut r = BufReader::new(s.try_clone().unwrap());
            let _: Option<Request> = read_frame(&mut r).unwrap();
            write_frame(
                &mut s,
                &ServerEvent::Hello {
                    protocol_version: PROTOCOL_VERSION,
                    pid,
                    version: "test".to_owned(),
                    exe_path: String::new(),
                    exe_identity: String::new(),
                    draining: false,
                },
            )
            .unwrap();
            // Connection 6: Start -> Error
            let (mut s, _) = listener.accept().unwrap();
            let mut r = BufReader::new(s.try_clone().unwrap());
            let _: Option<Request> = read_frame(&mut r).unwrap();
            write_frame(
                &mut s,
                &ServerEvent::Error {
                    message: "server rejected".to_owned(),
                    draining: false,
                },
            )
            .unwrap();
        });

        let err1 = run_foreground(dir.path(), make_spec(), Mode::Agent).unwrap_err();
        assert!(matches!(err1, StartStackError::Overlap(_)));
        let err2 = run_foreground(dir.path(), make_spec(), Mode::Agent).unwrap_err();
        assert!(matches!(err2, StartStackError::Failure(f) if f.message == "failed start"));
        let err3 = run_foreground(dir.path(), make_spec(), Mode::Agent).unwrap_err();
        assert!(matches!(err3, StartStackError::Failure(f) if f.message == "server rejected"));
        server.join().unwrap();

        // 2. Detached start rejects unsupported OS and handles external signal before ready.
        let dummy_manifest = ResolvedManifest {
            remote: None,
            configuration: None,
            requested: Vec::new(),
            caddy: Default::default(),
            domain_suffix: ".localhost".to_owned(),
            devtools: Default::default(),
            worktrees: Default::default(),
            manifest_directory: dir.path().to_path_buf(),
            manifest_path: dir.path().join("devhost.toml"),
            name: "demo".to_owned(),
            primary_service: String::new(),
            service_order: Vec::new(),
            services: Default::default(),
            stopped: Default::default(),
            kill_zombies: false,
        };
        let out = ServiceOutput::new(
            Mode::Agent,
            Box::new(Vec::new()),
            Box::new(Vec::new()),
            &["devhost"],
        );
        let os_err = run_detached(DetachedDaemonStartOptions {
            manifest: dummy_manifest.clone(),
            spec: make_spec(),
            state_dir: dir.path().to_path_buf(),
            output: out.clone(),
            startup_timeout: Some(Duration::from_secs(1)),
            cleanup_timeout: Some(Duration::from_millis(200)),
            target_os: Some("windows".to_owned()),
            external_signal: None,
            install_signal_handlers: false,
        })
        .unwrap_err();
        assert!(os_err.message.contains("Linux and macOS"));

        // Detached start setup error when logs path is blocked by a file.
        let blocked_state = dir.path().join("blocked-state");
        fs::create_dir_all(&blocked_state).unwrap();
        fs::write(blocked_state.join("logs"), "not-a-dir").unwrap();
        let setup_err = run_detached(DetachedDaemonStartOptions {
            manifest: dummy_manifest,
            spec: make_spec(),
            state_dir: blocked_state,
            output: out,
            startup_timeout: Some(Duration::from_secs(1)),
            cleanup_timeout: Some(Duration::from_millis(200)),
            target_os: Some("linux".to_owned()),
            external_signal: None,
            install_signal_handlers: false,
        })
        .unwrap_err();
        assert!(
            setup_err
                .message
                .contains("the stack log directory could not be created")
        );
    }
}
