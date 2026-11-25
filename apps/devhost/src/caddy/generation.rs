use std::{fs, io, path::Path};

use serde::{Deserialize, Serialize};
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};

use super::ctx;
use crate::procid;

// A reload cannot clear certificates cached by the former on-demand issuer.
const RESTART_GENERATION: i64 = 1;

#[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ManagedProcess {
    pid: i32,
    start_identity: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Runtime {
    restart_generation: i64,
    #[serde(flatten)]
    process: ManagedProcess,
}

fn read_runtime(directory: &Path) -> Result<Option<Runtime>, String> {
    let text = match fs::read(directory.join("runtime.json")) {
        Ok(text) => text,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("read managed Caddy runtime: {error}")),
    };
    let record: Runtime = ctx(serde_json::from_slice(&text), "parse managed Caddy runtime")?;
    if record.restart_generation < 0
        || record.process.pid < 1
        || record.process.start_identity.is_empty()
    {
        return Err("invalid managed Caddy runtime record".to_owned());
    }
    Ok(Some(record))
}

// Call only with the shared route lock held, before changing shared state.
pub(super) fn check(directory: &Path) -> Result<(), String> {
    if let Some(record) = read_runtime(directory)?
        && record.restart_generation > RESTART_GENERATION
    {
        return Err(format!(
            "managed Caddy requires restart generation {}; this devhost supports {RESTART_GENERATION}. Upgrade this devhost instance before changing shared Caddy configuration",
            record.restart_generation
        ));
    }
    Ok(())
}

pub(super) fn read_process(directory: &Path) -> Result<ManagedProcess, String> {
    let text = ctx(
        fs::read_to_string(directory.join("caddy.pid")),
        "read managed Caddy PID",
    )?;
    let pid = text
        .trim()
        .parse::<i32>()
        .ok()
        .filter(|pid| *pid > 0)
        .ok_or_else(|| "invalid managed Caddy PID".to_owned())?;
    let start_identity = ctx(
        procid::start_identity(pid),
        "identify managed Caddy process",
    )?;
    Ok(ManagedProcess {
        pid,
        start_identity,
    })
}

pub(super) fn needs_restart(directory: &Path) -> Result<bool, String> {
    let owner = read_process(directory)?;
    if let Some(record) = read_runtime(directory)?
        && record.process == owner
    {
        return Ok(record.restart_generation < RESTART_GENERATION);
    }
    verify_legacy_process(directory, &owner)?;
    Ok(true)
}

fn verify_legacy_process(directory: &Path, owner: &ManagedProcess) -> Result<(), String> {
    let pid = Pid::from_u32(owner.pid as u32);
    let mut system = System::new();
    system.refresh_processes_specifics(
        ProcessesToUpdate::Some(&[pid]),
        true,
        ProcessRefreshKind::nothing().with_cmd(UpdateKind::Always),
    );
    let process = system
        .process(pid)
        .ok_or_else(|| "inspect managed Caddy process: process is not available".to_owned())?;
    let arguments = process.cmd();
    let has_argument = |flag: &str, value: &Path| {
        arguments.get(2..).is_some_and(|args| {
            args.windows(2)
                .any(|pair| pair[0] == flag && pair[1] == value.as_os_str())
        })
    };
    if arguments.get(1).is_none_or(|argument| argument != "run")
        || !has_argument("--config", &directory.join("Caddyfile"))
        || !has_argument("--pidfile", &directory.join("caddy.pid"))
    {
        return Err("cannot verify the running Caddy belongs to this devhost state directory; refusing automatic restart".to_owned());
    }
    if read_process(directory)? != *owner {
        return Err("managed Caddy process changed while verifying ownership".to_owned());
    }
    Ok(())
}

pub(super) fn record(directory: &Path, process: ManagedProcess) -> Result<(), String> {
    let record = Runtime {
        restart_generation: RESTART_GENERATION,
        process,
    };
    let text = ctx(
        serde_json::to_vec_pretty(&record),
        "encode managed Caddy runtime",
    )?;
    // The lock serializes publishers; tempfile keeps failed publication private
    // and removes its temporary file on every error path.
    let mut temporary = ctx(
        tempfile::NamedTempFile::new_in(directory),
        "write managed Caddy runtime",
    )?;
    use io::Write;
    ctx(temporary.write_all(&text), "write managed Caddy runtime")?;
    ctx(
        temporary.persist(directory.join("runtime.json")),
        "record managed Caddy runtime",
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn current_process(directory: &Path) -> ManagedProcess {
        fs::write(directory.join("caddy.pid"), std::process::id().to_string()).unwrap();
        read_process(directory).unwrap()
    }

    #[test]
    fn receipt_requires_a_valid_owner_and_rejects_newer_generations() {
        let directory = tempfile::tempdir().unwrap();
        let directory = directory.path();
        assert!(read_runtime(directory).unwrap().is_none());
        assert!(
            read_process(directory)
                .unwrap_err()
                .contains("read managed Caddy PID")
        );
        for text in ["0", "-1", "not a pid"] {
            fs::write(directory.join("caddy.pid"), text).unwrap();
            assert!(
                read_process(directory)
                    .unwrap_err()
                    .contains("invalid managed Caddy PID")
            );
        }
        fs::write(directory.join("caddy.pid"), i32::MAX.to_string()).unwrap();
        assert!(
            read_process(directory)
                .unwrap_err()
                .contains("identify managed Caddy process")
        );
        record(directory, current_process(directory)).unwrap();
        assert!(!needs_restart(directory).unwrap());
        let path = directory.join("runtime.json");
        let receipt = fs::read(&path).unwrap();
        let mut value: serde_json::Value = serde_json::from_slice(&receipt).unwrap();
        value["restartGeneration"] = 0.into();
        fs::write(&path, serde_json::to_vec(&value).unwrap()).unwrap();
        assert!(needs_restart(directory).unwrap());
        value["restartGeneration"] = 2.into();
        fs::write(&path, serde_json::to_vec(&value).unwrap()).unwrap();
        assert!(
            check(directory)
                .unwrap_err()
                .contains("this devhost supports 1")
        );
        for (key, invalid) in [
            ("restartGeneration", serde_json::json!(-1)),
            ("pid", serde_json::json!(0)),
            ("startIdentity", serde_json::json!("")),
        ] {
            let mut invalid_record: serde_json::Value = serde_json::from_slice(&receipt).unwrap();
            invalid_record[key] = invalid;
            fs::write(&path, serde_json::to_vec(&invalid_record).unwrap()).unwrap();
            assert!(
                check(directory)
                    .unwrap_err()
                    .contains("invalid managed Caddy runtime record")
            );
        }
        fs::write(&path, "invalid JSON").unwrap();
        assert!(
            check(directory)
                .unwrap_err()
                .contains("parse managed Caddy runtime")
        );
        fs::remove_file(&path).unwrap();
        fs::create_dir(&path).unwrap();
        assert!(
            check(directory)
                .unwrap_err()
                .contains("read managed Caddy runtime")
        );
        assert!(
            record(directory, current_process(directory))
                .unwrap_err()
                .contains("record managed Caddy runtime")
        );
        assert_eq!(
            fs::read_dir(directory).unwrap().count(),
            2,
            "failed publication leaves no temporary receipt"
        );
    }

    #[test]
    fn unreceipted_unrelated_process_never_authorizes_automatic_restart() {
        let directory = tempfile::tempdir().unwrap();
        current_process(directory.path());
        assert!(
            needs_restart(directory.path())
                .unwrap_err()
                .contains("refusing automatic restart")
        );
    }
}
