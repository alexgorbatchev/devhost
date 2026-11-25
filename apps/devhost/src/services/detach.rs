use std::{
    collections::BTreeMap,
    fs::{self, File, OpenOptions},
    io::{self, Read, Seek, SeekFrom, Write},
    os::unix::fs::OpenOptionsExt,
    os::unix::io::AsRawFd,
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicI32, Ordering},
    },
    thread,
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};

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

pub(crate) struct DetachSignalGuard {
    previous: Vec<(libc::c_int, libc::sigaction)>,
}

impl DetachSignalGuard {
    pub(crate) fn install() -> Self {
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
    static FAILURE_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let seq = FAILURE_SEQ.fetch_add(1, Ordering::Relaxed);
    let temp = parent.join(format!(".failure-{pid}-{seq}.tmp"));
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

pub(crate) struct SignalSource<'a> {
    pub(crate) external: Option<&'a Arc<AtomicI32>>,
    pub(crate) use_process: bool,
}

impl SignalSource<'_> {
    pub(crate) fn take(&self) -> Option<i32> {
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

pub(crate) fn acquire_detached_lock(
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

pub(crate) fn await_earlier_start(
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

pub(crate) fn find_detached_stack(
    caddy_dir: &Path,
    canonical: &str,
) -> Result<Option<LiveStack>, String> {
    let stacks = read_live_stacks(caddy_dir)?;
    Ok(stacks
        .into_iter()
        .find(|s| launch_identity(Path::new(&s.manifest_path), &s.name) == canonical))
}

pub(crate) fn launch_identity(path: &Path, name: &str) -> String {
    if path.as_os_str().is_empty() {
        format!("serve:{name}")
    } else {
        manifest_identity(path).to_string_lossy().into_owned()
    }
}

pub(crate) fn report_detached_stack(
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

pub(crate) fn write_detached_log_tail(output: &ServiceOutput, path: &Path, offset: u64) {
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

pub(crate) fn detached_failure(cause: Failure, log_path: &str, hint: &str) -> Failure {
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

pub(crate) fn still_stopping(cause: Failure, pid: i32) -> Failure {
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

pub(crate) fn detached_setup_failure(step: &str, err: &str, hint: &str) -> Failure {
    Failure {
        message: format!("{step}: {err}"),
        summary: Some(step.to_owned()),
        hint: Some(hint.to_owned()),
    }
}

pub(crate) fn describe_signal(sig: i32) -> String {
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
