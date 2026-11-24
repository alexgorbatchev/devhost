use super::*;
use std::io::{Read, Write};

#[path = "documents/source.rs"]
mod source;

pub(super) struct Backend {
    pub(super) port: u16,
    shutdown: Option<tokio::sync::oneshot::Sender<()>>,
    thread: Option<thread::JoinHandle<()>>,
}

impl Backend {
    fn start() -> Self {
        Self::start_at("127.0.0.1")
    }

    pub(super) fn start_at(host: &str) -> Self {
        use axum::{
            Router,
            body::Body,
            http::{Request, Response},
            routing::any,
        };
        let listener = TcpListener::bind((host, 0)).unwrap();
        listener.set_nonblocking(true).unwrap();
        let port = listener.local_addr().unwrap().port();
        let (shutdown, receiver) = tokio::sync::oneshot::channel();
        let thread = thread::spawn(move || {
            let io = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .unwrap();
            io.block_on(async {
                let app = Router::new().fallback(any(|request: Request<Body>| async move {
                    if request.uri().path() == "/inspect" {
                        return Response::builder()
                            .header("Content-Type", "application/json")
                            .body(Body::from(
                                serde_json::to_vec(&json!({
                                    "host": request.headers().get("host").map(|value| value.to_str().unwrap()),
                                    "origin": request.headers().get("origin").map(|value| value.to_str().unwrap()),
                                    "forwardedHost": request.headers().get("x-forwarded-host").map(|value| value.to_str().unwrap()),
                                }))
                                .unwrap(),
                            ))
                            .unwrap();
                    }
                    let source = b"<html><body>caf\xe9</body></html>";
                    let mut response = Response::builder()
                        .header("Content-Security-Policy", "script-src 'none'")
                        .header("Content-Security-Policy-Report-Only", "script-src 'none'");
                    let bytes = match request.uri().path() {
                        "/gzip" => {
                            let mut encoder = flate2::write::GzEncoder::new(
                                Vec::new(),
                                flate2::Compression::default(),
                            );
                            encoder.write_all(source).unwrap();
                            response = response.header("Content-Encoding", "gzip");
                            encoder.finish().unwrap()
                        }
                        "/large" => {
                            let mut bytes = vec![b'a'; 64 * 1024 * 1024 + 32];
                            bytes.extend_from_slice(b"</body>");
                            bytes
                        }
                        "/plain" => b"unmodified binary \xff".to_vec(),
                        "/missing" => {
                            response = response.status(404);
                            b"upstream missing".to_vec()
                        }
                        "/error" => {
                            response = response.status(500);
                            b"upstream error".to_vec()
                        }
                        _ => source.to_vec(),
                    };
                    let content_type = if request.uri().path() == "/plain" {
                        "application/octet-stream"
                    } else {
                        "text/html; charset=iso-8859-1"
                    };
                    response
                        .header("Content-Type", content_type)
                        .body(Body::from(bytes))
                        .unwrap()
                }));
                axum::serve(tokio::net::TcpListener::from_std(listener).unwrap(), app)
                    .with_graceful_shutdown(async {
                        let _ = receiver.await;
                    })
                    .await
                    .unwrap();
            });
        });
        Self {
            port,
            shutdown: Some(shutdown),
            thread: Some(thread),
        }
    }
}

impl Drop for Backend {
    fn drop(&mut self) {
        let _ = self.shutdown.take().unwrap().send(());
        self.thread.take().unwrap().join().unwrap();
    }
}

fn client() -> ureq::Agent {
    ureq::Agent::config_builder()
        .proxy(None)
        .http_status_as_error(false)
        .max_redirects(0)
        .timeout_global(Some(Duration::from_secs(10)))
        .build()
        .into()
}

fn start(runtime: &Runtime, backend: &Backend) -> Process {
    let directory = runtime.root.path().join("external backend");
    fs::create_dir(&directory).unwrap();
    let log = File::create(directory.join("serve.log")).unwrap();
    let mut command = runtime.command();
    command
        .current_dir(&directory)
        .args([
            "serve",
            "--domain",
            "document-contract.localhost",
            "--port",
            &backend.port.to_string(),
        ])
        .env("DEVHOST_MANIFEST", "/missing-manifest.toml")
        .stdin(Stdio::null())
        .stdout(log.try_clone().unwrap())
        .stderr(log);
    // SAFETY: setsid is async-signal-safe and establishes fixture ownership.
    unsafe {
        command.pre_exec(|| {
            if libc::setsid() < 0 {
                Err(std::io::Error::last_os_error())
            } else {
                Ok(())
            }
        });
    }
    let mut process = Process(command.spawn().unwrap());
    wait_until(|| {
        read_live_stacks(&runtime.state().join("caddy"))
            .unwrap()
            .iter()
            .any(|stack| {
                stack.name == "serve-document-contract.localhost" && stack.control_port > 0
            })
    });
    super::lifecycle::ready(&super::control::origin(
        runtime,
        "serve-document-contract.localhost",
    ));
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        // Registration precedes route readiness; a reload may close this probe.
        let pending = match try_request(runtime, "/plain") {
            Ok(response) if response.status() == 200 => break,
            Ok(response) => format!("HTTP {}", response.status()),
            Err(error) => error.to_string(),
        };
        assert!(
            process.0.try_wait().unwrap().is_none() && Instant::now() < deadline,
            "document route did not become ready: {pending}\n{}",
            fs::read_to_string(directory.join("serve.log")).unwrap()
        );
        thread::sleep(Duration::from_millis(20));
    }
    process
}

fn request(runtime: &Runtime, path: &str) -> ureq::http::Response<ureq::Body> {
    try_request(runtime, path).unwrap_or_else(|error| panic!("document request {path}: {error}"))
}

fn try_request(
    runtime: &Runtime,
    path: &str,
) -> Result<ureq::http::Response<ureq::Body>, ureq::Error> {
    client()
        .get(format!(
            "http://127.0.0.1:{}{path}",
            runtime.settings.http_port
        ))
        .header("Host", "document-contract.localhost")
        .header("Sec-Fetch-Dest", "document")
        .call()
}

fn bytes(response: &mut ureq::http::Response<ureq::Body>) -> Vec<u8> {
    response
        .body_mut()
        .with_config()
        .limit(70 * 1024 * 1024)
        .read_to_vec()
        .unwrap()
}

#[test]
fn external_proxy_preserves_document_bytes_headers_recovery_and_backend_ownership() {
    let runtime = Runtime::start();
    let backend = Backend::start();
    let mut process = start(&runtime, &backend);
    let script = br#"<script type="module" src="/__devhost__/inject.js"></script>"#;
    let expected = [b"<html><body>caf\xe9".as_slice(), script, b"</body></html>"].concat();
    for path in ["/legacy", "/gzip"] {
        let mut response = request(&runtime, path);
        assert_eq!(
            response.status(),
            200,
            "{path}: {}\nserve: {}\ncaddy: {}",
            if response.status() == 200 {
                String::new()
            } else {
                response.body_mut().read_to_string().unwrap_or_default()
            },
            fs::read_to_string(runtime.root.path().join("external backend/serve.log")).unwrap(),
            fs::read_to_string(runtime.state().join("caddy/Caddyfile")).unwrap_or_default()
        );
        assert_eq!(
            response.headers()["content-type"],
            "text/html; charset=iso-8859-1"
        );
        assert!(!response.headers().contains_key("content-security-policy"));
        assert!(
            !response
                .headers()
                .contains_key("content-security-policy-report-only")
        );
        assert!(!response.headers().contains_key("content-encoding"));
        assert_eq!(
            bytes(&mut response),
            expected,
            "document bytes changed for {path}"
        );
    }
    let mut response = request(&runtime, "/large");
    assert_eq!(response.status(), 200);
    let payload = bytes(&mut response);
    assert_eq!(payload.len(), 64 * 1024 * 1024 + 32 + script.len() + 7);
    assert!(payload.ends_with(&[script.as_slice(), b"</body>"].concat()));
    let mut response = request(&runtime, "/plain");
    assert_eq!(bytes(&mut response), b"unmodified binary \xff");
    for (path, status) in [("/missing", 404), ("/error", 500)] {
        let mut response = client()
            .get(format!(
                "http://127.0.0.1:{}{path}",
                runtime.settings.http_port
            ))
            .header("Host", "document-contract.localhost")
            .header("Sec-Fetch-Dest", "document")
            .call()
            .unwrap();
        assert_eq!(response.status(), status);
        assert_eq!(response.headers()["cache-control"], "no-store");
        let page = response.body_mut().read_to_string().unwrap();
        assert!(page.contains("devhost-status-data"));
        assert!(page.contains("/__devhost__/inject.js"));
        let mut response = client()
            .get(format!(
                "http://127.0.0.1:{}{path}",
                runtime.settings.http_port
            ))
            .header("Host", "document-contract.localhost")
            .call()
            .unwrap();
        assert_eq!(response.status(), status);
        assert!(
            response
                .body_mut()
                .read_to_string()
                .unwrap()
                .contains("upstream")
        );
    }
    let output = runtime
        .command()
        .args(["stop", "--session", "serve-document-contract.localhost"])
        .output()
        .unwrap();
    assert!(output.status.success(), "{output:?}");
    wait_until(|| process.0.try_wait().unwrap().is_some());
    let mut response = client()
        .get(format!("http://127.0.0.1:{}/plain", backend.port))
        .call()
        .unwrap();
    assert_eq!(bytes(&mut response), b"unmodified binary \xff");
    assert!(
        read_live_stacks(&runtime.state().join("caddy"))
            .unwrap()
            .is_empty()
    );
}

#[test]
fn embedded_assets_obey_version_compression_condition_and_method_contracts() {
    use sha2::{Digest, Sha256};
    let runtime = Runtime::start();
    let _process = runtime.start_serve();
    wait_until(|| runtime.serve_response().is_some());
    let origin = control::origin(&runtime, "serve-restart-serve.localhost");
    assert_eq!(control::get(&origin, "pages/").status(), 404);
    let mut config = client()
        .get(format!("{origin}/__devhost__/config.json"))
        .call()
        .unwrap();
    assert_eq!(config.status(), 200);
    assert_eq!(config.headers()["cache-control"], "no-store");
    assert_eq!(config.headers()["x-content-type-options"], "nosniff");
    let etag = config.headers()["etag"].clone();
    assert!(
        serde_json::from_slice::<Value>(&bytes(&mut config))
            .unwrap()
            .is_object()
    );
    for tag in [
        etag.to_str().unwrap().to_owned(),
        format!("W/{}", etag.to_str().unwrap()),
        "*".into(),
    ] {
        let mut response = client()
            .get(format!("{origin}/__devhost__/config.json"))
            .header("If-None-Match", tag)
            .call()
            .unwrap();
        assert_eq!(response.status(), 304);
        assert!(bytes(&mut response).is_empty());
    }
    let response = client()
        .get(format!("{origin}/__devhost__/inject.js?foo=1&v="))
        .call()
        .unwrap();
    assert_eq!(
        response.status(),
        307,
        "asset discovery response: {response:?}"
    );
    assert_eq!(response.headers()["cache-control"], "no-store");
    let location = response.headers()["location"].to_str().unwrap();
    assert!(location.starts_with("/__devhost__/inject.js?foo=1&v="));
    let version = location.rsplit('=').next().unwrap();
    assert_eq!(version.len(), 64);
    let url = format!("{origin}{location}");
    let mut response = client()
        .get(&url)
        .header("Accept-Encoding", "identity")
        .call()
        .unwrap();
    assert_eq!(response.status(), 200);
    assert_eq!(
        response.headers()["cache-control"],
        "public, max-age=31536000, immutable"
    );
    let payload = bytes(&mut response);
    assert_eq!(format!("{:x}", Sha256::digest(&payload)), version);
    let mut response = client()
        .get(&url)
        .header("Accept-Encoding", "gzip")
        .call()
        .unwrap();
    assert_eq!(response.headers()["content-encoding"], "gzip");
    let mut decoded = Vec::new();
    flate2::read::GzDecoder::new(bytes(&mut response).as_slice())
        .read_to_end(&mut decoded)
        .unwrap();
    assert_eq!(decoded, payload);
    let mut response = client().head(&url).call().unwrap();
    assert_eq!(response.status(), 200);
    assert!(bytes(&mut response).is_empty());
    assert_eq!(
        client()
            .get(&url)
            .header("Accept-Encoding", "identity;q=0,gzip;q=0")
            .call()
            .unwrap()
            .status(),
        406
    );
    assert_eq!(
        client()
            .get(format!("{origin}/__devhost__/inject.js?v=wrong"))
            .call()
            .unwrap()
            .status(),
        404
    );
    assert_eq!(client().post(&url).send_empty().unwrap().status(), 405);
    assert_eq!(
        client()
            .get(format!("{origin}/__devhost__/assets/missing.js"))
            .call()
            .unwrap()
            .status(),
        404
    );
}
