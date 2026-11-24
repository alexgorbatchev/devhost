use super::*;

const SERVER: &str = r#"import http.server, json, os, pathlib, signal, socket, threading, time
root = pathlib.Path.cwd()
class Handler(http.server.BaseHTTPRequestHandler):
    def do_HEAD(self):
        self.send_response(200); self.end_headers()
    def do_GET(self):
        data = b'command serve fixture'
        self.send_response(200); self.send_header('Content-Type', 'text/plain'); self.end_headers(); self.wfile.write(data)
    def log_message(self, *args): pass
def server():
    instance = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=instance.serve_forever, daemon=True).start()
    return instance
raw = socket.socket(); raw.bind(('127.0.0.1', 0)); raw.listen()
time.sleep(0.3)
first = server(); second = None
(root/'ports.json').write_text(json.dumps({'first':first.server_port, 'raw':raw.getsockname()[1]}))
while True:
    if (root/'second').exists() and second is None:
        second = server()
        (root/'second-port').write_text(str(second.server_port))
    if (root/'close-first').exists() and first is not None:
        first.shutdown(); first.server_close(); first = None
        (root/'first-closed').touch()
    time.sleep(0.02)
"#;

fn fixture(runtime: &Runtime, name: &str) -> PathBuf {
    let directory = runtime.root.path().join(name);
    fs::create_dir(&directory).unwrap();
    fs::write(directory.join("server.py"), SERVER).unwrap();
    directory
}

fn start(runtime: &Runtime, directory: &Path, detach: bool) -> Option<Process> {
    let mut command = runtime.command();
    command
        .current_dir(directory)
        .args(["serve", "--name", "My Test App"]);
    if detach {
        command.arg("--detach");
    }
    command.args(["--", "python3", "server.py"]);
    if detach {
        let output = command.output().unwrap();
        assert!(
            output.status.success(),
            "serve exited {}: {}{}",
            output.status,
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(
            directory.join("ports.json").exists(),
            "detach returned before HTTP readiness"
        );
        return None;
    }
    let log = fs::File::create(directory.join("serve.log")).unwrap();
    command
        .stdin(Stdio::null())
        .stdout(log.try_clone().unwrap())
        .stderr(log);
    unsafe {
        command.pre_exec(|| {
            if libc::setsid() < 0 {
                Err(std::io::Error::last_os_error())
            } else {
                Ok(())
            }
        });
    }
    Some(Process(command.spawn().unwrap()))
}

fn session(runtime: &Runtime) -> caddy::stacks::LiveStack {
    let mut session = None;
    wait_until(|| {
        session = read_live_stacks(&runtime.state().join("caddy"))
            .unwrap()
            .into_iter()
            .find(|stack| stack.manifest_path.is_empty() && !stack.urls.is_empty());
        session.is_some()
    });
    session.unwrap()
}

fn response(runtime: &Runtime, host: &str) -> Option<String> {
    ureq::Agent::config_builder()
        .proxy(None)
        .timeout_global(Some(Duration::from_secs(1)))
        .build()
        .new_agent()
        .get(format!("http://127.0.0.1:{}/", runtime.settings.http_port))
        .header("Host", host)
        .call()
        .ok()?
        .body_mut()
        .read_to_string()
        .ok()
}

#[test]
fn command_sessions_discover_http_and_support_named_controls() {
    let runtime = Runtime::start();
    let directory = fixture(&runtime, "command sessions");
    start(&runtime, &directory, true);
    let session = session(&runtime);
    assert!(session.name.starts_with("my-test-app-"), "{}", session.name);
    assert_eq!(session.name.len(), "my-test-app-".len() + 8);
    let host = format!("{}.localhost", session.name);
    assert_eq!(
        response(&runtime, &host).as_deref(),
        Some("command serve fixture")
    );
    let ports: Value =
        serde_json::from_slice(&fs::read(directory.join("ports.json")).unwrap()).unwrap();
    assert!(
        session
            .urls
            .iter()
            .all(|url| !url.contains(&format!("-{}.", ports["raw"])))
    );
    for agent in ["0", "1"] {
        let output = runtime
            .command()
            .env("AGENT", agent)
            .args(["stack", "list", "--sessions"])
            .output()
            .unwrap();
        assert!(output.status.success(), "{:?}", output);
        assert_eq!(
            String::from_utf8(output.stdout).unwrap(),
            format!("{}\t{}\n", session.pid, session.name)
        );
        let output = runtime
            .command()
            .env("AGENT", agent)
            .env("DEVHOST_MANIFEST", "/missing.toml")
            .args(["stack", "info", "--session", &session.name])
            .output()
            .unwrap();
        assert!(output.status.success(), "{:?}", output);
        assert!(String::from_utf8_lossy(&output.stdout).contains(&session.name));
    }
    let output = runtime.command().args(["stack", "list"]).output().unwrap();
    assert!(output.status.success());
    assert!(output.stdout.is_empty());
    let output = runtime
        .command()
        .env("DEVHOST_MANIFEST", "/missing.toml")
        .args(["stop", "--session", &session.name])
        .output()
        .unwrap();
    assert!(output.status.success(), "{:?}", output);
    assert!(!session.is_alive());
    assert!(
        read_live_stacks(&runtime.state().join("caddy"))
            .unwrap()
            .is_empty()
    );
    assert_ne!(
        response(&runtime, &host).as_deref(),
        Some("command serve fixture")
    );
}

#[test]
fn command_routes_keep_alias_and_port_qualifiers_as_listeners_change() {
    let runtime = Runtime::start();
    let directory = fixture(&runtime, "changing ports");
    let _process = start(&runtime, &directory, false);
    let session = session(&runtime);
    let alias = format!("{}.localhost", session.name);
    wait_until(|| response(&runtime, &alias).as_deref() == Some("command serve fixture"));
    let ports: Value =
        serde_json::from_slice(&fs::read(directory.join("ports.json")).unwrap()).unwrap();
    let first = ports["first"].as_u64().unwrap();
    fs::write(directory.join("second"), "").unwrap();
    wait_until(|| directory.join("second-port").exists());
    let second = fs::read_to_string(directory.join("second-port")).unwrap();
    let first_host = format!("{}-{first}.localhost", session.name);
    let second_host = format!("{}-{second}.localhost", session.name);
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        let responses = [alias.as_str(), &first_host, &second_host]
            .iter()
            .map(|host| (*host, response(&runtime, host)))
            .collect::<Vec<_>>();
        if responses
            .iter()
            .all(|(_, body)| body.as_deref() == Some("command serve fixture"))
        {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "routes: {responses:?}; sessions: {:?}; log: {}",
            read_live_stacks(&runtime.state().join("caddy")),
            fs::read_to_string(directory.join("serve.log")).unwrap()
        );
        thread::sleep(Duration::from_millis(20));
    }
    fs::write(directory.join("close-first"), "").unwrap();
    wait_until(|| directory.join("first-closed").exists());
    wait_until(|| {
        let live = read_live_stacks(&runtime.state().join("caddy")).unwrap();
        let urls = &live
            .iter()
            .find(|live| live.name == session.name)
            .unwrap()
            .urls;
        urls.len() == 1 && urls[0].contains(&second_host)
    });
    assert_eq!(
        response(&runtime, &second_host).as_deref(),
        Some("command serve fixture")
    );
    assert_ne!(
        response(&runtime, &alias).as_deref(),
        Some("command serve fixture")
    );
}

#[test]
fn global_restart_preserves_command_session_identity() {
    let runtime = Runtime::start();
    let directory = fixture(&runtime, "restart command");
    let _process = start(&runtime, &directory, false);
    let original = session(&runtime);
    let output = runtime
        .command()
        .current_dir(runtime.root.path())
        .arg("restart-all")
        .output()
        .unwrap();
    assert!(output.status.success(), "{:?}", output);
    wait_until(|| {
        read_live_stacks(&runtime.state().join("caddy"))
            .unwrap()
            .iter()
            .any(|stack| {
                stack.name == original.name && stack.pid != original.pid && !stack.urls.is_empty()
            })
    });
    assert!(!original.is_alive());
    assert_eq!(
        response(&runtime, &format!("{}.localhost", original.name)).as_deref(),
        Some("command serve fixture")
    );
}

#[test]
fn command_startup_rejects_exit_and_missing_http_without_leaving_sessions() {
    let runtime = Runtime::start();
    for (arguments, diagnostics) in [
        (
            vec!["serve", "--startup-timeout", "1s", "exit 7"],
            &[
                "command exited with code 7 before opening an HTTP listener",
                "Service command exited before passing its health check with code 7.",
            ][..],
        ),
        (
            vec!["serve", "--startup-timeout", "200ms", "--", "sleep", "300"],
            &["command opened no HTTP listener within 200ms"][..],
        ),
        (
            vec![
                "serve",
                "--detach",
                "--startup-timeout",
                "200ms",
                "--",
                "sleep",
                "300",
            ],
            &["command opened no HTTP listener within 200ms"][..],
        ),
    ] {
        let output = runtime
            .command()
            .current_dir(runtime.root.path())
            .args(arguments)
            .output()
            .unwrap();
        assert!(!output.status.success(), "{:?}", output);
        assert!(
            diagnostics.iter().any(|diagnostic| {
                String::from_utf8_lossy(&output.stderr).contains(diagnostic)
                    || String::from_utf8_lossy(&output.stdout).contains(diagnostic)
            }),
            "{:?}",
            output
        );
        assert!(
            read_live_stacks(&runtime.state().join("caddy"))
                .unwrap()
                .is_empty()
        );
    }
}
