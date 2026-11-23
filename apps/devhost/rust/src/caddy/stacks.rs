use std::{
    collections::BTreeSet,
    env,
    fs::{self, File, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

use serde::{Deserialize, Serialize};

use super::{
    ctx, files, path_ctx,
    routes::{
        FixedPortClaimRecord, HostClaimRecord, RouteRegistration, current_pid, own_start_identity,
        remove_if_exists, utc_timestamp,
    },
};
use crate::{cliout, paths::clean, procid};

static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LiveStack {
    pub remote: bool,
    pub ready: bool,
    pub urls: Vec<String>,
    pub log_path: String,
    pub name: String,
    pub pid: i32,
    pub manifest_path: String,
    pub started_at: String,
    pub control_port: u16,
    pub owner_start_identity: String,
}

impl LiveStack {
    pub fn is_alive(&self) -> bool {
        procid::is_record_owner_alive(self.pid, &self.owner_start_identity)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct StackOwner {
    pub manifest_path: String,
    pub pid: i32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ManifestOverlapError {
    pub manifest_path: String,
    pub owner: StackOwner,
    pub stack_name: String,
}

impl ManifestOverlapError {
    pub fn default_message(&self) -> String {
        self.message(&format!(
            "devhost stop --manifest {}",
            cliout::shell_path(&self.owner.manifest_path)
        ))
    }

    pub fn message(&self, stop_command: &str) -> String {
        format!(
            "devhost is already running with manifest {} (PID {}, stack {}, root {}); stop that stack with {stop_command} before starting this one",
            cliout::display_path(&self.manifest_path),
            self.owner.pid,
            self.stack_name,
            cliout::display_path(&self.owner.manifest_path)
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RegisterStackError {
    Overlap(ManifestOverlapError),
    Other(String),
}

impl From<String> for RegisterStackError {
    fn from(message: String) -> Self {
        Self::Other(message)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StackRecord {
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub remote: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub ready: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub urls: Vec<String>,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub log_path: String,
    #[serde(default, skip_serializing_if = "is_zero_u16")]
    pub control_port: u16,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub manifest_files: Vec<String>,
    pub created_at: String,
    pub manifest_path: String,
    pub owner_pid: i32,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub owner_start_identity: String,
    pub stack_name: String,
}

fn is_zero_u16(value: &u16) -> bool {
    *value == 0
}

#[derive(Debug, Clone)]
pub struct RegisterStackOptions {
    pub remote: bool,
    pub log_path: String,
    pub control_port: u16,
    pub manifest_files: Vec<String>,
    pub manifest_path: String,
    pub stack_name: String,
}

pub fn register_stack(
    caddy_dir: &Path,
    options: &RegisterStackOptions,
) -> Result<(), RegisterStackError> {
    let stacks_dir = caddy_dir.join("stacks");
    let _lock = stack_records_lock(&stacks_dir)?;
    path_ctx(
        fs::create_dir_all(&stacks_dir),
        "create stack records directory",
        &stacks_dir,
    )?;

    let mut all_files = Vec::with_capacity(options.manifest_files.len() + 1);
    all_files.push(options.manifest_path.clone());
    all_files.extend(options.manifest_files.iter().cloned());
    let manifest_files = canonical_manifest_files(&all_files)?;

    let mut record = StackRecord {
        remote: options.remote,
        ready: false,
        urls: Vec::new(),
        log_path: options.log_path.clone(),
        control_port: options.control_port,
        manifest_files,
        created_at: utc_timestamp(),
        manifest_path: options.manifest_path.clone(),
        owner_pid: current_pid(),
        owner_start_identity: own_start_identity(),
        stack_name: options.stack_name.clone(),
    };

    let own_path = stack_record_path(&stacks_dir, record.owner_pid);
    match fs::read(&own_path) {
        Ok(bytes) => {
            let previous = parse_stack_record(&bytes)?;
            if previous.owner_pid == record.owner_pid
                && previous.owner_start_identity == record.owner_start_identity
                && previous.manifest_path == record.manifest_path
            {
                record.ready = previous.ready;
                record.urls = previous.urls;
                record.log_path = previous.log_path;
            }
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(RegisterStackError::Other(format!(
                "read stack record {}: {error}",
                own_path.display()
            )));
        }
    }

    if let Some(overlap) = check_manifest_overlap(&stacks_dir, &record)? {
        return Err(RegisterStackError::Overlap(overlap));
    }

    write_stack_record(&stacks_dir, &record)?;
    Ok(())
}

pub fn unregister_stack(caddy_dir: &Path) -> Result<(), String> {
    let stacks_dir = caddy_dir.join("stacks");
    let _lock = stack_records_lock(&stacks_dir)?;
    remove_if_exists(&stack_record_path(&stacks_dir, current_pid()))
}

pub fn cleanup_stale_stack_records(caddy_dir: &Path) -> Result<(), String> {
    let stacks_dir = caddy_dir.join("stacks");
    let _lock = stack_records_lock(&stacks_dir)?;
    if !stacks_dir.exists() {
        return Ok(());
    }
    let own_pid = current_pid();
    for path in files::json_files(&stacks_dir, "read stack records directory")? {
        let bytes = match fs::read(&path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
            Err(error) => return path_ctx(Err(error), "read stack record", &path),
        };
        let record = path_ctx(parse_stack_record(&bytes), "read stack record", &path)?;
        if record.owner_pid == own_pid
            || procid::is_record_owner_alive(record.owner_pid, &record.owner_start_identity)
        {
            continue;
        }
        remove_if_exists(&path)?;
    }
    Ok(())
}

pub fn read_live_stacks(caddy_dir: &Path) -> Result<Vec<LiveStack>, String> {
    let stacks_dir = caddy_dir.join("stacks");
    if !stacks_dir.exists() {
        return Ok(Vec::new());
    }
    let mut stacks = Vec::new();
    for path in files::json_files(&stacks_dir, "read stack directory")? {
        let bytes = match fs::read(&path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
            Err(error) => return path_ctx(Err(error), "read stack record", &path),
        };
        let record = path_ctx(parse_stack_record(&bytes), "read stack", &path)?;
        if procid::is_record_owner_alive(record.owner_pid, &record.owner_start_identity) {
            stacks.push(LiveStack {
                remote: record.remote,
                ready: record.ready,
                urls: record.urls,
                log_path: record.log_path,
                name: record.stack_name,
                pid: record.owner_pid,
                manifest_path: record.manifest_path,
                started_at: record.created_at,
                control_port: record.control_port,
                owner_start_identity: record.owner_start_identity,
            });
        }
    }
    stacks.sort_by(|a, b| {
        a.name
            .cmp(&b.name)
            .then_with(|| a.manifest_path.cmp(&b.manifest_path))
            .then_with(|| a.pid.cmp(&b.pid))
    });
    Ok(stacks)
}

pub fn set_stack_ready(caddy_dir: &Path, urls: Vec<String>) -> Result<(), String> {
    let stacks_dir = caddy_dir.join("stacks");
    let _lock = stack_records_lock(&stacks_dir)?;
    let path = stack_record_path(&stacks_dir, current_pid());
    let bytes = path_ctx(fs::read(&path), "read stack record", &path)?;
    let mut record = path_ctx(parse_stack_record(&bytes), "read stack record", &path)?;
    record.ready = true;
    record.urls = urls;
    write_stack_record(&stacks_dir, &record)
}

pub fn read_live_stack_owners(caddy_dir: &Path) -> Result<Vec<StackOwner>, String> {
    let mut owners = BTreeSet::new();
    collect_owners_from_dir(
        &caddy_dir.join("stacks"),
        &mut owners,
        parse_stack_record_owner,
    )?;
    collect_owners_from_dir(
        &caddy_dir.join("routes/.host-claims"),
        &mut owners,
        parse_host_claim_owner,
    )?;
    collect_owners_from_dir(
        &caddy_dir.join("port-claims"),
        &mut owners,
        parse_fixed_port_claim_owner,
    )?;
    collect_owners_from_dir(
        &caddy_dir.join("routes/.registrations"),
        &mut owners,
        parse_route_registration_owner,
    )?;
    Ok(owners.into_iter().collect())
}

struct RecordedOwner {
    manifest_path: String,
    pid: i32,
    start_identity: String,
}

fn collect_owners_from_dir(
    dir: &Path,
    owners: &mut BTreeSet<StackOwner>,
    parse: fn(&[u8]) -> Result<RecordedOwner, String>,
) -> Result<(), String> {
    if !dir.exists() {
        return Ok(());
    }
    for path in files::json_files(dir, "read record directory")? {
        let bytes = match fs::read(&path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
            Err(error) => return path_ctx(Err(error), "read record", &path),
        };
        let recorded = path_ctx(parse(&bytes), "read record", &path)?;
        if recorded.manifest_path.is_empty()
            || recorded.pid <= 0
            || !procid::is_record_owner_alive(recorded.pid, &recorded.start_identity)
        {
            continue;
        }
        owners.insert(StackOwner {
            manifest_path: recorded.manifest_path,
            pid: recorded.pid,
        });
    }
    Ok(())
}

fn parse_stack_record_owner(bytes: &[u8]) -> Result<RecordedOwner, String> {
    let record = parse_stack_record(bytes)?;
    Ok(RecordedOwner {
        manifest_path: record.manifest_path,
        pid: record.owner_pid,
        start_identity: record.owner_start_identity,
    })
}

fn parse_host_claim_owner(bytes: &[u8]) -> Result<RecordedOwner, String> {
    let record: HostClaimRecord = ctx(serde_json::from_slice(bytes), "parse host claim")?;
    Ok(RecordedOwner {
        manifest_path: record.manifest_path,
        pid: record.owner_pid,
        start_identity: record.owner_start_identity,
    })
}

fn parse_fixed_port_claim_owner(bytes: &[u8]) -> Result<RecordedOwner, String> {
    let record: FixedPortClaimRecord =
        ctx(serde_json::from_slice(bytes), "parse fixed port claim")?;
    Ok(RecordedOwner {
        manifest_path: record.manifest_path,
        pid: record.owner_pid,
        start_identity: record.owner_start_identity,
    })
}

fn parse_route_registration_owner(bytes: &[u8]) -> Result<RecordedOwner, String> {
    if let Ok(record) = serde_json::from_slice::<RouteRegistration>(bytes) {
        return Ok(RecordedOwner {
            manifest_path: record.manifest_path,
            pid: record.owner_pid,
            start_identity: record.owner_start_identity,
        });
    }
    // Legacy registrations have no manifestPath and are skipped by caller.
    let value: serde_json::Value = ctx(serde_json::from_slice(bytes), "parse route registration")?;
    let has_legacy = value.get("createdAt").is_some()
        && value.get("host").is_some()
        && value.get("ownerPid").is_some()
        && value.get("port").is_some();
    if has_legacy {
        return Ok(RecordedOwner {
            manifest_path: String::new(),
            pid: value
                .get("ownerPid")
                .and_then(serde_json::Value::as_i64)
                .unwrap_or(0) as i32,
            start_identity: String::new(),
        });
    }
    Err("Registration file is malformed.".to_owned())
}

fn check_manifest_overlap(
    stacks_dir: &Path,
    candidate: &StackRecord,
) -> Result<Option<ManifestOverlapError>, String> {
    if !stacks_dir.exists() {
        return Ok(None);
    }
    for path in files::json_files(stacks_dir, "read stack records")? {
        let bytes = match fs::read(&path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
            Err(error) => return path_ctx(Err(error), "read stack record", &path),
        };
        let owner = path_ctx(parse_stack_record(&bytes), "read stack record", &path)?;
        if owner.owner_pid == candidate.owner_pid
            || !procid::is_record_owner_alive(owner.owner_pid, &owner.owner_start_identity)
        {
            continue;
        }
        let mut owner_inputs = Vec::with_capacity(owner.manifest_files.len() + 1);
        owner_inputs.push(owner.manifest_path.clone());
        owner_inputs.extend(owner.manifest_files.iter().cloned());
        let owner_files = canonical_manifest_files(&owner_inputs)?;
        for file in &candidate.manifest_files {
            if owner_files.contains(file) {
                return Ok(Some(ManifestOverlapError {
                    manifest_path: file.clone(),
                    stack_name: owner.stack_name,
                    owner: StackOwner {
                        manifest_path: owner.manifest_path,
                        pid: owner.owner_pid,
                    },
                }));
            }
        }
    }
    Ok(None)
}

fn canonical_manifest_files(files: &[String]) -> Result<Vec<String>, String> {
    let mut set = BTreeSet::new();
    for file in files {
        if file.is_empty() {
            continue;
        }
        let raw = Path::new(file);
        let abs = if raw.is_absolute() {
            clean(raw)
        } else {
            let cwd = ctx(env::current_dir(), "resolve current directory")?;
            clean(&cwd.join(raw))
        };
        let resolved = match fs::canonicalize(&abs) {
            Ok(path) => path,
            Err(error) if error.kind() == io::ErrorKind::NotFound => abs,
            Err(error) => return path_ctx(Err(error), "resolve manifest path", &abs),
        };
        set.insert(resolved.to_string_lossy().into_owned());
    }
    Ok(set.into_iter().collect())
}

fn parse_stack_record(bytes: &[u8]) -> Result<StackRecord, String> {
    let record: StackRecord =
        serde_json::from_slice(bytes).map_err(|_| "Stack record is malformed.".to_owned())?;
    Ok(record)
}

fn write_stack_record(stacks_dir: &Path, record: &StackRecord) -> Result<(), String> {
    let text = serde_json::to_string_pretty(record).expect("serialize stack record");
    let seq = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    let temp_path = stacks_dir.join(format!("stack-{}-{seq}.tmp", record.owner_pid));
    let target = stack_record_path(stacks_dir, record.owner_pid);
    let mut file = path_ctx(
        OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temp_path),
        "create stack record",
        &temp_path,
    )?;
    if let Err(error) = file
        .write_all(text.as_bytes())
        .and_then(|()| file.sync_all())
    {
        let _ = fs::remove_file(&temp_path);
        return path_ctx(Err(error), "write stack record", &temp_path);
    }
    drop(file);
    if let Err(error) = fs::rename(&temp_path, &target) {
        let _ = fs::remove_file(&temp_path);
        return path_ctx(Err(error), "write stack record", &target);
    }
    Ok(())
}

fn stack_record_path(stacks_dir: &Path, pid: i32) -> PathBuf {
    stacks_dir.join(format!("{pid}.json"))
}

fn stack_records_lock(stacks_dir: &Path) -> Result<File, String> {
    let lock_path = PathBuf::from(format!("{}.lock", stacks_dir.display()));
    if let Some(parent) = lock_path.parent() {
        path_ctx(
            fs::create_dir_all(parent),
            "create stack records lock directory",
            parent,
        )?;
    }
    let mut options = OpenOptions::new();
    options.create(true).truncate(false).read(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let lock = path_ctx(
        options.open(&lock_path),
        "open stack records lock",
        &lock_path,
    )?;
    ctx(lock.lock(), "lock stack records")?;
    Ok(lock)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registers_detects_overlap_cleans_stale_and_reads_live_owners() {
        let fixture = tempfile::tempdir().unwrap();
        let caddy_dir = fixture.path().join("caddy");
        let manifest = fixture.path().join("devhost.toml");
        fs::write(&manifest, "name = 'demo'\n").unwrap();
        let manifest_str = manifest.to_string_lossy().into_owned();

        let opts = RegisterStackOptions {
            remote: false,
            log_path: String::new(),
            control_port: 0,
            manifest_files: vec![manifest_str.clone()],
            manifest_path: manifest_str.clone(),
            stack_name: "demo".to_owned(),
        };
        register_stack(&caddy_dir, &opts).unwrap();

        let owners = read_live_stack_owners(&caddy_dir).unwrap();
        assert_eq!(owners.len(), 1);
        assert_eq!(owners[0].pid, current_pid());

        // Write a stale stack record and verify cleanup removes it.
        let stale = StackRecord {
            remote: false,
            ready: false,
            urls: Vec::new(),
            log_path: String::new(),
            control_port: 0,
            manifest_files: vec![manifest_str.clone()],
            created_at: utc_timestamp(),
            manifest_path: manifest_str.clone(),
            owner_pid: i32::MAX,
            owner_start_identity: "dead:0".to_owned(),
            stack_name: "stale".to_owned(),
        };
        fs::write(
            caddy_dir.join("stacks").join(format!("{}.json", i32::MAX)),
            serde_json::to_string_pretty(&stale).unwrap(),
        )
        .unwrap();
        cleanup_stale_stack_records(&caddy_dir).unwrap();
        assert!(
            !caddy_dir
                .join("stacks")
                .join(format!("{}.json", i32::MAX))
                .exists()
        );

        // Spawn a live child process to simulate an overlapping stack owner.
        let mut sleeper = std::process::Command::new("sleep")
            .arg("10")
            .spawn()
            .unwrap();
        let other_pid = sleeper.id() as i32;
        let other = StackRecord {
            remote: false,
            ready: false,
            urls: Vec::new(),
            log_path: String::new(),
            control_port: 0,
            manifest_files: vec![manifest_str.clone()],
            created_at: utc_timestamp(),
            manifest_path: manifest_str.clone(),
            owner_pid: other_pid,
            owner_start_identity: procid::start_identity(other_pid).unwrap_or_default(),
            stack_name: "other".to_owned(),
        };
        fs::write(
            caddy_dir.join("stacks").join(format!("{other_pid}.json")),
            serde_json::to_string_pretty(&other).unwrap(),
        )
        .unwrap();

        let overlap = register_stack(&caddy_dir, &opts).unwrap_err();
        let RegisterStackError::Overlap(err) = overlap else {
            panic!("expected overlap error");
        };
        assert_eq!(err.owner.pid, other_pid);
        assert!(err.default_message().contains("devhost stop --manifest"));
        assert!(
            err.message("devhost stop")
                .contains("stop that stack with devhost stop")
        );

        let _ = sleeper.kill();
        let _ = sleeper.wait();
        unregister_stack(&caddy_dir).unwrap();

        // Legacy route registration without manifestPath is ignored, and malformed stack records fail cleanly.
        let reg_dir = caddy_dir.join("routes/.registrations");
        fs::create_dir_all(&reg_dir).unwrap();
        fs::write(
            reg_dir.join("legacy.json"),
            format!(
                r#"{{"createdAt":"2026-01-01T00:00:00Z","host":"old.localhost","ownerPid":{},"port":3000}}"#,
                current_pid()
            ),
        )
        .unwrap();
        assert!(read_live_stack_owners(&caddy_dir).unwrap().is_empty());

        fs::write(reg_dir.join("bad.json"), "not json").unwrap();
        assert!(read_live_stack_owners(&caddy_dir).is_err());

        // Cleanup stale stack records on an empty/missing dir succeeds cleanly.
        cleanup_stale_stack_records(&fixture.path().join("missing-caddy")).unwrap();
    }
}
