use super::*;
use devhost_rust::services::control::{RuntimeControl, RuntimeHandle};
#[path = "worktrees.rs"]
mod worktrees;

struct Stack {
    running: RunningFileStack,
    handle: RuntimeHandle,
    stdout: SharedBuf,
    stderr: SharedBuf,
    ports: BTreeMap<String, u16>,
    config_path: PathBuf,
}

impl Stack {
    fn start(root: &Path, caddy: &LiveCaddyGuard, idle: Option<Duration>) -> Self {
        Self::start_with(root, caddy, idle, |_| {})
    }

    fn start_with(
        root: &Path,
        caddy: &LiveCaddyGuard,
        idle: Option<Duration>,
        before_ready: impl FnOnce(&Self),
    ) -> Self {
        let config_path = write_config(root, &caddy.settings);
        let validated = manifest::read_manifest(&root.join("project"), None).unwrap();
        let order = resolve_service_order(&validated).unwrap();
        let mut resolved =
            resolve_service_ports(&validated, &PortResolutionOptions::default()).unwrap();
        let ports = resolved
            .services
            .iter()
            .filter_map(|(name, service)| service.port.map(|port| (name.clone(), port)))
            .collect();
        let stdout = SharedBuf::default();
        let stderr = SharedBuf::default();
        let output = ServiceOutput::new(
            Mode::Agent,
            Box::new(stdout.clone()),
            Box::new(stderr.clone()),
            &["runtime", "api", "web", "files"],
        );
        let cancel = Arc::new(AtomicBool::new(false));
        let (handle, control) = RuntimeControl::channel();
        let options = StartStackOptions {
            runtime_control: Some(control),
            command_serve_timeout: None,
            serve_session: false,
            runtime_errors: None,
            configuration: Some(validated),
            caddy_dir: caddy.caddy_dir.clone(),
            config_path: Some(config_path.clone()),
            environment: BTreeMap::new(),
            output,
            debug_caddy: false,
            shutdown_grace_period: Some(Duration::from_secs(2)),
            idle_timeout: idle,
            install_signal_handlers: false,
            external_cancel: Some(cancel.clone()),
            launch: LaunchMetadata::default(),
        };
        let running = RunningFileStack {
            cancel,
            thread: Some(thread::spawn(move || {
                start_stack(&mut resolved, &order, options)
            })),
        };
        let mut stack = Self {
            running,
            handle,
            stdout,
            stderr,
            ports,
            config_path,
        };
        before_ready(&stack);
        if !wait_until(Duration::from_secs(10), || {
            stack.stdout.text().contains("(primary):")
                || stack.running.thread.as_ref().unwrap().is_finished()
        }) || !stack.stdout.text().contains("(primary):")
        {
            stack.running.cancel.store(true, Ordering::SeqCst);
            let result = stack.running.thread.take().unwrap().join();
            panic!(
                "stack failed before readiness: {result:?}; {} {}",
                stack.stdout.text(),
                stack.stderr.text()
            );
        }
        stack.wait_log("(primary):");
        stack
    }

    fn wait_log(&self, text: &str) {
        assert!(
            wait_until(Duration::from_secs(10), || self
                .stdout
                .text()
                .contains(text)),
            "missing {text}: {} {}",
            self.stdout.text(),
            self.stderr.text()
        );
    }

    fn restart(&self, names: &[&str]) -> Result<(), String> {
        self.handle
            .restart_services(names.iter().map(|name| (*name).to_owned()).collect())
            .unwrap()
            .recv_timeout(Duration::from_secs(10))
            .unwrap()
    }

    fn stop(&mut self) {
        self.running.cancel.store(true, Ordering::SeqCst);
        assert_eq!(
            self.running.thread.take().unwrap().join().unwrap().unwrap(),
            0
        );
    }
}

fn write_manifest(root: &Path, body: &str) {
    fs::write(root.join("project/devhost.toml"), body).unwrap();
}

fn files(root: &Path) {
    fs::create_dir_all(root.join("project/public")).unwrap();
    fs::write(root.join("project/public/note.txt"), "runtime content").unwrap();
}

fn file_manifest(host: &str, extra: &str) -> String {
    format!("name = 'runtime'\n{extra}\n[services.files]\nserve = 'public'\nhost = '{host}'\n")
}

#[test]
fn shared_settings_saved_during_service_startup_are_applied_after_readiness() {
    let fixture = tempfile::tempdir().unwrap();
    let root = fixture.path();
    let caddy = LiveCaddyGuard::start(root);
    files(root);
    fs::write(
        root.join("project/public/server.py"),
        "import http.server, os, pathlib, time\nprint('waiting for startup', flush=True)\nwhile not pathlib.Path('../../startup.gate').exists():\n    time.sleep(0.01)\nhttp.server.HTTPServer(('127.0.0.1', int(os.environ['PORT'])), http.server.SimpleHTTPRequestHandler).serve_forever()\n",
    )
    .unwrap();
    write_manifest(
        root,
        "name = 'runtime'\n[services.files]\ncommand = ['python3', 'server.py']\ncwd = 'public'\nport = 'auto'\nhost = 'runtime.localhost'\n",
    );
    let next_https = free_port();
    let mut stack = Stack::start_with(root, &caddy, None, |stack| {
        stack.wait_log("waiting for startup");
        let shared = fs::read_to_string(&stack.config_path).unwrap();
        fs::write(
            &stack.config_path,
            shared.replace(
                &format!("httpsPort = {}", caddy.settings.https_port),
                &format!("httpsPort = {next_https}"),
            ),
        )
        .unwrap();
        fs::write(root.join("startup.gate"), "ready").unwrap();
    });
    stack.wait_log("Applied the shared Caddy settings from");
    stack.wait_log(&format!("https://runtime.localhost:{next_https}"));
    assert!(
        http_get_host(caddy.settings.http_port, "runtime.localhost", "/note.txt")
            .contains("runtime content")
    );
    stack.stop();
    assert!(read_live_stack_owners(&caddy.caddy_dir).unwrap().is_empty());
}

#[test]
fn native_watches_restart_requests_reload_and_failed_replacement_recovery() {
    let fixture = tempfile::tempdir().unwrap();
    let root = fixture.path();
    let caddy = LiveCaddyGuard::start(root);
    files(root);
    fs::create_dir_all(root.join("project/public/node_modules")).unwrap();
    let command = "command = ['python3', '-c', \"import http.server, os; http.server.HTTPServer(('127.0.0.1', int(os.environ['PORT'])), http.server.SimpleHTTPRequestHandler).serve_forever()\"]";
    let original = format!(
        "name = 'runtime'\n[services.files]\n{command}\ncwd = 'public'\nwatch = ['.']\nport = 'auto'\nhost = 'runtime.localhost'\n"
    );
    write_manifest(root, &original);
    let mut stack = Stack::start(root, &caddy, None);
    let port = stack.ports["files"];
    // Ignored children must not dirty a service, even though siblings are watched.
    fs::write(
        root.join("project/public/node_modules/ignored.js"),
        "ignored",
    )
    .unwrap();
    let until = Instant::now() + Duration::from_millis(350);
    while Instant::now() < until {
        assert!(stack.handle.dirty_services().is_empty());
        thread::sleep(Duration::from_millis(10));
    }
    fs::write(root.join("project/public/note.txt"), "changed content").unwrap();
    assert!(wait_until(Duration::from_secs(2), || stack
        .handle
        .dirty_services()
        .contains("files")));
    assert!(
        stack
            .restart(&["missing", "files"])
            .unwrap_err()
            .contains("unknown service: missing")
    );
    assert!(stack.handle.dirty_services().contains("files"));
    stack.restart(&["files", "files"]).unwrap();
    assert!(stack.handle.dirty_services().is_empty());
    assert!(http_get_host(port, "runtime.localhost", "/note.txt").contains("changed content"));
    assert_eq!(
        stack
            .stdout
            .text()
            .matches("restarting service: files")
            .count(),
        1
    );
    fs::create_dir(root.join("project/public/nested")).unwrap();
    assert!(wait_until(Duration::from_secs(2), || stack
        .handle
        .dirty_services()
        .contains("files")));
    stack.restart(&["files"]).unwrap();
    fs::write(root.join("project/public/nested/new.txt"), "nested").unwrap();
    assert!(wait_until(Duration::from_secs(2), || stack
        .handle
        .dirty_services()
        .contains("files")));

    write_manifest(root, "invalid = [");
    stack.wait_log("configuration reload rejected:");
    assert!(
        http_get_host(caddy.settings.http_port, "runtime.localhost", "/note.txt")
            .contains("changed content")
    );
    // This candidate passes manifest validation but cannot start its replacement.
    write_manifest(
        root,
        &original.replace(command, "command = ['/definitely/missing-devhost-command']"),
    );
    stack.wait_log("start reloaded service files:");
    assert!(
        http_get_host(caddy.settings.http_port, "runtime.localhost", "/note.txt")
            .contains("changed content")
    );
    assert!(http_get_host(port, "runtime.localhost", "/note.txt").contains("changed content"));
    write_manifest(
        root,
        &original.replace("runtime.localhost", "replacement.localhost"),
    );
    stack.wait_log("configuration reloaded:");
    assert!(
        http_get_host(
            caddy.settings.http_port,
            "replacement.localhost",
            "/note.txt"
        )
        .contains("changed content")
    );
    assert!(
        !http_get_host(caddy.settings.http_port, "runtime.localhost", "/note.txt")
            .contains("changed content")
    );
    stack.stop();
    assert!(!stack.stdout.text().contains("waiting for a restart"));
    assert!(read_live_stack_owners(&caddy.caddy_dir).unwrap().is_empty());
    assert!(TcpListener::bind(("127.0.0.1", port)).is_ok());
    assert!(
        stack
            .handle
            .restart_services(vec!["files".to_owned()])
            .is_err()
    );
}

#[test]
fn failed_route_refresh_stops_replacement_and_allows_retry() {
    let fixture = tempfile::tempdir().unwrap();
    let root = fixture.path();
    let caddy = LiveCaddyGuard::start(root);
    files(root);
    write_manifest(root, &file_manifest("runtime", ""));
    let mut stack = Stack::start(root, &caddy, None);
    let port = stack.ports["files"];
    let applied_path = caddy.caddy_dir.join("applied.json");
    let applied = fs::read(&applied_path).unwrap();
    fs::write(&applied_path, "invalid JSON").unwrap();
    let error = stack.restart(&["files"]).unwrap_err();
    assert!(
        error.contains("parse applied managed Caddy settings"),
        "{error}"
    );
    let released = TcpListener::bind(("127.0.0.1", port));
    assert!(released.is_ok(), "replacement port {port}: {released:?}");
    drop(released);
    fs::write(&applied_path, applied).unwrap();
    stack.restart(&["files"]).unwrap();
    assert!(
        http_get_host(caddy.settings.http_port, "runtime.localhost", "/note.txt")
            .contains("runtime content")
    );
    stack.stop();
    assert!(read_live_stack_owners(&caddy.caddy_dir).unwrap().is_empty());
}

#[test]
fn partial_include_glob_recovery_and_shared_settings_reload() {
    let fixture = tempfile::tempdir().unwrap();
    let root = fixture.path();
    let caddy = LiveCaddyGuard::start(root);
    files(root);
    write_manifest(root, &file_manifest("runtime", ""));
    let mut stack = Stack::start(root, &caddy, None);
    // A newly included file remains watched even when its first read fails.
    fs::create_dir(root.join("project/missing")).unwrap();
    fs::write(root.join("project/missing/part.toml"), "invalid = [").unwrap();
    write_manifest(
        root,
        &file_manifest("runtime", "includes = ['missing/part.toml', 'more/*.toml']"),
    );
    stack.wait_log("configuration reload rejected:");
    fs::create_dir(root.join("project/more")).unwrap();
    fs::write(
        root.join("project/missing/part.toml"),
        "[services.extra]\nserve = '../public'\nhost = 'extra'\n",
    )
    .unwrap();
    stack.wait_log("extra:");
    fs::write(
        root.join("project/more/other.toml"),
        "[services.another]\nserve = '../public'\nhost = 'another'\n",
    )
    .unwrap();
    stack.wait_log("another:");
    assert!(
        http_get_host(caddy.settings.http_port, "another.localhost", "/note.txt")
            .contains("runtime content")
    );
    let shared = fs::read_to_string(&stack.config_path).unwrap();
    fs::write(
        &stack.config_path,
        format!("domainSuffix = '.test'\n{shared}"),
    )
    .unwrap();
    stack.wait_log("local domainSuffix changed while this stack is running");
    assert!(
        http_get_host(caddy.settings.http_port, "runtime.localhost", "/note.txt")
            .contains("runtime content")
    );
    let next_https = free_port();
    fs::write(
        &stack.config_path,
        shared.replace(
            &format!("httpsPort = {}", caddy.settings.https_port),
            &format!("httpsPort = {next_https}"),
        ),
    )
    .unwrap();
    stack.wait_log("Applied the shared Caddy settings from");
    stack.wait_log(&format!("https://runtime.localhost:{next_https}"));
    fs::write(&stack.config_path, "[caddy]\nhttpPort = -1\n").unwrap();
    stack.wait_log("shared Caddy settings rejected:");
    assert!(
        http_get_host(caddy.settings.http_port, "runtime.localhost", "/note.txt")
            .contains("runtime content")
    );
    stack.stop();
}

#[test]
fn idle_timeout_tracks_http_activity_connections_and_chat_turns() {
    let fixture = tempfile::tempdir().unwrap();
    let root = fixture.path();
    let caddy = LiveCaddyGuard::start(root);
    files(root);
    write_manifest(
        root,
        &file_manifest("runtime.localhost", "[devtools]\nidleTimeout = '50ms'"),
    );
    let mut stack = Stack::start(root, &caddy, Some(Duration::from_millis(400)));
    stack.wait_log("Idle timeout enabled: 400ms");
    let connection = stack.handle.activity.connection();
    let turn = stack.handle.activity.chat_turn();
    let until = Instant::now() + Duration::from_millis(500);
    while Instant::now() < until {
        assert!(!stack.running.thread.as_ref().unwrap().is_finished());
        thread::sleep(Duration::from_millis(20));
    }
    drop(connection);
    assert!(!stack.running.thread.as_ref().unwrap().is_finished());
    drop(turn);
    let until = Instant::now() + Duration::from_millis(900);
    while Instant::now() < until {
        assert!(
            http_get_host(caddy.settings.http_port, "runtime.localhost", "/note.txt")
                .contains("runtime content")
        );
        assert!(
            !stack.running.thread.as_ref().unwrap().is_finished(),
            "{}",
            stack.stdout.text()
        );
        thread::sleep(Duration::from_millis(80));
    }
    assert!(
        wait_until(Duration::from_secs(3), || stack
            .running
            .thread
            .as_ref()
            .unwrap()
            .is_finished()),
        "{}",
        stack.stdout.text()
    );
    assert_eq!(
        stack
            .running
            .thread
            .take()
            .unwrap()
            .join()
            .unwrap()
            .unwrap(),
        0
    );
    stack.wait_log("Idle timeout of 400ms reached.");
    assert!(read_live_stack_owners(&caddy.caddy_dir).unwrap().is_empty());
}

#[test]
fn simultaneous_changes_restart_dependents_and_preserve_unaffected_services() {
    let fixture = tempfile::tempdir().unwrap();
    let root = fixture.path();
    let caddy = LiveCaddyGuard::start(root);
    files(root);
    let script = root.join("project/server.py");
    fs::write(
        &script,
        r#"import http.server, os
class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        body = (str(os.getpid()) + ':' + os.environ.get('TOKEN', '')).encode()
        self.send_response(200)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)
http.server.HTTPServer(('127.0.0.1', int(os.environ['PORT'])), Handler).serve_forever()
"#,
    )
    .unwrap();
    let source = "name = 'runtime'\n[services.api]\ncommand = ['python3', 'server.py']\nport = 'auto'\nhost = 'api.localhost'\nwatch = ['server.py', 'missing']\n[services.api.env]\nTOKEN = 'old'\n[services.web]\ncommand = ['python3', 'server.py']\nport = 'auto'\nhost = 'web.localhost'\nwatch = ['public']\ndependsOn = ['api']\n[services.files]\nserve = 'public'\nhost = 'files.localhost'\n";
    write_manifest(root, source);
    let mut stack = Stack::start(root, &caddy, None);
    let response = |name: &str| {
        http_get_host(stack.ports[name], &format!("{name}.localhost"), "/")
            .split("\r\n\r\n")
            .nth(1)
            .unwrap()
            .to_owned()
    };
    let old_api = response("api");
    let old_web = response("web");
    // Independent file events retain both dirty names rather than overwriting one.
    fs::write(&script, fs::read(&script).unwrap()).unwrap();
    fs::write(root.join("project/public/note.txt"), "new content").unwrap();
    assert!(wait_until(Duration::from_secs(3), || stack
        .handle
        .dirty_services()
        .len()
        == 2));
    stack.restart(&["web", "api"]).unwrap();
    assert!(stack.handle.dirty_services().is_empty());
    let restarted_api = response("api");
    let restarted_web = response("web");
    assert_ne!(old_api, restarted_api);
    assert_ne!(old_web, restarted_web);
    let logs = stack.stdout.text();
    assert!(
        logs.find("restarting service: api").unwrap()
            < logs.find("restarting service: web").unwrap()
    );
    write_manifest(root, &source.replace("TOKEN = 'old'", "TOKEN = 'new'"));
    stack.wait_log("configuration reloaded:");
    let next_api = response("api");
    let next_web = response("web");
    assert!(next_api.ends_with(":new"), "{next_api}");
    assert_ne!(restarted_api, next_api);
    assert_ne!(restarted_web, next_web);
    assert!(
        http_get_host(stack.ports["files"], "files.localhost", "/note.txt").contains("new content")
    );
    stack.wait_log("watch path");
    stack.stop();
}

#[test]
fn manifest_idle_changes_disable_then_enable_timeout_and_cancel_startup() {
    let fixture = tempfile::tempdir().unwrap();
    let root = fixture.path();
    let caddy = LiveCaddyGuard::start(root);
    files(root);
    let initial = file_manifest("runtime.localhost", "[devtools]\nidleTimeout = '2s'");
    write_manifest(root, &initial);
    let mut stack = Stack::start(root, &caddy, None);
    stack.wait_log("Idle timeout enabled: 2s");
    write_manifest(
        root,
        &initial.replace("idleTimeout = '2s'", "idleTimeout = '0s'"),
    );
    stack.wait_log("Idle timeout disabled.");
    write_manifest(
        root,
        &initial.replace("idleTimeout = '2s'", "idleTimeout = '200ms'"),
    );
    stack.wait_log("Idle timeout enabled: 200ms");
    assert!(wait_until(Duration::from_secs(3), || stack
        .running
        .thread
        .as_ref()
        .unwrap()
        .is_finished()));
    assert_eq!(
        stack
            .running
            .thread
            .take()
            .unwrap()
            .join()
            .unwrap()
            .unwrap(),
        0
    );

    write_manifest(root, &file_manifest("runtime.localhost", ""));
    let mut stack = Stack::start(root, &caddy, None);
    let waiting = "name = 'runtime'\n[services.files]\ncommand = ['/bin/sh', '-c', 'echo replacement-started; exec sleep 30']\nport = 'auto'\nhost = 'runtime.localhost'\n[services.files.health]\ntimeout = 30000\n";
    write_manifest(root, waiting);
    stack.wait_log("replacement-started");
    let started = Instant::now();
    stack.stop();
    assert!(started.elapsed() < Duration::from_secs(5));
    assert_eq!(stack.stdout.text().matches("files (primary):").count(), 1);
    assert!(read_live_stack_owners(&caddy.caddy_dir).unwrap().is_empty());
}
