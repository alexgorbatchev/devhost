use std::{
    fs,
    io::{Read, Write},
    net::{SocketAddr, TcpListener},
    os::unix::process::CommandExt,
    path::PathBuf,
    process::{Child, Command, Stdio},
    time::{Duration, Instant},
};

use devhost::remote::transport::Connector;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    sync::oneshot,
};

const AUTH: &str = "machine:private-test-credential";

#[path = "remote_transport/lifecycle.rs"]
mod lifecycle;

#[path = "support/ports.rs"]
mod fixture_ports;

fn free_port() -> u16 {
    // Keep fixture endpoints distinct even when the OS immediately reuses a
    // released ephemeral port while another test has not started its server.
    static PORTS: std::sync::Mutex<std::collections::BTreeSet<u16>> =
        std::sync::Mutex::new(std::collections::BTreeSet::new());
    loop {
        let listener = fixture_ports::reserve_listener();
        let port = listener.local_addr().unwrap().port();
        if PORTS.lock().unwrap().insert(port) {
            return port;
        }
    }
}

fn relay_binary() -> &'static PathBuf {
    static BINARY: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();
    BINARY.get_or_init(|| {
        let cache =
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../.cache/test-dependencies");
        fs::create_dir_all(&cache).unwrap();
        let lock = fs::OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(cache.join("chisel-v1.12.0.lock"))
            .unwrap();
        lock.lock().unwrap();
        let binary = cache.join("chisel-v1.12.0");
        if !binary.exists() {
            use sha2::{Digest, Sha256};
            use std::os::unix::fs::PermissionsExt;

            let (asset, expected_sha256) = match (std::env::consts::OS, std::env::consts::ARCH) {
                ("linux", "x86_64") => (
                    "chisel_1.12.0_linux_amd64.gz",
                    "f3f180f1d93aa72cce4e6386f98cc06569a0146fbd65eb4423cf83e6434bcfe6",
                ),
                ("linux", "aarch64") => (
                    "chisel_1.12.0_linux_arm64.gz",
                    "2ec6152cd2c74fe0146d4d79e4e7aa174521368c56e433d55e023a92ea404ec3",
                ),
                ("macos", "aarch64") => (
                    "chisel_1.12.0_darwin_arm64.gz",
                    "707a4b932eea214765146504a0df246cefc415b4297af65a80dd67cf69ba85a9",
                ),
                ("macos", "x86_64") => (
                    "chisel_1.12.0_darwin_amd64.gz",
                    "4aeae36c867f11c8e8c3f2b913a0e063ea3c6d29e1c14a52ed2e6eef8cfc4395",
                ),
                (os, arch) => panic!("unsupported platform for Chisel v1.12.0: {os}/{arch}"),
            };
            let url =
                format!("https://github.com/jpillora/chisel/releases/download/v1.12.0/{asset}");
            let mut response = ureq::get(&url)
                .call()
                .unwrap_or_else(|error| panic!("download {url}: {error}"));
            let mut compressed = Vec::new();
            response
                .body_mut()
                .as_reader()
                .read_to_end(&mut compressed)
                .unwrap();
            let actual_sha256 = format!("{:x}", Sha256::digest(&compressed));
            assert_eq!(
                actual_sha256, expected_sha256,
                "checksum mismatch for {asset}"
            );
            let mut decoder = flate2::read::GzDecoder::new(compressed.as_slice());
            let mut decoded = Vec::new();
            decoder.read_to_end(&mut decoded).unwrap();
            let staging = tempfile::Builder::new()
                .prefix("chisel-install-")
                .tempdir_in(&cache)
                .unwrap();
            let staged = staging.path().join("chisel");
            fs::write(&staged, decoded).unwrap();
            fs::set_permissions(&staged, fs::Permissions::from_mode(0o755)).unwrap();
            fs::rename(&staged, &binary).unwrap();
        }
        binary
    })
}

struct Relay {
    child: Child,
    directory: tempfile::TempDir,
    port: u16,
    reverse_port: u16,
    fingerprint: String,
}

impl Relay {
    fn start() -> Self {
        let directory = tempfile::tempdir().unwrap();
        let port = free_port();
        let reverse_port = free_port();
        let authfile = directory.path().join("users.json");
        fs::write(
            &authfile,
            serde_json::to_vec(
                &serde_json::json!({AUTH:[format!("^R:0\\.0\\.0\\.0:{reverse_port}$")]}),
            )
            .unwrap(),
        )
        .unwrap();
        let log_path = directory.path().join("relay.log");
        let log = fs::File::create(&log_path).unwrap();
        let binary = relay_binary();
        assert!(
            Command::new(binary)
                .arg("server")
                .arg("--keygen")
                .arg(directory.path().join("key.pem"))
                .output()
                .unwrap()
                .status
                .success()
        );
        let child = Command::new(binary)
            .args([
                "server",
                "--reverse",
                "--host",
                "127.0.0.1",
                "--port",
                &port.to_string(),
                "--authfile",
            ])
            .arg(&authfile)
            .arg("--keyfile")
            .arg(directory.path().join("key.pem"))
            .stdin(Stdio::null())
            .stdout(log.try_clone().unwrap())
            .stderr(log)
            .process_group(0)
            .spawn()
            .unwrap_or_else(|error| {
                panic!("start pinned Chisel fixture {}: {error}", binary.display())
            });
        let mut relay = Self {
            child,
            directory,
            port,
            reverse_port,
            fingerprint: String::new(),
        };
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            let log = fs::read_to_string(&log_path).unwrap();
            if let Some(value) = log.lines().find_map(|line| {
                line.split_once("Fingerprint ")
                    .map(|(_, fingerprint)| fingerprint.trim().to_owned())
            }) && log.contains("Listening on")
            {
                relay.fingerprint = value;
                return relay;
            }
            assert!(Instant::now() < deadline, "relay not ready: {log}");
            assert!(
                relay.child.try_wait().unwrap().is_none(),
                "relay exited: {log}"
            );
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    fn url(&self) -> String {
        format!("http://127.0.0.1:{}", self.port)
    }

    fn stop(&mut self) {
        if self.child.try_wait().unwrap().is_some() {
            return;
        }
        // SAFETY: the owned child is an unreaped process-group leader.
        unsafe {
            libc::kill(-(self.child.id() as i32), libc::SIGTERM);
        }
        let deadline = Instant::now() + Duration::from_secs(2);
        while self.child.try_wait().unwrap().is_none() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(10));
        }
        if self.child.try_wait().unwrap().is_none() {
            unsafe {
                libc::kill(-(self.child.id() as i32), libc::SIGKILL);
            }
        }
        self.child.wait().unwrap();
    }

    fn restart(&mut self) {
        self.stop();
        let binary = relay_binary();
        let log = fs::OpenOptions::new()
            .append(true)
            .open(self.directory.path().join("relay.log"))
            .unwrap();
        self.child = Command::new(binary)
            .args([
                "server",
                "--reverse",
                "--host",
                "127.0.0.1",
                "--port",
                &self.port.to_string(),
                "--authfile",
            ])
            .arg(self.directory.path().join("users.json"))
            .arg("--keyfile")
            .arg(self.directory.path().join("key.pem"))
            .stdin(Stdio::null())
            .stdout(log.try_clone().unwrap())
            .stderr(log)
            .process_group(0)
            .spawn()
            .unwrap();
    }
}

impl Drop for Relay {
    fn drop(&mut self) {
        self.stop();
    }
}

#[tokio::test]
async fn native_chisel_reverse_http_and_rejected_enrollment() {
    let relay = Relay::start();
    let backend = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let destination = backend.local_addr().unwrap();
    let bad_pin = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
    for (pin, credentials, port, message) in [
        (
            bad_pin,
            AUTH,
            relay.reverse_port,
            "remote fingerprint mismatch",
        ),
        (
            relay.fingerprint.as_str(),
            "machine:wrong",
            relay.reverse_port,
            "remote authentication failed",
        ),
        (
            relay.fingerprint.as_str(),
            AUTH,
            free_port(),
            "remote enrollment rejected",
        ),
    ] {
        let error = Connector::connect(&relay.url(), pin, credentials, port, destination)
            .await
            .err()
            .expect("invalid enrollment must fail");
        assert_eq!(
            error.kind(),
            std::io::ErrorKind::PermissionDenied,
            "{error:?}"
        );
        assert_eq!(error.to_string(), message);
    }
    let connector = Connector::connect(
        &relay.url(),
        &relay.fingerprint,
        AUTH,
        relay.reverse_port,
        destination,
    )
    .await
    .unwrap();
    let (stop, stopped) = oneshot::channel();
    let running = tokio::spawn(connector.run(stopped));
    let serve = tokio::spawn(async move {
        let (mut stream, _) = backend.accept().await.unwrap();
        let mut request = Vec::new();
        loop {
            let byte = stream.read_u8().await.unwrap();
            request.push(byte);
            if request.ends_with(b"\r\n\r\n") {
                break;
            }
        }
        assert!(
            String::from_utf8(request)
                .unwrap()
                .contains("Host: preview.example.test")
        );
        stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 18\r\nConnection: close\r\n\r\nnative Rust tunnel").await.unwrap();
        stream.shutdown().await.unwrap();
    });
    let response = tokio::task::spawn_blocking(move || {
        let deadline = Instant::now() + Duration::from_secs(5);
        let mut stream = loop {
            match std::net::TcpStream::connect(SocketAddr::from((
                [127, 0, 0, 1],
                relay.reverse_port,
            ))) {
                Ok(stream) => break stream,
                Err(error) => {
                    assert!(
                        Instant::now() < deadline,
                        "reverse port did not bind: {error}"
                    );
                    std::thread::sleep(Duration::from_millis(10));
                }
            }
        };
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        stream
            .write_all(b"GET / HTTP/1.1\r\nHost: preview.example.test\r\nConnection: close\r\n\r\n")
            .unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).unwrap();
        response
    })
    .await
    .unwrap();
    assert!(response.ends_with("native Rust tunnel"), "{response}");
    serve.await.unwrap();
    stop.send(()).unwrap();
    tokio::time::timeout(Duration::from_secs(5), running)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert!(
        !fs::read_to_string(relay.directory.path().join("relay.log"))
            .unwrap()
            .contains("panic")
    );
}
