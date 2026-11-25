use std::{
    fs::{self, DirBuilder, File, OpenOptions, TryLockError},
    io::{self, Write},
    os::unix::{
        fs::{DirBuilderExt, MetadataExt, OpenOptionsExt, PermissionsExt},
        io::AsRawFd,
        net::UnixStream,
    },
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    thread,
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{paths::clean, procid};

pub mod client;
pub mod protocol;
pub mod server;

pub const PROTOCOL_VERSION: u32 = 1;
const MAX_UNIX_SOCKET_PATH_BYTES: usize = 90;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DaemonRecord {
    pub protocol_version: u32,
    pub pid: i32,
    #[serde(default)]
    pub start_identity: String,
    pub socket_path: String,
    pub version: String,
    #[serde(default)]
    pub exe_path: String,
    #[serde(default)]
    pub exe_identity: String,
    #[serde(default)]
    pub context_fingerprint: String,
}

pub fn daemon_lock_path(state_dir: &Path) -> PathBuf {
    state_dir.join("daemon.lock")
}

pub fn daemon_record_path(state_dir: &Path) -> PathBuf {
    state_dir.join("daemon.json")
}

pub fn daemon_log_path(state_dir: &Path) -> PathBuf {
    state_dir.join("daemon.log")
}

pub fn current_euid() -> u32 {
    // SAFETY: geteuid takes no arguments and cannot fail.
    unsafe { libc::geteuid() }
}

pub fn daemon_socket_path(state_dir: &Path, pid: i32) -> PathBuf {
    let direct = state_dir.join("run").join(format!("daemon-{pid}.sock"));
    if direct.as_os_str().as_encoded_bytes().len() <= MAX_UNIX_SOCKET_PATH_BYTES {
        return direct;
    }
    let key_dir = fs::canonicalize(state_dir).unwrap_or_else(|_| clean(state_dir));
    let digest = Sha256::digest(key_dir.as_os_str().as_encoded_bytes());
    let mut prefix = String::with_capacity(12);
    for byte in &digest[..6] {
        use std::fmt::Write as _;
        let _ = write!(prefix, "{byte:02x}");
    }
    let uid = current_euid();
    std::env::temp_dir()
        .join(format!("dh-{uid}-{prefix}"))
        .join(format!("d-{pid}.sock"))
}

/// Ensure the parent directory of `socket_path` exists, is not a symlink, is
/// owned by the current effective UID, and has mode `0700` before `bind()`.
pub fn ensure_private_socket_dir(socket_path: &Path) -> Result<(), String> {
    let Some(dir) = socket_path.parent() else {
        return Err(format!(
            "daemon socket path has no parent directory: {}",
            socket_path.display()
        ));
    };
    if let Err(error) = DirBuilder::new().recursive(true).mode(0o700).create(dir) {
        return Err(format!(
            "create daemon socket directory {}: {error}",
            dir.display()
        ));
    }
    let meta = match fs::symlink_metadata(dir) {
        Ok(meta) => meta,
        Err(error) => {
            return Err(format!(
                "inspect daemon socket directory {}: {error}",
                dir.display()
            ));
        }
    };
    if meta.file_type().is_symlink() || !meta.is_dir() {
        return Err(format!(
            "daemon socket directory {} is not a regular directory",
            dir.display()
        ));
    }
    let expected_uid = current_euid();
    if meta.uid() != expected_uid {
        return Err(format!(
            "daemon socket directory {} is owned by UID {} instead of {}",
            dir.display(),
            meta.uid(),
            expected_uid
        ));
    }
    if meta.mode() & 0o077 != 0
        && let Err(error) = fs::set_permissions(dir, fs::Permissions::from_mode(0o700))
    {
        return Err(format!(
            "restrict daemon socket directory {} permissions: {error}",
            dir.display()
        ));
    }
    Ok(())
}

/// Verify that the connecting peer on a Unix domain socket runs as the same
/// effective user ID as the daemon process.
pub fn verify_peer_uid(stream: &UnixStream) -> Result<(), String> {
    let expected = current_euid();
    #[cfg(target_os = "linux")]
    {
        let mut cred = libc::ucred {
            pid: 0,
            uid: u32::MAX,
            gid: u32::MAX,
        };
        let mut len = std::mem::size_of::<libc::ucred>() as libc::socklen_t;
        // SAFETY: getsockopt with SO_PEERCRED populates `cred` for the live socket fd.
        let rc = unsafe {
            libc::getsockopt(
                stream.as_raw_fd(),
                libc::SOL_SOCKET,
                libc::SO_PEERCRED,
                (&mut cred as *mut libc::ucred).cast(),
                &mut len,
            )
        };
        if rc != 0 {
            return Err(format!(
                "read socket peer credentials: {}",
                io::Error::last_os_error()
            ));
        }
        if cred.uid != expected {
            return Err(format!(
                "rejected daemon connection from UID {} (expected {expected})",
                cred.uid
            ));
        }
        Ok(())
    }
    #[cfg(target_os = "macos")]
    {
        let mut euid: libc::uid_t = 0;
        let mut egid: libc::gid_t = 0;
        // SAFETY: getpeereid writes peer effective UID/GID for the live Unix socket fd.
        let rc = unsafe { libc::getpeereid(stream.as_raw_fd(), &mut euid, &mut egid) };
        if rc != 0 {
            return Err(format!(
                "read socket peer credentials: {}",
                io::Error::last_os_error()
            ));
        }
        if euid != expected {
            return Err(format!(
                "rejected daemon connection from UID {euid} (expected {expected})"
            ));
        }
        Ok(())
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    {
        let _ = (stream, expected);
        Ok(())
    }
}

/// Fingerprint the calling process's execution context (UID, Linux mount/network/user
/// namespaces, seccomp, and NoNewPrivs) so sandboxed and unsandboxed environments do
/// not share a single supervisor daemon across trust boundaries.
pub fn execution_context_fingerprint() -> String {
    let uid = current_euid();
    #[cfg(target_os = "linux")]
    {
        let ns = |name: &str| {
            fs::read_link(format!("/proc/self/ns/{name}"))
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or_default()
        };
        let mut seccomp = String::new();
        let mut no_new_privs = String::new();
        if let Ok(status) = fs::read_to_string("/proc/self/status") {
            for line in status.lines() {
                if let Some(val) = line.strip_prefix("Seccomp:") {
                    seccomp = val.trim().to_owned();
                } else if let Some(val) = line.strip_prefix("NoNewPrivs:") {
                    no_new_privs = val.trim().to_owned();
                }
            }
        }
        format!(
            "uid={uid}|mnt={}|net={}|user={}|seccomp={seccomp}|nnp={no_new_privs}",
            ns("mnt"),
            ns("net"),
            ns("user"),
        )
    }
    #[cfg(not(target_os = "linux"))]
    {
        format!("uid={uid}")
    }
}

pub fn exe_identity(path: &Path) -> String {
    let canonical = fs::canonicalize(path).unwrap_or_else(|_| clean(path));
    match fs::metadata(&canonical) {
        Ok(meta) => format!(
            "{}|{}|{}|{}|{}.{}",
            canonical.display(),
            meta.dev(),
            meta.ino(),
            meta.len(),
            meta.mtime(),
            meta.mtime_nsec()
        ),
        Err(_) => canonical.display().to_string(),
    }
}

pub fn ensure_state_dir(state_dir: &Path) -> Result<(), String> {
    match DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(state_dir)
    {
        Ok(()) => Ok(()),
        Err(error) => Err(format!("create devhost state directory: {error}")),
    }
}

pub fn read_daemon_record(state_dir: &Path) -> Option<DaemonRecord> {
    let bytes = fs::read(daemon_record_path(state_dir)).ok()?;
    serde_json::from_slice(&bytes).ok()
}

pub fn read_live_daemon(state_dir: &Path) -> Option<DaemonRecord> {
    let record = read_daemon_record(state_dir)?;
    if record.pid > 0 && procid::is_record_owner_alive(record.pid, &record.start_identity) {
        Some(record)
    } else {
        None
    }
}

pub fn is_live_daemon_pid(state_dir: &Path, pid: i32) -> Option<DaemonRecord> {
    let record = read_live_daemon(state_dir)?;
    (record.pid == pid).then_some(record)
}

pub fn write_daemon_record(state_dir: &Path, record: &DaemonRecord) -> Result<(), String> {
    ensure_state_dir(state_dir)?;
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let data = match serde_json::to_vec_pretty(record) {
        Ok(data) => data,
        Err(error) => return Err(format!("serialize daemon record: {error}")),
    };
    let temp = state_dir.join(format!(
        ".daemon-{}-{}.tmp",
        record.pid,
        SEQ.fetch_add(1, Ordering::Relaxed)
    ));
    let target = daemon_record_path(state_dir);
    let write_result = (|| -> io::Result<()> {
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .mode(0o600)
            .open(&temp)?;
        file.write_all(&data)?;
        file.sync_all()?;
        drop(file);
        fs::rename(&temp, &target)
    })();
    if let Err(error) = write_result {
        let _ = fs::remove_file(&temp);
        return Err(format!("write daemon record: {error}"));
    }
    Ok(())
}

pub fn remove_daemon_record_if_pid(state_dir: &Path, pid: i32) {
    if read_daemon_record(state_dir).is_some_and(|record| record.pid == pid) {
        let _ = fs::remove_file(daemon_record_path(state_dir));
    }
}

pub struct DaemonLock(File);

impl Drop for DaemonLock {
    fn drop(&mut self) {
        let _ = self.0.unlock();
    }
}

pub fn acquire_daemon_lock(state_dir: &Path, timeout: Duration) -> Result<DaemonLock, String> {
    ensure_state_dir(state_dir)?;
    let path = daemon_lock_path(state_dir);
    let file = match OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .mode(0o600)
        .open(&path)
    {
        Ok(file) => file,
        Err(error) => return Err(format!("open daemon lock: {error}")),
    };
    let deadline = Instant::now() + timeout;
    loop {
        match file.try_lock() {
            Ok(()) => return Ok(DaemonLock(file)),
            Err(TryLockError::WouldBlock) => {
                if Instant::now() >= deadline {
                    return Err("timed out waiting for devhost daemon lock".to_owned());
                }
                thread::sleep(Duration::from_millis(15));
            }
            Err(TryLockError::Error(error)) if error.kind() == io::ErrorKind::Interrupted => {}
            Err(TryLockError::Error(error)) => {
                return Err(format!("lock devhost daemon: {error}"));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::symlink;

    #[test]
    fn socket_path_falls_back_to_short_private_temp_dir_for_long_state_dirs() {
        let short = PathBuf::from("/tmp/dh-short");
        assert_eq!(
            daemon_socket_path(&short, 42),
            PathBuf::from("/tmp/dh-short/run/daemon-42.sock")
        );
        let long = PathBuf::from(format!("/tmp/{}", "a".repeat(120)));
        let sock = daemon_socket_path(&long, 42);
        assert!(sock.as_os_str().as_encoded_bytes().len() <= MAX_UNIX_SOCKET_PATH_BYTES);
        assert!(sock.to_string_lossy().ends_with("/d-42.sock"));
    }

    #[test]
    fn private_socket_dir_enforces_0700_and_rejects_symlinks() {
        let dir = tempfile::tempdir().unwrap();
        let sock = dir.path().join("run/daemon-1.sock");
        ensure_private_socket_dir(&sock).unwrap();
        let meta = fs::symlink_metadata(dir.path().join("run")).unwrap();
        assert_eq!(meta.mode() & 0o777, 0o700);

        let real_target = dir.path().join("real");
        fs::create_dir(&real_target).unwrap();
        let link = dir.path().join("link-run");
        symlink(&real_target, &link).unwrap();
        let err = ensure_private_socket_dir(&link.join("daemon-1.sock")).unwrap_err();
        assert!(err.contains("not a regular directory"), "{err}");
    }

    #[test]
    fn peer_uid_and_context_fingerprint_succeed_for_current_process() {
        let (a, _b) = UnixStream::pair().unwrap();
        verify_peer_uid(&a).unwrap();
        let fp = execution_context_fingerprint();
        assert!(fp.starts_with(&format!("uid={}", current_euid())), "{fp}");
    }

    #[test]
    fn daemon_record_round_trips_and_checks_owner_pid() {
        let dir = tempfile::tempdir().unwrap();
        let pid = std::process::id() as i32;
        let record = DaemonRecord {
            protocol_version: PROTOCOL_VERSION,
            pid,
            start_identity: procid::start_identity(pid).unwrap_or_default(),
            socket_path: daemon_socket_path(dir.path(), pid)
                .to_string_lossy()
                .into_owned(),
            version: "test".to_owned(),
            exe_path: "/bin/devhost".to_owned(),
            exe_identity: "id".to_owned(),
            context_fingerprint: execution_context_fingerprint(),
        };
        write_daemon_record(dir.path(), &record).unwrap();
        assert_eq!(read_live_daemon(dir.path()), Some(record.clone()));
        assert_eq!(is_live_daemon_pid(dir.path(), pid), Some(record));
        assert!(is_live_daemon_pid(dir.path(), pid + 1).is_none());
        remove_daemon_record_if_pid(dir.path(), pid + 1);
        assert!(read_daemon_record(dir.path()).is_some());
        remove_daemon_record_if_pid(dir.path(), pid);
        assert!(read_daemon_record(dir.path()).is_none());
    }
}
