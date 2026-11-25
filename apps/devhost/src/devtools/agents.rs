use std::{
    collections::BTreeSet,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use agent_watcher::{Config, Harness, SessionSnapshot, Snapshotter, scanner::SessionState};
use axum::{
    body::Body,
    extract::State,
    http::{Method, Request, StatusCode, header},
    response::{IntoResponse, Response},
};
use serde::Serialize;
use tokio_util::{sync::CancellationToken, task::TaskTracker};

use super::server::{diagnostic, guard};
use crate::services::control::RuntimeHandle;

pub(crate) struct Agents {
    pub config: Config,
    snapshotter: Arc<Snapshotter>,
    cache: tokio::sync::Mutex<Option<Cached>>,
    pub owned: Mutex<BTreeSet<String>>,
    pub cancel: CancellationToken,
    pub tasks: TaskTracker,
}

struct Cached {
    scanned: Instant,
    sessions: Vec<SessionSnapshot>,
    failed: bool,
}

impl Default for Agents {
    fn default() -> Self {
        Self::new(Config {
            harnesses: vec![
                Harness::ClaudeCode,
                Harness::Pi,
                Harness::Codex,
                Harness::Opencode,
            ],
            ..Config::default()
        })
    }
}

impl Agents {
    pub fn new(config: Config) -> Self {
        Self {
            snapshotter: Arc::new(Snapshotter::new(config.clone())),
            config,
            cache: tokio::sync::Mutex::new(None),
            owned: Mutex::new(BTreeSet::new()),
            cancel: CancellationToken::new(),
            tasks: TaskTracker::new(),
        }
    }

    async fn read(&self) -> (Vec<SessionSnapshot>, bool) {
        let mut cache = self.cache.lock().await;
        if let Some(previous) = cache.as_ref()
            && previous.scanned.elapsed() < Duration::from_secs(5)
        {
            return (previous.sessions.clone(), previous.failed);
        }
        let scanned = Instant::now();
        let cancel = self.cancel.child_token();
        let scanner = self.snapshotter.clone();
        let scan_cancel = cancel.clone();
        let mut worker = tokio::task::spawn_blocking(move || scanner.snapshot(&scan_cancel));
        let result = tokio::select! {
            result = &mut worker => result,
            _ = tokio::time::sleep(Duration::from_secs(10)) => {
                cancel.cancel();
                worker.await
            }
        };
        let (sessions, failed) = match result {
            Ok(snapshot) if !cancel.is_cancelled() => {
                (snapshot.sessions, !snapshot.errors.is_empty())
            }
            _ => (Vec::new(), true),
        };
        *cache = Some(Cached {
            scanned,
            sessions: sessions.clone(),
            failed,
        });
        (sessions, failed)
    }

    pub async fn shutdown(&self) {
        self.cancel.cancel();
        self.tasks.close();
        self.tasks.wait().await;
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RunningAgent {
    key: String,
    harness: String,
    state: SessionState,
    #[serde(skip_serializing_if = "String::is_empty")]
    name: String,
    subdirectory: String,
    last_activity: i64,
    is_owned: bool,
}

pub(super) fn checkout_subdirectory(cwd: &Path, root: &Path) -> Option<PathBuf> {
    if cwd.as_os_str().is_empty() {
        return None;
    }
    let root = root.canonicalize().unwrap_or_else(|_| root.to_owned());
    let relative = crate::paths::clean(cwd)
        .strip_prefix(crate::paths::clean(&root))
        .ok()?
        .to_owned();
    Some(if relative.as_os_str().is_empty() {
        PathBuf::from(".")
    } else {
        relative
    })
}

fn in_checkout(
    sessions: Vec<SessionSnapshot>,
    root: &Path,
    owned: &BTreeSet<String>,
) -> Vec<RunningAgent> {
    let mut agents: Vec<_> = sessions
        .into_iter()
        .filter(|session| !session.subagent)
        .filter_map(|session| {
            let subdirectory = checkout_subdirectory(&session.cwd, root)?;
            Some(RunningAgent {
                key: format!("{}:{}", session.harness, session.pid),
                harness: session.harness.to_string(),
                state: session.state,
                name: session.name,
                subdirectory: subdirectory.display().to_string(),
                last_activity: session.last_activity,
                is_owned: owned.contains(&session.session_id),
            })
        })
        .collect();
    fn rank(state: SessionState) -> u8 {
        match state {
            SessionState::Waiting => 0,
            SessionState::Working => 1,
            SessionState::Unknown => 2,
            SessionState::Idle => 3,
        }
    }
    agents.sort_by(|a, b| {
        rank(a.state)
            .cmp(&rank(b.state))
            .then_with(|| b.last_activity.cmp(&a.last_activity))
            .then_with(|| a.key.cmp(&b.key))
    });
    agents
}

pub(super) async fn serve(State(handle): State<RuntimeHandle>, request: Request<Body>) -> Response {
    if let Err(error) = guard(&handle, &request) {
        return diagnostic(StatusCode::FORBIDDEN, error);
    }
    if request.method() != Method::GET {
        return diagnostic(StatusCode::METHOD_NOT_ALLOWED, "method not allowed");
    }
    let root = match super::project_context::query_root(&handle, &request) {
        Ok(root) => root,
        Err(error) => return diagnostic(StatusCode::BAD_REQUEST, &error),
    };
    if handle.agents.cancel.is_cancelled() {
        return diagnostic(StatusCode::SERVICE_UNAVAILABLE, "Devhost is stopping");
    }
    let _tracked = handle.agents.tasks.token();
    let (sessions, failed) = handle.agents.read().await;
    let agents = in_checkout(
        sessions,
        &root,
        &handle.agents.owned.lock().expect("owned agents"),
    );
    let mut response = serde_json::json!({"agents":agents});
    if failed {
        response["error"] = serde_json::json!("Some agents could not be listed.");
        handle
            .live
            .record_log("devhost", "stderr", "running agents scan failed");
    }
    ([(header::CACHE_CONTROL, "no-store")], axum::Json(response)).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn agents_are_ranked_by_attention_then_recency_and_key_without_children() {
        let session = |pid, state, last_activity| SessionSnapshot {
            harness: Harness::ClaudeCode,
            harness_version: String::new(),
            session_id: format!("private-{pid}"),
            pid,
            cwd: "/project/sub".into(),
            name: String::new(),
            started_at: 1,
            last_activity,
            subagent: false,
            transcript_path: PathBuf::new(),
            state,
            state_updated_at: 0,
            entrypoint: String::new(),
        };
        let mut child = session(99, SessionState::Waiting, 200);
        child.subagent = true;
        let result = in_checkout(
            vec![
                session(1, SessionState::Idle, 100),
                session(2, SessionState::Unknown, 100),
                session(3, SessionState::Working, 100),
                session(6, SessionState::Waiting, 1),
                session(5, SessionState::Waiting, 1),
                session(4, SessionState::Waiting, 2),
                child,
            ],
            Path::new("/project"),
            &BTreeSet::from(["private-4".into()]),
        );
        assert_eq!(
            result
                .iter()
                .map(|agent| agent.key.as_str())
                .collect::<Vec<_>>(),
            [
                "claude-code:4",
                "claude-code:5",
                "claude-code:6",
                "claude-code:3",
                "claude-code:2",
                "claude-code:1"
            ]
        );
        assert!(result[0].is_owned && !result[1].is_owned);
        assert_eq!(result[0].subdirectory, "sub");
    }
}
