use super::*;

#[test]
fn start_inherits_opaque_environment_values_and_accepts_negative_idle_timeout() {
    let fixture = tempfile::tempdir().unwrap();
    let root = fixture.path();
    let caddy = LiveCaddyGuard::start(root);
    let config = write_config(root, &caddy.settings);
    fs::write(root.join("devhost.toml"), "name='opaque'\n[devtools]\nidleTimeout='-1s'\n[services.worker]\ncommand=['sh','-c','printf %s \"$OPAQUE\" > opaque; printf %s \"$cwd\" > literal; exec sleep 30']\nhealth.process=true\n[services.worker.env]\ncwd='literal-value'\n").unwrap();
    let mut process = ServeProcess(Some(
        Command::new(env!("CARGO_BIN_EXE_devhost"))
            .arg("start")
            .current_dir(root)
            .env("AGENT", "1")
            .env("DEVHOST_CONFIG_DIR", config.parent().unwrap())
            .env("DEVHOST_STATE_DIR", root.join("state"))
            .env("OPAQUE", std::ffi::OsString::from_vec(vec![b'a', 0xff]))
            .env(std::ffi::OsString::from_vec(vec![0xff]), "opaque-key")
            .env_remove("BASH_ENV")
            .env_remove("DEVHOST_MANIFEST")
            .stdout(fs::File::create(root.join("stdout")).unwrap())
            .stderr(fs::File::create(root.join("stderr")).unwrap())
            .process_group(0)
            .spawn()
            .unwrap(),
    ));
    assert!(
        wait_until(Duration::from_secs(10), || root.join("literal").exists()),
        "{}",
        fs::read_to_string(root.join("stderr")).unwrap()
    );
    assert_eq!(fs::read(root.join("opaque")).unwrap(), [b'a', 0xff]);
    assert_eq!(
        fs::read_to_string(root.join("literal")).unwrap(),
        "literal-value"
    );
    assert_eq!(process.stop(libc::SIGINT).code(), Some(130));
}

#[test]
fn https_health_negotiates_http2_and_rejects_non_success_status() {
    use rustls_pki_types::pem::PemObject;
    let fixture = tempfile::tempdir().unwrap();
    let root = fixture.path();
    let cert = root.join("root.pem");
    let key = root.join("key.pem");
    let generated = Command::new("openssl")
        .args([
            "req",
            "-x509",
            "-newkey",
            "rsa:2048",
            "-nodes",
            "-days",
            "1",
            "-subj",
            "/CN=localhost",
            "-addext",
            "subjectAltName=IP:127.0.0.1",
            "-addext",
            "basicConstraints=critical,CA:FALSE",
            "-keyout",
        ])
        .arg(&key)
        .arg("-out")
        .arg(&cert)
        .output()
        .unwrap();
    assert!(
        generated.status.success(),
        "{}",
        String::from_utf8_lossy(&generated.stderr)
    );
    let mut tls = rustls::ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(
            vec![rustls_pki_types::CertificateDer::from_pem_file(&cert).unwrap()],
            rustls_pki_types::PrivateKeyDer::from_pem_file(&key).unwrap(),
        )
        .unwrap();
    tls.alpn_protocols = vec![b"h2".to_vec()];
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    listener.set_nonblocking(true).unwrap();
    let (shutdown, done) = tokio::sync::oneshot::channel();
    let statuses = Arc::new(Mutex::new(Vec::new()));
    let observed = statuses.clone();
    let server = thread::spawn(move || {
        tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap().block_on(async move {
            let listener = tokio::net::TcpListener::from_std(listener).unwrap();
            let acceptor = tokio_rustls::TlsAcceptor::from(Arc::new(tls));
            let mut connections = tokio::task::JoinSet::new();
            tokio::pin!(done);
            loop {
                tokio::select! {
                    _ = &mut done => break,
                    socket = listener.accept() => {
                        let (socket, _) = socket.unwrap();
                        let acceptor = acceptor.clone();
                        let observed = observed.clone();
                        connections.spawn(async move {
                            let Ok(socket) = acceptor.accept(socket).await else { return; };
                            assert_eq!(socket.get_ref().1.alpn_protocol(), Some(b"h2".as_slice()));
                            let service = hyper::service::service_fn(move |request: hyper::Request<hyper::body::Incoming>| {
                                let status = if request.uri().path() == "/ok" { 200 } else { 503 };
                                observed.lock().unwrap().push(status);
                                async move { Ok::<_, std::convert::Infallible>(hyper::Response::builder().status(status).body(http_body_util::Empty::<hyper::body::Bytes>::new()).unwrap()) }
                            });
                            let _ = hyper::server::conn::http2::Builder::new(hyper_util::rt::TokioExecutor::new()).serve_connection(hyper_util::rt::TokioIo::new(socket), service).await;
                        });
                    }
                }
            }
            connections.shutdown().await;
        });
    });
    struct Server(
        Option<tokio::sync::oneshot::Sender<()>>,
        Option<thread::JoinHandle<()>>,
    );
    impl Drop for Server {
        fn drop(&mut self) {
            let _ = self.0.take().unwrap().send(());
            self.1.take().unwrap().join().unwrap();
        }
    }
    let _server = Server(Some(shutdown), Some(server));
    let caddy = LiveCaddyGuard::start(root);
    let config = write_config(root, &caddy.settings);
    for path in ["/ok", "/unavailable"] {
        fs::write(root.join("devhost.toml"), format!("name='h2-health'\n[services.worker]\ncommand=['sleep','30']\nport='auto'\nhost='h2-health'\n[services.worker.health]\nhttp='https://127.0.0.1:{port}{path}'\ninterval=50\ntimeout=1000\nretries=1\n")).unwrap();
        let mut process = ServeProcess(Some(
            Command::new(env!("CARGO_BIN_EXE_devhost"))
                .arg("start")
                .current_dir(root)
                .env("AGENT", "1")
                .env("SSL_CERT_FILE", &cert)
                .env("SSL_CERT_DIR", root.join("empty-ca-directory"))
                .env("DEVHOST_CONFIG_DIR", config.parent().unwrap())
                .env("DEVHOST_STATE_DIR", root.join("state"))
                .env_remove("BASH_ENV")
                .env_remove("DEVHOST_MANIFEST")
                .stdout(fs::File::create(root.join("stdout")).unwrap())
                .stderr(fs::File::create(root.join("stderr")).unwrap())
                .process_group(0)
                .spawn()
                .unwrap(),
        ));
        assert!(
            wait_until(Duration::from_secs(8), || statuses
                .lock()
                .unwrap()
                .contains(&if path == "/ok" { 200 } else { 503 })),
            "{}",
            fs::read_to_string(root.join("stderr")).unwrap()
        );
        if path == "/ok" {
            assert!(
                wait_until(Duration::from_secs(5), || {
                    caddy::stacks::read_live_stacks(&caddy.caddy_dir)
                        .unwrap()
                        .iter()
                        .any(|owner| {
                            ureq::get(format!(
                                "http://127.0.0.1:{}/__devhost__/stack-info",
                                owner.control_port
                            ))
                            .call()
                            .ok()
                            .and_then(|mut response| response.body_mut().read_to_string().ok())
                            .and_then(|body| serde_json::from_str::<serde_json::Value>(&body).ok())
                            .is_some_and(|snapshot| {
                                snapshot["starting"] == false
                                    && snapshot["services"][0]["state"] == "ready"
                            })
                        })
                }),
                "{}",
                fs::read_to_string(root.join("stdout")).unwrap()
            );
            assert_eq!(process.stop(libc::SIGINT).code(), Some(130));
        } else {
            assert!(wait_until(Duration::from_secs(5), || fs::read_to_string(
                root.join("stdout")
            )
            .unwrap()
            .contains("startup health check failed")));
            assert!(
                !caddy::stacks::read_live_stacks(&caddy.caddy_dir)
                    .unwrap()
                    .iter()
                    .any(|owner| owner.ready)
            );
            assert_eq!(process.stop(libc::SIGINT).code(), Some(130));
        }
        assert!(read_live_stack_owners(&caddy.caddy_dir).unwrap().is_empty());
    }
}
