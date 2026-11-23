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
    response::{IntoResponse, Response},
    routing::any,
};
use serde::Deserialize;
use tokio::sync::oneshot;

use super::{
    CACHE_CONTROL_NO_STORE,
    request_guard::{check_cross_origin, serves_request_host},
};
use crate::services::control::RuntimeHandle;

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
        let app = Router::new()
            .route("/__devhost__/restart-service", any(restart_service))
            .with_state(handle);
        let worker = thread::Builder::new()
            .name("devhost-control".to_owned())
            .spawn(move || {
                runtime.block_on(async move {
                    // Dropping serve also cancels in-flight requests; none may keep
                    // shutdown waiting for the stack loop that is itself stopping.
                    tokio::select! {
                        _ = axum::serve(listener, app).into_future() => {},
                        _ = stopped => {},
                    }
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

fn diagnostic(status: StatusCode, message: &str) -> Response {
    (
        status,
        [(header::CACHE_CONTROL, CACHE_CONTROL_NO_STORE)],
        format!("{message}\n"),
    )
        .into_response()
}

async fn restart_service(State(handle): State<RuntimeHandle>, request: Request<Body>) -> Response {
    let host = request
        .headers()
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    let proto = request
        .headers()
        .get("x-forwarded-proto")
        .and_then(|value| value.to_str().ok());
    if !serves_request_host::<fn(u16, &str) -> Result<bool, String>>(host, proto, 0, None) {
        return diagnostic(StatusCode::FORBIDDEN, "Unrecognized devhost request host.");
    }
    if let Err(error) = check_cross_origin(request.method(), request.headers(), host, proto) {
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::control::RuntimeControl;
    use std::{
        io::{Read, Write},
        net::TcpStream,
        time::Instant,
    };

    fn request(port: u16, method: &str, headers: &str, body: &str) -> String {
        let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        write!(stream, "{method} /__devhost__/restart-service HTTP/1.1\r\n{headers}Connection: close\r\nContent-Length: {}\r\n\r\n{body}", body.len()).unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).unwrap();
        response
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
                assert_eq!(request.names, expected);
                if let Some(result) = result {
                    request.result.send(result).unwrap();
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
        stream.write_all(b"POST /__devhost__/restart-service HTTP/1.1\r\nHost: localhost\r\nContent-Length: 21\r\n\r\n{\"serviceName\":\"web\"}").unwrap();
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
