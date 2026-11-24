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
