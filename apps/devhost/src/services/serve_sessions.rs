use super::stack_info::{StackInfo, read_live_stack_info};
use crate::{
    Failure,
    caddy::stacks::{LiveStack, read_live_stacks, signal_live_stack},
};
use std::{
    path::Path,
    thread,
    time::{Duration, Instant},
};

pub fn list_sessions(caddy_dir: &Path) -> Result<Vec<LiveStack>, String> {
    Ok(read_live_stacks(caddy_dir)?
        .into_iter()
        .filter(|stack| stack.manifest_path.is_empty())
        .collect())
}

fn find_session(caddy_dir: &Path, name: &str) -> Result<LiveStack, String> {
    list_sessions(caddy_dir)?
        .into_iter()
        .find(|stack| stack.name == name)
        .ok_or_else(|| {
            format!("no running serve session named {name:?}; use devhost stack list --sessions")
        })
}

pub fn read_info(caddy_dir: &Path, name: &str) -> Result<StackInfo, Failure> {
    read_live_stack_info(&find_session(caddy_dir, name).map_err(Failure::from)?)
}

pub fn stop_session(caddy_dir: &Path, name: &str) -> Result<(), String> {
    let stack = find_session(caddy_dir, name)?;
    if !stack.daemon_socket.is_empty() {
        crate::daemon::client::stop_live_stack(
            Path::new(&stack.daemon_socket),
            &stack.stack_id,
            stack.pid,
            libc::SIGTERM,
            Duration::from_secs(30),
        )?;
        return Ok(());
    }
    signal_live_stack(caddy_dir, &stack)?;
    let deadline = Instant::now() + Duration::from_secs(30);
    while stack.is_alive() {
        if Instant::now() >= deadline {
            return Err(format!(
                "serve session {name} is still stopping (PID {})",
                stack.pid
            ));
        }
        thread::sleep(Duration::from_millis(50));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::caddy::stacks::{RegisterStackOptions, register_stack};
    use std::process::{Command, Stdio};

    #[test]
    fn stops_legacy_non_daemon_session_and_rejects_missing_session() {
        let dir = tempfile::tempdir().unwrap();
        let caddy_dir = dir.path().join("caddy");
        assert!(
            stop_session(&caddy_dir, "missing")
                .unwrap_err()
                .contains("no running serve session")
        );
        let mut child = Command::new("sh")
            .args(["-c", "sleep 30"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let pid = child.id() as i32;
        register_stack(
            &caddy_dir,
            &RegisterStackOptions {
                stack_name: "legacy-session".to_owned(),
                ..RegisterStackOptions::default()
            },
        )
        .unwrap();
        // Write synthetic non-daemon stack record for the spawned child.
        std::fs::remove_file(caddy_dir.join(format!("stacks/{}.json", std::process::id())))
            .unwrap();
        let identity = crate::procid::start_identity(pid).unwrap_or_default();
        std::fs::write(
            caddy_dir.join(format!("stacks/{pid}.json")),
            serde_json::to_vec(&serde_json::json!({
                "createdAt": "2026-11-25T00:00:00Z",
                "manifestPath": "",
                "ownerPid": pid,
                "ownerStartIdentity": identity,
                "stackName": "legacy-session"
            }))
            .unwrap(),
        )
        .unwrap();
        let waiter = thread::spawn(move || {
            let _ = child.wait();
        });
        stop_session(&caddy_dir, "legacy-session").unwrap();
        waiter.join().unwrap();
    }
}
