use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, File, OpenOptions},
    io::{self, BufReader, Write},
    os::unix::{
        fs::{DirBuilderExt, OpenOptionsExt, PermissionsExt},
        net::{UnixListener, UnixStream},
    },
    panic::{AssertUnwindSafe, catch_unwind},
    path::{Path, PathBuf},
    sync::{
        Arc, Condvar, Mutex,
        atomic::{AtomicBool, AtomicI32, AtomicUsize, Ordering},
        mpsc::{self, Sender},
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

use base64::{Engine, engine::general_purpose::STANDARD};
use cli_command_kit::Mode;

use super::{
    DaemonRecord, PROTOCOL_VERSION, acquire_daemon_lock, daemon_socket_path, ensure_state_dir,
    exe_identity, remove_daemon_record_if_pid, write_daemon_record,
};
use crate::{
    Failure, caddy,
    cliout::ServiceOutput,
    config,
    daemon::protocol::{
        ExportedStack, FailureWire, LaunchKind, OutputStream, OverlapWire, Request, ServerEvent,
        StoredLaunchSpec, read_frame, write_frame,
    },
    manifest, paths, procid,
    services::{
        containment,
        detach::LaunchMetadata,
        resolve::{
            PortResolutionOptions, resolve_service_order, resolve_service_ports,
            validate_requested_services,
        },
        serve::start_serve,
        serve_command::{resolve_command_with_config, start_command},
        stack::{StartStackError, StartStackOptions, start_stack},
    },
};

const ACCEPT_POLL_INTERVAL: Duration = Duration::from_millis(50);
const IDLE_STARTUP_GRACE: Duration = Duration::from_secs(5);
const REGISTRATION_TIMEOUT: Duration = Duration::from_secs(30);
const DEFAULT_RESTART_STOP_TIMEOUT: Duration = Duration::from_secs(15);

static DAEMON_SIGNAL: AtomicI32 = AtomicI32::new(0);

extern "C" fn handle_daemon_signal(sig: libc::c_int) {
    let _ = DAEMON_SIGNAL.compare_exchange(0, sig, Ordering::SeqCst, Ordering::SeqCst);
}

struct DaemonSignalGuard {
    previous: Vec<(libc::c_int, libc::sigaction)>,
}

impl DaemonSignalGuard {
    fn install() -> Self {
        DAEMON_SIGNAL.store(0, Ordering::SeqCst);
        let mut previous = Vec::new();
        for sig in [libc::SIGINT, libc::SIGTERM] {
            // SAFETY: signal handler only stores an integer into a static AtomicI32.
            unsafe {
                let mut action: libc::sigaction = std::mem::zeroed();
                action.sa_sigaction = handle_daemon_signal as *const () as usize;
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

impl Drop for DaemonSignalGuard {
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
struct StackOutcome {
    exit_code: i32,
    failure: Option<FailureWire>,
    overlap: Option<OverlapWire>,
}

struct HostedStack {
    stack_id: String,
    name: Mutex<String>,
    manifest_path: String,
    remote: AtomicBool,
    spec: StoredLaunchSpec,
    cancel: Arc<AtomicBool>,
    signal: Arc<AtomicI32>,
    finished: Arc<(Mutex<Option<StackOutcome>>, Condvar)>,
    join_handle: Mutex<Option<JoinHandle<()>>>,
}

impl HostedStack {
    fn request_stop(&self, sig: i32) {
        let _ = self
            .signal
            .compare_exchange(0, sig, Ordering::SeqCst, Ordering::SeqCst);
        self.cancel.store(true, Ordering::SeqCst);
    }

    fn outcome(&self) -> Option<StackOutcome> {
        self.finished.0.lock().expect("stack finished lock").clone()
    }

    fn wait_finished(&self, timeout: Duration) -> Option<StackOutcome> {
        let deadline = Instant::now() + timeout;
        let mut guard = self.finished.0.lock().expect("stack finished lock");
        while guard.is_none() {
            let remaining = deadline.checked_duration_since(Instant::now())?;
            let (next, _) = self
                .finished
                .1
                .wait_timeout(guard, remaining)
                .expect("stack finished condvar");
            guard = next;
        }
        guard.clone()
    }

    fn join_if_done(&self) {
        if let Some(handle) = self.join_handle.lock().expect("join handle lock").take() {
            let _ = handle.join();
        }
    }
}

struct InnerState {
    draining: bool,
    ever_had_stack: bool,
    stacks: BTreeMap<String, Arc<HostedStack>>,
    retired_handles: Vec<JoinHandle<()>>,
}

struct DaemonState {
    state_dir: PathBuf,
    caddy_dir: PathBuf,
    socket_path: PathBuf,
    pid: i32,
    version: String,
    exe_path: String,
    exe_identity: String,
    started_at: Instant,
    shutting_down: AtomicBool,
    active_connections: AtomicUsize,
    inner: Mutex<InnerState>,
}

impl DaemonState {
    fn try_begin_shutdown_if_idle(&self, expected_connections: usize, force_idle: bool) -> bool {
        if self.shutting_down.load(Ordering::SeqCst) {
            return true;
        }
        {
            let inner = self.inner.lock().expect("daemon inner lock");
            if !inner.stacks.is_empty() {
                return false;
            }
            if !force_idle
                && !inner.ever_had_stack
                && self.started_at.elapsed() < IDLE_STARTUP_GRACE
            {
                return false;
            }
            if self.active_connections.load(Ordering::SeqCst) > expected_connections {
                return false;
            }
        }
        let Ok(_lock) = acquire_daemon_lock(&self.state_dir, Duration::from_secs(2)) else {
            return false;
        };
        let mut inner = self.inner.lock().expect("daemon inner lock");
        if !inner.stacks.is_empty()
            || self.active_connections.load(Ordering::SeqCst) > expected_connections
        {
            return false;
        }
        if !force_idle && !inner.ever_had_stack && self.started_at.elapsed() < IDLE_STARTUP_GRACE {
            return false;
        }
        inner.draining = true;
        self.shutting_down.store(true, Ordering::SeqCst);
        remove_daemon_record_if_pid(&self.state_dir, self.pid);
        let _ = fs::remove_file(&self.socket_path);
        true
    }

    fn cancel_all_and_wait(&self, sig: i32, timeout: Duration) {
        let stacks: Vec<Arc<HostedStack>> = {
            let mut inner = self.inner.lock().expect("daemon inner lock");
            inner.draining = true;
            inner.stacks.values().cloned().collect()
        };
        for stack in &stacks {
            stack.request_stop(sig);
        }
        let deadline = Instant::now() + timeout;
        for stack in &stacks {
            let remaining = deadline.saturating_duration_since(Instant::now());
            let _ = stack.wait_finished(remaining);
            stack.join_if_done();
        }
        let handles: Vec<JoinHandle<()>> = {
            let mut inner = self.inner.lock().expect("daemon inner lock");
            std::mem::take(&mut inner.retired_handles)
        };
        for handle in handles {
            let _ = handle.join();
        }
    }

    fn cleanup_on_exit(&self) {
        if let Ok(_lock) = acquire_daemon_lock(&self.state_dir, Duration::from_secs(2)) {
            remove_daemon_record_if_pid(&self.state_dir, self.pid);
        } else {
            remove_daemon_record_if_pid(&self.state_dir, self.pid);
        }
        let _ = fs::remove_file(&self.socket_path);
    }
}

struct StreamWriter {
    stream: OutputStream,
    tx: Sender<ServerEvent>,
}

impl Write for StreamWriter {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        if !buf.is_empty() {
            let _ = self.tx.send(ServerEvent::Output {
                stream: self.stream,
                data: STANDARD.encode(buf),
            });
        }
        Ok(buf.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

#[derive(Clone)]
struct SharedFileWriter(Arc<Mutex<File>>);

impl Write for SharedFileWriter {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        let mut file = self.0.lock().expect("log file lock");
        file.write_all(buf)?;
        Ok(buf.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        let mut file = self.0.lock().expect("log file lock");
        file.flush()
    }
}

enum OutputSink {
    Stream(Sender<ServerEvent>),
    LogFile(Arc<Mutex<File>>),
}

impl OutputSink {
    fn build_output(&self, mode: Mode, labels: &[&str]) -> ServiceOutput {
        match self {
            Self::Stream(tx) => ServiceOutput::new(
                mode,
                Box::new(StreamWriter {
                    stream: OutputStream::Stdout,
                    tx: tx.clone(),
                }),
                Box::new(StreamWriter {
                    stream: OutputStream::Stderr,
                    tx: tx.clone(),
                }),
                labels,
            ),
            Self::LogFile(file) => ServiceOutput::new(
                mode,
                Box::new(SharedFileWriter(file.clone())),
                Box::new(SharedFileWriter(file.clone())),
                labels,
            ),
        }
    }
}

pub fn run_daemon(state_dir: &Path, version: &str) -> Result<(), String> {
    let state_dir = paths::clean(state_dir);
    ensure_state_dir(&state_dir)?;
    #[cfg(target_os = "linux")]
    {
        // SAFETY: PR_SET_CHILD_SUBREAPER with arg2=1 takes no pointers and causes
        // orphaned descendant processes of hosted stacks to reparent here for reaping.
        unsafe {
            let _ = libc::prctl(libc::PR_SET_CHILD_SUBREAPER, 1, 0, 0, 0);
        }
    }
    let _signal_guard = DaemonSignalGuard::install();

    let pid = std::process::id() as i32;
    let socket_path = daemon_socket_path(&state_dir, pid);
    let _ = fs::remove_file(&socket_path);
    let listener = UnixListener::bind(&socket_path)
        .map_err(|error| format!("bind daemon socket {}: {error}", socket_path.display()))?;
    let _ = fs::set_permissions(&socket_path, fs::Permissions::from_mode(0o600));
    listener
        .set_nonblocking(true)
        .map_err(|error| format!("configure daemon listener: {error}"))?;

    let current_exe = std::env::current_exe().unwrap_or_default();
    let exe_path = current_exe.to_string_lossy().into_owned();
    let current_exe_identity = exe_identity(&current_exe);
    let record = DaemonRecord {
        protocol_version: PROTOCOL_VERSION,
        pid,
        start_identity: procid::start_identity(pid).unwrap_or_default(),
        socket_path: socket_path.to_string_lossy().into_owned(),
        version: version.to_owned(),
        exe_path: exe_path.clone(),
        exe_identity: current_exe_identity.clone(),
    };
    write_daemon_record(&state_dir, &record)?;

    let state = Arc::new(DaemonState {
        caddy_dir: paths::clean(&state_dir.join("caddy")),
        state_dir,
        socket_path,
        pid,
        version: version.to_owned(),
        exe_path,
        exe_identity: current_exe_identity,
        started_at: Instant::now(),
        shutting_down: AtomicBool::new(false),
        active_connections: AtomicUsize::new(0),
        inner: Mutex::new(InnerState {
            draining: false,
            ever_had_stack: false,
            stacks: BTreeMap::new(),
            retired_handles: Vec::new(),
        }),
    });

    let stopper_state = state.clone();
    caddy::routes::set_in_process_stack_stopper(Arc::new(move |target_stack_id: &str| {
        let stack = stopper_state
            .inner
            .lock()
            .expect("daemon inner lock")
            .stacks
            .get(target_stack_id)
            .cloned();
        let Some(stack) = stack else {
            return Ok(());
        };
        stack.request_stop(libc::SIGTERM);
        if stack.wait_finished(Duration::from_secs(10)).is_none() {
            return Err(format!(
                "zombie stack {target_stack_id} did not stop in time"
            ));
        }
        stack.join_if_done();
        Ok(())
    }));

    let mut conn_threads: Vec<JoinHandle<()>> = Vec::new();

    loop {
        containment::reap_orphaned_descendants();
        conn_threads.retain(|handle| !handle.is_finished());

        let sig = DAEMON_SIGNAL.swap(0, Ordering::SeqCst);
        if sig != 0 {
            state.shutting_down.store(true, Ordering::SeqCst);
            state.cancel_all_and_wait(sig, DEFAULT_RESTART_STOP_TIMEOUT);
            break;
        }

        if state.shutting_down.load(Ordering::SeqCst) {
            if state.active_connections.load(Ordering::SeqCst) == 0 {
                break;
            }
            thread::sleep(ACCEPT_POLL_INTERVAL);
            continue;
        }

        match listener.accept() {
            Ok((stream, _)) => {
                let _ = stream.set_nonblocking(false);
                state.active_connections.fetch_add(1, Ordering::SeqCst);
                let conn_state = state.clone();
                conn_threads.push(thread::spawn(move || {
                    struct ActiveGuard(Arc<DaemonState>);
                    impl Drop for ActiveGuard {
                        fn drop(&mut self) {
                            self.0.active_connections.fetch_sub(1, Ordering::SeqCst);
                        }
                    }
                    let _guard = ActiveGuard(conn_state.clone());
                    handle_connection(conn_state, stream);
                }));
            }
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                if state.try_begin_shutdown_if_idle(0, false) {
                    break;
                }
                thread::sleep(ACCEPT_POLL_INTERVAL);
            }
            Err(_) => {
                thread::sleep(ACCEPT_POLL_INTERVAL);
            }
        }
    }

    drop(listener);
    for handle in conn_threads {
        let _ = handle.join();
    }
    state.cancel_all_and_wait(libc::SIGTERM, Duration::from_secs(5));
    state.cleanup_on_exit();
    Ok(())
}

fn handle_connection(state: Arc<DaemonState>, mut stream: UnixStream) {
    let Ok(read_clone) = stream.try_clone() else {
        return;
    };
    let mut reader = BufReader::new(read_clone);
    let request: Request = match read_frame(&mut reader) {
        Ok(Some(req)) => req,
        Ok(None) | Err(_) => return,
    };

    match request {
        Request::Hello => {
            let draining = state.inner.lock().expect("daemon inner lock").draining;
            let _ = write_frame(
                &mut stream,
                &ServerEvent::Hello {
                    protocol_version: PROTOCOL_VERSION,
                    pid: state.pid,
                    version: state.version.clone(),
                    exe_path: state.exe_path.clone(),
                    exe_identity: state.exe_identity.clone(),
                    draining,
                },
            );
        }
        Request::CancelStack { stack_id, signal } => {
            let stack = state
                .inner
                .lock()
                .expect("daemon inner lock")
                .stacks
                .get(&stack_id)
                .cloned();
            if let Some(stack) = stack {
                stack.request_stop(signal);
            }
            let _ = write_frame(&mut stream, &ServerEvent::Ok);
        }
        Request::StopStack {
            stack_id,
            signal,
            grace_ms,
        } => {
            let stack = state
                .inner
                .lock()
                .expect("daemon inner lock")
                .stacks
                .get(&stack_id)
                .cloned();
            let Some(stack) = stack else {
                let daemon_exiting = state.try_begin_shutdown_if_idle(1, false);
                let _ = write_frame(
                    &mut stream,
                    &ServerEvent::Stopped {
                        already_stopped: true,
                        daemon_exiting,
                    },
                );
                return;
            };
            stack.request_stop(signal);
            let grace = Duration::from_millis(grace_ms.max(100));
            if stack.wait_finished(grace).is_none() {
                let _ = write_frame(
                    &mut stream,
                    &ServerEvent::Error {
                        message: format!(
                            "stack {} (PID {}) is still stopping after {}s",
                            stack.name.lock().expect("stack name").clone(),
                            state.pid,
                            grace.as_secs()
                        ),
                        draining: false,
                    },
                );
                return;
            }
            stack.join_if_done();
            let wait_deadline = Instant::now() + Duration::from_millis(500);
            while state
                .inner
                .lock()
                .expect("daemon inner lock")
                .stacks
                .is_empty()
                && state.active_connections.load(Ordering::SeqCst) > 1
                && Instant::now() < wait_deadline
            {
                thread::sleep(Duration::from_millis(10));
            }
            let daemon_exiting = state.try_begin_shutdown_if_idle(1, false);
            let _ = write_frame(
                &mut stream,
                &ServerEvent::Stopped {
                    already_stopped: false,
                    daemon_exiting,
                },
            );
        }
        Request::ExportSpecs => {
            let stacks = {
                let inner = state.inner.lock().expect("daemon inner lock");
                inner
                    .stacks
                    .values()
                    .map(|stack| ExportedStack {
                        stack_id: stack.stack_id.clone(),
                        name: stack.name.lock().expect("stack name").clone(),
                        manifest_path: stack.manifest_path.clone(),
                        remote: stack.remote.load(Ordering::Relaxed),
                        spec: stack.spec.clone(),
                    })
                    .collect()
            };
            let _ = write_frame(
                &mut stream,
                &ServerEvent::Specs {
                    pid: state.pid,
                    exe_identity: state.exe_identity.clone(),
                    stacks,
                },
            );
        }
        Request::Drain {
            preserve_stack_ids,
            stop_timeout_ms,
        } => {
            handle_drain(&state, &mut stream, preserve_stack_ids, stop_timeout_ms);
        }
        Request::Start {
            spec,
            wait_for_ready,
            attach_output,
        } => {
            handle_start(
                &state,
                &mut stream,
                reader,
                spec,
                wait_for_ready,
                attach_output,
            );
        }
        Request::StartReplaced {
            spec,
            output_log_path,
            record_log,
        } => {
            handle_start_replaced(&state, &mut stream, spec, &output_log_path, record_log);
        }
        Request::RestartStack {
            stack_id,
            output_log_path,
            record_log,
        } => {
            handle_restart_stack(&state, &mut stream, &stack_id, &output_log_path, record_log);
        }
    }
}

fn handle_drain(
    state: &Arc<DaemonState>,
    stream: &mut UnixStream,
    preserve_stack_ids: Vec<String>,
    stop_timeout_ms: u64,
) {
    let preserve: BTreeSet<String> = preserve_stack_ids.into_iter().collect();
    if let Ok(_lock) = acquire_daemon_lock(&state.state_dir, Duration::from_secs(5)) {
        let mut inner = state.inner.lock().expect("daemon inner lock");
        inner.draining = true;
        remove_daemon_record_if_pid(&state.state_dir, state.pid);
    } else {
        state.inner.lock().expect("daemon inner lock").draining = true;
        remove_daemon_record_if_pid(&state.state_dir, state.pid);
    }

    let targets: Vec<Arc<HostedStack>> = {
        let inner = state.inner.lock().expect("daemon inner lock");
        inner
            .stacks
            .values()
            .filter(|stack| !preserve.contains(&stack.stack_id))
            .cloned()
            .collect()
    };

    for stack in &targets {
        stack.request_stop(libc::SIGTERM);
    }
    let timeout = Duration::from_millis(stop_timeout_ms.max(1000));
    let deadline = Instant::now() + timeout;
    let mut stopped = Vec::new();
    let mut errors = Vec::new();
    for stack in &targets {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if stack.wait_finished(remaining).is_some() {
            stack.join_if_done();
            stopped.push(stack.stack_id.clone());
        } else {
            errors.push(format!(
                "stack {} is still stopping after {}s; replacement was not started",
                stack.name.lock().expect("stack name").clone(),
                timeout.as_secs()
            ));
        }
    }

    let remaining = state.inner.lock().expect("daemon inner lock").stacks.len();
    let daemon_exiting = if remaining == 0 {
        state.try_begin_shutdown_if_idle(1, true)
    } else {
        false
    };
    let _ = write_frame(
        stream,
        &ServerEvent::Drained {
            stopped,
            errors,
            remaining,
            daemon_exiting,
        },
    );
}

fn handle_start(
    state: &Arc<DaemonState>,
    stream: &mut UnixStream,
    mut reader: BufReader<UnixStream>,
    spec: StoredLaunchSpec,
    wait_for_ready: bool,
    attach_output: bool,
) {
    let (event_tx, event_rx) = if attach_output {
        let (tx, rx) = mpsc::channel();
        (Some(tx), Some(rx))
    } else {
        (None, None)
    };
    let (ready_tx, ready_rx) = if wait_for_ready {
        let (tx, rx) = mpsc::channel();
        (Some(tx), Some(rx))
    } else {
        (None, None)
    };

    let sink = if let Some(tx) = event_tx {
        OutputSink::Stream(tx)
    } else {
        match open_log_file(Path::new(&spec.log_path)) {
            Ok(file) => OutputSink::LogFile(Arc::new(Mutex::new(file))),
            Err(error) => {
                let _ = write_frame(
                    stream,
                    &ServerEvent::Error {
                        message: format!("open stack log {}: {error}", spec.log_path),
                        draining: false,
                    },
                );
                return;
            }
        }
    };

    let launch = LaunchMetadata {
        log_path: spec.log_path.clone(),
        detached: spec.detached,
    };

    let hosted = match spawn_hosted_stack(state, spec.clone(), sink, launch, ready_tx) {
        Ok(hosted) => hosted,
        Err(SpawnError::Draining) => {
            let _ = write_frame(
                stream,
                &ServerEvent::Error {
                    message: "devhost daemon is shutting down".to_owned(),
                    draining: true,
                },
            );
            return;
        }
        Err(SpawnError::Other(message)) => {
            let _ = write_frame(
                stream,
                &ServerEvent::Error {
                    message,
                    draining: false,
                },
            );
            return;
        }
    };

    if write_frame(
        stream,
        &ServerEvent::Started {
            stack_id: hosted.stack_id.clone(),
            pid: state.pid,
        },
    )
    .is_err()
    {
        hosted.request_stop(libc::SIGHUP);
        return;
    }

    if attach_output {
        let stop_reader = Arc::new(AtomicBool::new(false));
        let watcher_stack = hosted.clone();
        let watcher_done = stop_reader.clone();
        let watcher = thread::spawn(move || {
            let _ = reader
                .get_ref()
                .set_read_timeout(Some(Duration::from_millis(100)));
            loop {
                if watcher_done.load(Ordering::Relaxed) || watcher_stack.outcome().is_some() {
                    break;
                }
                match read_frame::<_, Request>(&mut reader) {
                    Ok(Some(Request::CancelStack { signal, .. })) => {
                        watcher_stack.request_stop(signal);
                    }
                    Ok(Some(_)) => {}
                    Ok(None) => {
                        if !watcher_done.load(Ordering::Relaxed)
                            && watcher_stack.outcome().is_none()
                        {
                            watcher_stack.request_stop(libc::SIGHUP);
                        }
                        break;
                    }
                    Err(error)
                        if matches!(
                            error.kind(),
                            io::ErrorKind::WouldBlock
                                | io::ErrorKind::TimedOut
                                | io::ErrorKind::Interrupted
                        ) => {}
                    Err(_) => {
                        if !watcher_done.load(Ordering::Relaxed)
                            && watcher_stack.outcome().is_none()
                        {
                            watcher_stack.request_stop(libc::SIGHUP);
                        }
                        break;
                    }
                }
            }
        });

        if let Some(rx) = event_rx {
            loop {
                match rx.recv_timeout(Duration::from_millis(50)) {
                    Ok(event) => {
                        if write_frame(stream, &event).is_err() {
                            hosted.request_stop(libc::SIGHUP);
                            break;
                        }
                    }
                    Err(mpsc::RecvTimeoutError::Disconnected) => break,
                    Err(mpsc::RecvTimeoutError::Timeout) => {
                        if hosted.outcome().is_some() {
                            while let Ok(event) = rx.try_recv() {
                                let _ = write_frame(stream, &event);
                            }
                            break;
                        }
                    }
                }
            }
        }
        let outcome = hosted
            .wait_finished(Duration::from_secs(60))
            .unwrap_or(StackOutcome {
                exit_code: 1,
                failure: Some(FailureWire {
                    message: "stack exited without reporting an outcome".to_owned(),
                    summary: None,
                    hint: None,
                }),
                overlap: None,
            });
        stop_reader.store(true, Ordering::Relaxed);
        let _ = stream.shutdown(std::net::Shutdown::Read);
        let daemon_exiting = state.try_begin_shutdown_if_idle(1, false);
        let _ = write_frame(
            stream,
            &ServerEvent::Finished {
                exit_code: outcome.exit_code,
                failure: outcome.failure,
                overlap: outcome.overlap,
                daemon_exiting,
            },
        );
        let _ = watcher.join();
        return;
    }

    if wait_for_ready {
        let ready_rx = ready_rx.expect("ready receiver");
        let _ = reader
            .get_ref()
            .set_read_timeout(Some(Duration::from_millis(25)));
        loop {
            match ready_rx.recv_timeout(Duration::from_millis(25)) {
                Ok(urls) => {
                    let name = hosted.name.lock().expect("stack name").clone();
                    let remote = hosted.remote.load(Ordering::Relaxed);
                    let _ = write_frame(
                        stream,
                        &ServerEvent::Ready {
                            stack_id: hosted.stack_id.clone(),
                            pid: state.pid,
                            name,
                            urls,
                            log_path: spec.log_path.clone(),
                            remote,
                        },
                    );
                    return;
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    let outcome =
                        hosted
                            .wait_finished(Duration::from_secs(5))
                            .unwrap_or(StackOutcome {
                                exit_code: 1,
                                failure: None,
                                overlap: None,
                            });
                    let daemon_exiting = state.try_begin_shutdown_if_idle(1, false);
                    let _ = write_frame(
                        stream,
                        &ServerEvent::Finished {
                            exit_code: outcome.exit_code,
                            failure: outcome.failure,
                            overlap: outcome.overlap,
                            daemon_exiting,
                        },
                    );
                    return;
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
            }

            if let Some(outcome) = hosted.outcome() {
                let daemon_exiting = state.try_begin_shutdown_if_idle(1, false);
                let _ = write_frame(
                    stream,
                    &ServerEvent::Finished {
                        exit_code: outcome.exit_code,
                        failure: outcome.failure,
                        overlap: outcome.overlap,
                        daemon_exiting,
                    },
                );
                return;
            }

            match read_frame::<_, Request>(&mut reader) {
                Ok(Some(Request::CancelStack { signal, .. })) => {
                    hosted.request_stop(signal);
                }
                Ok(Some(_)) => {}
                Ok(None) => {
                    // Client closed connection before Ready arrived; abort startup cleanly.
                    hosted.request_stop(libc::SIGTERM);
                    return;
                }
                Err(error)
                    if matches!(
                        error.kind(),
                        io::ErrorKind::WouldBlock
                            | io::ErrorKind::TimedOut
                            | io::ErrorKind::Interrupted
                    ) => {}
                Err(_) => {
                    hosted.request_stop(libc::SIGTERM);
                    return;
                }
            }
        }
    }
}

fn handle_start_replaced(
    state: &Arc<DaemonState>,
    stream: &mut UnixStream,
    mut spec: StoredLaunchSpec,
    output_log_path: &Path,
    record_log: bool,
) {
    let log_file = match open_log_file(output_log_path) {
        Ok(file) => Arc::new(Mutex::new(file)),
        Err(error) => {
            let _ = write_frame(
                stream,
                &ServerEvent::Error {
                    message: format!("open restart log {}: {error}", output_log_path.display()),
                    draining: false,
                },
            );
            return;
        }
    };
    let recorded_path = if record_log {
        output_log_path.to_string_lossy().into_owned()
    } else {
        String::new()
    };
    spec.detached = false;
    spec.log_path = recorded_path.clone();
    let launch = LaunchMetadata {
        log_path: recorded_path,
        detached: false,
    };

    let hosted = match spawn_hosted_stack(state, spec, OutputSink::LogFile(log_file), launch, None)
    {
        Ok(hosted) => hosted,
        Err(SpawnError::Draining) => {
            let _ = write_frame(
                stream,
                &ServerEvent::Error {
                    message: "devhost daemon is shutting down".to_owned(),
                    draining: true,
                },
            );
            return;
        }
        Err(SpawnError::Other(message)) => {
            let _ = write_frame(
                stream,
                &ServerEvent::Error {
                    message,
                    draining: false,
                },
            );
            return;
        }
    };

    match wait_for_control_registration(&state.caddy_dir, &hosted, state.pid) {
        Ok(name) => {
            let _ = write_frame(
                stream,
                &ServerEvent::Restarted {
                    stack_id: hosted.stack_id.clone(),
                    pid: state.pid,
                    name,
                },
            );
        }
        Err(message) => {
            let _ = write_frame(
                stream,
                &ServerEvent::Error {
                    message,
                    draining: false,
                },
            );
        }
    }
}

fn handle_restart_stack(
    state: &Arc<DaemonState>,
    stream: &mut UnixStream,
    stack_id: &str,
    output_log_path: &Path,
    record_log: bool,
) {
    let existing = state
        .inner
        .lock()
        .expect("daemon inner lock")
        .stacks
        .get(stack_id)
        .cloned();
    let Some(existing) = existing else {
        let _ = write_frame(
            stream,
            &ServerEvent::Error {
                message: format!("stack {stack_id} is no longer running"),
                draining: false,
            },
        );
        return;
    };
    let mut spec = existing.spec.clone();
    // Preserve effective remote mode across restarts.
    if let LaunchKind::Manifest {
        ref mut local,
        ref mut remote,
        ..
    } = spec.kind
    {
        let was_remote = existing.remote.load(Ordering::Relaxed);
        *remote = was_remote;
        *local = !was_remote;
    }

    existing.request_stop(libc::SIGTERM);
    if existing
        .wait_finished(DEFAULT_RESTART_STOP_TIMEOUT)
        .is_none()
    {
        let _ = write_frame(
            stream,
            &ServerEvent::Error {
                message: "stack is still stopping after 15s; replacement was not started"
                    .to_owned(),
                draining: false,
            },
        );
        return;
    }
    existing.join_if_done();
    handle_start_replaced(state, stream, spec, output_log_path, record_log);
}

fn wait_for_control_registration(
    caddy_dir: &Path,
    hosted: &Arc<HostedStack>,
    daemon_pid: i32,
) -> Result<String, String> {
    let deadline = Instant::now() + REGISTRATION_TIMEOUT;
    loop {
        if let Ok(stacks) = caddy::stacks::read_live_stacks(caddy_dir)
            && let Some(found) = stacks
                .into_iter()
                .find(|s| s.stack_id == hosted.stack_id && s.control_port > 0)
        {
            return Ok(found.name);
        }
        if let Some(outcome) = hosted.outcome() {
            let detail = outcome
                .failure
                .map(|f| f.message)
                .or_else(|| {
                    outcome
                        .overlap
                        .map(|o| format!("manifest overlap with PID {}", o.owner_pid))
                })
                .unwrap_or_else(|| format!("exit code {}", outcome.exit_code));
            return Err(format!(
                "replacement exited before its control server registered: {detail}"
            ));
        }
        if Instant::now() >= deadline {
            return Err(format!(
                "replacement PID {daemon_pid} has not registered after 30s; it remains running, inspect its log"
            ));
        }
        thread::sleep(Duration::from_millis(50));
    }
}

enum SpawnError {
    Draining,
    Other(String),
}

fn spawn_hosted_stack(
    state: &Arc<DaemonState>,
    spec: StoredLaunchSpec,
    sink: OutputSink,
    launch: LaunchMetadata,
    ready_notify: Option<Sender<Vec<String>>>,
) -> Result<Arc<HostedStack>, SpawnError> {
    let stack_id = caddy::stacks::generate_stack_id();
    let (initial_name, manifest_path, initial_remote) = match &spec.kind {
        LaunchKind::Manifest {
            manifest_path,
            remote,
            ..
        } => (
            manifest_path
                .parent()
                .and_then(|p| p.file_name())
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| "devhost".to_owned()),
            paths::clean(manifest_path).to_string_lossy().into_owned(),
            *remote,
        ),
        LaunchKind::Serve { domain, .. } => (format!("serve-{domain}"), String::new(), false),
        LaunchKind::ServeCommand { session_name, .. } => {
            (session_name.clone(), String::new(), false)
        }
    };

    let cancel = Arc::new(AtomicBool::new(false));
    let signal = Arc::new(AtomicI32::new(0));
    let finished = Arc::new((Mutex::new(None), Condvar::new()));

    let hosted = Arc::new(HostedStack {
        stack_id: stack_id.clone(),
        name: Mutex::new(initial_name),
        manifest_path,
        remote: AtomicBool::new(initial_remote),
        spec: spec.clone(),
        cancel: cancel.clone(),
        signal: signal.clone(),
        finished: finished.clone(),
        join_handle: Mutex::new(None),
    });

    {
        let mut inner = state.inner.lock().expect("daemon inner lock");
        if inner.draining {
            return Err(SpawnError::Draining);
        }
        inner.ever_had_stack = true;
        inner.stacks.insert(stack_id.clone(), hosted.clone());
    }

    let worker_state = state.clone();
    let worker_hosted = hosted.clone();
    let handle = thread::Builder::new()
        .name(format!("stack-{stack_id}"))
        .spawn(move || {
            let outcome = match catch_unwind(AssertUnwindSafe(|| {
                run_hosted_stack(
                    &worker_state,
                    &worker_hosted,
                    spec,
                    sink,
                    launch,
                    ready_notify,
                )
            })) {
                Ok(outcome) => outcome,
                Err(payload) => {
                    let message = payload
                        .downcast_ref::<&str>()
                        .map(|s| (*s).to_owned())
                        .or_else(|| payload.downcast_ref::<String>().cloned())
                        .unwrap_or_else(|| "unexpected panic in stack supervisor".to_owned());
                    let _ = caddy::stacks::unregister_stack_for(
                        &worker_state.caddy_dir,
                        &worker_hosted.stack_id,
                    );
                    StackOutcome {
                        exit_code: 1,
                        failure: Some(FailureWire {
                            message: format!("stack panicked: {message}"),
                            summary: None,
                            hint: None,
                        }),
                        overlap: None,
                    }
                }
            };
            {
                let mut inner = worker_state.inner.lock().expect("daemon inner lock");
                inner.stacks.remove(&worker_hosted.stack_id);
                if let Some(handle) = worker_hosted
                    .join_handle
                    .lock()
                    .expect("join handle lock")
                    .take()
                {
                    inner.retired_handles.push(handle);
                }
            }
            {
                let mut guard = worker_hosted.finished.0.lock().expect("finished lock");
                *guard = Some(outcome);
            }
            worker_hosted.finished.1.notify_all();
        })
        .map_err(|error| {
            state
                .inner
                .lock()
                .expect("daemon inner lock")
                .stacks
                .remove(&stack_id);
            SpawnError::Other(format!("spawn stack worker thread: {error}"))
        })?;

    *hosted.join_handle.lock().expect("join handle lock") = Some(handle);
    Ok(hosted)
}

fn run_hosted_stack(
    state: &Arc<DaemonState>,
    hosted: &Arc<HostedStack>,
    spec: StoredLaunchSpec,
    sink: OutputSink,
    launch: LaunchMetadata,
    ready_notify: Option<Sender<Vec<String>>>,
) -> StackOutcome {
    let mode: Mode = spec.mode.into();
    let daemon_socket = state.socket_path.to_string_lossy().into_owned();
    let log_file_for_errors = match &sink {
        OutputSink::LogFile(file) => Some(file.clone()),
        OutputSink::Stream(_) => None,
    };
    let result = match spec.kind {
        LaunchKind::Manifest {
            manifest_path,
            requested,
            debug_caddy,
            local,
            remote,
            idle_timeout_ms,
        } => {
            let validated = match manifest::read_manifest_env(
                &spec.cwd,
                Some(&manifest_path),
                Some(&spec.environment),
            ) {
                Ok(m) => m,
                Err(failure) => return failure_outcome(failure),
            };
            if let Err(err) = validate_requested_services(&validated, &requested) {
                return failure_outcome(Failure {
                    message: err,
                    summary: None,
                    hint: Some(
                        "Run \"devhost service list\" to print the service names.".to_owned(),
                    ),
                });
            }
            let service_order = match resolve_service_order(&validated) {
                Ok(order) => order,
                Err(err) => return failure_outcome(err.into()),
            };
            let (config_path, shared) = match config::read_from_env(&spec.environment) {
                Ok(pair) => pair,
                Err(err) => return failure_outcome(err.into()),
            };
            if remote && shared.remote.is_none() {
                return failure_outcome(Failure {
                    message: format!("remote previews are not configured in {}", config_path.display()),
                    summary: None,
                    hint: Some(
                        "Configure the [remote] table in the devhost machine config before starting with --remote."
                            .to_owned(),
                    ),
                });
            }
            let remote_settings = if local { None } else { shared.remote.clone() };
            let mut resolved = match resolve_service_ports(
                &validated,
                &PortResolutionOptions {
                    requested,
                    domain_suffix: remote_settings.as_ref().map_or_else(
                        || shared.domain_suffix.clone(),
                        |settings| settings.domain_suffix.clone(),
                    ),
                    remote_mode: remote_settings.is_some(),
                    remote: remote_settings,
                    ..PortResolutionOptions::default()
                },
            ) {
                Ok(m) => m,
                Err(err) => return failure_outcome(err.into()),
            };
            *hosted.name.lock().expect("stack name") = resolved.name.clone();
            hosted
                .remote
                .store(resolved.remote.is_some(), Ordering::Relaxed);

            let mut label_names: Vec<String> = vec![
                resolved.name.trim().to_owned(),
                "devhost".to_owned(),
                "caddy".to_owned(),
            ];
            label_names.extend(service_order.iter().cloned());
            let label_refs: Vec<&str> = label_names.iter().map(String::as_str).collect();
            let output = sink.build_output(mode, &label_refs);
            start_stack(
                &mut resolved,
                &service_order,
                StartStackOptions {
                    stack_id: hosted.stack_id.clone(),
                    daemon_socket,
                    command_serve_timeout: None,
                    runtime_control: None,
                    serve_session: false,
                    runtime_errors: None,
                    configuration: Some(validated),
                    caddy_dir: state.caddy_dir.clone(),
                    config_path: Some(config_path),
                    environment: spec.environment,
                    output,
                    debug_caddy,
                    shutdown_grace_period: None,
                    idle_timeout: idle_timeout_ms.map(Duration::from_millis),
                    install_signal_handlers: false,
                    external_cancel: Some(hosted.cancel.clone()),
                    external_signal: Some(hosted.signal.clone()),
                    ready_notify,
                    launch,
                },
            )
        }
        LaunchKind::Serve {
            directory,
            domain,
            port,
        } => {
            let resolved_dir = if directory.is_absolute() {
                paths::clean(&directory)
            } else {
                paths::clean(&spec.cwd.join(&directory))
            };
            let config_path = config::path_from_env(&spec.environment).ok();
            let label = format!("serve-{domain}");
            *hosted.name.lock().expect("stack name") = label.clone();
            let output = sink.build_output(mode, &[&label, "serve", "devhost", "caddy"]);
            start_serve(
                &resolved_dir,
                &domain,
                port,
                StartStackOptions {
                    stack_id: hosted.stack_id.clone(),
                    daemon_socket,
                    command_serve_timeout: None,
                    runtime_control: None,
                    serve_session: true,
                    runtime_errors: None,
                    configuration: None,
                    caddy_dir: state.caddy_dir.clone(),
                    config_path,
                    environment: spec.environment,
                    output,
                    debug_caddy: false,
                    shutdown_grace_period: None,
                    idle_timeout: None,
                    install_signal_handlers: false,
                    external_cancel: Some(hosted.cancel.clone()),
                    external_signal: Some(hosted.signal.clone()),
                    ready_notify,
                    launch,
                },
            )
        }
        LaunchKind::ServeCommand {
            command,
            session_name,
            startup_timeout_ms,
        } => {
            let timeout = Duration::from_millis(startup_timeout_ms);
            let (config_path, shared) = match config::read_from_env(&spec.environment) {
                Ok(pair) => pair,
                Err(err) => return failure_outcome(err.into()),
            };
            let mut resolved = match resolve_command_with_config(
                &spec.cwd,
                command,
                "",
                &session_name,
                timeout,
                shared,
            ) {
                Ok(m) => m,
                Err(err) => return failure_outcome(err.into()),
            };
            *hosted.name.lock().expect("stack name") = resolved.name.clone();
            let output = sink.build_output(mode, &[&resolved.name, "command", "devhost", "caddy"]);
            output.log_stdout(&resolved.name, &format!("Session: {}", resolved.name));
            output.log_stdout(
                &resolved.name,
                &format!("Stop: devhost stop --session {}", resolved.name),
            );
            start_command(
                &mut resolved,
                timeout,
                StartStackOptions {
                    stack_id: hosted.stack_id.clone(),
                    daemon_socket,
                    command_serve_timeout: None,
                    runtime_control: None,
                    serve_session: true,
                    runtime_errors: None,
                    configuration: None,
                    caddy_dir: state.caddy_dir.clone(),
                    config_path: Some(config_path),
                    environment: spec.environment,
                    output,
                    debug_caddy: false,
                    shutdown_grace_period: None,
                    idle_timeout: None,
                    install_signal_handlers: false,
                    external_cancel: Some(hosted.cancel.clone()),
                    external_signal: Some(hosted.signal.clone()),
                    ready_notify,
                    launch,
                },
            )
        }
    };

    match result {
        Ok(exit_code) => StackOutcome {
            exit_code,
            failure: None,
            overlap: None,
        },
        Err(StartStackError::Failure(failure)) => {
            if let Some(file) = log_file_for_errors
                && let Ok(mut guard) = file.lock()
            {
                let _ = crate::cliout::write_failure(mode, &mut *guard, &failure);
                let _ = guard.flush();
            }
            failure_outcome(failure)
        }
        Err(StartStackError::Overlap(overlap)) => {
            if let Some(file) = log_file_for_errors
                && let Ok(mut guard) = file.lock()
            {
                let failure = Failure::from(overlap.default_message());
                let _ = crate::cliout::write_failure(mode, &mut *guard, &failure);
                let _ = guard.flush();
            }
            StackOutcome {
                exit_code: 1,
                failure: None,
                overlap: Some(overlap.into()),
            }
        }
    }
}

fn failure_outcome(failure: Failure) -> StackOutcome {
    StackOutcome {
        exit_code: 1,
        failure: Some(failure.into()),
        overlap: None,
    }
}

fn open_log_file(path: &Path) -> io::Result<File> {
    if let Some(parent) = path.parent() {
        let _ = fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(parent);
    }
    OpenOptions::new()
        .create(true)
        .append(true)
        .mode(0o600)
        .open(path)
}
