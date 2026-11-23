use std::{io, path::PathBuf, sync::Arc, time::Duration};

use axum::{
    body::Body,
    extract::{
        State, WebSocketUpgrade,
        ws::{CloseFrame, Message, WebSocket},
    },
    http::{Method, Request, StatusCode, header},
    response::{IntoResponse, Response},
};
use futures_util::StreamExt;
use serde::Serialize;
use tokio::sync::{mpsc, oneshot};

use super::{
    agents::checkout_subdirectory,
    server::{diagnostic, is_local_client},
    streams::{send, websocket_guard},
};
use crate::services::control::RuntimeHandle;

const DIRECT_ONLY: &str = "Agent activity opens from the running agents list.";

fn direct_request(handle: &RuntimeHandle, request: &Request<Body>) -> bool {
    request
        .headers()
        .get(header::HOST)
        .is_some_and(|host| host == format!("127.0.0.1:{}", handle.live.control_port()).as_str())
        && is_local_client(request.headers())
}

pub(super) async fn page(State(handle): State<RuntimeHandle>, request: Request<Body>) -> Response {
    if request.method() != Method::GET {
        return diagnostic(StatusCode::METHOD_NOT_ALLOWED, "method not allowed");
    }
    if !direct_request(&handle, &request) {
        return diagnostic(StatusCode::FORBIDDEN, DIRECT_ONLY);
    }
    if let Err(error) = super::server::guard(&handle, &request) {
        return diagnostic(StatusCode::FORBIDDEN, error);
    }
    if let Err(error) = super::project_context::query_root(&handle, &request) {
        return diagnostic(StatusCode::BAD_REQUEST, &error);
    }
    let page = crate::statuspage::Page::basic(
        "agent-activity",
        200,
        "Agent activity",
        "What the agents in this checkout do from now on, including agents devhost did not start.",
    );
    match crate::statuspage::render(&page, "") {
        Ok(document) => (
            [
                (header::CACHE_CONTROL, "no-store"),
                (header::REFERRER_POLICY, "no-referrer"),
                (header::CONTENT_TYPE, "text/html; charset=utf-8"),
            ],
            document,
        )
            .into_response(),
        Err(error) => diagnostic(StatusCode::INTERNAL_SERVER_ERROR, &error),
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ActivityEvent {
    harness: String,
    pid: i32,
    event_type: String,
    timestamp: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    role: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_name: Option<String>,
    #[serde(skip_serializing_if = "String::is_empty")]
    text: String,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    is_error: bool,
}

impl From<agent_watcher::Event> for ActivityEvent {
    fn from(event: agent_watcher::Event) -> Self {
        let data = event.parsed.data;
        let mut text = data.content.or(data.tool_output).unwrap_or_default();
        if text.len() > 4096 {
            let mut end = 4096;
            while !text.is_char_boundary(end) {
                end -= 1;
            }
            text.truncate(end);
            text.push('…');
        }
        Self {
            harness: event.harness.to_string(),
            pid: event.pid,
            event_type: event.parsed.event_type,
            timestamp: event.parsed.timestamp,
            role: data.role.filter(|value| !value.is_empty()),
            tool_name: data.tool_name.filter(|value| !value.is_empty()),
            text,
            is_error: data.is_error.unwrap_or(false),
        }
    }
}

pub(super) async fn websocket(
    State(handle): State<RuntimeHandle>,
    upgrade: WebSocketUpgrade,
    request: Request<Body>,
) -> Response {
    if !direct_request(&handle, &request) {
        return diagnostic(StatusCode::FORBIDDEN, DIRECT_ONLY);
    }
    if let Err(error) = websocket_guard(&handle, &request) {
        return diagnostic(StatusCode::FORBIDDEN, error);
    }
    let root = match super::project_context::query_root(&handle, &request) {
        Ok(root) => root,
        Err(error) => return diagnostic(StatusCode::BAD_REQUEST, &error),
    };
    if handle.agents.cancel.is_cancelled() || *handle.live.events.stopping.borrow() {
        return diagnostic(StatusCode::SERVICE_UNAVAILABLE, "Devhost is stopping");
    }
    let state = match tempfile::Builder::new()
        .prefix("devhost-agent-activity-")
        .tempdir()
    {
        Ok(state) => state,
        Err(error) => return diagnostic(StatusCode::INTERNAL_SERVER_ERROR, &error.to_string()),
    };
    // Reserve before the upgrade: shutdown also waits for pending upgrade callbacks.
    let tracked = handle.agents.tasks.token();
    upgrade
        .on_upgrade(move |socket| async move {
            let _tracked = tracked;
            session(handle, root, state, socket).await;
        })
        .into_response()
}

struct Delivery {
    message: String,
    delivered: oneshot::Sender<bool>,
}

async fn session(
    handle: RuntimeHandle,
    root: PathBuf,
    state: tempfile::TempDir,
    mut socket: WebSocket,
) {
    let _activity = handle.activity.connection();
    let cancel = handle.agents.cancel.child_token();
    let mut config = handle.agents.config.clone();
    config.scan_interval = Duration::from_secs(5);
    config.cursor_path = state.path().join("cursors.json");
    config.session_state_path = state.path().join("sessions.json");
    config.opencode_checkpoint_path = state.path().join("opencode.json");
    config.start_at_end = true;
    config.session_filter = Some(Arc::new(move |session| {
        !session.subagent && checkout_subdirectory(&session.cwd, &root).is_some()
    }));
    let (sender, mut deliveries) = mpsc::channel::<Delivery>(32);
    let handler: agent_watcher::Handler = Arc::new(move |cancel, event, acknowledge| {
        let sender = sender.clone();
        Box::pin(async move {
            let (delivered, confirmed) = oneshot::channel();
            let delivery = Delivery {
                message: serde_json::to_string(&ActivityEvent::from(event))?,
                delivered,
            };
            tokio::select! {
                _ = cancel.cancelled() => return Err(io::Error::new(io::ErrorKind::Interrupted, "agent activity cancelled")),
                result = sender.send(delivery) => result.map_err(|_| io::Error::new(io::ErrorKind::BrokenPipe, "agent activity disconnected"))?,
            }
            let success = tokio::select! {
                _ = cancel.cancelled() => false,
                result = confirmed => result.unwrap_or(false),
            };
            if !success {
                return Err(io::Error::new(
                    io::ErrorKind::BrokenPipe,
                    "publish agent activity",
                ));
            }
            if let Some(acknowledge) = acknowledge {
                acknowledge.acknowledge()?;
            }
            Ok(())
        })
    });
    let watcher_cancel = cancel.clone();
    let mut worker =
        tokio::spawn(async move { agent_watcher::run(&watcher_cancel, config, handler).await });
    let result = loop {
        tokio::select! {
            _ = cancel.cancelled() => break None,
            result = &mut worker => break Some(result),
            incoming = socket.next() => if matches!(incoming, None | Some(Err(_)) | Some(Ok(Message::Close(_)))) { break None; },
            Some(delivery) = deliveries.recv() => {
                let success = tokio::select! {
                    _ = cancel.cancelled() => false,
                    success = send(&mut socket, Message::Text(delivery.message.into())) => success,
                };
                let _ = delivery.delivered.send(success);
                if !success { break None; }
            }
        }
    };
    cancel.cancel();
    let result = match result {
        Some(result) => result,
        None => worker.await,
    };
    let (code, reason) = if handle.agents.cancel.is_cancelled() {
        (1001, "Devhost stopping")
    } else if !matches!(result, Ok(Ok(()))) {
        (1011, "Agent activity failed")
    } else {
        (1000, "Agent activity ended")
    };
    let _ = tokio::time::timeout(
        Duration::from_secs(1),
        socket.send(Message::Close(Some(CloseFrame {
            code,
            reason: reason.into(),
        }))),
    )
    .await;
    // All watcher workers have joined; removing this page's state is now safe.
    drop(state);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn activity_projects_content_tool_results_and_errors_without_native_identifiers() {
        let mut event = agent_watcher::Event {
            harness: agent_watcher::Harness::Codex,
            harness_version: "private version".into(),
            session_id: "private id".into(),
            subagent_id: None,
            pid: 17,
            parsed: Default::default(),
        };
        event.parsed.event_type = "tool_result".into();
        event.parsed.timestamp = 123;
        event.parsed.data.role = Some("assistant".into());
        event.parsed.data.tool_name = Some("shell".into());
        event.parsed.data.tool_output = Some("failure".into());
        event.parsed.data.is_error = Some(true);
        let wire = serde_json::to_value(ActivityEvent::from(event.clone())).unwrap();
        assert_eq!(
            wire,
            serde_json::json!({"harness":"codex", "pid":17,"eventType":"tool_result", "timestamp":123,"role":"assistant","toolName":"shell","text":"failure","isError":true})
        );
        event.parsed.data.content = Some(String::new());
        event.parsed.data.role = Some(String::new());
        event.parsed.data.tool_name = Some(String::new());
        event.parsed.data.is_error = Some(false);
        let wire = serde_json::to_value(ActivityEvent::from(event)).unwrap();
        assert_eq!(
            wire,
            serde_json::json!({"harness":"codex", "pid":17,"eventType":"tool_result", "timestamp":123})
        );
    }
}
