use std::{
    collections::BTreeMap,
    env,
    fs::{self, DirBuilder, File, OpenOptions},
    io::{self, Read, Seek, SeekFrom, Write},
    os::unix::fs::{DirBuilderExt, OpenOptionsExt},
    os::unix::io::AsRawFd,
    os::unix::process::{CommandExt, ExitStatusExt},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        Arc, Mutex,
        atomic::{AtomicI32, Ordering},
    },
    thread,
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{
    Failure,
    caddy::stacks::{LiveStack, read_live_stacks},
    cliout::ServiceOutput,
    paths::manifest_identity,
    services::resolve::ResolvedManifest,
};

pub const DETACHED_LOG_ENV: &str = "DEVHOST_INTERNAL_DETACHED_LOG";
pub const STACK_LOG_ENV: &str = "DEVHOST_INTERNAL_STACK_LOG";
pub const DETACHED_POLL_INTERVAL: Duration = Duration::from_millis(50);
const LOG_TAIL_MAX_BYTES: u64 = 64 * 1024;
const LOG_TAIL_MAX_LINES: usize = 30;
const STARTUP_BASE_TIMEOUT: Duration = Duration::from_secs(120);
const CLEANUP_BASE_TIMEOUT: Duration = Duration::from_secs(60);
const SERVICE_SHUTDOWN_GRACE: Duration = Duration::from_secs(10);
const AUTO_PORT_RETRIES: u32 = 3;

static DETACH_SIGNAL: AtomicI32 = AtomicI32::new(0);

extern "C" fn handle_detach_signal(sig: libc::c_int) {
    let _ = DETACH_SIGNAL.compare_exchange(0, sig, Ordering::SeqCst, Ordering::SeqCst);
}

struct DetachSignalGuard {
    previous: Vec<(libc::c_int, libc::sigaction)>,
}

impl DetachSignalGuard {
    fn install() -> Self {
        DETACH_SIGNAL.store(0, Ordering::SeqCst);
        let mut previous = Vec::new();
        for sig in [libc::SIGINT, libc::SIGHUP, libc::SIGTERM] {
            unsafe {
                let mut action: libc::sigaction = std::mem::zeroed();
                action.sa_sigaction = handle_detach_signal as *const () as usize;
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

impl Drop for DetachSignalGuard {
    fn drop(&mut self) {
        for (sig, old) in &self.previous {
            unsafe {
                let _ = libc::sigaction(*sig, old, std::ptr::null_mut());
            }
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct LaunchMetadata {
    pub log_path: String,
    pub detached: bool,
}

pub fn take_launch_metadata(environment: &mut BTreeMap<String, String>) -> LaunchMetadata {
    let stack_log = environment.remove(STACK_LOG_ENV).unwrap_or_default();
    let detached_log = environment.remove(DETACHED_LOG_ENV).unwrap_or_default();
    if !detached_log.is_empty() {
        LaunchMetadata {
            log_path: detached_log,
            detached: true,
        }
    } else {
        LaunchMetadata {
            log_path: stack_log,
            detached: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct DetachedFailureRecord {
    service: String,
}

pub fn detached_failure_path(log_path: &Path) -> PathBuf {
    let raw = log_path.to_string_lossy();
    let stem = raw.strip_suffix(".log").unwrap_or(&raw);
    PathBuf::from(format!("{stem}.failure.json"))
}

pub fn record_detached_failure(log_path: &str, service: &str) -> Result<(), String> {
    let path = detached_failure_path(Path::new(log_path));
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let data = serde_json::to_vec(&DetachedFailureRecord {
        service: service.to_owned(),
    })
    .expect("serialize detached failure record");
    let pid = std::process::id();
    let temp = parent.join(format!(".failure-{pid}.tmp"));
    let write_res = (|| -> io::Result<()> {
        let mut opts = OpenOptions::new();
        opts.create(true).truncate(true).write(true).mode(0o600);
        let mut file = opts.open(&temp)?;
        file.write_all(&data)?;
        file.sync_all()?;
        drop(file);
        fs::rename(&temp, &path)
    })();
    if let Err(err) = write_res {
        let _ = fs::remove_file(&temp);
        return Err(format!("record the detached startup failure: {err}"));
    }
    Ok(())
}

pub fn read_detached_failure(path: &Path) -> Option<String> {
    let data = fs::read(path).ok()?;
    let record: DetachedFailureRecord = serde_json::from_slice(&data).ok()?;
    (!record.service.is_empty()).then_some(record.service)
}

pub fn remove_detached_failure(path: &Path) -> Result<(), String> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(err.to_string()),
    }
}

pub fn check_detach_platform(os: &str) -> Result<(), Failure> {
    if matches!(os, "linux" | "macos" | "darwin") {
        return Ok(());
    }
    Err(Failure {
        message: format!("devhost start --detach runs on Linux and macOS, not {os}"),
        summary: None,
        hint: Some("Run devhost start without --detach and keep its terminal open.".to_owned()),
    })
}

pub fn detached_startup_timeout(manifest: &ResolvedManifest) -> Duration {
    let mut total = STARTUP_BASE_TIMEOUT;
    for service in manifest.services.values() {
        let attempts = if service.port_source == "auto" {
            1 + AUTO_PORT_RETRIES
        } else {
            1
        };
        let per_attempt = Duration::from_millis(service.health.timeout_ms) + SERVICE_SHUTDOWN_GRACE;
        total += per_attempt * attempts;
    }
    total
}

pub fn detached_cleanup_timeout(manifest: &ResolvedManifest) -> Duration {
    let count = manifest.services.len() as u32;
    CLEANUP_BASE_TIMEOUT + SERVICE_SHUTDOWN_GRACE * 2 * count
}

pub struct DetachedStartOptions {
    pub manifest: ResolvedManifest,
    pub arguments: Vec<String>,
    pub directory: PathBuf,
    pub state_dir: PathBuf,
    pub environment: BTreeMap<String, String>,
    pub output: ServiceOutput,
    pub executable: Option<PathBuf>,
    pub startup_timeout: Option<Duration>,
    pub cleanup_timeout: Option<Duration>,
    pub target_os: Option<String>,
    pub external_signal: Option<Arc<AtomicI32>>,
    pub install_signal_handlers: bool,
}

struct SignalSource<'a> {
    external: Option<&'a Arc<AtomicI32>>,
    use_process: bool,
}

impl SignalSource<'_> {
    fn take(&self) -> Option<i32> {
        if let Some(ext) = self.external {
            let sig = ext.swap(0, Ordering::SeqCst);
            if sig != 0 {
                return Some(sig);
            }
        }
        if self.use_process {
            let sig = DETACH_SIGNAL.swap(0, Ordering::SeqCst);
            if sig != 0 {
                return Some(sig);
            }
        }
        None
    }
}

struct DetachedChildState {
    child: Child,
    exit_code: Option<i32>,
}

struct DetachedProcess {
    pid: i32,
    state: Mutex<DetachedChildState>,
}

impl DetachedProcess {
    fn spawn(mut cmd: Command) -> io::Result<Self> {
        // SAFETY: setsid() detaches the supervisor child into its own session before exec.
        unsafe {
            cmd.pre_exec(|| {
                if libc::setsid() == -1 {
                    return Err(io::Error::last_os_error());
                }
                Ok(())
            });
        }
        let child: Child = cmd.spawn()?;
        let pid = child.id() as i32;
        Ok(Self {
            pid,
            state: Mutex::new(DetachedChildState {
                child,
                exit_code: None,
            }),
        })
    }

    fn poll_exit_locked(state: &mut DetachedChildState) -> Option<i32> {
        if let Some(code) = state.exit_code {
            return Some(code);
        }
        match state.child.try_wait() {
            Ok(Some(status)) => {
                let code = status
                    .signal()
                    .map(|sig| 128 + sig)
                    .or_else(|| status.code())
                    .unwrap_or(1);
                state.exit_code = Some(code);
                Some(code)
            }
            Ok(None) | Err(_) => None,
        }
    }

    fn read_exit_code(&self) -> Option<i32> {
        let mut state = self.state.lock().expect("detached exit lock");
        Self::poll_exit_locked(&mut state)
    }

    fn signal_term(&self) -> io::Result<()> {
        let mut state = self.state.lock().expect("detached signal lock");
        if Self::poll_exit_locked(&mut state).is_some() {
            return Ok(());
        }
        // SAFETY: self.pid is an unreaped child owned by this process while `state` is held.
        let rc = unsafe { libc::kill(self.pid, libc::SIGTERM) };
        if rc != 0 {
            let err = io::Error::last_os_error();
            if err.raw_os_error() != Some(libc::ESRCH) {
                return Err(err);
            }
        }
        Ok(())
    }

    fn wait_stopped(&self, signals: &SignalSource<'_>, timeout: Duration) -> bool {
        let deadline = Instant::now() + timeout;
        loop {
            if self.read_exit_code().is_some() {
                return true;
            }
            if signals.take().is_some() || Instant::now() >= deadline {
                return self.read_exit_code().is_some();
            }
            let remaining = deadline.saturating_duration_since(Instant::now());
            thread::sleep(remaining.min(Duration::from_millis(10)));
        }
    }
}

#[derive(Debug)]
enum AttemptWaitFailure {
    ServiceNotReady(Failure),
    Other(Failure),
}

impl AttemptWaitFailure {
    fn into_failure(self) -> Failure {
        match self {
            Self::ServiceNotReady(f) | Self::Other(f) => f,
        }
    }

    fn is_service_not_ready(&self) -> bool {
        matches!(self, Self::ServiceNotReady(_))
    }
}

pub fn start_detached_stack(options: DetachedStartOptions) -> Result<(), Failure> {
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
    let canonical = manifest_identity(&options.manifest.manifest_path)
        .to_string_lossy()
        .into_owned();
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
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(&log_dir, fs::Permissions::from_mode(0o700));
        }
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

    let lock_file = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .mode(0o600)
        .open(&lock_path)
        .map_err(|err| {
            detached_setup_failure(
                "the start lock could not be opened",
                &err.to_string(),
                &state_hint,
            )
        })?;

    let limit = options
        .startup_timeout
        .unwrap_or_else(|| detached_startup_timeout(&options.manifest));
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
                hint: Some("Stop this stack with devhost stop, then start it again with --local or the configured relay mode.".to_owned()),
            });
        }
        return report_detached_stack(&options.output, &existing, true)
            .map_err(|err| Failure::from(err.to_string()));
    }

    let failure_path = detached_failure_path(&log_path);
    if let Err(err) = remove_detached_failure(&failure_path) {
        return Err(detached_setup_failure(
            "the failure record of the previous start could not be removed",
            &err,
            &state_hint,
        ));
    }

    let log_file = OpenOptions::new()
        .create(true)
        .append(true)
        .mode(0o600)
        .open(&log_path)
        .map_err(|err| {
            detached_setup_failure(
                "the stack log could not be opened",
                &err.to_string(),
                &state_hint,
            )
        })?;
    let log_offset = log_file
        .metadata()
        .map_err(|err| {
            detached_setup_failure(
                "the stack log could not be read",
                &err.to_string(),
                &state_hint,
            )
        })?
        .len();
    let stderr_log = log_file.try_clone().map_err(|err| {
        detached_setup_failure(
            "the stack log could not be opened",
            &err.to_string(),
            &state_hint,
        )
    })?;

    let executable = match options.executable {
        Some(path) => path,
        None => env::current_exe().map_err(|err| {
            detached_setup_failure(
                "devhost could not find its own executable",
                &err.to_string(),
                "Run devhost start without --detach and keep its terminal open.",
            )
        })?,
    };

    let mut child_env = options.environment;
    child_env.insert(DETACHED_LOG_ENV.to_owned(), log_path_str.clone());
    child_env.remove(STACK_LOG_ENV);

    let mut cmd = Command::new(executable);
    cmd.args(&options.arguments)
        .current_dir(&options.directory)
        .env_clear()
        .stdin(Stdio::null())
        .stdout(Stdio::from(log_file))
        .stderr(Stdio::from(stderr_log));
    for (k, v) in child_env {
        cmd.env(k, v);
    }

    let process = DetachedProcess::spawn(cmd).map_err(|err| {
        detached_failure(
            format!("the stack supervisor could not be launched: {err}").into(),
            &log_path_str,
            "",
        )
    })?;

    match wait_ready(
        &process,
        ReadyWait {
            caddy_dir: &caddy_dir,
            canonical: &canonical,
            failure_path: &failure_path,
            state_dir: &options.state_dir,
            deadline,
            limit,
        },
        &signal_src,
    ) {
        Ok(stack) => match report_detached_stack(&options.output, &stack, false) {
            Ok(()) => Ok(()),
            Err(err) => Err(finish_detached_failure(
                AttemptWaitFailure::Other(
                    format!("reporting the started stack failed: {err}").into(),
                ),
                &process,
                &signal_src,
                options
                    .cleanup_timeout
                    .unwrap_or_else(|| detached_cleanup_timeout(&options.manifest)),
                &log_path,
                log_offset,
                &options.output,
            )),
        },
        Err(cause) => Err(finish_detached_failure(
            cause,
            &process,
            &signal_src,
            options
                .cleanup_timeout
                .unwrap_or_else(|| detached_cleanup_timeout(&options.manifest)),
            &log_path,
            log_offset,
            &options.output,
        )),
    }
}

fn acquire_detached_lock(
    file: &File,
    deadline: Instant,
    limit: Duration,
    signals: &SignalSource<'_>,
) -> Result<(), Failure> {
    let fd = file.as_raw_fd();
    loop {
        if Instant::now() >= deadline {
            return Err(format!(
                "another start of this manifest did not finish within {}",
                format_go_duration(limit)
            )
            .into());
        }
        // SAFETY: flock operates on an open locked descriptor owned by caller for the wait.
        let rc = unsafe { libc::flock(fd, libc::LOCK_EX | libc::LOCK_NB) };
        if rc == 0 {
            return Ok(());
        }
        let err = io::Error::last_os_error();
        if err.raw_os_error() != Some(libc::EWOULDBLOCK) && err.raw_os_error() != Some(libc::EINTR)
        {
            return Err(format!("locking the detached start failed: {err}").into());
        }
        if let Some(sig) = signals.take() {
            return Err(format!(
                "received {} while another start of this manifest was running",
                describe_signal(sig)
            )
            .into());
        }
        thread::sleep(
            DETACHED_POLL_INTERVAL.min(deadline.saturating_duration_since(Instant::now())),
        );
    }
}

fn await_earlier_start(
    caddy_dir: &Path,
    canonical: &str,
    log_path: &str,
    state_dir: &Path,
    deadline: Instant,
    limit: Duration,
    signals: &SignalSource<'_>,
) -> Result<Option<LiveStack>, Failure> {
    loop {
        let found = find_detached_stack(caddy_dir, canonical).map_err(|err| {
            detached_setup_failure(
                "the running stacks could not be read",
                &err,
                &format!(
                    "Check that you can read and write devhost's state directory, {}.",
                    state_dir.display()
                ),
            )
        })?;
        match found {
            None => return Ok(None),
            Some(stack) if stack.ready || (!stack.remote && stack.log_path != log_path) => {
                return Ok(Some(stack));
            }
            Some(_) => {}
        }
        if let Some(sig) = signals.take() {
            return Err(detached_failure(
                format!(
                    "received {} while another start of this manifest was running",
                    describe_signal(sig)
                )
                .into(),
                log_path,
                "",
            ));
        }
        if Instant::now() >= deadline {
            return Err(detached_failure(
                format!(
                    "another start of this manifest did not finish within {}",
                    format_go_duration(limit)
                )
                .into(),
                log_path,
                "",
            ));
        }
        thread::sleep(
            DETACHED_POLL_INTERVAL.min(deadline.saturating_duration_since(Instant::now())),
        );
    }
}

struct ReadyWait<'a> {
    caddy_dir: &'a Path,
    canonical: &'a str,
    failure_path: &'a Path,
    state_dir: &'a Path,
    deadline: Instant,
    limit: Duration,
}

fn wait_ready(
    process: &DetachedProcess,
    wait: ReadyWait<'_>,
    signals: &SignalSource<'_>,
) -> Result<LiveStack, AttemptWaitFailure> {
    let ReadyWait {
        caddy_dir,
        canonical,
        failure_path,
        state_dir,
        deadline,
        limit,
    } = wait;
    let state_hint = format!(
        "Check that you can read and write devhost's state directory, {}.",
        state_dir.display()
    );
    loop {
        if let Some(code) = process.read_exit_code() {
            if let Some(service) = read_detached_failure(failure_path) {
                return Err(AttemptWaitFailure::ServiceNotReady(
                    format!("service {service} did not become ready").into(),
                ));
            }
            return Err(AttemptWaitFailure::Other(
                format!("the stack exited before it was ready (exit code {code})").into(),
            ));
        }
        if let Some(sig) = signals.take() {
            return Err(AttemptWaitFailure::Other(
                format!(
                    "received {} before the stack was ready",
                    describe_signal(sig)
                )
                .into(),
            ));
        }
        if Instant::now() >= deadline {
            return Err(AttemptWaitFailure::Other(
                format!(
                    "the stack was not ready within {}",
                    format_go_duration(limit)
                )
                .into(),
            ));
        }
        if let Some(service) = read_detached_failure(failure_path) {
            return Err(AttemptWaitFailure::ServiceNotReady(
                format!("service {service} did not become ready").into(),
            ));
        }
        match find_detached_stack(caddy_dir, canonical) {
            Ok(Some(stack)) if stack.pid == process.pid && stack.ready => return Ok(stack),
            Ok(_) => {}
            Err(err) => {
                return Err(AttemptWaitFailure::Other(detached_setup_failure(
                    "the running stacks could not be read",
                    &err,
                    &state_hint,
                )));
            }
        }
        thread::sleep(
            DETACHED_POLL_INTERVAL.min(deadline.saturating_duration_since(Instant::now())),
        );
    }
}

fn finish_detached_failure(
    cause: AttemptWaitFailure,
    process: &DetachedProcess,
    signals: &SignalSource<'_>,
    cleanup_timeout: Duration,
    log_path: &Path,
    log_offset: u64,
    output: &ServiceOutput,
) -> Failure {
    let was_not_ready = cause.is_service_not_ready();
    let mut err_failure = cause.into_failure();
    if !was_not_ready && let Err(os_err) = process.signal_term() {
        err_failure.message = format!(
            "{}; signaling the stack failed: {os_err}",
            err_failure.message
        );
        err_failure.summary = None;
    }
    let stopped = process.wait_stopped(signals, cleanup_timeout);
    let failure_path = detached_failure_path(log_path);
    if !was_not_ready && let Some(service) = read_detached_failure(&failure_path) {
        err_failure = format!("service {service} did not become ready").into();
    }
    let _ = remove_detached_failure(&failure_path);
    write_detached_log_tail(output, log_path, log_offset);
    let log_str = log_path.to_string_lossy();
    if !stopped {
        let stopping = still_stopping(err_failure, process.pid);
        return detached_failure(
            stopping,
            &log_str,
            "Run \"devhost stack list\" to see when it has stopped.",
        );
    }
    detached_failure(err_failure, &log_str, "")
}

fn find_detached_stack(caddy_dir: &Path, canonical: &str) -> Result<Option<LiveStack>, String> {
    let stacks = read_live_stacks(caddy_dir)?;
    Ok(stacks
        .into_iter()
        .find(|s| manifest_identity(Path::new(&s.manifest_path)).to_string_lossy() == canonical))
}

fn report_detached_stack(
    output: &ServiceOutput,
    stack: &LiveStack,
    existing: bool,
) -> io::Result<()> {
    let state = if existing {
        "Already running"
    } else {
        "Started"
    };
    output.log_stdout_checked(
        "devhost",
        &format!("{state} {} (PID {}).", stack.name, stack.pid),
    )?;
    if !existing || stack.remote {
        for url in &stack.urls {
            output.log_stdout_checked("devhost", url)?;
        }
    }
    if !stack.log_path.is_empty() {
        output.log_stdout_checked("devhost", &format!("Log: {}", stack.log_path))?;
    }
    Ok(())
}

fn write_detached_log_tail(output: &ServiceOutput, path: &Path, offset: u64) {
    let mut file = match File::open(path) {
        Ok(file) => file,
        Err(err) => {
            output.log_stderr("devhost", &format!("Cannot read startup log: {err}"));
            return;
        }
    };
    let Ok(meta) = file.metadata() else {
        return;
    };
    let start = offset.max(meta.len().saturating_sub(LOG_TAIL_MAX_BYTES));
    if file.seek(SeekFrom::Start(start)).is_err() {
        return;
    }
    let mut data = Vec::new();
    if file
        .take(LOG_TAIL_MAX_BYTES)
        .read_to_end(&mut data)
        .is_err()
    {
        return;
    }
    let text = String::from_utf8_lossy(&data);
    let mut lines: Vec<&str> = text.trim().split('\n').collect();
    if lines.len() > LOG_TAIL_MAX_LINES {
        lines = lines[lines.len() - LOG_TAIL_MAX_LINES..].to_vec();
    }
    output.log_stderr("devhost", "Startup log tail:");
    for line in lines {
        output.write_raw_stderr_line(line);
    }
}

fn detached_failure(cause: Failure, log_path: &str, hint: &str) -> Failure {
    let read_hint = if hint.is_empty() {
        format!("Read the full log in {log_path}.")
    } else {
        format!("Read the full log in {log_path}. {hint}")
    };
    let person_summary = cause
        .summary
        .clone()
        .unwrap_or_else(|| cause.message.clone());
    Failure {
        message: format!("{}; full log: {log_path}", cause.message),
        summary: Some(person_summary),
        hint: Some(read_hint),
    }
}

fn still_stopping(cause: Failure, pid: i32) -> Failure {
    let suffix = format!("; the stack (PID {pid}) is still stopping");
    let person_summary = cause
        .summary
        .clone()
        .unwrap_or_else(|| cause.message.clone());
    Failure {
        message: format!("{}{suffix}", cause.message),
        summary: Some(format!("{person_summary}{suffix}")),
        hint: None,
    }
}

fn detached_setup_failure(step: &str, err: &str, hint: &str) -> Failure {
    Failure {
        message: format!("{step}: {err}"),
        summary: Some(step.to_owned()),
        hint: Some(hint.to_owned()),
    }
}

fn describe_signal(sig: i32) -> String {
    let name = match sig {
        libc::SIGINT => "SIGINT (Ctrl-C)",
        libc::SIGHUP => "SIGHUP",
        libc::SIGTERM => "SIGTERM",
        _ => "signal",
    };
    format!("{name} (signal {sig})")
}

pub fn format_go_duration(duration: Duration) -> String {
    let total_ms = (duration.as_nanos() + 500_000) / 1_000_000;
    if total_ms == 0 {
        return "0s".to_owned();
    }
    if total_ms < 1_000 {
        return format!("{total_ms}ms");
    }
    let minutes = total_ms / 60_000;
    let rem_ms = total_ms % 60_000;
    let secs = rem_ms / 1_000;
    let frac_ms = rem_ms % 1_000;
    let sec_str = if frac_ms == 0 {
        format!("{secs}s")
    } else {
        let trimmed = format!("{frac_ms:03}").trim_end_matches('0').to_owned();
        format!("{secs}.{trimmed}s")
    };
    if minutes == 0 {
        return sec_str;
    }
    let hours = minutes / 60;
    let rem_min = minutes % 60;
    if hours == 0 {
        format!("{rem_min}m{sec_str}")
    } else {
        format!("{hours}h{rem_min}m{sec_str}")
    }
}
