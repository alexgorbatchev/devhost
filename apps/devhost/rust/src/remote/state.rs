use std::{
    fs::{self, File, OpenOptions, TryLockError},
    io::{self, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    thread,
    time::{Duration, Instant},
};

use super::Backend;
use crate::procid;
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use sha2::{Digest, Sha256};

pub(super) const STARTUP_TIMEOUT: Duration = Duration::from_secs(45);
pub(super) const POLL_INTERVAL: Duration = Duration::from_millis(50);

#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Owner {
    pub pid: i32,
    pub start_identity: String,
}

impl Owner {
    pub fn current() -> io::Result<Self> {
        Self::for_pid(std::process::id() as i32)
    }
    pub fn for_pid(pid: i32) -> io::Result<Self> {
        Ok(Self {
            pid,
            start_identity: procid::start_identity(pid)?,
        })
    }
    pub fn alive(&self) -> bool {
        self.pid > 0
            && !self.start_identity.is_empty()
            && procid::is_record_owner_alive(self.pid, &self.start_identity)
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct LeaseRecord {
    pub owner: Owner,
    pub manifest_path: PathBuf,
    pub hosts: Vec<String>,
    pub backend: Backend,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub(super) struct WorkerRecord {
    pub owner: Owner,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub admin_address: String,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub stopping: bool,
}

pub(super) fn private_file(path: &Path) -> io::Result<File> {
    let mut options = OpenOptions::new();
    options.create(true).truncate(false).read(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path)
}

pub(super) fn with_lock<T>(
    dir: &Path,
    deadline: Instant,
    action: impl FnOnce() -> io::Result<T>,
) -> io::Result<T> {
    let mut builder = fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(dir.join("leases"))?;
    let lock = private_file(&dir.join("state.lock"))?;
    loop {
        match lock.try_lock() {
            Ok(()) => return action(),
            Err(TryLockError::WouldBlock) => pause(deadline)?,
            Err(TryLockError::Error(e)) if e.kind() == io::ErrorKind::Interrupted => {}
            Err(TryLockError::Error(e)) => return Err(e),
        }
    }
}

pub(super) fn pause(deadline: Instant) -> io::Result<()> {
    let remaining = deadline
        .checked_duration_since(Instant::now())
        .ok_or_else(|| io::Error::new(io::ErrorKind::TimedOut, "remote connector timed out"))?;
    thread::sleep(POLL_INTERVAL.min(remaining));
    Ok(())
}

pub(super) fn write_json(path: &Path, value: &impl Serialize) -> io::Result<()> {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let bytes = serde_json::to_vec(value)?;
    let parent = path
        .parent()
        .ok_or_else(|| io::Error::other("remote state path requires a parent"))?;
    let temporary = parent.join(format!(
        ".remote-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    let mut options = OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&temporary)?;
    let result = file.write_all(&bytes).and_then(|()| file.sync_all());
    drop(file);
    let result = result.and_then(|()| fs::rename(&temporary, path));
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

pub(super) fn read_json<T: DeserializeOwned>(path: &Path) -> io::Result<T> {
    serde_json::from_slice(&fs::read(path)?).map_err(io::Error::other)
}

pub(super) fn read_worker(dir: &Path) -> io::Result<WorkerRecord> {
    match read_json(&dir.join("worker.json")) {
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(WorkerRecord::default()),
        result => result,
    }
}

pub(super) fn read_leases(dir: &Path) -> io::Result<Vec<LeaseRecord>> {
    let mut records = Vec::new();
    for entry in fs::read_dir(dir.join("leases"))? {
        let entry = entry?;
        let path = entry.path();
        if entry.file_type()?.is_dir() || path.extension().is_none_or(|ext| ext != "json") {
            continue;
        }
        let record: LeaseRecord = read_json(&path)
            .map_err(|e| io::Error::other(format!("read remote preview lease: {e}")))?;
        if record.owner.alive() {
            records.push(record);
        } else {
            remove_file(&path)?;
        }
    }
    Ok(records)
}

pub(super) fn lease_path(dir: &Path, record: &LeaseRecord) -> PathBuf {
    let mut hash = Sha256::new();
    hash.update(record.manifest_path.as_os_str().as_encoded_bytes());
    hash.update(format!(
        "\n{}\n{}",
        record.owner.pid, record.owner.start_identity
    ));
    dir.join("leases")
        .join(format!("{:x}.json", hash.finalize()))
}

pub(super) fn remove_file(path: &Path) -> io::Result<()> {
    match fs::remove_file(path) {
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        result => result,
    }
}
