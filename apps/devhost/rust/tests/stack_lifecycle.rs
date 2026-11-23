use std::{
    collections::BTreeMap,
    fs,
    io::{self, Read, Write},
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::{Duration, Instant},
};

use cli_command_kit::Mode;
use devhost_rust::{
    caddy::{
        self,
        routes::{self, ZombieCleanup},
        stacks::{RegisterStackOptions, read_live_stack_owners, register_stack},
    },
    cliout::ServiceOutput,
    config::CaddySettings,
    manifest, procid,
    services::{
        detach::LaunchMetadata,
        resolve::{PortResolutionOptions, resolve_service_order, resolve_service_ports},
        stack::{StartStackError, StartStackOptions, start_stack},
        stop::{StopStackOptions, stop_stack},
    },
};

#[derive(Clone, Default)]
struct SharedBuf(Arc<Mutex<Vec<u8>>>);

impl SharedBuf {
    fn text(&self) -> String {
        String::from_utf8_lossy(&self.0.lock().unwrap()).into_owned()
    }
}

impl Write for SharedBuf {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(buf);
        Ok(buf.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

fn free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

struct LiveCaddyGuard {
    caddy_dir: PathBuf,
    settings: CaddySettings,
}

impl LiveCaddyGuard {
    fn start(root: &Path) -> Self {
        let caddy_dir = root.join("state/caddy");
        let settings = CaddySettings {
            admin_address: format!("127.0.0.1:{}", free_port()),
            bind_host: "127.0.0.1".to_owned(),
            http_enabled: true,
            http_port: free_port(),
            https_port: free_port(),
            stack_directory_host: String::new(),
            stack_directory_allow_remote: false,
        };
        let mut out = Vec::new();
        caddy::start_in_directory(&caddy_dir, &settings, Mode::Agent, &mut out, true)
            .expect("start isolated caddy");
        Self {
            caddy_dir,
            settings,
        }
    }
}

impl Drop for LiveCaddyGuard {
    fn drop(&mut self) {
        let mut out = Vec::new();
        let _ = caddy::stop_in_directory(&self.caddy_dir, &self.settings, Mode::Agent, &mut out);
    }
}

fn write_config(root: &Path, settings: &CaddySettings) -> PathBuf {
    let config_dir = root.join("config");
    fs::create_dir_all(&config_dir).unwrap();
    let config_path = config_dir.join("config.toml");
    fs::write(
        &config_path,
        format!(
            r#"[caddy]
adminAddress = {:?}
bindHost = {:?}
http = {}
httpPort = {}
httpsPort = {}
"#,
            settings.admin_address,
            settings.bind_host,
            settings.http_enabled,
            settings.http_port,
            settings.https_port
        ),
    )
    .unwrap();
    config_path
}

fn http_get_host(port: u16, host: &str, path: &str) -> String {
    let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(3)))
        .unwrap();
    write!(
        stream,
        "GET {path} HTTP/1.1\r\nHost: {host}:{port}\r\nConnection: close\r\n\r\n"
    )
    .unwrap();
    let mut response = String::new();
    let _ = stream.read_to_string(&mut response);
    response
}

fn wait_until<F: FnMut() -> bool>(timeout: Duration, mut check: F) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if check() {
            return true;
        }
        thread::sleep(Duration::from_millis(30));
    }
    check()
}

#[test]
fn live_stack_routes_services_contains_descendants_runs_daemon_lifecycle_and_stops() {
    if Command::new("caddy")
        .arg("version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_err()
    {
        return;
    }

    let fixture = tempfile::tempdir().unwrap();
    let root = fixture.path();
    let caddy = LiveCaddyGuard::start(root);
    let config_path = write_config(root, &caddy.settings);

    let project = root.join("project");
    fs::create_dir_all(&project).unwrap();
    let daemon_pid_file = project.join("daemon.pid");
    let daemon_port = free_port();
    let daemon_start_script = project.join("daemon_start.py");
    fs::write(
        &daemon_start_script,
        format!(
            r#"import os, subprocess, sys
p = subprocess.Popen(
    [sys.executable, "-c", "import socket, time; s = socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1); s.bind(('127.0.0.1', {daemon_port})); s.listen(5); time.sleep(60)"],
    stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True,
)
with open({pid_file:?}, "w") as f:
    f.write(str(p.pid))
"#,
            daemon_port = daemon_port,
            pid_file = daemon_pid_file.to_str().unwrap()
        ),
    )
    .unwrap();
    let daemon_stop_script = project.join("daemon_stop.py");
    fs::write(
        &daemon_stop_script,
        format!(
            r#"import os, signal
p = {pid_file:?}
if os.path.exists(p):
    try:
        os.kill(int(open(p).read().strip()), signal.SIGTERM)
    except ProcessLookupError:
        pass
    os.remove(p)
"#,
            pid_file = daemon_pid_file.to_str().unwrap()
        ),
    )
    .unwrap();
    let daemon_marker = daemon_pid_file;
    let descendant_pid_file = project.join("descendant.pid");
    let server_script = project.join("server.py");
    fs::write(
        &server_script,
        r#"import http.server, os, subprocess, sys
port = int(os.environ["PORT"])
label = sys.argv[1]
if len(sys.argv) > 2:
    p = subprocess.Popen(["sleep", "60"])
    with open(sys.argv[2], "w") as f:
        f.write(str(p.pid))
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        body = f"{label}:{self.path}:{os.environ.get('DEVHOST_PORT_API','')}".encode()
        self.send_response(200)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def log_message(self, *args):
        pass
print(f"{label}-started", flush=True)
http.server.HTTPServer(("127.0.0.1", port), H).serve_forever()
"#,
    )
    .unwrap();

    // Unmanaged external HTTP listener on a fixed port.
    let ext_listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let ext_port = ext_listener.local_addr().unwrap().port();
    let ext_stop = Arc::new(AtomicBool::new(false));
    let ext_stop_bg = ext_stop.clone();
    ext_listener.set_nonblocking(true).unwrap();
    let ext_thread = thread::spawn(move || {
        while !ext_stop_bg.load(Ordering::Relaxed) {
            if let Ok((mut stream, _)) = ext_listener.accept() {
                let mut buf = [0u8; 512];
                let _ = stream.read(&mut buf);
                let _ = stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 3\r\n\r\next");
            } else {
                thread::sleep(Duration::from_millis(20));
            }
        }
    });

    let manifest_path = project.join("devhost.toml");
    fs::write(
        &manifest_path,
        format!(
            r#"name = "live-demo"

[services.db]
lifecycle.mode = "daemon"
lifecycle.start = ["python3", "{daemon_start}"]
lifecycle.status = ["sh", "-c", "test -f {marker}"]
lifecycle.stop = ["python3", "{daemon_stop}"]
port = {daemon_port}
[services.db.health]
interval = 50
timeout = 5000

[services.api]
command = ["python3", "{script}", "api"]
port = "auto"
host = "live-api"
dependsOn = ["db"]
[services.api.health]
http = "/healthz"
interval = 50
timeout = 5000

[services.web]
command = ["python3", "{script}", "web", "{desc_pid}"]
port = "auto"
host = "live-web"
dependsOn = ["api"]
[services.web.health]
http = "/healthz"
interval = 50
timeout = 5000

[services.ext]
managed = false
port = {ext_port}
host = "live-ext"

[services.worker]
command = ["sh", "-c", "sleep 30"]
[services.worker.health]
process = true
"#,
            marker = daemon_marker.display(),
            daemon_start = daemon_start_script.display(),
            daemon_stop = daemon_stop_script.display(),
            daemon_port = daemon_port,
            script = server_script.display(),
            desc_pid = descendant_pid_file.display(),
            ext_port = ext_port
        ),
    )
    .unwrap();

    // Launch real `devhost start` binary in foreground, routing web, api, db, ext (leaving worker stopped).
    let bin = env!("CARGO_BIN_EXE_devhost");
    let mut stack_proc = Command::new(bin)
        .args([
            "start",
            "--manifest",
            manifest_path.to_str().unwrap(),
            "web",
            "ext",
        ])
        .env("AGENT", "1")
        .env("DEVHOST_STATE_DIR", root.join("state"))
        .env("DEVHOST_CONFIG_DIR", config_path.parent().unwrap())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();

    let stack_pid = stack_proc.id() as i32;
    let stack_stdout_buf = SharedBuf::default();
    let stdout_pipe = stack_proc.stdout.take().unwrap();
    let stdout_capture = stack_stdout_buf.clone();
    let stdout_reader = thread::spawn(move || {
        let mut reader = stdout_pipe;
        let mut buf = [0u8; 1024];
        while let Ok(n) = reader.read(&mut buf) {
            if n == 0 {
                break;
            }
            let _ = stdout_capture.clone().write_all(&buf[..n]);
        }
    });

    let ready = wait_until(Duration::from_secs(10), || {
        if stack_proc.try_wait().ok().flatten().is_some() {
            return true;
        }
        descendant_pid_file.exists()
            && daemon_marker.exists()
            && caddy
                .caddy_dir
                .join(format!("stacks/{stack_pid}.json"))
                .exists()
            && stack_stdout_buf.text().contains("not started: worker")
            && http_get_host(caddy.settings.http_port, "live-web.localhost", "/hello")
                .contains("web:/hello:")
    });
    if !ready || stack_proc.try_wait().ok().flatten().is_some() {
        let _ = stack_proc.kill();
        let out = stack_proc.wait_with_output().unwrap();
        let _ = stdout_reader.join();
        let resp = http_get_host(caddy.settings.http_port, "live-web.localhost", "/hello");
        panic!(
            "stack failed to become ready (status={:?}, desc={}, marker={}, stack_file={})\nhttp={resp}\nstdout={}\nstderr={}",
            out.status,
            descendant_pid_file.exists(),
            daemon_marker.exists(),
            caddy
                .caddy_dir
                .join(format!("stacks/{stack_pid}.json"))
                .exists(),
            stack_stdout_buf.text(),
            String::from_utf8_lossy(&out.stderr),
        );
    }

    // Verify routed traffic through Caddy for managed web, api, and unmanaged ext.
    let web_resp = http_get_host(caddy.settings.http_port, "live-web.localhost", "/ping");
    assert!(web_resp.contains("200 OK"), "web response: {web_resp}");
    assert!(web_resp.contains("web:/ping:"), "web body: {web_resp}");
    let ext_resp = http_get_host(caddy.settings.http_port, "live-ext.localhost", "/");
    assert!(ext_resp.contains("ext"), "ext response: {ext_resp}");

    let descendant_pid: i32 = fs::read_to_string(&descendant_pid_file)
        .unwrap()
        .trim()
        .parse()
        .unwrap();
    assert!(procid::is_process_alive(descendant_pid));

    // Second start of same manifest fails with ManifestOverlapError.
    let dup = Command::new(bin)
        .args(["start", "--manifest", manifest_path.to_str().unwrap()])
        .env("AGENT", "1")
        .env("DEVHOST_STATE_DIR", root.join("state"))
        .env("DEVHOST_CONFIG_DIR", config_path.parent().unwrap())
        .output()
        .unwrap();
    assert!(!dup.status.success());
    let dup_err = String::from_utf8_lossy(&dup.stderr);
    assert!(
        dup_err.contains("devhost is already running with manifest"),
        "expected overlap error, got: {dup_err}"
    );

    // Stop via `devhost stop`.
    let stop_out = Command::new(bin)
        .args(["stop", "--manifest", manifest_path.to_str().unwrap()])
        .env("AGENT", "1")
        .env("DEVHOST_STATE_DIR", root.join("state"))
        .env("DEVHOST_CONFIG_DIR", config_path.parent().unwrap())
        .output()
        .unwrap();
    assert!(
        stop_out.status.success(),
        "stop failed: {}",
        String::from_utf8_lossy(&stop_out.stderr)
    );
    let stop_stdout = String::from_utf8_lossy(&stop_out.stdout);
    assert!(stop_stdout.contains("stopped cleanly"), "{stop_stdout}");

    let stack_result = stack_proc.wait_with_output().unwrap();
    stdout_reader.join().unwrap();
    let stack_stdout = stack_stdout_buf.text();
    assert!(
        stack_stdout.contains("not started: worker"),
        "{stack_stdout}"
    );
    assert!(stack_stdout.contains("live-web"), "{stack_stdout}");
    assert!(stack_stdout.contains("Stack stopped."), "{stack_stdout}");
    assert_eq!(stack_result.status.code(), Some(128 + libc::SIGTERM));

    // Daemon stopped, descendant killed, stack record removed, unmanaged listener still alive.
    assert!(!daemon_marker.exists(), "daemon stop command did not run");
    assert!(
        wait_until(Duration::from_secs(2), || !procid::is_process_alive(
            descendant_pid
        )),
        "descendant pid {descendant_pid} survived stack stop"
    );
    assert!(
        !caddy
            .caddy_dir
            .join(format!("stacks/{stack_pid}.json"))
            .exists()
    );
    assert!(read_live_stack_owners(&caddy.caddy_dir).unwrap().is_empty());

    ext_stop.store(true, Ordering::Relaxed);
    ext_thread.join().unwrap();
}

#[test]
fn auto_port_collision_idle_timeout_unexpected_exit_and_worktree_stop() {
    if Command::new("caddy")
        .arg("version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_err()
    {
        return;
    }

    let fixture = tempfile::tempdir().unwrap();
    let root = fixture.path();
    let caddy = LiveCaddyGuard::start(root);
    let config_path = write_config(root, &caddy.settings);

    // 1. Test auto-port bind collision retry + unexpected exit + idle timeout via in-process start_stack.
    let project = root.join("collision");
    fs::create_dir_all(&project).unwrap();
    let manifest_path = project.join("devhost.toml");
    fs::write(
        &manifest_path,
        r#"name = "retry-demo"

[services.app]
command = ["python3", "-c", "import http.server, os; http.server.HTTPServer(('127.0.0.1', int(os.environ['PORT'])), http.server.BaseHTTPRequestHandler).serve_forever()"]
port = "auto"
host = "retry-app"
[services.app.health]
interval = 50
timeout = 3000

[services.flaky]
command = ["sh", "-c", "exit 7"]
[services.flaky.health]
process = true
"#,
    )
    .unwrap();

    let validated = manifest::read_manifest(&project, None).unwrap();
    let order = resolve_service_order(&validated).unwrap();
    let mut resolved =
        resolve_service_ports(&validated, &PortResolutionOptions::default()).unwrap();

    // Occupy the initially assigned auto port to force bind-collision retry!
    let initial_port = resolved.services["app"].port.unwrap();
    let occupier = TcpListener::bind(("127.0.0.1", initial_port)).unwrap();

    let stdout_buf = SharedBuf::default();
    let stderr_buf = SharedBuf::default();
    let output = ServiceOutput::new(
        Mode::Agent,
        Box::new(stdout_buf.clone()),
        Box::new(stderr_buf.clone()),
        &["retry-demo", "devhost", "caddy", "app", "flaky"],
    );

    let code = start_stack(
        &mut resolved,
        &order,
        StartStackOptions {
            configuration: Some(validated),
            caddy_dir: caddy.caddy_dir.clone(),
            config_path: Some(config_path.clone()),
            environment: BTreeMap::new(),
            output,
            debug_caddy: false,
            shutdown_grace_period: Some(Duration::from_secs(2)),
            idle_timeout: Some(Duration::from_millis(400)),
            install_signal_handlers: false,
            external_cancel: None,
            launch: LaunchMetadata::default(),
        },
    )
    .unwrap();
    drop(occupier);
    assert_eq!(code, 0);
    let logs = stdout_buf.text();
    assert!(
        logs.contains("retrying app with a new auto port after a bind collision."),
        "expected auto-port retry log: {logs}"
    );
    assert_ne!(resolved.services["app"].port.unwrap(), initial_port);
    assert!(
        logs.contains("Idle timeout"),
        "expected idle shutdown: {logs}"
    );
    assert!(
        logs.contains("Stack stopped."),
        "expected clean stop: {logs}"
    );

    // 2. Test killZombies reclaiming host & fixed port claims from a live process of same manifest.
    let mut zombie = Command::new("sleep").arg("30").spawn().unwrap();
    let zpid = zombie.id() as i32;
    let zident = procid::is_process_alive(zpid);
    assert!(zident);
    let same_manifest = manifest_path.to_string_lossy().into_owned();
    fs::write(
        caddy.caddy_dir.join("routes/.host-claims/z.localhost.json"),
        format!(
            r#"{{"createdAt":"2026-01-01T00:00:00.000Z","host":"z.localhost","manifestPath":{same_manifest:?},"ownerPid":{zpid}}}"#
        ),
    )
    .unwrap();
    fs::write(
        caddy.caddy_dir.join("port-claims/ipv4_44555.json"),
        format!(
            r#"{{"bindHost":"127.0.0.1","createdAt":"2026-01-01T00:00:00.000Z","manifestPath":{same_manifest:?},"ownerPid":{zpid},"port":44555}}"#
        ),
    )
    .unwrap();
    let z_out = SharedBuf::default();
    let z_err = SharedBuf::default();
    let z_output = ServiceOutput::new(
        Mode::Agent,
        Box::new(z_out.clone()),
        Box::new(z_err),
        &["devhost"],
    );
    let mut cleanup = ZombieCleanup::default();
    routes::claim_fixed_port_with_options(
        &caddy.caddy_dir,
        "127.0.0.1",
        44555,
        &same_manifest,
        true,
        Some(&mut cleanup),
        Some(&z_output),
    )
    .unwrap();
    routes::claim_host_with_options(
        &caddy.caddy_dir,
        "z.localhost",
        &same_manifest,
        true,
        Some(&mut cleanup),
        Some(&z_output),
    )
    .unwrap();
    let _ = zombie.wait();
    assert!(z_out.text().contains("Stopped zombie PID"));

    // 3. Test --worktrees stop across main repo + linked worktree.
    let repo_main = root.join("repo-main");
    fs::create_dir_all(&repo_main).unwrap();
    assert!(
        Command::new("git")
            .args(["-C", repo_main.to_str().unwrap(), "init", "-b", "main"])
            .status()
            .unwrap()
            .success()
    );
    let main_manifest = repo_main.join("devhost.toml");
    fs::write(&main_manifest, "name = 'wt'\n").unwrap();
    assert!(
        Command::new("git")
            .args(["-C", repo_main.to_str().unwrap(), "add", "devhost.toml"])
            .status()
            .unwrap()
            .success()
    );
    assert!(
        Command::new("git")
            .args([
                "-C",
                repo_main.to_str().unwrap(),
                "-c",
                "user.name=Test",
                "-c",
                "user.email=test@example.com",
                "commit",
                "-m",
                "init",
            ])
            .status()
            .unwrap()
            .success()
    );
    let repo_wt = root.join("repo-wt");
    assert!(
        Command::new("git")
            .args([
                "-C",
                repo_main.to_str().unwrap(),
                "worktree",
                "add",
                "-b",
                "feature",
                repo_wt.to_str().unwrap(),
            ])
            .status()
            .unwrap()
            .success()
    );
    let wt_manifest = repo_wt.join("devhost.toml");

    // Simulate a live stack in the linked worktree.
    let mut wt_sleeper = Command::new("sleep").arg("30").spawn().unwrap();
    let wt_pid = wt_sleeper.id() as i32;
    fs::write(
        caddy.caddy_dir.join(format!("stacks/{wt_pid}.json")),
        format!(
            r#"{{"createdAt":"2026-01-01T00:00:00.000Z","manifestPath":{:?},"ownerPid":{wt_pid},"stackName":"wt"}}"#,
            wt_manifest.to_string_lossy()
        ),
    )
    .unwrap();

    // Non-worktree stop reports the sibling hint.
    let hint_buf = SharedBuf::default();
    let hint_output = ServiceOutput::new(
        Mode::Agent,
        Box::new(hint_buf.clone()),
        Box::new(SharedBuf::default()),
        &["devhost"],
    );
    stop_stack(
        &StopStackOptions {
            manifest_path: main_manifest.clone(),
            worktrees: false,
            grace_period: Some(Duration::from_secs(2)),
        },
        &caddy.caddy_dir,
        &hint_output,
    )
    .unwrap();
    assert!(
        hint_buf
            .text()
            .contains("1 other stack(s) run in this repository's worktrees"),
        "{}",
        hint_buf.text()
    );

    // Worktree stop stops the linked worktree stack.
    let wt_buf = SharedBuf::default();
    let wt_output = ServiceOutput::new(
        Mode::Agent,
        Box::new(wt_buf.clone()),
        Box::new(SharedBuf::default()),
        &["devhost"],
    );
    stop_stack(
        &StopStackOptions {
            manifest_path: main_manifest.clone(),
            worktrees: true,
            grace_period: Some(Duration::from_secs(2)),
        },
        &caddy.caddy_dir,
        &wt_output,
    )
    .unwrap();
    let _ = wt_sleeper.wait();
    assert!(wt_buf.text().contains("Stopping stack PID"));
    assert!(wt_buf.text().contains("stopped cleanly"));

    // Verify register_stack overlap path returns StartStackError::Overlap when calling start_stack.
    let mut other_proc = Command::new("sleep").arg("30").spawn().unwrap();
    let other_pid = other_proc.id() as i32;
    let overlap_dir = root.join("overlap-state/caddy");
    register_stack(
        &overlap_dir,
        &RegisterStackOptions {
            remote: false,
            log_path: String::new(),
            control_port: 0,
            manifest_files: vec![main_manifest.to_string_lossy().into_owned()],
            manifest_path: main_manifest.to_string_lossy().into_owned(),
            stack_name: "wt".to_owned(),
        },
    )
    .unwrap();
    fs::write(
        overlap_dir.join(format!("stacks/{other_pid}.json")),
        format!(
            r#"{{"createdAt":"2026-01-01T00:00:00.000Z","manifestPath":{:?},"ownerPid":{other_pid},"stackName":"wt"}}"#,
            main_manifest.to_string_lossy()
        ),
    )
    .unwrap();
    let mut dummy_manifest = resolved.clone();
    dummy_manifest.manifest_path = main_manifest.clone();
    let err = start_stack(
        &mut dummy_manifest,
        &order,
        StartStackOptions {
            configuration: None,
            caddy_dir: overlap_dir,
            config_path: Some(config_path),
            environment: BTreeMap::new(),
            output: wt_output,
            debug_caddy: false,
            shutdown_grace_period: Some(Duration::from_secs(1)),
            idle_timeout: None,
            install_signal_handlers: false,
            external_cancel: None,
            launch: LaunchMetadata::default(),
        },
    )
    .unwrap_err();
    let _ = other_proc.kill();
    let _ = other_proc.wait();
    assert!(matches!(err, StartStackError::Overlap(_)));
}

#[test]
fn cli_start_and_stop_error_paths_and_daemon_already_running_and_startup_health_timeout() {
    let fixture = tempfile::tempdir().unwrap();
    let root = fixture.path();
    let bin = env!("CARGO_BIN_EXE_devhost");

    let run = |args: &[&str], agent: &str| {
        Command::new(bin)
            .args(args)
            .current_dir(root)
            .env("AGENT", agent)
            .env("DEVHOST_STATE_DIR", root.join("state"))
            .env("DEVHOST_CONFIG_DIR", root.join("cfg"))
            .output()
            .unwrap()
    };

    // Flag and manifest errors
    assert!(!run(&["start", "--local", "--remote"], "1").status.success());
    assert!(
        !run(&["start", "--manifest", "bad.toml"], "1")
            .status
            .success()
    );
    assert!(
        !run(&["stop", "--manifest", "bad.toml"], "1")
            .status
            .success()
    );
    assert!(!run(&["stop"], "1").status.success());

    let manifest_path = root.join("devhost.toml");
    fs::write(
        &manifest_path,
        "name = \"cli-err\"\n[services.web]\ncommand = [\"echo\"]\nport = 3000\nhost = \"web\"\n",
    )
    .unwrap();
    assert!(!run(&["start", "unknown"], "").status.success());
    assert!(!run(&["start", "--remote"], "").status.success());
    assert!(
        !run(&["start", "--idle-timeout", "nope"], "")
            .status
            .success()
    );
    fs::create_dir_all(root.join("cfg")).unwrap();
    // Reserve the endpoint without serving HTTP so an existing Caddy can never
    // satisfy this failure fixture or receive its configuration.
    let unavailable_admin = TcpListener::bind("127.0.0.1:0").unwrap();
    fs::write(
        root.join("cfg/config.toml"),
        format!(
            "[caddy]\nadminAddress = \"{}\"\n",
            unavailable_admin.local_addr().unwrap()
        ),
    )
    .unwrap();
    let no_caddy = run(&["start"], "");
    assert!(!no_caddy.status.success());
    assert!(
        String::from_utf8_lossy(&no_caddy.stderr).contains("Caddy is not available."),
        "{}",
        String::from_utf8_lossy(&no_caddy.stderr)
    );
    let detach_no_caddy = run(&["start", "--detach"], "1");
    assert!(!detach_no_caddy.status.success());
    let detach_no_caddy_err = String::from_utf8_lossy(&detach_no_caddy.stderr);
    assert!(
        detach_no_caddy_err.contains("Startup log tail:")
            && detach_no_caddy_err.contains("Caddy admin API is not available.")
            && detach_no_caddy_err.contains("the stack exited before it was ready (exit code 1)"),
        "{detach_no_caddy_err}"
    );
    assert!(run(&["stop"], "").status.success());
    assert!(!run(&["stop", "--worktrees"], "1").status.success());

    // Live test for: hung service failing startup health check (SIGTERM cleanup),
    // daemon already-running status skipping start, and format_overlap_for_cwd.
    if Command::new("caddy")
        .arg("version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_err()
    {
        return;
    }
    let caddy = LiveCaddyGuard::start(root);
    let config_path = write_config(root, &caddy.settings);
    let proj = root.join("hung");
    fs::create_dir_all(&proj).unwrap();
    let unused_port = free_port();
    let daemon_listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let daemon_port = daemon_listener.local_addr().unwrap().port();
    let hung_manifest = proj.join("devhost.toml");
    fs::write(
        &hung_manifest,
        format!(
            r#"name = "hung-demo"

[services.already]
lifecycle.mode = "daemon"
lifecycle.start = ["sh", "-c", "exit 99"]
lifecycle.status = ["sh", "-c", "exit 0"]
lifecycle.stop = ["sh", "-c", "exit 0"]
port = {daemon_port}
[services.already.health]
interval = 50
timeout = 2000

[services.stuck]
command = ["sh", "-c", "echo boot >&2; sleep 30"]
port = {unused_port}
[services.stuck.health]
interval = 50
timeout = 200
retries = 2
"#
        ),
    )
    .unwrap();

    let validated = manifest::read_manifest(&proj, None).unwrap();
    let order = resolve_service_order(&validated).unwrap();
    let mut resolved =
        resolve_service_ports(&validated, &PortResolutionOptions::default()).unwrap();
    let out_buf = SharedBuf::default();
    let err_buf = SharedBuf::default();
    let output = ServiceOutput::new(
        Mode::Human,
        Box::new(out_buf.clone()),
        Box::new(err_buf.clone()),
        &["hung-demo", "devhost", "caddy", "already", "stuck"],
    );
    let cancel = Arc::new(AtomicBool::new(false));
    let cancel_bg = cancel.clone();
    let stopper = thread::spawn(move || {
        thread::sleep(Duration::from_millis(600));
        cancel_bg.store(true, Ordering::Relaxed);
    });
    let code = start_stack(
        &mut resolved,
        &order,
        StartStackOptions {
            configuration: Some(validated),
            caddy_dir: caddy.caddy_dir.clone(),
            config_path: Some(config_path),
            environment: BTreeMap::new(),
            output,
            debug_caddy: true,
            shutdown_grace_period: Some(Duration::from_secs(2)),
            idle_timeout: None,
            install_signal_handlers: false,
            external_cancel: Some(cancel),
            launch: LaunchMetadata::default(),
        },
    )
    .unwrap();
    stopper.join().unwrap();
    drop(daemon_listener);
    assert_eq!(code, 0);
    let text = out_buf.text();
    assert!(
        text.contains("Stopping service stuck because its startup health check failed"),
        "{text}"
    );
    assert!(err_buf.text().contains("boot"));
}
