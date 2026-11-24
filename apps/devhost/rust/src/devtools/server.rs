use std::{
    net::TcpListener,
    sync::mpsc::TryRecvError,
    thread::{self, JoinHandle},
    time::Duration,
};

use axum::{
    Router,
    body::{Body, to_bytes},
    extract::State,
    http::{Method, Request, StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::any,
};
use serde::Deserialize;
use tokio::sync::oneshot;

use super::{
    CACHE_CONTROL_NO_STORE,
    request_guard::{check_cross_origin, serves_request_host},
};
use crate::services::control::{RuntimeHandle, WorktreeOperation};

/// Owns the loopback listener and joins its worker on every shutdown path.
pub(crate) struct ControlServer {
    port: u16,
    shutdown: Option<oneshot::Sender<()>>,
    worker: Option<JoinHandle<()>>,
}

impl ControlServer {
    pub(crate) fn start(handle: RuntimeHandle) -> Result<Self, String> {
        let listener = TcpListener::bind("127.0.0.1:0")
            .map_err(|error| format!("start control listener: {error}"))?;
        listener
            .set_nonblocking(true)
            .map_err(|error| format!("configure control listener: {error}"))?;
        let port = listener
            .local_addr()
            .map_err(|error| error.to_string())?
            .port();
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|error| format!("start control runtime: {error}"))?;
        let listener = {
            let _enter = runtime.enter();
            tokio::net::TcpListener::from_std(listener).map_err(|error| error.to_string())?
        };
        let (shutdown, stopped) = oneshot::channel();
        handle.live.set_control_port(port);
        let store = super::assets::AssetStore::new(
            handle.live.dev_source(),
            serde_json::to_vec(&super::configuration::injected_config(&handle))
                .map_err(|error| error.to_string())?,
        );
        let previews = super::page_preview::preview_routes(store.clone());
        let assets = super::assets::asset_routes(store.clone()).layer(
            middleware::from_fn_with_state((handle.clone(), store), serve_assets),
        );
        let chat = Router::new()
            .route(
                "/__devhost__/chat/panel",
                any(super::chat::transport::panel),
            )
            .route(
                "/__devhost__/chat/harnesses",
                any(super::chat::transport::harnesses),
            )
            .route(
                "/__devhost__/chat/sessions",
                any(super::chat::transport::sessions),
            )
            .route(
                "/__devhost__/chat/sessions/{id}/close",
                any(super::chat::transport::close),
            )
            .route(
                "/__devhost__/ws/chat",
                any(super::chat::transport::websocket),
            )
            .route("/__devhost__/agents", any(super::agents::serve))
            .route(
                "/__devhost__/agents/activity",
                any(super::agent_activity::page),
            )
            .route(
                "/__devhost__/ws/agents/activity",
                any(super::agent_activity::websocket),
            )
            .route_layer(middleware::from_fn_with_state(
                handle.clone(),
                while_chat_enabled,
            ));
        let app = Router::new()
            .route("/__devhost__/stack-info", any(stack_info))
            .route("/__devhost__/stacks", any(super::directory::serve))
            .route("/__devhost__/stacks/self", any(super::directory::serve))
            .route("/__devhost__/restart-service", any(restart_service))
            .route("/__devhost__/start-service", any(start_service))
            .route("/__devhost__/restart-stack", any(restart_stack))
            .route("/__devhost__/worktrees", any(worktrees))
            .merge(chat)
            .route("/__devhost__/config/files", any(super::config_files::files))
            .route(
                "/__devhost__/config/schema",
                any(super::config_files::schema),
            )
            .route(
                "/__devhost__/config/validate",
                any(super::config_files::validate),
            )
            .route("/__devhost__/config/save", any(super::config_files::save))
            .route("/__devhost__/ws/health", any(super::streams::health))
            .route("/__devhost__/ws/logs", any(super::streams::logs))
            .route("/__devhost__/ws/resources", any(super::resources::serve))
            .route(
                "/__devhost__/react-highlight/cursor",
                any(super::streams::cursor),
            )
            .route(
                "/__devhost__/ws/react-highlight",
                any(super::streams::cursor_ws),
            )
            .with_state(handle.clone())
            .merge(assets)
            .merge(previews)
            .layer(middleware::from_fn_with_state(handle.clone(), json_body));
        let poller_stop = handle.live.events.stopping.clone();
        let agents = handle.agents.clone();
        let chat_store = handle.chat.clone();
        let sampler = super::resources::Sampler::start(handle.clone())?;
        let worker = thread::Builder::new()
            .name("devhost-control".to_owned())
            .spawn(move || {
                let _sampler = sampler;
                runtime.block_on(async move {
                    let poller = tokio::spawn(super::streams::poll_health(handle.clone()));
                    let server = axum::serve(listener, app)
                        .with_graceful_shutdown(async move {
                            let _ = stopped.await;
                            handle.live.events.stopping.send_replace(true);
                        })
                        .into_future();
                    tokio::pin!(server);
                    let mut stopping = poller_stop.subscribe();
                    tokio::select! { _ = &mut server => {}, _ = stopping.changed() => {
                        let _ = tokio::time::timeout(Duration::from_millis(250), &mut server).await;
                    }}
                    chat_store.shutdown().await;
                    agents.shutdown().await;
                    poller.abort();
                    let _ = poller.await;
                });
            })
            .map_err(|error| format!("start control worker: {error}"))?;
        Ok(Self {
            port,
            shutdown: Some(shutdown),
            worker: Some(worker),
        })
    }

    pub(crate) fn port(&self) -> u16 {
        self.port
    }
}

impl Drop for ControlServer {
    fn drop(&mut self) {
        if let Some(shutdown) = self.shutdown.take() {
            let _ = shutdown.send(());
        }
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RestartPayload {
    #[serde(default)]
    service_name: String,
    #[serde(default)]
    service_names: Vec<String>,
}

pub(super) fn diagnostic(status: StatusCode, message: &str) -> Response {
    (
        status,
        [(header::CACHE_CONTROL, CACHE_CONTROL_NO_STORE)],
        format!("{message}\n"),
    )
        .into_response()
}

pub(super) fn guard(handle: &RuntimeHandle, request: &Request<Body>) -> Result<(), &'static str> {
    let host = request
        .headers()
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    let proto = request
        .headers()
        .get("x-forwarded-proto")
        .and_then(|value| value.to_str().ok());
    if !serves_request_host(
        host,
        proto,
        handle.live.control_port(),
        Some(&|port, href: &str| handle.live.owns_document_url(port, href)),
    ) {
        return Err("Unrecognized devhost request host.");
    }
    check_cross_origin(request.method(), request.headers(), host, proto)
}

async fn json_body(
    State(handle): State<RuntimeHandle>,
    request: Request<Body>,
    next: Next,
) -> Response {
    use http_body::Body as _;
    if super::request_guard::is_state_changing_request(request.method(), request.headers())
        || request.uri().path().starts_with("/__devhost__/config/")
    {
        if let Err(error) = guard(&handle, &request) {
            return diagnostic(StatusCode::FORBIDDEN, error);
        }
        if request.body().size_hint().exact() != Some(0)
            && !super::request_guard::is_json_request(request.headers())
        {
            return diagnostic(
                StatusCode::UNSUPPORTED_MEDIA_TYPE,
                "Request bodies must be application/json.",
            );
        }
    }
    next.run(request).await
}

async fn while_chat_enabled(
    State(handle): State<RuntimeHandle>,
    request: Request<Body>,
    next: Next,
) -> Response {
    if !handle
        .live
        .manifest()
        .is_some_and(|manifest| manifest.devtools.chat.enabled)
    {
        return diagnostic(StatusCode::NOT_FOUND, "404 page not found");
    }
    next.run(request).await
}

async fn serve_assets(
    State((handle, store)): State<(RuntimeHandle, super::assets::AssetStore)>,
    request: Request<Body>,
    next: Next,
) -> Response {
    if let Err(error) = guard(&handle, &request) {
        return diagnostic(StatusCode::FORBIDDEN, error);
    }
    store.set_config_json(
        serde_json::to_vec(&super::configuration::injected_config(&handle))
            .expect("injected configuration"),
    );
    next.run(request).await
}

async fn stack_info(State(handle): State<RuntimeHandle>, request: Request<Body>) -> Response {
    let result = stack_info_response(handle, request).await;
    let mut result = result;
    result.headers_mut().insert(
        header::CACHE_CONTROL,
        header::HeaderValue::from_static(CACHE_CONTROL_NO_STORE),
    );
    result.headers_mut().insert(
        header::REFERRER_POLICY,
        header::HeaderValue::from_static("no-referrer"),
    );
    result
}

async fn stack_info_response(handle: RuntimeHandle, request: Request<Body>) -> Response {
    if !is_local_client(request.headers()) {
        return diagnostic(
            StatusCode::FORBIDDEN,
            "Stack info is available on this machine only.",
        );
    }
    if !matches!(*request.method(), Method::GET | Method::HEAD) {
        let mut response = diagnostic(StatusCode::METHOD_NOT_ALLOWED, "Method not allowed");
        response
            .headers_mut()
            .insert(header::ALLOW, header::HeaderValue::from_static("GET, HEAD"));
        return response;
    }
    let host = request
        .headers()
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    if !serves_request_host::<fn(u16, &str) -> Result<bool, String>>(host, None, 0, None) {
        return diagnostic(
            StatusCode::FORBIDDEN,
            "Stack info is available on the loopback control listener only.",
        );
    }
    let proto = if request
        .headers()
        .get("x-forwarded-proto")
        .is_some_and(|value| value == "https")
    {
        "https"
    } else {
        "http"
    };
    if request
        .headers()
        .get(header::ORIGIN)
        .is_some_and(|origin| origin != format!("{proto}://{host}").as_str())
    {
        return diagnostic(StatusCode::FORBIDDEN, "Cross-origin stack info request");
    }
    let head = request.method() == Method::HEAD;
    match tokio::task::spawn_blocking(move || handle.live.snapshot()).await {
        Ok(Ok(snapshot)) => {
            if head {
                ([(header::CONTENT_TYPE, "application/json")], "").into_response()
            } else {
                axum::Json(snapshot).into_response()
            }
        }
        Ok(Err(error)) => diagnostic(StatusCode::SERVICE_UNAVAILABLE, &error),
        Err(error) => diagnostic(StatusCode::SERVICE_UNAVAILABLE, &error.to_string()),
    }
}

pub(super) fn is_local_client(headers: &header::HeaderMap) -> bool {
    // The listener binds loopback; forwarded addresses identify proxied callers.
    headers.get_all("x-forwarded-for").iter().all(|value| {
        value.to_str().is_ok_and(|value| {
            value.split(',').all(|address| {
                let address = address.trim();
                address
                    .parse::<std::net::IpAddr>()
                    .or_else(|_| {
                        address
                            .parse::<std::net::SocketAddr>()
                            .map(|value| value.ip())
                    })
                    .is_ok_and(|address| address.is_loopback())
            })
        })
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WorktreePayload {
    #[serde(default)]
    repository_id: String,
    #[serde(default)]
    path: std::path::PathBuf,
    #[serde(default)]
    stop_owner_id: String,
}

async fn worktrees(State(handle): State<RuntimeHandle>, request: Request<Body>) -> Response {
    if let Err(error) = guard(&handle, &request) {
        return diagnostic(StatusCode::FORBIDDEN, error);
    }
    let read = request.method() == Method::GET;
    let operation = if read {
        WorktreeOperation::Refresh
    } else {
        if request.method() != Method::POST {
            let mut response = diagnostic(StatusCode::METHOD_NOT_ALLOWED, "Method not allowed");
            response
                .headers_mut()
                .insert(header::ALLOW, header::HeaderValue::from_static("GET, POST"));
            return response;
        }
        let bytes = match to_bytes(request.into_body(), 64 * 1024).await {
            Ok(bytes) => bytes,
            Err(_) => return diagnostic(StatusCode::BAD_REQUEST, "Invalid worktree payload."),
        };
        let payload = match serde_json::from_slice::<WorktreePayload>(&bytes) {
            Ok(payload)
                if !payload.repository_id.is_empty() && !payload.path.as_os_str().is_empty() =>
            {
                payload
            }
            _ => return diagnostic(StatusCode::BAD_REQUEST, "Invalid worktree payload."),
        };
        if payload.stop_owner_id.is_empty() {
            WorktreeOperation::Switch {
                repository_id: payload.repository_id,
                path: payload.path,
            }
        } else {
            WorktreeOperation::StopOwner {
                repository_id: payload.repository_id,
                path: payload.path,
                owner_id: payload.stop_owner_id,
            }
        }
    };
    handle.activity.record_activity();
    let result = match handle.worktrees(operation) {
        Ok(result) => result,
        Err(error) => return diagnostic(StatusCode::INTERNAL_SERVER_ERROR, &error),
    };
    loop {
        match result.try_recv() {
            Ok(Ok(repositories)) => {
                let value = if read {
                    let mut health = match super::streams::health_value(&handle) {
                        Ok(health) => health,
                        Err(error) => return diagnostic(StatusCode::INTERNAL_SERVER_ERROR, &error),
                    };
                    if !repositories.is_empty() {
                        health["repositories"] = serde_json::json!(repositories);
                    }
                    health
                } else {
                    serde_json::json!({"success": true})
                };
                return (
                    [(header::CACHE_CONTROL, CACHE_CONTROL_NO_STORE)],
                    axum::Json(value),
                )
                    .into_response();
            }
            Ok(Err(error)) => {
                return diagnostic(
                    if error == "Worktrees are disabled." {
                        StatusCode::NOT_IMPLEMENTED
                    } else {
                        StatusCode::INTERNAL_SERVER_ERROR
                    },
                    &error,
                );
            }
            Err(TryRecvError::Disconnected) => {
                return diagnostic(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "devhost is shutting down",
                );
            }
            Err(TryRecvError::Empty) => tokio::time::sleep(Duration::from_millis(10)).await,
        }
    }
}

pub(crate) fn recovery_worktrees(handle: RuntimeHandle, request: Request<Body>) -> Response {
    match tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    {
        Ok(runtime) => runtime.block_on(worktrees(State(handle), request)),
        Err(error) => diagnostic(StatusCode::INTERNAL_SERVER_ERROR, &error.to_string()),
    }
}

async fn restart_service(State(handle): State<RuntimeHandle>, request: Request<Body>) -> Response {
    if let Err(error) = guard(&handle, &request) {
        return diagnostic(StatusCode::FORBIDDEN, error);
    }
    if request.method() != Method::POST {
        return diagnostic(StatusCode::METHOD_NOT_ALLOWED, "Method not allowed");
    }
    let bytes = match to_bytes(request.into_body(), 1024 * 1024).await {
        Ok(bytes) => bytes,
        Err(_) => return diagnostic(StatusCode::BAD_REQUEST, "Invalid restart service payload."),
    };
    let Ok(mut payload) = serde_json::from_slice::<RestartPayload>(&bytes) else {
        return diagnostic(StatusCode::BAD_REQUEST, "Invalid restart service payload.");
    };
    if payload.service_names.is_empty() && !payload.service_name.is_empty() {
        payload.service_names.push(payload.service_name);
    }
    if payload.service_names.is_empty() {
        return diagnostic(
            StatusCode::BAD_REQUEST,
            "Invalid restart service payload: no services specified.",
        );
    }
    handle.activity.record_activity();
    let result = match handle.restart_services(payload.service_names) {
        Ok(result) => result,
        Err(error) => return diagnostic(StatusCode::INTERNAL_SERVER_ERROR, &error),
    };
    loop {
        match result.try_recv() {
            Ok(Ok(())) => {
                return (
                    [
                        (header::CONTENT_TYPE, "application/json"),
                        (header::CACHE_CONTROL, CACHE_CONTROL_NO_STORE),
                    ],
                    "{\"success\":true}\n",
                )
                    .into_response();
            }
            Ok(Err(error)) => return diagnostic(StatusCode::INTERNAL_SERVER_ERROR, &error),
            Err(TryRecvError::Disconnected) => {
                return diagnostic(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "devhost is shutting down",
                );
            }
            Err(TryRecvError::Empty) => tokio::time::sleep(Duration::from_millis(10)).await,
        }
    }
}

async fn start_service(State(handle): State<RuntimeHandle>, request: Request<Body>) -> Response {
    if let Err(error) = guard(&handle, &request) {
        return diagnostic(StatusCode::FORBIDDEN, error);
    }
    if request.method() != Method::POST {
        return diagnostic(StatusCode::METHOD_NOT_ALLOWED, "Method not allowed");
    }
    let bytes = match to_bytes(request.into_body(), 1024 * 1024).await {
        Ok(bytes) => bytes,
        Err(_) => return diagnostic(StatusCode::BAD_REQUEST, "Invalid start service payload."),
    };
    let payload = match serde_json::from_slice::<RestartPayload>(&bytes) {
        Ok(payload) if !payload.service_names.is_empty() => payload,
        _ => return diagnostic(StatusCode::BAD_REQUEST, "Invalid start service payload."),
    };
    handle.activity.record_activity();
    mutation_response(handle.start_services(payload.service_names)).await
}

async fn restart_stack(State(handle): State<RuntimeHandle>, request: Request<Body>) -> Response {
    if let Err(error) = guard(&handle, &request) {
        return diagnostic(StatusCode::FORBIDDEN, error);
    }
    if request.method() != Method::POST {
        return diagnostic(StatusCode::METHOD_NOT_ALLOWED, "Method not allowed");
    }
    handle.activity.record_activity();
    mutation_response(handle.restart_stack()).await
}

async fn mutation_response(
    result: Result<std::sync::mpsc::Receiver<Result<(), String>>, String>,
) -> Response {
    let result = match result {
        Ok(result) => result,
        Err(error) => return diagnostic(StatusCode::INTERNAL_SERVER_ERROR, &error),
    };
    loop {
        match result.try_recv() {
            Ok(Ok(())) => {
                return (
                    StatusCode::NO_CONTENT,
                    [(header::CACHE_CONTROL, CACHE_CONTROL_NO_STORE)],
                )
                    .into_response();
            }
            Ok(Err(error)) => return diagnostic(StatusCode::INTERNAL_SERVER_ERROR, &error),
            Err(TryRecvError::Disconnected) => {
                return diagnostic(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "devhost is shutting down",
                );
            }
            Err(TryRecvError::Empty) => tokio::time::sleep(Duration::from_millis(10)).await,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::control::{RuntimeControl, RuntimeRequest};
    use std::{
        io::{Read, Write},
        net::TcpStream,
        time::Instant,
    };

    fn request(port: u16, method: &str, headers: &str, body: &str) -> String {
        request_path(port, method, "/__devhost__/restart-service", headers, body)
    }

    fn request_path(port: u16, method: &str, path: &str, headers: &str, body: &str) -> String {
        let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        write!(stream, "{method} {path} HTTP/1.1\r\n{headers}Content-Type: application/json\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{body}", body.len()).unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).unwrap();
        response
    }

    #[test]
    fn worktree_requests_enforce_guards_payload_limits_and_runtime_results() {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(
            root.path().join("devhost.toml"),
            "name = 'worktrees'\n[services.web]\ncommand = ['sleep', '30']\nhealth.process = true\n",
        )
        .unwrap();
        let config = crate::manifest::read_manifest(root.path(), None).unwrap();
        let manifest = crate::services::resolve::resolve_service_ports(
            &config,
            &crate::services::resolve::PortResolutionOptions::default(),
        )
        .unwrap();
        let (handle, control) = RuntimeControl::channel();
        handle.live.initialize(&manifest);
        let server = ControlServer::start(handle).unwrap();
        let request = |method, headers, body: &str| {
            request_path(
                server.port(),
                method,
                "/__devhost__/worktrees",
                headers,
                body,
            )
        };
        for (method, headers, body, status) in [
            ("GET", "Host: attacker.test\r\n", "", 403),
            (
                "POST",
                "Host: localhost\r\nOrigin: http://attacker.test\r\n",
                "{}",
                403,
            ),
            ("DELETE", "Host: localhost\r\n", "", 405),
            ("POST", "Host: localhost\r\n", "{", 400),
            ("POST", "Host: localhost\r\n", "{}", 400),
            (
                "POST",
                "Host: localhost\r\n",
                r#"{"repositoryId":"repo","path":"/checkout","extra":true}"#,
                400,
            ),
        ] {
            let response = request(method, headers, body);
            assert!(
                response.starts_with(&format!("HTTP/1.1 {status}")),
                "{response}"
            );
            assert!(response.contains("cache-control: no-store"));
        }
        assert!(
            request("POST", "Host: localhost\r\n", &" ".repeat(64 * 1024 + 1))
                .starts_with("HTTP/1.1 400")
        );
        assert!(control.requests.try_recv().is_err());
        let consumer = thread::spawn(move || {
            for index in 0..5 {
                let RuntimeRequest::Worktrees { operation, result } = control
                    .requests
                    .recv_timeout(Duration::from_secs(5))
                    .unwrap()
                else {
                    panic!("expected worktree request")
                };
                match (index, operation) {
                    (0 | 3 | 4, WorktreeOperation::Refresh) => {}
                    (
                        1,
                        WorktreeOperation::Switch {
                            repository_id,
                            path,
                        },
                    ) => {
                        assert_eq!(repository_id, "repo");
                        assert_eq!(path, std::path::Path::new("/checkout"));
                    }
                    (
                        2,
                        WorktreeOperation::StopOwner {
                            repository_id,
                            path,
                            owner_id,
                        },
                    ) => {
                        assert_eq!(repository_id, "repo");
                        assert_eq!(path, std::path::Path::new("/checkout"));
                        assert_eq!(owner_id, "owner");
                    }
                    _ => panic!("unexpected operation"),
                }
                match index {
                    0 | 1 => result.send(Ok(Vec::new())).unwrap(),
                    2 => result.send(Err("ownership changed".to_owned())).unwrap(),
                    3 => result
                        .send(Err("Worktrees are disabled.".to_owned()))
                        .unwrap(),
                    _ => {}
                }
            }
        });
        let refresh_response = request("GET", "Host: localhost\r\n", "");
        assert!(
            refresh_response.starts_with("HTTP/1.1 200"),
            "{refresh_response}"
        );
        let refresh_body = refresh_response.split_once("\r\n\r\n").unwrap().1;
        let refresh_json: serde_json::Value = serde_json::from_str(refresh_body).unwrap();
        assert!(refresh_json["services"].is_array(), "{refresh_json}");
        assert!(refresh_json["config"].is_object(), "{refresh_json}");
        assert!(
            request(
                "POST",
                "Host: localhost\r\n",
                r#"{"repositoryId":"repo","path":"/checkout"}"#
            )
            .ends_with(r#"{"success":true}"#)
        );
        assert!(
            request(
                "POST",
                "Host: localhost\r\n",
                r#"{"repositoryId":"repo","path":"/checkout","stopOwnerId":"owner"}"#
            )
            .contains("ownership changed")
        );
        assert!(request("GET", "Host: localhost\r\n", "").starts_with("HTTP/1.1 501"));
        assert!(request("GET", "Host: localhost\r\n", "").contains("devhost is shutting down"));
        consumer.join().unwrap();
        assert!(request("GET", "Host: localhost\r\n", "").contains("devhost is shutting down"));
    }

    #[test]
    fn guards_reject_requests_before_dispatching_a_restart() {
        let (handle, control) = RuntimeControl::channel();
        let server = ControlServer::start(handle).unwrap();
        for (method, headers, body, status) in [
            ("POST", "Host: attacker.example\r\n", "{}", 403),
            (
                "POST",
                "Host: localhost\r\nOrigin: https://attacker.example\r\n",
                "{}",
                403,
            ),
            (
                "POST",
                "Host: localhost\r\nSec-Fetch-Site: cross-site\r\n",
                "{}",
                403,
            ),
            ("GET", "Host: localhost\r\n", "", 405),
            ("POST", "Host: localhost\r\n", "not json", 400),
            ("POST", "Host: localhost\r\n", "{}", 400),
        ] {
            let response = request(server.port(), method, headers, body);
            assert!(
                response.starts_with(&format!("HTTP/1.1 {status}")),
                "{response}"
            );
            assert!(response.contains("cache-control: no-store"), "{response}");
        }
        let oversized = " ".repeat(1024 * 1024 + 1);
        assert!(
            request(server.port(), "POST", "Host: 127.0.0.1\r\n", &oversized)
                .starts_with("HTTP/1.1 400")
        );
        assert!(control.requests.try_recv().is_err());
    }

    #[test]
    fn returns_runtime_results_and_accepts_both_restart_payloads() {
        let (handle, control) = RuntimeControl::channel();
        let activity = handle.activity.clone();
        let server = ControlServer::start(handle).unwrap();
        let consumer = thread::spawn(move || {
            for (expected, result) in [
                (vec!["web"], Some(Ok(()))),
                (
                    vec!["api", "worker"],
                    Some(Err("unknown service worker".to_owned())),
                ),
                (vec!["lost"], None),
            ] {
                let request = control
                    .requests
                    .recv_timeout(Duration::from_secs(5))
                    .unwrap();
                let crate::services::control::RuntimeRequest::Restart {
                    names,
                    result: response,
                } = request
                else {
                    panic!("expected restart")
                };
                assert_eq!(names, expected);
                if let Some(result) = result {
                    response.send(result).unwrap();
                }
            }
        });
        let response = request(
            server.port(),
            "POST",
            "Host: localhost\r\nOrigin: http://localhost\r\n",
            r#"{"serviceName":"web"}"#,
        );
        assert!(response.starts_with("HTTP/1.1 200"), "{response}");
        assert!(response.contains("application/json"));
        assert!(response.ends_with("{\"success\":true}\n"));
        assert!(activity.is_idle(Duration::ZERO));
        let response = request(
            server.port(),
            "POST",
            "Host: 127.0.0.1\r\nSec-Fetch-Site: same-origin\r\n",
            r#"{"serviceName":"ignored","serviceNames":["api","worker"]}"#,
        );
        assert!(response.starts_with("HTTP/1.1 500"), "{response}");
        assert!(response.contains("unknown service worker"));
        let response = request(
            server.port(),
            "POST",
            "Host: localhost\r\n",
            r#"{"serviceName":"lost"}"#,
        );
        assert!(response.contains("devhost is shutting down"));
        consumer.join().unwrap();
        let response = request(
            server.port(),
            "POST",
            "Host: localhost\r\n",
            r#"{"serviceName":"closed"}"#,
        );
        assert!(response.starts_with("HTTP/1.1 500"));
        assert!(response.contains("devhost is shutting down"));
    }

    #[test]
    fn dropping_listener_cancels_inflight_requests_without_waiting_for_runtime() {
        let (handle, control) = RuntimeControl::channel();
        let server = ControlServer::start(handle).unwrap();
        let port = server.port();
        let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
        stream.write_all(b"POST /__devhost__/restart-service HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: 21\r\n\r\n{\"serviceName\":\"web\"}").unwrap();
        let _pending = control
            .requests
            .recv_timeout(Duration::from_secs(5))
            .unwrap();
        let start = Instant::now();
        drop(server);
        assert!(start.elapsed() < Duration::from_secs(1));
        assert!(TcpStream::connect(("127.0.0.1", port)).is_err());
        stream
            .set_read_timeout(Some(Duration::from_secs(1)))
            .unwrap();
        let mut response = Vec::new();
        assert_eq!(stream.read_to_end(&mut response).unwrap(), 0);
    }
}
