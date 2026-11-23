use super::{
    configuration,
    server::{diagnostic, guard},
};
use crate::services::control::RuntimeHandle;
use axum::{
    body::Body,
    extract::{
        State, WebSocketUpgrade,
        ws::{CloseFrame, Message, WebSocket},
    },
    http::{Request, StatusCode},
    response::{IntoResponse, Response},
};
use futures_util::StreamExt;
use serde_json::json;
use std::time::Duration;

pub(super) async fn publish_health(handle: &RuntimeHandle) -> Result<String, String> {
    let _publication = handle.live.events.health_lock.lock().await;
    let reader = handle.clone();
    let message = tokio::task::spawn_blocking(move || health_message(&reader))
        .await
        .map_err(|error| error.to_string())??;
    handle.live.events.health.send_if_modified(|previous| {
        if previous.as_ref() == Some(&message) {
            false
        } else {
            *previous = Some(message.clone());
            true
        }
    });
    Ok(message)
}

pub(super) async fn poll_health(handle: RuntimeHandle) {
    let mut interval = tokio::time::interval(Duration::from_secs(1));
    let mut stopping = handle.live.events.stopping.subscribe();
    loop {
        tokio::select! {
            _ = stopping.changed() => return,
            _ = interval.tick() => {
                if handle.live.events.health.receiver_count() > 0 {
                    let _ = publish_health(&handle).await;
                }
            }
        }
    }
}

fn health_message(handle: &RuntimeHandle) -> Result<String, String> {
    let manifest = handle.live.manifest().ok_or("Health is not available.")?;
    let snapshot = handle.live.snapshot()?;
    let dirty = handle.dirty_services();
    let mut services = Vec::new();
    let mut stopped = Vec::new();
    for info in snapshot.services {
        if info.state == "not-started" {
            stopped.push(json!({"name":info.name}));
            continue;
        }
        let Some(service) = manifest.services.get(&info.name) else {
            continue;
        };
        let managed = service.managed || !service.command.is_empty() || !service.serve.is_empty();
        let mut value = json!({"managed":managed,"name":info.name,"status":info.state == "ready"});
        if let Some(url) = info.urls.first() {
            value["url"] = json!(url);
        }
        if dirty.contains(&info.name) {
            value["dirty"] = json!(true);
        }
        if info.state == "restarting" {
            value["restarting"] = json!(true);
        }
        if let Some(code) = info.exit_code {
            value["exitCode"] = json!(code);
        }
        let repositories = handle.live.repositories_snapshot();
        if let Some(repository) = repositories
            .iter()
            .find(|repository| repository.service_names.contains(&info.name))
        {
            let root = std::path::Path::new(&repository.configured_path);
            let selected = std::path::Path::new(&repository.selected_path);
            let project_root = manifest
                .manifest_directory
                .strip_prefix(root)
                .map(|relative| crate::paths::clean(&selected.join(relative)))
                .unwrap_or_else(|_| selected.to_owned());
            value["projectRootPath"] = json!(project_root.display().to_string());
        }
        services.push(value);
    }
    let mut response =
        json!({"services":services,"config": configuration::injected_config(handle)});
    if !stopped.is_empty() {
        response["stoppedServices"] = json!(stopped);
    }
    let repositories = handle.live.repositories_snapshot();
    let configuration = handle.live.configuration();
    if !configuration.is_empty() {
        response["configuration"] = json!(configuration);
    }
    if !repositories.is_empty() {
        response["repositories"] = json!(repositories);
    }
    Ok(response.to_string())
}

pub(super) fn websocket_guard(
    handle: &RuntimeHandle,
    request: &Request<Body>,
) -> Result<(), &'static str> {
    guard(handle, request)?;
    if let Some(origin) = request.headers().get(axum::http::header::ORIGIN) {
        let host = request
            .headers()
            .get(axum::http::header::HOST)
            .and_then(|v| v.to_str().ok())
            .unwrap_or_default();
        let valid = origin
            .to_str()
            .ok()
            .and_then(|origin| url::Url::parse(origin).ok())
            .is_some_and(|origin| origin.authority().eq_ignore_ascii_case(host));
        if !valid {
            return Err("websocket: request origin not allowed by Upgrader.CheckOrigin");
        }
    }
    Ok(())
}

pub(super) async fn health(
    State(handle): State<RuntimeHandle>,
    upgrade: WebSocketUpgrade,
    request: Request<Body>,
) -> Response {
    if let Err(error) = websocket_guard(&handle, &request) {
        return diagnostic(StatusCode::FORBIDDEN, error);
    }
    upgrade
        .on_upgrade(move |socket| health_session(handle, socket))
        .into_response()
}

pub(super) async fn send(socket: &mut WebSocket, message: Message) -> bool {
    matches!(
        tokio::time::timeout(Duration::from_secs(10), socket.send(message)).await,
        Ok(Ok(()))
    )
}

pub(super) async fn closing(socket: &mut WebSocket) {
    let _ = tokio::time::timeout(
        Duration::from_secs(1),
        socket.send(Message::Close(Some(CloseFrame {
            code: 1001,
            reason: "devhost is stopping".into(),
        }))),
    )
    .await;
}

async fn health_session(handle: RuntimeHandle, mut socket: WebSocket) {
    let _activity = handle.activity.connection();
    let mut stopping = handle.live.events.stopping.subscribe();
    let mut messages = handle.live.events.health.subscribe();
    if *stopping.borrow() {
        closing(&mut socket).await;
        return;
    }
    if publish_health(&handle).await.is_err() {
        return;
    }
    let initial = messages
        .borrow_and_update()
        .clone()
        .expect("published health");
    if !send(&mut socket, Message::Text(initial.into())).await {
        return;
    }
    loop {
        tokio::select! {
            _ = stopping.changed() => { closing(&mut socket).await; return; },
            incoming = socket.next() => { if matches!(incoming, None | Some(Err(_)) | Some(Ok(Message::Close(_)))) { return; } },
            changed = messages.changed() => {
                if changed.is_err() { return; }
                let message = messages.borrow_and_update().clone();
                if let Some(message) = message && !send(&mut socket, Message::Text(message.into())).await { return; }
            }
        }
    }
}

pub(super) async fn logs(
    State(handle): State<RuntimeHandle>,
    upgrade: WebSocketUpgrade,
    request: Request<Body>,
) -> Response {
    if let Err(error) = websocket_guard(&handle, &request) {
        return diagnostic(StatusCode::FORBIDDEN, error);
    }
    upgrade
        .on_upgrade(move |socket| logs_session(handle, socket))
        .into_response()
}

async fn logs_session(handle: RuntimeHandle, mut socket: WebSocket) {
    let _activity = handle.activity.connection();
    let mut stopping = handle.live.events.stopping.subscribe();
    if *stopping.borrow() {
        closing(&mut socket).await;
        return;
    }
    let (entries, mut messages) = handle.live.subscribe_logs();
    if !send(
        &mut socket,
        Message::Text(
            json!({"type":"snapshot","entries":entries})
                .to_string()
                .into(),
        ),
    )
    .await
    {
        return;
    }
    loop {
        tokio::select! {
            _ = stopping.changed() => { closing(&mut socket).await; return; },
            incoming = socket.next() => { if matches!(incoming, None | Some(Err(_)) | Some(Ok(Message::Close(_)))) { return; } },
            entry = messages.recv() => {
                match entry {
                    Ok(entry) => if !send(&mut socket, Message::Text(json!({"type":"entry","entry":entry}).to_string().into())).await { return; },
                    Err(_) => return,
                }
            }
        }
    }
}

pub(super) async fn cursor(
    State(handle): State<RuntimeHandle>,
    request: Request<Body>,
) -> Response {
    if let Err(error) = guard(&handle, &request) {
        return diagnostic(StatusCode::FORBIDDEN, error);
    }
    if request.method() != axum::http::Method::POST {
        return diagnostic(StatusCode::METHOD_NOT_ALLOWED, "Method not allowed");
    }
    let bytes = match axum::body::to_bytes(request.into_body(), 1024 * 1024).await {
        Ok(bytes) => bytes,
        Err(_) => {
            return diagnostic(
                StatusCode::BAD_REQUEST,
                "Invalid React Highlight cursor payload.",
            );
        }
    };
    #[derive(serde::Deserialize)]
    struct Cursor {
        locator: Option<String>,
    }
    let cursor = match serde_json::from_slice::<Cursor>(&bytes) {
        Ok(cursor) if cursor.locator.as_deref() != Some("") => cursor,
        _ => {
            return diagnostic(
                StatusCode::BAD_REQUEST,
                "Invalid React Highlight cursor payload.",
            );
        }
    };
    let manifest = handle.live.manifest();
    let message = json!({"kind":"cursor","locator":cursor.locator,
        "projectRoot":manifest.as_ref().map(|manifest| manifest.manifest_directory.display().to_string()).unwrap_or_default(),
        "stackName":manifest.map(|manifest|manifest.name).unwrap_or_default(),
        "timestamp":std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis()});
    let _ = handle.live.events.cursor.send(message.to_string());
    axum::Json(json!({"success":true})).into_response()
}

pub(super) async fn cursor_ws(
    State(handle): State<RuntimeHandle>,
    upgrade: WebSocketUpgrade,
    request: Request<Body>,
) -> Response {
    if let Err(error) = websocket_guard(&handle, &request) {
        return diagnostic(StatusCode::FORBIDDEN, error);
    }
    upgrade.on_upgrade(move |mut socket| async move {
        let _activity = handle.activity.connection();
        let mut messages = handle.live.events.cursor.subscribe();
        let mut stopping = handle.live.events.stopping.subscribe();
        if *stopping.borrow() { closing(&mut socket).await; return; }
        loop {
            tokio::select! {
                _ = stopping.changed() => { closing(&mut socket).await; return; },
                incoming = socket.next() => { if matches!(incoming, None | Some(Err(_)) | Some(Ok(Message::Close(_)))) { return; } },
                message = messages.recv() => match message {
                    Ok(message) => if !send(&mut socket, Message::Text(message.into())).await { return; },
                    Err(_) => return,
                }
            }
        }
    }).into_response()
}
