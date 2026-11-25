use super::*;
use cli_command_kit::Mode;
use devhost::{caddy, config::CaddySettings, procid};
use std::{net::TcpStream, os::unix::fs::PermissionsExt, path::Path};

struct Machine {
    root: tempfile::TempDir,
    caddy: CaddySettings,
}

impl Machine {
    fn new(relay: &Relay) -> Self {
        Self::with_http(relay, true)
    }

    fn with_http(relay: &Relay, http_enabled: bool) -> Self {
        let root = tempfile::tempdir().unwrap();
        fs::create_dir(root.path().join("config")).unwrap();
        let credentials = root.path().join("credentials");
        fs::write(&credentials, AUTH).unwrap();
        fs::set_permissions(&credentials, fs::Permissions::from_mode(0o600)).unwrap();
        let caddy = CaddySettings {
            admin_address: format!("127.0.0.1:{}", free_port()),
            bind_host: "127.0.0.1".to_owned(),
            http_enabled,
            http_port: free_port(),
            https_port: free_port(),
            stack_directory_host: String::new(),
            stack_directory_allow_remote: false,
        };
        fs::write(root.path().join("config/config.toml"), format!(
            "[caddy]\nadminAddress = {:?}\nbindHost = '127.0.0.1'\nhttp = {}\nhttpPort = {}\nhttpsPort = {}\n[remote]\nserverURL = {:?}\ncredentialFile = {:?}\nfingerprint = {:?}\nremotePort = {}\ndomainSuffix = '.preview.example.test'\n",
            caddy.admin_address, caddy.http_enabled, caddy.http_port, caddy.https_port, relay.url(), credentials, relay.fingerprint, relay.reverse_port,
        )).unwrap();
        let machine = Self { root, caddy };
        let mut startup = Vec::new();
        caddy::start_in_directory(
            &machine.root.path().join("state/caddy"),
            &machine.caddy,
            Mode::Agent,
            &mut startup,
            true,
        )
        .unwrap_or_else(|error| {
            panic!(
                "{error:?}\n{}\n{}",
                String::from_utf8_lossy(&startup),
                fs::read_to_string(machine.root.path().join("state/caddy/caddy.stderr.log"))
                    .unwrap_or_default()
            )
        });
        machine
    }

    fn start(&self, name: &str, local: bool) -> Stack {
        let mut stack = self.spawn(name, local);
        wait(|| {
            assert!(
                stack.child.try_wait().unwrap().is_none(),
                "{}",
                stack.logs()
            );
            stack.logs().contains("files (primary):")
        });
        stack
    }

    fn spawn(&self, name: &str, local: bool) -> Stack {
        self.spawn_with_args(name, if local { &["--local"] } else { &[] })
    }

    fn spawn_with_args(&self, name: &str, args: &[&str]) -> Stack {
        let project = self.root.path().join(name);
        fs::create_dir_all(project.join("public")).unwrap();
        fs::write(project.join("public/note.txt"), format!("{name} content")).unwrap();
        write_manifest(&project, name, name);
        let stdout = fs::File::create(project.join("stdout.log")).unwrap();
        let stderr = fs::File::create(project.join("stderr.log")).unwrap();
        let child = self
            .command(&project)
            .arg("start")
            .args(args)
            .stdin(Stdio::null())
            .stdout(stdout)
            .stderr(stderr)
            .process_group(0)
            .spawn()
            .unwrap();
        Stack { child, project }
    }

    fn command(&self, project: &Path) -> Command {
        let binary = std::env::var_os("DEVHOST_REMOTE_TEST_BINARY")
            .unwrap_or_else(|| env!("CARGO_BIN_EXE_devhost").into());
        let mut command = Command::new(binary);
        command
            .current_dir(project)
            .env("AGENT", "1")
            .env("HOME", self.root.path().join("home"))
            .env("DEVHOST_CONFIG_DIR", self.root.path().join("config"))
            .env("DEVHOST_STATE_DIR", self.root.path().join("state"))
            .env_remove("DEVHOST_MANIFEST")
            .env_remove("BASH_ENV");
        command
    }

    fn worker(&self) -> serde_json::Value {
        serde_json::from_slice(
            &fs::read(self.root.path().join("state/remote/worker.json")).unwrap(),
        )
        .unwrap()
    }

    fn wait_stopped(&self) {
        wait(|| !self.root.path().join("state/remote/worker.json").exists());
        assert_eq!(
            fs::read_dir(self.root.path().join("state/remote/leases"))
                .unwrap()
                .count(),
            0
        );
    }
}

impl Drop for Machine {
    fn drop(&mut self) {
        // Detached supervisors outlive their launching CLI, including when an
        // assertion fails before the explicit stop command.
        let dir = self.root.path().join("state/caddy");
        if let Ok(owners) = caddy::stacks::read_live_stack_owners(&dir) {
            for owner in owners {
                let _ = devhost::services::stop::stop_stack(
                    &devhost::services::stop::StopStackOptions {
                        manifest_path: owner.manifest_path.into(),
                        worktrees: false,
                        grace_period: Some(Duration::from_secs(2)),
                    },
                    &dir,
                    &devhost::cliout::ServiceOutput::new(
                        Mode::Agent,
                        Box::new(std::io::sink()),
                        Box::new(std::io::sink()),
                        &[],
                    ),
                );
            }
        }
        // Cleanup also covers assertions while a stack is starting. Only the
        // connector recorded under this unique fixture directory is ours.
        if let Ok(bytes) = fs::read(self.root.path().join("state/remote/worker.json"))
            && let Ok(record) = serde_json::from_slice::<serde_json::Value>(&bytes)
            && let (Some(pid), Some(identity)) = (
                record["owner"]["pid"].as_i64(),
                record["owner"]["startIdentity"].as_str(),
            )
        {
            let pid = pid as i32;
            if procid::is_record_owner_alive(pid, identity) {
                // SAFETY: identity verification bounds the signal to this fixture's worker.
                unsafe {
                    libc::kill(-pid, libc::SIGTERM);
                }
                let deadline = Instant::now() + Duration::from_secs(5);
                while procid::is_record_owner_alive(pid, identity) && Instant::now() < deadline {
                    std::thread::sleep(Duration::from_millis(10));
                }
                if procid::is_record_owner_alive(pid, identity) {
                    unsafe {
                        libc::kill(-pid, libc::SIGKILL);
                    }
                }
            }
        }
        let _ = caddy::stop_in_directory(
            &self.root.path().join("state/caddy"),
            &self.caddy,
            Mode::Agent,
            &mut Vec::new(),
        );
    }
}

struct Stack {
    child: Child,
    project: PathBuf,
}
impl Stack {
    fn pause_for_backend_override(&mut self) {
        assert!(self.child.try_wait().unwrap().is_none(), "{}", self.logs());
        let pid = self.child.id() as i32;
        // Fault injection owns the lease until stop resumes the supervisor.
        // Otherwise its initial config reconciliation can restore the real backend.
        // SAFETY: this is the owned, unreaped child; only that supervisor is paused.
        assert_eq!(unsafe { libc::kill(pid, libc::SIGSTOP) }, 0);
        wait(|| {
            let mut status = 0;
            // SAFETY: status is writable and pid names the owned child.
            let result =
                unsafe { libc::waitpid(pid, &mut status, libc::WUNTRACED | libc::WNOHANG) };
            assert!(
                result >= 0,
                "wait for supervisor pause: {}",
                std::io::Error::last_os_error()
            );
            if result == 0 {
                return false;
            }
            assert!(
                libc::WIFSTOPPED(status),
                "supervisor exited before fault injection: {}",
                self.logs()
            );
            true
        });
    }

    fn logs(&self) -> String {
        format!(
            "{}\n{}",
            fs::read_to_string(self.project.join("stdout.log")).unwrap_or_default(),
            fs::read_to_string(self.project.join("stderr.log")).unwrap_or_default()
        )
    }
    fn stop(&mut self) {
        if self.child.try_wait().unwrap().is_some() {
            return;
        }
        // SAFETY: the child is an owned, unreaped process-group leader.
        unsafe {
            libc::kill(self.child.id() as i32, libc::SIGCONT);
            libc::kill(-(self.child.id() as i32), libc::SIGTERM);
        }
        let deadline = Instant::now() + Duration::from_secs(7);
        while self.child.try_wait().unwrap().is_none() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(10));
        }
        if self.child.try_wait().unwrap().is_none() {
            unsafe {
                libc::kill(-(self.child.id() as i32), libc::SIGKILL);
            }
        }
        let _ = self.child.wait();
    }
}
impl Drop for Stack {
    fn drop(&mut self) {
        self.stop();
    }
}

fn write_manifest(project: &Path, name: &str, host: &str) {
    fs::write(
        project.join("devhost.toml"),
        format!("name = '{name}'\n[services.files]\nserve = 'public'\nhost = '{host}'\n"),
    )
    .unwrap();
}

fn wait(mut condition: impl FnMut() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(15);
    while !condition() {
        assert!(Instant::now() < deadline, "condition did not become ready");
        std::thread::sleep(Duration::from_millis(20));
    }
}

fn request(port: u16, method: &str, host: &str, path: &str) -> String {
    request_headers(port, method, host, path, "")
}

fn request_headers(port: u16, method: &str, host: &str, path: &str, headers: &str) -> String {
    let Ok(mut stream) = TcpStream::connect_timeout(
        &SocketAddr::from(([127, 0, 0, 1], port)),
        Duration::from_millis(200),
    ) else {
        return String::new();
    };
    stream
        .set_read_timeout(Some(Duration::from_secs(2)))
        .unwrap();
    stream
        .set_write_timeout(Some(Duration::from_secs(2)))
        .unwrap();
    if write!(stream, "{method} {path} HTTP/1.1\r\nHost: {host}\r\nContent-Length: 0\r\nConnection: close\r\n{headers}\r\n").is_err() {return String::new();}
    let mut response = String::new();
    let _ = stream.read_to_string(&mut response);
    response
}

fn tls_request(machine: &Machine, host: &str) -> std::io::Result<String> {
    use rustls::pki_types::{CertificateDer, ServerName, pem::PemObject};
    let pem = fs::read(
        machine
            .root
            .path()
            .join("state/caddy/storage/pki/authorities/local/root.crt"),
    )?;
    let mut roots = rustls::RootCertStore::empty();
    for certificate in CertificateDer::pem_slice_iter(&pem) {
        roots.add(certificate.unwrap()).unwrap();
    }
    let config = rustls::ClientConfig::builder_with_provider(std::sync::Arc::new(
        rustls::crypto::ring::default_provider(),
    ))
    .with_protocol_versions(&[&rustls::version::TLS13, &rustls::version::TLS12])
    .unwrap()
    .with_root_certificates(roots)
    .with_no_client_auth();
    let connection = rustls::ClientConnection::new(
        std::sync::Arc::new(config),
        ServerName::try_from(host.to_owned()).unwrap(),
    )
    .unwrap();
    let socket = TcpStream::connect(("127.0.0.1", machine.caddy.https_port))?;
    socket.set_read_timeout(Some(Duration::from_secs(2)))?;
    socket.set_write_timeout(Some(Duration::from_secs(2)))?;
    let mut stream = rustls::StreamOwned::new(connection, socket);
    write!(
        stream,
        "GET /note.txt HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n"
    )?;
    let mut response = String::new();
    // Caddy may close TCP without TLS close_notify after a complete response.
    match stream.read_to_string(&mut response) {
        Err(error) if response.is_empty() => Err(error),
        _ => Ok(response),
    }
}

#[test]
fn saturated_preview_connections_leave_readiness_and_new_leases_available() {
    let relay = Relay::start();
    let machine = Machine::new(&relay);
    let mut alpha = machine.start("capacity-alpha", false);
    let worker = machine.worker();
    // The startup URL can be logged before the relay's first backend route is ready.
    wait(|| {
        request(
            relay.reverse_port,
            "GET",
            "capacity-alpha.preview.example.test",
            "/note.txt",
        )
        .starts_with("HTTP/1.1 200")
    });
    let mut connections = Vec::new();
    for _ in 0..128 {
        let mut socket = TcpStream::connect(("127.0.0.1", relay.reverse_port)).unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(3)))
            .unwrap();
        socket
            .set_write_timeout(Some(Duration::from_secs(3)))
            .unwrap();
        write!(socket, "GET /note.txt HTTP/1.1\r\nHost: capacity-alpha.preview.example.test\r\nConnection: keep-alive\r\n\r\n").unwrap();
        let mut response = Vec::new();
        let mut byte = [0];
        while !response.ends_with(b"\r\n\r\n") {
            socket.read_exact(&mut byte).unwrap();
            response.push(byte[0]);
        }
        assert!(
            response.starts_with(b"HTTP/1.1 200"),
            "preview response with {} held connections: {}\n{}",
            connections.len(),
            String::from_utf8_lossy(&response),
            alpha.logs()
        );
        let mut body = vec![0; "capacity-alpha content".len()];
        socket.read_exact(&mut body).unwrap();
        assert_eq!(body, b"capacity-alpha content");
        connections.push(socket);
    }
    let admin: SocketAddr = worker["adminAddress"].as_str().unwrap().parse().unwrap();
    let started = Instant::now();
    assert!(request(admin.port(), "GET", &admin.to_string(), "/ready").starts_with("HTTP/1.1 200"));
    let mut beta = machine.start("capacity-beta", false);
    assert_eq!(machine.worker()["owner"], worker["owner"]);
    assert!(started.elapsed() < Duration::from_secs(5));
    drop(connections);
    beta.stop();
    alpha.stop();
    machine.wait_stopped();
}

#[test]
fn cli_stacks_share_connector_reload_hosts_and_withdraw_only_owned_routes() {
    let relay = Relay::start();
    let machine = Machine::new(&relay);
    let mut alpha = machine.start("alpha", false);
    let worker = machine.worker();
    wait(|| {
        request(
            relay.reverse_port,
            "GET",
            "alpha.preview.example.test",
            "/note.txt",
        )
        .contains("alpha content")
    });
    wait(
        || match tls_request(&machine, "alpha.preview.example.test") {
            Ok(response) => response.contains("alpha content"),
            Err(error) => {
                eprintln!("configured certificate not ready: {error}");
                false
            }
        },
    );
    assert!(
        tls_request(&machine, "unknown.preview.example.test").is_err(),
        "unknown SNI received a certificate"
    );
    assert!(
        alpha
            .logs()
            .contains("https://alpha.preview.example.test\n"),
        "{}",
        alpha.logs()
    );
    for host in [
        "unknown.preview.example.test",
        "alpha.preview.example.test:444",
    ] {
        assert!(request(relay.reverse_port, "GET", host, "/note.txt").starts_with("HTTP/1.1 404"));
    }
    assert!(
        request(
            relay.reverse_port,
            "GET",
            "ALPHA.preview.example.test:443",
            "/note.txt"
        )
        .contains("alpha content")
    );
    for path in [
        "/__devhost__/config",
        "/__devhost__/%63onfig/write",
        "/a/../__devhost__/config/write",
        "/__devhost__%2fconfig/write",
    ] {
        let response = request(
            relay.reverse_port,
            "POST",
            "alpha.preview.example.test",
            path,
        );
        assert!(response.starts_with("HTTP/1.1 403"), "{path}: {response}");
    }
    let mut beta = machine.start("beta", false);
    assert_eq!(worker["owner"], machine.worker()["owner"]);
    wait(|| {
        request(
            relay.reverse_port,
            "GET",
            "beta.preview.example.test",
            "/note.txt",
        )
        .contains("beta content")
    });
    write_manifest(&alpha.project, "alpha", "gamma");
    wait(|| {
        request(
            relay.reverse_port,
            "GET",
            "gamma.preview.example.test",
            "/note.txt",
        )
        .contains("alpha content")
    });
    assert!(
        request(
            relay.reverse_port,
            "GET",
            "alpha.preview.example.test",
            "/note.txt"
        )
        .starts_with("HTTP/1.1 404")
    );
    write_manifest(&alpha.project, "alpha", "beta");
    wait(|| alpha.logs().contains("configuration reload rejected"));
    assert!(
        request(
            relay.reverse_port,
            "GET",
            "gamma.preview.example.test",
            "/note.txt"
        )
        .contains("alpha content")
    );
    assert!(
        request(
            relay.reverse_port,
            "GET",
            "beta.preview.example.test",
            "/note.txt"
        )
        .contains("beta content")
    );
    alpha.stop();
    assert!(
        request(
            relay.reverse_port,
            "GET",
            "gamma.preview.example.test",
            "/note.txt"
        )
        .starts_with("HTTP/1.1 404")
    );
    assert!(
        request(
            relay.reverse_port,
            "GET",
            "beta.preview.example.test",
            "/note.txt"
        )
        .contains("beta content")
    );
    beta.stop();
    machine.wait_stopped();
    let mut local = machine.start("local", true);
    assert!(
        local.logs().contains(&format!(
            "https://local.localhost:{}\n",
            machine.caddy.https_port
        )),
        "{}",
        local.logs()
    );
    assert!(
        !machine
            .root
            .path()
            .join("state/remote/worker.json")
            .exists()
    );
    assert!(
        request(
            machine.caddy.http_port,
            "GET",
            "local.localhost",
            "/note.txt"
        )
        .contains("local content")
    );
    local.stop();
}

#[test]
fn disconnected_relay_does_not_block_local_reload_and_reconnect_uses_new_hosts() {
    let mut relay = Relay::start();
    let machine = Machine::new(&relay);
    let mut stack = machine.start("reconnect", false);
    let owner = machine.worker()["owner"].clone();
    wait(|| {
        request(
            relay.reverse_port,
            "GET",
            "reconnect.preview.example.test",
            "/note.txt",
        )
        .contains("reconnect content")
    });
    relay.stop();
    let start = Instant::now();
    write_manifest(&stack.project, "reconnect", "offline-reload");
    wait(|| stack.logs().contains("configuration reloaded"));
    assert!(
        start.elapsed() < Duration::from_secs(2),
        "offline reload waited for relay: {}",
        stack.logs()
    );
    relay.restart();
    wait(|| {
        request(
            relay.reverse_port,
            "GET",
            "offline-reload.preview.example.test",
            "/note.txt",
        )
        .contains("reconnect content")
    });
    assert_eq!(owner, machine.worker()["owner"]);
    assert!(
        request(
            relay.reverse_port,
            "GET",
            "reconnect.preview.example.test",
            "/note.txt"
        )
        .starts_with("HTTP/1.1 404")
    );
    stack.stop();
    machine.wait_stopped();
}

#[test]
fn canceled_first_enrollment_withdraws_lease_and_connector() {
    let relay = Relay::start();
    let machine = Machine::new(&relay);
    let path = machine.root.path().join("config/config.toml");
    let config = fs::read_to_string(&path).unwrap().replace(
        &relay.fingerprint,
        "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    );
    fs::write(path, config).unwrap();
    let mut stack = machine.spawn("rejected", false);
    wait(|| {
        let log = fs::read_to_string(machine.root.path().join("state/remote/connector.log"))
            .unwrap_or_default()
            .to_ascii_lowercase();
        log.contains("remote fingerprint mismatch") || log.contains("invalid fingerprint (")
    });
    stack.stop();
    machine.wait_stopped();
    assert!(
        !request(
            machine.caddy.http_port,
            "GET",
            "rejected.preview.example.test",
            "/note.txt"
        )
        .contains("rejected content")
    );
}

struct EchoBackend {
    address: SocketAddr,
    stop: Option<oneshot::Sender<()>>,
    thread: Option<std::thread::JoinHandle<()>>,
}

impl EchoBackend {
    fn start() -> Self {
        let (address_tx, address_rx) = std::sync::mpsc::channel();
        let (stop, stopped) = oneshot::channel();
        let thread = std::thread::spawn(move || {
            let runtime = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .unwrap();
            runtime.block_on(async move {
                let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
                address_tx.send(listener.local_addr().unwrap()).unwrap();
                let app = axum::Router::new()
                    .route(
                        "/upload",
                        axum::routing::post(|body: axum::body::Bytes| async move {
                            format!("received {} bytes", body.len())
                        }),
                    )
                    .route(
                        "/echo",
                        axum::routing::any(|headers: http::HeaderMap| async move {
                            let values: std::collections::BTreeMap<_, _> = headers
                                .iter()
                                .map(|(name, value)| {
                                    (name.as_str().to_owned(), value.to_str().unwrap().to_owned())
                                })
                                .collect();
                            axum::Json(values)
                        }),
                    )
                    .route(
                        "/ws",
                        axum::routing::get(|ws: axum::extract::WebSocketUpgrade| async move {
                            ws.on_upgrade(|mut socket| async move {
                                while let Some(Ok(message)) = socket.recv().await {
                                    if matches!(message, axum::extract::ws::Message::Close(_)) {
                                        break;
                                    }
                                    if socket.send(message).await.is_err() {
                                        break;
                                    }
                                }
                            })
                        }),
                    );
                axum::serve(listener, app)
                    .with_graceful_shutdown(async {
                        let _ = stopped.await;
                    })
                    .await
                    .unwrap();
            });
        });
        Self {
            address: address_rx.recv_timeout(Duration::from_secs(5)).unwrap(),
            stop: Some(stop),
            thread: Some(thread),
        }
    }
}
impl Drop for EchoBackend {
    fn drop(&mut self) {
        if let Some(stop) = self.stop.take() {
            let _ = stop.send(());
        }
        if let Some(thread) = self.thread.take() {
            thread.join().unwrap();
        }
    }
}

fn edit_backend(machine: &Machine, backend: serde_json::Value) -> PathBuf {
    let path = fs::read_dir(machine.root.path().join("state/remote/leases"))
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    let mut lease: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    lease["backend"] = backend;
    let mut staged = tempfile::NamedTempFile::new_in(path.parent().unwrap()).unwrap();
    staged
        .write_all(&serde_json::to_vec(&lease).unwrap())
        .unwrap();
    staged.persist(&path).unwrap();
    path
}

#[test]
fn proxy_preserves_origin_and_forwarding_headers_upgrades_and_reports_backend_errors() {
    use async_tungstenite::tungstenite::{Message, client::IntoClientRequest};
    use futures_util::StreamExt;
    let relay = Relay::start();
    let machine = Machine::new(&relay);
    let mut stack = machine.start("headers", false);
    stack.pause_for_backend_override();
    let backend = EchoBackend::start();
    let host = "headers.preview.example.test";
    edit_backend(
        &machine,
        serde_json::json!({"scheme":"http", "address":backend.address.to_string()}),
    );
    let headers = "Origin: https://headers.preview.example.test\r\nX-Forwarded-Proto: http\r\nX-Forwarded-Host: spoofed\r\nX-Forwarded-For: 192.0.2.1\r\nConnection: secret\r\nSecret: removed\r\n";
    let response = request_headers(relay.reverse_port, "GET", host, "/echo", headers);
    assert!(response.starts_with("HTTP/1.1 200"), "{response}");
    let values: serde_json::Value =
        serde_json::from_str(response.split_once("\r\n\r\n").unwrap().1).unwrap();
    assert_eq!(values["origin"], format!("https://{host}"));
    assert_eq!(values["host"], host);
    assert_eq!(values["x-forwarded-proto"], "https");
    assert_eq!(values["x-forwarded-host"], host);
    assert_eq!(values["x-forwarded-for"], "192.0.2.1");
    assert!(values.get("secret").is_none());
    assert!(!request(relay.reverse_port, "GET", host, "/echo").contains("x-forwarded-for"));
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    runtime.block_on(async {
        let mut request = format!("ws://127.0.0.1:{}/ws", relay.reverse_port)
            .into_client_request()
            .unwrap();
        request.headers_mut().insert("Host", host.parse().unwrap());
        request
            .headers_mut()
            .insert("Origin", format!("https://{host}").parse().unwrap());
        let (mut ws, _) = async_tungstenite::tokio::connect_async(request)
            .await
            .unwrap();
        ws.send(Message::Text("live upgrade".into())).await.unwrap();
        assert_eq!(
            tokio::time::timeout(Duration::from_secs(3), ws.next())
                .await
                .unwrap()
                .unwrap()
                .unwrap(),
            Message::Text("live upgrade".into())
        );
        stack.stop();
        let closed = tokio::time::timeout(Duration::from_secs(3), ws.next())
            .await
            .unwrap();
        assert!(!matches!(closed, Some(Ok(Message::Text(_)))));
        drop(ws);
    });
    machine.wait_stopped();
    drop(backend);

    let mut stack = machine.start("errors", false);
    stack.pause_for_backend_override();
    let host = "errors.preview.example.test";
    let unrelated = Machine::new(&relay);
    let wrong_root = unrelated
        .root
        .path()
        .join("state/caddy/storage/pki/authorities/local/root.crt");
    edit_backend(
        &machine,
        serde_json::json!({"scheme":"https", "address": format!("127.0.0.1:{}", machine.caddy.https_port), "rootCertificatePath":wrong_root}),
    );
    let response = request(relay.reverse_port, "GET", host, "/");
    assert!(
        response.contains("The local preview is unavailable."),
        "wrong root response: {response:.512}\n{}",
        stack.logs()
    );
    drop(unrelated);
    let invalid = machine.root.path().join("invalid-root.crt");
    fs::write(&invalid, "invalid certificate").unwrap();
    edit_backend(
        &machine,
        serde_json::json!({"scheme":"https", "address": format!("127.0.0.1:{}", machine.caddy.https_port), "rootCertificatePath":invalid}),
    );
    let response = request(relay.reverse_port, "GET", host, "/");
    assert!(
        response.contains("The local preview certificate is unavailable."),
        "invalid root response: {response:.512}\n{}\nconnector: {}",
        stack.logs(),
        fs::read_to_string(machine.root.path().join("state/remote/connector.log")).unwrap()
    );
    edit_backend(
        &machine,
        serde_json::json!({"scheme":"http", "address":format!("127.0.0.1:{}", free_port())}),
    );
    let response = request(relay.reverse_port, "GET", host, "/");
    assert!(
        response.contains("The local preview is unavailable."),
        "unreachable backend response: {response:.512}\n{}",
        stack.logs()
    );
    stack.stop();
    machine.wait_stopped();
}

#[test]
fn response_deadline_starts_after_upload_and_tls_handshake_is_bounded() {
    let relay = Relay::start();
    let machine = Machine::new(&relay);
    let mut stack = machine.start("deadlines", false);
    stack.pause_for_backend_override();
    let backend = EchoBackend::start();
    edit_backend(
        &machine,
        serde_json::json!({"scheme":"http", "address":backend.address.to_string()}),
    );
    let mut upload = TcpStream::connect(("127.0.0.1", relay.reverse_port)).unwrap();
    upload
        .set_read_timeout(Some(Duration::from_secs(5)))
        .unwrap();
    upload
        .set_write_timeout(Some(Duration::from_secs(5)))
        .unwrap();
    write!(upload, "POST /upload HTTP/1.1\r\nHost: deadlines.preview.example.test\r\nContent-Length: 2\r\nConnection: close\r\n\r\na").unwrap();
    // A slow producer is allowed to take longer than the response-header limit.
    std::thread::sleep(Duration::from_secs(31));
    upload.write_all(b"b").unwrap();
    let mut response = String::new();
    upload.read_to_string(&mut response).unwrap();
    assert!(
        response.contains("received 2 bytes"),
        "response={response:?}\nstack={}\nconnector={}\nrelay={}",
        stack.logs(),
        fs::read_to_string(machine.root.path().join("state/remote/connector.log"))
            .unwrap_or_default(),
        fs::read_to_string(relay.directory.path().join("relay.log")).unwrap_or_default()
    );
    let stalled = TcpListener::bind("127.0.0.1:0").unwrap();
    edit_backend(
        &machine,
        serde_json::json!({
            "scheme":"https", "address":stalled.local_addr().unwrap().to_string(),
            "rootCertificatePath":machine.root.path().join("state/caddy/storage/pki/authorities/local/root.crt"),
        }),
    );
    let mut request = TcpStream::connect(("127.0.0.1", relay.reverse_port)).unwrap();
    request
        .set_read_timeout(Some(Duration::from_secs(15)))
        .unwrap();
    request
        .set_write_timeout(Some(Duration::from_secs(2)))
        .unwrap();
    let started = Instant::now();
    write!(
        request,
        "GET / HTTP/1.1\r\nHost: deadlines.preview.example.test\r\nConnection: close\r\n\r\n"
    )
    .unwrap();
    let mut response = String::new();
    request.read_to_string(&mut response).unwrap();
    assert!(response.starts_with("HTTP/1.1 502"), "{response}");
    assert!(started.elapsed() >= Duration::from_secs(9));
    assert!(started.elapsed() < Duration::from_secs(14));
    stack.stop();
    machine.wait_stopped();
}

#[test]
fn detached_remote_stack_uses_verified_https_backend_and_stops_cleanly() {
    let relay = Relay::start();
    let machine = Machine::with_http(&relay, false);
    let mut stack = machine.spawn_with_args("detached", &["--detach"]);
    let mut status = None;
    wait(|| {
        status = stack.child.try_wait().unwrap();
        status.is_some()
    });
    assert!(status.unwrap().success(), "{}", stack.logs());
    assert!(
        stack
            .logs()
            .contains("https://detached.preview.example.test"),
        "{}",
        stack.logs()
    );
    wait(|| {
        request(
            relay.reverse_port,
            "GET",
            "detached.preview.example.test",
            "/note.txt",
        )
        .contains("detached content")
    });
    let path = fs::read_dir(machine.root.path().join("state/remote/leases"))
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    let lease: serde_json::Value = serde_json::from_slice(&fs::read(path).unwrap()).unwrap();
    assert_eq!(lease["backend"]["scheme"], "https");
    let stopped = machine
        .command(&stack.project)
        .arg("stop")
        .output()
        .unwrap();
    assert!(
        stopped.status.success(),
        "{}",
        String::from_utf8_lossy(&stopped.stderr)
    );
    machine.wait_stopped();
    assert!(
        !request(
            relay.reverse_port,
            "GET",
            "detached.preview.example.test",
            "/note.txt"
        )
        .contains("detached content")
    );
}
