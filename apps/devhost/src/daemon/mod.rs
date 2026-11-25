use std::{
    fs::{self, DirBuilder, File, OpenOptions, TryLockError},
    io::{self, Write},
    os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt},
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

pub fn daemon_socket_path(state_dir: &Path, pid: i32) -> PathBuf {
    let direct = state_dir.join(format!("daemon-{pid}.sock"));
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
    std::env::temp_dir().join(format!("dh-{prefix}-{pid}.sock"))
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

    #[test]
    fn socket_path_falls_back_to_short_temp_path_for_long_state_dirs() {
        let short = PathBuf::from("/tmp/dh-short");
        assert_eq!(
            daemon_socket_path(&short, 42),
            PathBuf::from("/tmp/dh-short/daemon-42.sock")
        );
        let long = PathBuf::from(format!("/tmp/{}", "a".repeat(120)));
        let sock = daemon_socket_path(&long, 42);
        assert!(sock.as_os_str().as_encoded_bytes().len() <= MAX_UNIX_SOCKET_PATH_BYTES);
        assert!(sock.to_string_lossy().ends_with("-42.sock"));
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
        };
        write_daemon_record(dir.path(), &record).unwrap();
        assert_eq!(read_live_daemon(dir.path()), Some(record));
        remove_daemon_record_if_pid(dir.path(), pid + 1);
        assert!(read_daemon_record(dir.path()).is_some());
        remove_daemon_record_if_pid(dir.path(), pid);
        assert!(read_daemon_record(dir.path()).is_none());
    }
}
