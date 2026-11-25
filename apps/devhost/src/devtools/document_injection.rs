use std::{
    future::Future,
    net::{IpAddr, SocketAddr},
    pin::Pin,
    sync::{Arc, RwLock},
    thread::{self, JoinHandle},
};

use axum::{
    Router,
    body::{Body, to_bytes},
    extract::State,
    http::{HeaderMap, HeaderName, HeaderValue, Method, Request, StatusCode, Uri, Version, header},
    response::Response,
    routing::any,
};
use hyper_util::{
    client::legacy::{Client, connect::HttpConnector},
    rt::TokioExecutor,
};
use tokio::sync::oneshot;

use super::{
    CACHE_CONTROL_NO_STORE, INJECTED_SCRIPT_PATH, RECOVERY_HEADER, RecoveryState,
    recovery::{
        WorktreesHandler, no_store_error, recovery_control_guard, render_recovery_document,
        render_unavailable_document, serve_recovery_page, set_document_recovery_error,
    },
};

pub struct DocumentInjectionOptions {
    pub backend_host: String,
    pub backend_port: u16,
    pub should_inject: Option<Arc<dyn Fn() -> bool + Send + Sync>>,
    pub get_recovery: Option<Arc<dyn Fn() -> RecoveryState + Send + Sync>>,
    pub restart: Option<Arc<dyn Fn() -> Result<(), String> + Send + Sync>>,
    pub worktrees: Option<WorktreesHandler>,
}

impl DocumentInjectionOptions {
    fn inject_enabled(&self) -> bool {
        self.should_inject.as_ref().is_some_and(|f| f())
    }
}

#[derive(Clone)]
struct ProxyState {
    backend_address: Arc<RwLock<String>>,
    options: Arc<DocumentInjectionOptions>,
    client: Client<HttpConnector, Body>,
}

pub struct DocumentInjectionServer {
    port: u16,
    backend_address: Arc<RwLock<String>>,
    shutdown_tx: Option<oneshot::Sender<()>>,
    thread: Option<JoinHandle<()>>,
}

impl DocumentInjectionServer {
    pub fn start(options: DocumentInjectionOptions) -> Result<Self, String> {
        let initial_backend = format_host_port(&options.backend_host, options.backend_port);
        let backend_address = Arc::new(RwLock::new(initial_backend));

        let std_listener = std::net::TcpListener::bind("127.0.0.1:0")
            .map_err(|err| format!("start document injection listener: {err}"))?;
        std_listener
            .set_nonblocking(true)
            .map_err(|err| format!("start document injection listener: {err}"))?;
        let port = std_listener
            .local_addr()
            .map_err(|err| format!("start document injection listener: {err}"))?
            .port();

        let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
        let state = ProxyState {
            backend_address: backend_address.clone(),
            options: Arc::new(options),
            client: Client::builder(TokioExecutor::new()).build_http(),
        };

        let thread = thread::spawn(move || {
            let rt = tokio::runtime::Builder::new_multi_thread()
                .worker_threads(2)
                .enable_all()
                .build()
                .expect("tokio runtime");
            rt.block_on(async move {
                let listener =
                    tokio::net::TcpListener::from_std(std_listener).expect("tokio listener");
                let app = Router::new()
                    .route("/", any(handle_proxy))
                    .route("/{*rest}", any(handle_proxy))
                    .with_state(state);
                let server = axum::serve(listener, app).into_future();
                tokio::pin!(server);
                tokio::select! {
                    _ = &mut server => {},
                    _ = shutdown_rx => {},
                }
            });
        });

        Ok(Self {
            port,
            backend_address,
            shutdown_tx: Some(shutdown_tx),
            thread: Some(thread),
        })
    }

    pub fn set_backend(&self, host: &str, port: u16) {
        *self.backend_address.write().expect("backend write lock") = format_host_port(host, port);
    }

    pub fn port(&self) -> u16 {
        self.port
    }

    pub fn stop(&mut self) {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }
        if let Some(handle) = self.thread.take() {
            let _ = handle.join();
        }
    }
}

impl Drop for DocumentInjectionServer {
    fn drop(&mut self) {
        self.stop();
    }
}

async fn handle_proxy(State(state): State<ProxyState>, req: Request<Body>) -> Response {
    if let Some(ref get_recovery) = state.options.get_recovery {
        let has_recovery_action = req
            .headers()
            .get(RECOVERY_HEADER)
            .and_then(|v| v.to_str().ok())
            .is_some_and(|v| !v.is_empty());
        if has_recovery_action {
            return handle_recovery_control(&state, get_recovery, req).await;
        }
        let recovery_state = read_recovery(get_recovery).await;
        if recovery_state.phase != "ready" {
            return serve_recovery_page(
                req.method(),
                req.headers(),
                &recovery_state,
                StatusCode::SERVICE_UNAVAILABLE,
                state.options.inject_enabled(),
            );
        }
    }
    proxy_request(&state, req).await
}

async fn handle_recovery_control(
    state: &ProxyState,
    get_recovery: &Arc<dyn Fn() -> RecoveryState + Send + Sync>,
    req: Request<Body>,
) -> Response {
    let action = match recovery_control_guard(req.method(), req.headers()) {
        Ok(Some(action)) => action,
        Ok(None) => return no_store_error(StatusCode::BAD_REQUEST, "Unknown recovery action"),
        Err(err) => return no_store_error(StatusCode::FORBIDDEN, err),
    };
    match action.as_str() {
        "worktrees" => match state.options.worktrees {
            Some(ref handler) => {
                let handler = handler.clone();
                tokio::task::spawn_blocking(move || handler(req))
                    .await
                    .unwrap_or_else(|error| {
                        no_store_error(StatusCode::INTERNAL_SERVER_ERROR, &error.to_string())
                    })
            }
            None => no_store_error(StatusCode::NOT_IMPLEMENTED, "Worktrees are not enabled."),
        },
        "status" | "probe" => {
            if *req.method() != Method::GET {
                let mut resp =
                    no_store_error(StatusCode::METHOD_NOT_ALLOWED, "Use GET for service status");
                resp.headers_mut()
                    .insert(header::ALLOW, HeaderValue::from_static("GET"));
                return resp;
            }
            let recovery_state = read_recovery(get_recovery).await;
            if action == "probe" {
                if recovery_state.phase != "ready" {
                    return serve_recovery_page(
                        req.method(),
                        req.headers(),
                        &recovery_state,
                        StatusCode::SERVICE_UNAVAILABLE,
                        state.options.inject_enabled(),
                    );
                }
                return proxy_request(state, req).await;
            }
            let json = serde_json::to_vec(&recovery_state).expect("serialize recovery status");
            Response::builder()
                .status(StatusCode::OK)
                .header(header::CACHE_CONTROL, CACHE_CONTROL_NO_STORE)
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(json))
                .expect("status response")
        }
        "restart" => {
            if *req.method() != Method::POST {
                let mut resp =
                    no_store_error(StatusCode::METHOD_NOT_ALLOWED, "Use POST to restart");
                resp.headers_mut()
                    .insert(header::ALLOW, HeaderValue::from_static("POST"));
                return resp;
            }
            let Some(ref restart) = state.options.restart else {
                return no_store_error(
                    StatusCode::CONFLICT,
                    "Service cannot be restarted right now",
                );
            };
            if !read_recovery(get_recovery).await.can_restart {
                return no_store_error(
                    StatusCode::CONFLICT,
                    "Service cannot be restarted right now",
                );
            }
            let restart = restart.clone();
            match tokio::task::spawn_blocking(move || restart()).await {
                Ok(Ok(())) => Response::builder()
                    .status(StatusCode::NO_CONTENT)
                    .header(header::CACHE_CONTROL, CACHE_CONTROL_NO_STORE)
                    .body(Body::empty())
                    .expect("no content"),
                Ok(Err(err)) => no_store_error(StatusCode::SERVICE_UNAVAILABLE, &err),
                Err(err) => no_store_error(StatusCode::SERVICE_UNAVAILABLE, &err.to_string()),
            }
        }
        _ => no_store_error(StatusCode::BAD_REQUEST, "Unknown recovery action"),
    }
}

async fn read_recovery(reader: &Arc<dyn Fn() -> RecoveryState + Send + Sync>) -> RecoveryState {
    let reader = reader.clone();
    tokio::task::spawn_blocking(move || reader())
        .await
        .expect("recovery reader")
}

fn proxy_request<'a>(
    state: &'a ProxyState,
    req: Request<Body>,
) -> Pin<Box<dyn Future<Output = Response> + Send + 'a>> {
    Box::pin(async move {
        let method = req.method().clone();
        let req_headers = req.headers().clone();
        let sec_fetch_dest = req_headers
            .get("sec-fetch-dest")
            .and_then(|v| v.to_str().ok())
            .unwrap_or_default()
            .to_owned();
        let recovery_action = req_headers
            .get(RECOVERY_HEADER)
            .and_then(|v| v.to_str().ok())
            .unwrap_or_default()
            .to_owned();
        let request_host = req_headers
            .get(header::HOST)
            .and_then(|v| v.to_str().ok())
            .unwrap_or_default()
            .to_owned();

        let backend = state
            .backend_address
            .read()
            .expect("backend read lock")
            .clone();
        let path_and_query = req
            .uri()
            .path_and_query()
            .map(|pq| pq.as_str())
            .unwrap_or("/");
        let target_uri: Uri = match format!("http://{backend}{path_and_query}").parse() {
            Ok(uri) => uri,
            Err(err) => {
                return proxy_error_response(state, &method, &req_headers, &err.to_string()).await;
            }
        };

        let (mut parts, body) = req.into_parts();
        parts.uri = target_uri;
        parts.version = Version::HTTP_11;
        parts.headers.remove(header::ACCEPT_ENCODING);
        parts.headers.remove(header::HOST);
        parts
            .headers
            .insert("x-devhost-injected", HeaderValue::from_static("true"));
        if let Ok(val) = HeaderValue::from_str(&request_host) {
            parts.headers.insert("x-forwarded-host", val);
        }
        parts
            .headers
            .insert("x-forwarded-proto", HeaderValue::from_static("https"));
        let upstream_req = Request::from_parts(parts, body);

        let upstream_resp = match state.client.request(upstream_req).await {
            Ok(resp) => resp,
            Err(err) => {
                return proxy_error_response(state, &method, &req_headers, &err.to_string()).await;
            }
        };

        let status = upstream_resp.status();
        if let Some(ref get_recovery) = state.options.get_recovery
            && (status == StatusCode::NOT_FOUND || status.is_server_error())
            && (sec_fetch_dest == "document" || recovery_action == "probe")
        {
            let mut rec = read_recovery(get_recovery).await;
            set_document_recovery_error(&mut rec, status.as_u16());
            let Ok(document) =
                render_recovery_document(&rec, status.as_u16(), state.options.inject_enabled())
            else {
                return no_store_error(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Unable to render service status",
                );
            };
            let body = if method == Method::HEAD {
                Body::empty()
            } else {
                Body::from(document)
            };
            return Response::builder()
                .status(status)
                .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
                .header(header::CACHE_CONTROL, CACHE_CONTROL_NO_STORE)
                .body(body)
                .expect("recovery doc response");
        }

        if state.options.get_recovery.is_some() && recovery_action == "probe" {
            return Response::builder()
                .status(StatusCode::NO_CONTENT)
                .header(header::CACHE_CONTROL, CACHE_CONTROL_NO_STORE)
                .body(Body::empty())
                .expect("probe 204 response");
        }

        let is_html = upstream_resp
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .is_some_and(|ct| ct.contains("text/html"));

        let (mut resp_parts, resp_body) = upstream_resp.into_parts();
        if !state.options.inject_enabled() || !is_html {
            return Response::from_parts(resp_parts, Body::new(resp_body));
        }
        let encoding = resp_parts
            .headers
            .get(header::CONTENT_ENCODING)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("identity")
            .trim()
            .to_ascii_lowercase();
        if !matches!(
            encoding.as_str(),
            "identity" | "gzip" | "x-gzip" | "deflate"
        ) {
            return Response::from_parts(resp_parts, Body::new(resp_body));
        }
        let Ok(bytes) = to_bytes(Body::new(resp_body), usize::MAX).await else {
            return no_store_error(StatusCode::BAD_GATEWAY, "Failed reading upstream HTML body");
        };
        let rewritten =
            tokio::task::spawn_blocking(move || rewrite_document(&bytes, &encoding)).await;
        let Ok(Ok(rewritten)) = rewritten else {
            return no_store_error(
                StatusCode::BAD_GATEWAY,
                "Failed decoding upstream HTML body",
            );
        };
        resp_parts
            .headers
            .remove(HeaderName::from_static("content-security-policy"));
        resp_parts.headers.remove(HeaderName::from_static(
            "content-security-policy-report-only",
        ));
        resp_parts.headers.remove(header::CONTENT_LENGTH);
        resp_parts.headers.remove(header::ETAG);
        resp_parts.headers.remove(header::CONTENT_ENCODING);
        Response::from_parts(resp_parts, Body::from(rewritten))
    })
}

async fn proxy_error_response(
    state: &ProxyState,
    method: &Method,
    headers: &HeaderMap,
    err: &str,
) -> Response {
    if let Some(ref get_recovery) = state.options.get_recovery {
        let mut rec = read_recovery(get_recovery).await;
        rec.phase = "unavailable".to_owned();
        rec.title = format!("{} could not load", rec.service);
        rec.message = format!("The service could not return a document: {err}");
        return serve_recovery_page(
            method,
            headers,
            &rec,
            StatusCode::BAD_GATEWAY,
            state.options.inject_enabled(),
        );
    }
    let Ok(document) = render_unavailable_document() else {
        return no_store_error(StatusCode::BAD_GATEWAY, "Unable to render service status");
    };
    let injected = inject_devtools_script(&document);
    Response::builder()
        .status(StatusCode::BAD_GATEWAY)
        .header(header::CACHE_CONTROL, CACHE_CONTROL_NO_STORE)
        .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
        .body(Body::from(injected))
        .expect("unavailable response")
}

fn rewrite_document(bytes: &[u8], encoding: &str) -> std::io::Result<Vec<u8>> {
    use std::io::Read;
    let mut decoded = Vec::new();
    match encoding {
        "gzip" | "x-gzip" => {
            flate2::read::MultiGzDecoder::new(bytes).read_to_end(&mut decoded)?;
        }
        "deflate" => {
            flate2::read::ZlibDecoder::new(bytes).read_to_end(&mut decoded)?;
        }
        _ => return Ok(inject_script_bytes(bytes)),
    }
    Ok(inject_script_bytes(&decoded))
}

fn inject_script_bytes(document: &[u8]) -> Vec<u8> {
    let injected_tag = format!(r#"<script type="module" src="{INJECTED_SCRIPT_PATH}"></script>"#);
    let index = document
        .windows(7)
        .rposition(|window| window.eq_ignore_ascii_case(b"</body>"))
        .unwrap_or(document.len());
    let mut rewritten = Vec::with_capacity(document.len() + injected_tag.len());
    rewritten.extend_from_slice(&document[..index]);
    rewritten.extend_from_slice(injected_tag.as_bytes());
    rewritten.extend_from_slice(&document[index..]);
    rewritten
}

pub fn inject_devtools_script(document: &str) -> String {
    // Both the source string and the ASCII tag are valid UTF-8.
    String::from_utf8(inject_script_bytes(document.as_bytes())).expect("injection preserves UTF-8")
}

fn format_host_port(host: &str, port: u16) -> String {
    if let Ok(ip) = host.parse::<IpAddr>() {
        return SocketAddr::new(ip, port).to_string();
    }
    if host.contains(':') && !host.starts_with('[') {
        format!("[{host}]:{port}")
    } else {
        format!("{host}:{port}")
    }
}
