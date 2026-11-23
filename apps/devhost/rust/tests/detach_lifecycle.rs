use std::{
    collections::BTreeMap,
    fs::{self, OpenOptions},
    io::{self, Read, Write},
    net::{TcpListener, TcpStream},
    os::unix::fs::{PermissionsExt, symlink},
    os::unix::io::AsRawFd,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicI32, Ordering},
    },
    thread,
    time::{Duration, Instant},
};

use cli_command_kit::Mode;
use devhost_rust::{
    caddy::{
        self,
        stacks::{
            RegisterStackOptions, read_live_stack_owners, read_live_stacks, register_stack,
            set_stack_ready, unregister_stack,
        },
    },
    cliout::ServiceOutput,
    config::CaddySettings,
    manifest,
    paths::manifest_identity,
    services::{
        detach::{
            DETACHED_LOG_ENV, DetachedStartOptions, STACK_LOG_ENV, check_detach_platform,
            detached_cleanup_timeout, detached_failure_path, detached_startup_timeout,
            format_go_duration, read_detached_failure, record_detached_failure,
            remove_detached_failure, start_detached_stack, take_launch_metadata,
        },
        health::probe_service_health,
        resolve::{
            HealthKind, PortResolutionOptions, ResolvedHealthConfig, ResolvedManifest,
            resolve_service_ports,
        },
    },
};
use sha2::{Digest, Sha256};

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
        if let Ok(owners) = read_live_stack_owners(&self.caddy_dir) {
            let (_, _, out) = test_output(Mode::Agent);
            for owner in owners {
                let _ = devhost_rust::services::stop::stop_stack(
                    &devhost_rust::services::stop::StopStackOptions {
                        manifest_path: PathBuf::from(owner.manifest_path),
                        worktrees: false,
                        grace_period: Some(Duration::from_secs(2)),
                    },
                    &self.caddy_dir,
                    &out,
                );
            }
        }
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
    config_dir
}

fn http_get_host(port: u16, host: &str, path: &str) -> String {
    let mut stream = TcpStream::connect(("127.0.0.1", port)).expect("connect caddy http port");
    stream
        .set_read_timeout(Some(Duration::from_secs(3)))
        .unwrap();
    let req = format!("GET {path} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n");
    stream.write_all(req.as_bytes()).unwrap();
    let mut body = String::new();
    stream.read_to_string(&mut body).unwrap();
    body
}

fn log_stem(manifest_path: &Path) -> String {
    let canonical = manifest_identity(manifest_path)
        .to_string_lossy()
        .into_owned();
    let digest = Sha256::digest(canonical.as_bytes());
    let mut out = String::from("stack-");
    for byte in digest {
        use std::fmt::Write as _;
        let _ = write!(out, "{byte:02x}");
    }
    out
}

fn test_output(mode: Mode) -> (SharedBuf, SharedBuf, ServiceOutput) {
    let stdout_buf = SharedBuf::default();
    let stderr_buf = SharedBuf::default();
    let out = ServiceOutput::new(
        mode,
        Box::new(stdout_buf.clone()),
        Box::new(stderr_buf.clone()),
        &["devhost"],
    );
    (stdout_buf, stderr_buf, out)
}

#[test]
fn detach_unit_contracts_and_setup_failures() {
    for os in ["linux", "macos", "darwin"] {
        assert!(check_detach_platform(os).is_ok());
    }
    let win_err = check_detach_platform("windows").unwrap_err();
    assert_eq!(
        win_err.message,
        "devhost start --detach runs on Linux and macOS, not windows"
    );
    assert!(
        win_err
            .hint
            .as_deref()
            .unwrap()
            .contains("Run devhost start without --detach")
    );

    let mut env_map = BTreeMap::from([
        (STACK_LOG_ENV.to_owned(), "/tmp/stack.log".to_owned()),
        (DETACHED_LOG_ENV.to_owned(), "/tmp/detached.log".to_owned()),
    ]);
    let meta = take_launch_metadata(&mut env_map);
    assert!(meta.detached);
    assert_eq!(meta.log_path, "/tmp/detached.log");
    assert!(!env_map.contains_key(STACK_LOG_ENV));
    assert!(!env_map.contains_key(DETACHED_LOG_ENV));

    let mut stack_env = BTreeMap::from([(STACK_LOG_ENV.to_owned(), "/tmp/stack.log".to_owned())]);
    let stack_meta = take_launch_metadata(&mut stack_env);
    assert!(!stack_meta.detached);
    assert_eq!(stack_meta.log_path, "/tmp/stack.log");

    let tmp = tempfile::tempdir().unwrap();
    let log_file = tmp.path().join("stack-abc.log");
    let fail_path = detached_failure_path(&log_file);
    assert_eq!(fail_path, tmp.path().join("stack-abc.failure.json"));
    record_detached_failure(log_file.to_str().unwrap(), "web").unwrap();
    assert_eq!(read_detached_failure(&fail_path), Some("web".to_owned()));
    remove_detached_failure(&fail_path).unwrap();
    assert_eq!(read_detached_failure(&fail_path), None);
    remove_detached_failure(&fail_path).unwrap();
    fs::write(&fail_path, r#"{"service":""}"#).unwrap();
    assert_eq!(read_detached_failure(&fail_path), None);
    fs::write(&fail_path, "not json").unwrap();
    assert_eq!(read_detached_failure(&fail_path), None);

    assert_eq!(format_go_duration(Duration::ZERO), "0s");
    assert_eq!(format_go_duration(Duration::from_millis(300)), "300ms");
    assert_eq!(format_go_duration(Duration::from_secs(120)), "2m0s");
    assert_eq!(
        format_go_duration(Duration::from_millis(150_500)),
        "2m30.5s"
    );
    assert_eq!(format_go_duration(Duration::from_secs(3665)), "1h1m5s");

    // Startup & cleanup timeout calculation.
    let proj = tmp.path().join("proj");
    fs::create_dir_all(&proj).unwrap();
    let manifest_path = proj.join("devhost.toml");
    fs::write(
        &manifest_path,
        r#"
name = "timeout-demo"
[services.web]
command = "true"
port = "auto"
[services.web.health]
timeout = 5000
[services.fixed]
command = "true"
port = 4000
[services.fixed.health]
timeout = 2000
"#,
    )
    .unwrap();
    let validated = manifest::read_manifest(&proj, Some(&manifest_path)).unwrap();
    let resolved: ResolvedManifest =
        resolve_service_ports(&validated, &PortResolutionOptions::default()).unwrap();
    // 120s + 4*(5s+10s) + 1*(2s+10s) = 192s
    assert_eq!(
        detached_startup_timeout(&resolved),
        Duration::from_secs(192)
    );
    // 60s + 2*20s = 100s
    assert_eq!(
        detached_cleanup_timeout(&resolved),
        Duration::from_secs(100)
    );

    // Setup failure: state_dir/logs is a regular file so MkdirAll fails cleanly.
    let bad_state = tmp.path().join("bad-state");
    fs::create_dir_all(&bad_state).unwrap();
    fs::write(bad_state.join("logs"), "not a dir").unwrap();
    let (_, _, out) = test_output(Mode::Human);
    let setup_err = start_detached_stack(DetachedStartOptions {
        manifest: resolved,
        arguments: vec![],
        directory: proj,
        state_dir: bad_state,
        environment: BTreeMap::new(),
        output: out,
        executable: None,
        startup_timeout: None,
        cleanup_timeout: None,
        target_os: Some("linux".to_owned()),
        external_signal: None,
        install_signal_handlers: false,
    })
    .unwrap_err();
    assert_eq!(
        setup_err.summary.as_deref(),
        Some("the stack log directory could not be created")
    );
    assert!(
        setup_err
            .message
            .contains("the stack log directory could not be created:")
    );
}

#[test]
fn detach_state_faults_preserve_logs_and_prevent_launch() {
    let fixture = tempfile::tempdir().unwrap();
    let root = fixture.path();
    let project = root.join("project");
    fs::create_dir_all(&project).unwrap();
    let manifest_path = project.join("devhost.toml");
    fs::write(
        &manifest_path,
        "name = 'state-faults'\n[services.worker]\ncommand = ['sleep', '30']\nhealth.process = true\n",
    )
    .unwrap();
    let validated = manifest::read_manifest(&project, None).unwrap();
    let resolved = resolve_service_ports(&validated, &PortResolutionOptions::default()).unwrap();
    let state = root.join("state");
    let logs = state.join("logs");
    fs::create_dir_all(&logs).unwrap();
    let stem = log_stem(&manifest_path);
    let log = logs.join(format!("{stem}.log"));
    let lock = logs.join(format!("{stem}.lock"));
    let failure = detached_failure_path(&log);
    let run = |executable: &str| {
        let (_, _, output) = test_output(Mode::Human);
        start_detached_stack(DetachedStartOptions {
            manifest: resolved.clone(),
            arguments: Vec::new(),
            directory: project.clone(),
            state_dir: state.clone(),
            environment: BTreeMap::new(),
            output,
            executable: Some(PathBuf::from(executable)),
            startup_timeout: Some(Duration::from_millis(200)),
            cleanup_timeout: Some(Duration::from_secs(2)),
            target_os: None,
            external_signal: None,
            install_signal_handlers: false,
        })
        .unwrap_err()
    };

    fs::write(&log, "previous attempt\n").unwrap();
    fs::create_dir(&lock).unwrap();
    let error = run("/nonexistent/devhost-fault-supervisor");
    assert_eq!(
        error.summary.as_deref(),
        Some("the start lock could not be opened")
    );
    assert_eq!(fs::read_to_string(&log).unwrap(), "previous attempt\n");
    fs::remove_dir(&lock).unwrap();

    fs::create_dir(&failure).unwrap();
    let error = run("/nonexistent/devhost-fault-supervisor");
    assert_eq!(
        error.summary.as_deref(),
        Some("the failure record of the previous start could not be removed")
    );
    assert_eq!(fs::read_to_string(&log).unwrap(), "previous attempt\n");
    fs::remove_dir(&failure).unwrap();

    fs::remove_file(&log).unwrap();
    fs::create_dir(&log).unwrap();
    let error = run("/nonexistent/devhost-fault-supervisor");
    assert_eq!(
        error.summary.as_deref(),
        Some("the stack log could not be opened")
    );
    fs::remove_dir(&log).unwrap();

    let error = run("/nonexistent/devhost-fault-supervisor");
    assert!(
        error
            .message
            .contains("the stack supervisor could not be launched")
    );
    assert!(error.hint.unwrap().contains(log.to_str().unwrap()));
    assert!(!failure.exists());

    record_detached_failure(log.to_str().unwrap(), "original").unwrap();
    let scratch = logs.join(format!(".failure-{}.tmp", std::process::id()));
    fs::create_dir(&scratch).unwrap();
    assert!(record_detached_failure(log.to_str().unwrap(), "replacement").is_err());
    assert_eq!(read_detached_failure(&failure).as_deref(), Some("original"));
}

#[test]
fn detach_live_cli_start_idempotency_and_stop() {
    let fixture = tempfile::tempdir().unwrap();
    let root = fixture.path();
    let caddy = LiveCaddyGuard::start(root);
    let config_dir = write_config(root, &caddy.settings);
    let state_dir = root.join("state");
    let home_dir = root.join("home");
    fs::create_dir_all(&home_dir).unwrap();

    let project = root.join("project");
    fs::create_dir_all(&project).unwrap();
    let env_dump = project.join("service_env.txt");
    let server_py = project.join("server.py");
    fs::write(
        &server_py,
        format!(
            r#"import http.server, os
with open({dump:?}, "w") as f:
    for k in sorted(os.environ):
        f.write(f"{{k}}={{os.environ[k]}}\n")
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        body = b"detached-ok"
        self.send_response(200)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def log_message(self, *args):
        pass
http.server.HTTPServer(("127.0.0.1", int(os.environ["PORT"])), H).serve_forever()
"#,
            dump = env_dump.to_str().unwrap()
        ),
    )
    .unwrap();

    let manifest_path = project.join("devhost.toml");
    fs::write(
        &manifest_path,
        r#"name = "detach-live"
[worktrees]
enabled = false
[services.web]
command = "python3 server.py"
host = "detach-live.localhost"
port = "auto"
[services.web.health]
timeout = 5000
interval = 50
[services.extra]
command = "false"
[services.extra.health]
process = true
"#,
    )
    .unwrap();

    let bin = env!("CARGO_BIN_EXE_devhost");
    let out = Command::new(bin)
        .args(["start", "--detach", "--idle-timeout", "5m", "--", "web"])
        .current_dir(&project)
        .env("DEVHOST_STATE_DIR", &state_dir)
        .env("DEVHOST_CONFIG_DIR", &config_dir)
        .env("HOME", &home_dir)
        .env("AGENT", "1")
        .env(DETACHED_LOG_ENV, "/tmp/should-be-cleared.log")
        .output()
        .expect("run devhost start --detach");
    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        out.status.success(),
        "start --detach failed:\nstdout:\n{stdout}\nstderr:\n{stderr}"
    );

    let stem = log_stem(&manifest_path);
    let expected_log = state_dir.join("logs").join(format!("{stem}.log"));
    let expected_lock = state_dir.join("logs").join(format!("{stem}.lock"));

    let stacks = read_live_stacks(&caddy.caddy_dir).unwrap();
    assert_eq!(stacks.len(), 1);
    let stack = &stacks[0];
    assert!(stack.ready);
    assert!(stack.is_alive());
    assert_eq!(stack.name, "detach-live");
    assert_eq!(stack.log_path, expected_log.to_string_lossy());
    assert_eq!(
        stack.urls,
        vec![format!(
            "https://detach-live.localhost:{}",
            caddy.settings.https_port
        )]
    );

    assert!(stdout.contains(&format!(
        "devhost: Started detach-live (PID {}).",
        stack.pid
    )));
    assert!(stdout.contains(&stack.urls[0]));
    assert!(stdout.contains(&format!("devhost: Log: {}", stack.log_path)));

    // Verify private permissions on logs/, log file, and lock file.
    let dir_mode = fs::metadata(state_dir.join("logs"))
        .unwrap()
        .permissions()
        .mode();
    let log_mode = fs::metadata(&expected_log).unwrap().permissions().mode();
    let lock_mode = fs::metadata(&expected_lock).unwrap().permissions().mode();
    assert_eq!(dir_mode & 0o077, 0);
    assert_eq!(log_mode & 0o077, 0);
    assert_eq!(lock_mode & 0o077, 0);

    // Verify internal launch variables were stripped before service start.
    let dumped = fs::read_to_string(&env_dump).unwrap();
    assert!(!dumped.contains(DETACHED_LOG_ENV));
    assert!(!dumped.contains(STACK_LOG_ENV));

    // Verify live HTTP traffic routes through Caddy.
    let routed = http_get_host(caddy.settings.http_port, "detach-live.localhost", "/");
    assert!(routed.contains("200 OK") && routed.contains("detached-ok"));

    // Second start via symlink reports Already running without starting another supervisor.
    let alias_dir = root.join("alias");
    fs::create_dir_all(&alias_dir).unwrap();
    let alias = alias_dir.join("devhost.toml");
    symlink(&manifest_path, &alias).unwrap();
    let second = Command::new(bin)
        .args([
            "start",
            "--detach",
            "--manifest",
            alias.to_str().unwrap(),
            "web",
        ])
        .current_dir(root)
        .env("DEVHOST_STATE_DIR", &state_dir)
        .env("DEVHOST_CONFIG_DIR", &config_dir)
        .env("HOME", &home_dir)
        .env("AGENT", "1")
        .output()
        .expect("run second start --detach");
    let second_stdout = String::from_utf8_lossy(&second.stdout);
    let second_stderr = String::from_utf8_lossy(&second.stderr);
    assert!(second.status.success(), "{second_stdout}\n{second_stderr}");
    assert!(second_stdout.contains(&format!(
        "devhost: Already running detach-live (PID {}).",
        stack.pid
    )));
    assert!(second_stdout.contains(&format!("devhost: Log: {}", stack.log_path)));
    assert!(!second_stdout.contains(&stack.urls[0]));

    // Stop cleanly removes everything.
    let stop_out = Command::new(bin)
        .args(["stop"])
        .current_dir(&project)
        .env("DEVHOST_STATE_DIR", &state_dir)
        .env("DEVHOST_CONFIG_DIR", &config_dir)
        .env("HOME", &home_dir)
        .env("AGENT", "1")
        .output()
        .expect("run devhost stop");
    assert!(stop_out.status.success());
    assert!(read_live_stacks(&caddy.caddy_dir).unwrap().is_empty());
    assert!(read_live_stack_owners(&caddy.caddy_dir).unwrap().is_empty());
}

#[test]
fn detach_contention_failure_cleanup_and_signals() {
    let fixture = tempfile::tempdir().unwrap();
    let root = fixture.path();
    let caddy = LiveCaddyGuard::start(root);
    let config_dir = write_config(root, &caddy.settings);
    let state_dir = root.join("state");
    let home_dir = root.join("home");
    fs::create_dir_all(&home_dir).unwrap();

    let project = root.join("project");
    fs::create_dir_all(&project).unwrap();

    // 1. Live failure & bounded 30-line tail + strict cleanup of healthy sibling service.
    let ok_py = project.join("good.py");
    fs::write(
        &ok_py,
        r#"import http.server, os
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200); self.end_headers(); self.wfile.write(b"ok")
    def log_message(self, *args): pass
http.server.HTTPServer(("127.0.0.1", int(os.environ["PORT"])), H).serve_forever()
"#,
    )
    .unwrap();
    let bad_py = project.join("bad.py");
    fs::write(
        &bad_py,
        "import sys\nfor i in range(1, 41):\n    print(f'bad-line-{i}', file=sys.stderr)\nsys.exit(4)\n",
    )
    .unwrap();
    let fail_manifest = project.join("devhost.toml");
    fs::write(
        &fail_manifest,
        r#"name = "fail-detach"
[worktrees]
enabled = false
[services.good]
command = "python3 good.py"
host = "good-detach.localhost"
port = "auto"
[services.good.health]
timeout = 5000
interval = 50
[services.bad]
command = "python3 bad.py"
host = "bad-detach.localhost"
port = "auto"
[services.bad.health]
timeout = 2000
interval = 50
"#,
    )
    .unwrap();

    let bin = env!("CARGO_BIN_EXE_devhost");
    let fail_out = Command::new(bin)
        .args(["start", "--detach"])
        .current_dir(&project)
        .env("DEVHOST_STATE_DIR", &state_dir)
        .env("DEVHOST_CONFIG_DIR", &config_dir)
        .env("HOME", &home_dir)
        .env("AGENT", "1")
        .output()
        .expect("run failing start --detach");
    assert!(!fail_out.status.success());
    let fail_stderr = String::from_utf8_lossy(&fail_out.stderr);
    assert!(fail_stderr.contains("Startup log tail:"), "{fail_stderr}");
    assert!(!fail_stderr.contains("bad-line-1\n"), "{fail_stderr}");
    assert!(fail_stderr.contains("bad-line-40"), "{fail_stderr}");
    assert!(
        fail_stderr.contains("devhost: ERR: service bad did not become ready; full log:"),
        "{fail_stderr}"
    );
    assert!(read_live_stacks(&caddy.caddy_dir).unwrap().is_empty());
    assert!(read_live_stack_owners(&caddy.caddy_dir).unwrap().is_empty());
    let stem = log_stem(&fail_manifest);
    assert!(
        !state_dir
            .join("logs")
            .join(format!("{stem}.failure.json"))
            .exists()
    );

    // 2. Lock contention + signal while waiting for lock.
    let validated = manifest::read_manifest(&project, Some(&fail_manifest)).unwrap();
    let resolved = resolve_service_ports(&validated, &PortResolutionOptions::default()).unwrap();
    let lock_path = state_dir.join("logs").join(format!("{stem}.lock"));
    let lock_holder = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(&lock_path)
        .unwrap();
    // SAFETY: exclusive flock held for lock contention verification.
    assert_eq!(
        unsafe { libc::flock(lock_holder.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) },
        0
    );

    let (_, _, lock_out) = test_output(Mode::Agent);
    let lock_err = start_detached_stack(DetachedStartOptions {
        manifest: resolved.clone(),
        arguments: vec![],
        directory: project.clone(),
        state_dir: state_dir.clone(),
        environment: BTreeMap::new(),
        output: lock_out,
        executable: Some(PathBuf::from("true")),
        startup_timeout: Some(Duration::from_millis(180)),
        cleanup_timeout: Some(Duration::from_millis(500)),
        target_os: Some("linux".to_owned()),
        external_signal: None,
        install_signal_handlers: false,
    })
    .unwrap_err();
    assert!(
        lock_err
            .message
            .starts_with("another start of this manifest did not finish within "),
        "{}",
        lock_err.message
    );

    let pre_sig = Arc::new(AtomicI32::new(libc::SIGINT));
    let (_, _, sig_lock_out) = test_output(Mode::Agent);
    let sig_lock_err = start_detached_stack(DetachedStartOptions {
        manifest: resolved.clone(),
        arguments: vec![],
        directory: project.clone(),
        state_dir: state_dir.clone(),
        environment: BTreeMap::new(),
        output: sig_lock_out,
        executable: Some(PathBuf::from("true")),
        startup_timeout: Some(Duration::from_secs(2)),
        cleanup_timeout: Some(Duration::from_millis(500)),
        target_os: Some("linux".to_owned()),
        external_signal: Some(pre_sig),
        install_signal_handlers: false,
    })
    .unwrap_err();
    assert!(
        sig_lock_err.message.contains(
            "received SIGINT (Ctrl-C) (signal 2) while another start of this manifest was running"
        ),
        "{}",
        sig_lock_err.message
    );
    drop(lock_holder);

    // 3. Supervisor exits before readiness without writing a failure record.
    let exit_script = project.join("exit7.sh");
    fs::write(&exit_script, "#!/bin/sh\nexit 7\n").unwrap();
    fs::set_permissions(&exit_script, fs::Permissions::from_mode(0o755)).unwrap();
    let (_, _, exit_out) = test_output(Mode::Agent);
    let exit_err = start_detached_stack(DetachedStartOptions {
        manifest: resolved.clone(),
        arguments: vec![],
        directory: project.clone(),
        state_dir: state_dir.clone(),
        environment: BTreeMap::new(),
        output: exit_out,
        executable: Some(exit_script),
        startup_timeout: Some(Duration::from_secs(2)),
        cleanup_timeout: Some(Duration::from_millis(500)),
        target_os: Some("linux".to_owned()),
        external_signal: None,
        install_signal_handlers: false,
    })
    .unwrap_err();
    assert!(
        exit_err
            .message
            .starts_with("the stack exited before it was ready (exit code 7); full log:"),
        "{}",
        exit_err.message
    );

    // 4. Signal before ready + second signal interrupting slow supervisor cleanup -> still stopping.
    let pid_file = project.join("hang.pid");
    let hang_script = project.join("hang.sh");
    fs::write(
        &hang_script,
        format!(
            "#!/bin/sh\ntrap '' TERM\necho $$ > {}\nwhile true; do sleep 1; done\n",
            pid_file.display()
        ),
    )
    .unwrap();
    fs::set_permissions(&hang_script, fs::Permissions::from_mode(0o755)).unwrap();

    let sig_ctrl = Arc::new(AtomicI32::new(0));
    let sig_sender = sig_ctrl.clone();
    let pid_watch = pid_file.clone();
    let helper = thread::spawn(move || {
        let start = Instant::now();
        while !pid_watch.exists() && start.elapsed() < Duration::from_secs(3) {
            thread::sleep(Duration::from_millis(10));
        }
        sig_sender.store(libc::SIGINT, Ordering::SeqCst);
        thread::sleep(Duration::from_millis(80));
        sig_sender.store(libc::SIGTERM, Ordering::SeqCst);
    });

    let (_, hang_stderr, hang_out) = test_output(Mode::Human);
    let hang_err = start_detached_stack(DetachedStartOptions {
        manifest: resolved.clone(),
        arguments: vec![],
        directory: project.clone(),
        state_dir: state_dir.clone(),
        environment: BTreeMap::new(),
        output: hang_out,
        executable: Some(hang_script),
        startup_timeout: Some(Duration::from_secs(3)),
        cleanup_timeout: Some(Duration::from_secs(3)),
        target_os: Some("linux".to_owned()),
        external_signal: Some(sig_ctrl),
        install_signal_handlers: false,
    })
    .unwrap_err();
    helper.join().unwrap();
    assert!(hang_stderr.text().contains("Startup log tail:"));
    if let Ok(pid_txt) = fs::read_to_string(&pid_file)
        && let Ok(pid) = pid_txt.trim().parse::<i32>()
    {
        // SAFETY: reap mock hung process group created by this test.
        unsafe { libc::kill(-pid, libc::SIGKILL) };
        let deadline = Instant::now() + Duration::from_secs(2);
        while unsafe { libc::kill(pid, 0) } == 0 && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(20));
        }
    }
    assert!(
        hang_err.message.contains("is still stopping"),
        "{}",
        hang_err.message
    );
    assert!(
        hang_err
            .hint
            .as_deref()
            .unwrap()
            .contains("Run \"devhost stack list\""),
        "{:?}",
        hang_err.hint
    );

    // 5. Remote mode mismatch against an existing live ready stack record.
    register_stack(
        &caddy.caddy_dir,
        &RegisterStackOptions {
            remote: true,
            log_path: String::new(),
            control_port: 0,
            manifest_files: vec![fail_manifest.to_string_lossy().into_owned()],
            manifest_path: fail_manifest.to_string_lossy().into_owned(),
            stack_name: "fail-detach".to_owned(),
        },
    )
    .unwrap();
    devhost_rust::caddy::stacks::set_stack_ready(&caddy.caddy_dir, Vec::new()).unwrap();
    let (_, _, rem_out) = test_output(Mode::Agent);
    let rem_err = start_detached_stack(DetachedStartOptions {
        manifest: resolved,
        arguments: vec![],
        directory: project,
        state_dir,
        environment: BTreeMap::new(),
        output: rem_out,
        executable: None,
        startup_timeout: Some(Duration::from_secs(2)),
        cleanup_timeout: Some(Duration::from_millis(500)),
        target_os: Some("linux".to_owned()),
        external_signal: None,
        install_signal_handlers: false,
    })
    .unwrap_err();
    unregister_stack(&caddy.caddy_dir).unwrap();
    assert_eq!(
        rem_err.message,
        "the running stack uses a different remote preview mode"
    );
}

#[test]
fn detach_late_exit_and_launch_and_external_failures() {
    let fixture = tempfile::tempdir().unwrap();
    let root = fixture.path();
    let caddy = LiveCaddyGuard::start(root);
    let config_dir = write_config(root, &caddy.settings);
    let state_dir = root.join("state");
    let home_dir = root.join("home");
    fs::create_dir_all(&home_dir).unwrap();
    let bin = env!("CARGO_BIN_EXE_devhost");

    // 1. Late exit: `early` exits 5 after 150ms while `slow` waits 450ms to bind its port.
    let late_dir = root.join("late-exit");
    fs::create_dir_all(&late_dir).unwrap();
    let slow_pid = late_dir.join("slow.pid");
    let slow_py = late_dir.join("slow.py");
    fs::write(
        &slow_py,
        format!(
            r#"import http.server, os, signal, sys, time
with open({pid_path:?}, "w") as f:
    f.write(str(os.getpid()))
def on_term(*args):
    sys.exit(0)
signal.signal(signal.SIGTERM, on_term)
time.sleep(0.45)
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200); self.end_headers(); self.wfile.write(b"ok")
    def log_message(self, *args): pass
http.server.HTTPServer(("127.0.0.1", int(os.environ["PORT"])), H).serve_forever()
"#,
            pid_path = slow_pid.to_str().unwrap()
        ),
    )
    .unwrap();
    fs::write(
        late_dir.join("devhost.toml"),
        r#"name = "late-exit"
[worktrees]
enabled = false
[services.early]
command = ["sh", "-c", "sleep 0.15; exit 5"]
[services.early.health]
process = true
[services.slow]
dependsOn = ["early"]
command = "python3 slow.py"
host = "slow-late.localhost"
port = "auto"
[services.slow.health]
timeout = 5000
interval = 50
"#,
    )
    .unwrap();
    let late_out = Command::new(bin)
        .args(["start", "--detach"])
        .current_dir(&late_dir)
        .env("DEVHOST_STATE_DIR", &state_dir)
        .env("DEVHOST_CONFIG_DIR", &config_dir)
        .env("HOME", &home_dir)
        .env("AGENT", "1")
        .output()
        .expect("run late-exit start --detach");
    assert!(!late_out.status.success());
    let late_err = String::from_utf8_lossy(&late_out.stderr);
    assert!(
        late_err.contains("devhost: ERR: service early did not become ready; full log:"),
        "{late_err}"
    );
    assert!(read_live_stacks(&caddy.caddy_dir).unwrap().is_empty());
    assert!(read_live_stack_owners(&caddy.caddy_dir).unwrap().is_empty());
    if let Ok(pid_txt) = fs::read_to_string(&slow_pid)
        && let Ok(pid) = pid_txt.trim().parse::<i32>()
    {
        // SAFETY: liveness probe on child PID written by fixture.
        assert_ne!(unsafe { libc::kill(pid, 0) }, 0, "slow service lingered");
    }

    // 2. Launch error on missing command executable.
    let launch_dir = root.join("launch-err");
    fs::create_dir_all(&launch_dir).unwrap();
    fs::write(
        launch_dir.join("devhost.toml"),
        r#"name = "launch-err"
[worktrees]
enabled = false
[services.broken]
command = ["/nonexistent/devhost-test-command"]
[services.broken.health]
process = true
"#,
    )
    .unwrap();
    let launch_out = Command::new(bin)
        .args(["start", "--detach"])
        .current_dir(&launch_dir)
        .env("DEVHOST_STATE_DIR", &state_dir)
        .env("DEVHOST_CONFIG_DIR", &config_dir)
        .env("HOME", &home_dir)
        .env("AGENT", "1")
        .output()
        .expect("run launch-err start --detach");
    assert!(!launch_out.status.success());
    let launch_err = String::from_utf8_lossy(&launch_out.stderr);
    assert!(
        launch_err.contains("devhost: ERR: service broken did not become ready; full log:"),
        "{launch_err}"
    );
    assert!(read_live_stacks(&caddy.caddy_dir).unwrap().is_empty());
    assert!(read_live_stack_owners(&caddy.caddy_dir).unwrap().is_empty());

    // 3. External (unmanaged) service failing startup health probe.
    let ext_dir = root.join("ext-fail");
    fs::create_dir_all(&ext_dir).unwrap();
    let unused_port = free_port();
    fs::write(
        ext_dir.join("devhost.toml"),
        format!(
            r#"name = "ext-fail"
[worktrees]
enabled = false
[services.external]
managed = false
port = {unused_port}
[services.external.health]
timeout = 150
interval = 25
"#
        ),
    )
    .unwrap();
    let ext_out = Command::new(bin)
        .args(["start", "--detach"])
        .current_dir(&ext_dir)
        .env("DEVHOST_STATE_DIR", &state_dir)
        .env("DEVHOST_CONFIG_DIR", &config_dir)
        .env("HOME", &home_dir)
        .env("AGENT", "1")
        .output()
        .expect("run ext-fail start --detach");
    assert!(!ext_out.status.success());
    let ext_err = String::from_utf8_lossy(&ext_out.stderr);
    assert!(
        ext_err.contains("devhost: ERR: service external did not become ready; full log:"),
        "{ext_err}"
    );
    assert!(read_live_stacks(&caddy.caddy_dir).unwrap().is_empty());
    assert!(read_live_stack_owners(&caddy.caddy_dir).unwrap().is_empty());
}

#[test]
fn detach_await_earlier_unsettled_start() {
    struct UnregisterGuard<'a>(&'a Path);
    impl Drop for UnregisterGuard<'_> {
        fn drop(&mut self) {
            let _ = unregister_stack(self.0);
        }
    }

    let fixture = tempfile::tempdir().unwrap();
    let root = fixture.path();
    let state_dir = root.join("state");
    let caddy_dir = state_dir.join("caddy");
    let project = root.join("project");
    fs::create_dir_all(&project).unwrap();
    let manifest_path = project.join("devhost.toml");
    fs::write(
        &manifest_path,
        "name = \"unsettled\"\n[services.web]\ncommand = \"true\"\n[services.web.health]\nprocess = true\n",
    )
    .unwrap();

    let validated = manifest::read_manifest(&project, Some(&manifest_path)).unwrap();
    let resolved = resolve_service_ports(&validated, &PortResolutionOptions::default()).unwrap();
    let stem = log_stem(&manifest_path);
    let log_path = state_dir.join("logs").join(format!("{stem}.log"));
    let lock_path = state_dir.join("logs").join(format!("{stem}.lock"));

    let exit_script = project.join("exit7.sh");
    fs::write(&exit_script, "#!/bin/sh\nexit 7\n").unwrap();
    fs::set_permissions(&exit_script, fs::Permissions::from_mode(0o755)).unwrap();

    let wait_lock_held = |lock_path: &Path| {
        let deadline = Instant::now() + Duration::from_secs(3);
        while Instant::now() < deadline {
            if let Ok(file) = OpenOptions::new().read(true).write(true).open(lock_path) {
                // SAFETY: nonblocking flock probe to verify another thread holds the lock.
                let rc = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) };
                if rc != 0 {
                    return;
                }
            }
            thread::sleep(Duration::from_millis(10));
        }
        panic!("start_detached_stack did not acquire lock in time");
    };

    // Case A: earlier unready stack becomes ready -> returns Ok with Already running.
    let _guard_a = UnregisterGuard(&caddy_dir);
    register_stack(
        &caddy_dir,
        &RegisterStackOptions {
            remote: false,
            log_path: log_path.to_string_lossy().into_owned(),
            control_port: 0,
            manifest_files: vec![manifest_path.to_string_lossy().into_owned()],
            manifest_path: manifest_path.to_string_lossy().into_owned(),
            stack_name: "unsettled".to_owned(),
        },
    )
    .unwrap();
    let (stdout_a, _, out_a) = test_output(Mode::Agent);
    let opts_a = DetachedStartOptions {
        manifest: resolved.clone(),
        arguments: vec![],
        directory: project.clone(),
        state_dir: state_dir.clone(),
        environment: BTreeMap::new(),
        output: out_a,
        executable: Some(exit_script.clone()),
        startup_timeout: Some(Duration::from_secs(5)),
        cleanup_timeout: Some(Duration::from_millis(500)),
        target_os: Some("linux".to_owned()),
        external_signal: None,
        install_signal_handlers: false,
    };
    let handle_a = thread::spawn(move || start_detached_stack(opts_a));
    wait_lock_held(&lock_path);
    set_stack_ready(&caddy_dir, Vec::new()).unwrap();
    handle_a.join().unwrap().unwrap();
    assert!(
        stdout_a
            .text()
            .contains("devhost: Already running unsettled")
    );
    drop(_guard_a);

    // Case B: earlier unready stack unregisters -> waiter launches its own supervisor.
    let _guard_b = UnregisterGuard(&caddy_dir);
    register_stack(
        &caddy_dir,
        &RegisterStackOptions {
            remote: false,
            log_path: log_path.to_string_lossy().into_owned(),
            control_port: 0,
            manifest_files: vec![manifest_path.to_string_lossy().into_owned()],
            manifest_path: manifest_path.to_string_lossy().into_owned(),
            stack_name: "unsettled".to_owned(),
        },
    )
    .unwrap();
    let (_, _, out_b) = test_output(Mode::Agent);
    let opts_b = DetachedStartOptions {
        manifest: resolved,
        arguments: vec![],
        directory: project,
        state_dir,
        environment: BTreeMap::new(),
        output: out_b,
        executable: Some(exit_script),
        startup_timeout: Some(Duration::from_secs(5)),
        cleanup_timeout: Some(Duration::from_millis(500)),
        target_os: Some("linux".to_owned()),
        external_signal: None,
        install_signal_handlers: false,
    };
    let handle_b = thread::spawn(move || start_detached_stack(opts_b));
    wait_lock_held(&lock_path);
    unregister_stack(&caddy_dir).unwrap();
    let err_b = handle_b.join().unwrap().unwrap_err();
    assert!(
        err_b
            .message
            .starts_with("the stack exited before it was ready (exit code 7); full log:"),
        "{}",
        err_b.message
    );
}

#[test]
fn detach_live_sigterm_cancels_startup_promptly() {
    let fixture = tempfile::tempdir().unwrap();
    let root = fixture.path();
    let caddy = LiveCaddyGuard::start(root);
    let config_dir = write_config(root, &caddy.settings);
    let state_dir = root.join("state");
    let home_dir = root.join("home");
    fs::create_dir_all(&home_dir).unwrap();

    let project = root.join("project");
    fs::create_dir_all(&project).unwrap();
    let unused_port = free_port();
    fs::write(
        project.join("devhost.toml"),
        format!(
            r#"name = "sigterm-cancel"
[worktrees]
enabled = false
[services.stuck]
command = ["sh", "-c", "exec sleep 30"]
port = {unused_port}
[services.stuck.health]
timeout = 10000
interval = 50
"#
        ),
    )
    .unwrap();

    let stdout_file = OpenOptions::new()
        .create(true)
        .truncate(true)
        .read(true)
        .write(true)
        .open(root.join("cli.out"))
        .unwrap();
    let stderr_file = OpenOptions::new()
        .create(true)
        .truncate(true)
        .read(true)
        .write(true)
        .open(root.join("cli.err"))
        .unwrap();

    let bin = env!("CARGO_BIN_EXE_devhost");
    let mut child = Command::new(bin)
        .args(["start", "--detach"])
        .current_dir(&project)
        .env("DEVHOST_STATE_DIR", &state_dir)
        .env("DEVHOST_CONFIG_DIR", &config_dir)
        .env("HOME", &home_dir)
        .env("AGENT", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::from(stdout_file))
        .stderr(Stdio::from(stderr_file))
        .spawn()
        .expect("spawn devhost start --detach");

    let reg_deadline = Instant::now() + Duration::from_secs(5);
    loop {
        if let Ok(stacks) = read_live_stacks(&caddy.caddy_dir)
            && !stacks.is_empty()
        {
            break;
        }
        if Instant::now() >= reg_deadline {
            let _ = child.kill();
            let _ = child.wait();
            panic!("detached supervisor did not register in time");
        }
        thread::sleep(Duration::from_millis(20));
    }

    // SAFETY: signaling child spawned by this test.
    assert_eq!(unsafe { libc::kill(child.id() as i32, libc::SIGTERM) }, 0);

    let exit_deadline = Instant::now() + Duration::from_secs(5);
    let status = loop {
        if let Some(status) = child.try_wait().unwrap() {
            break status;
        }
        if Instant::now() >= exit_deadline {
            let _ = child.kill();
            let _ = child.wait();
            panic!("devhost start --detach did not exit promptly after SIGTERM");
        }
        thread::sleep(Duration::from_millis(20));
    };
    assert!(!status.success());

    let stderr_text = fs::read_to_string(root.join("cli.err")).unwrap();
    assert!(stderr_text.contains("Startup log tail:"), "{stderr_text}");
    assert!(
        stderr_text.contains("received SIGTERM (signal 15) before the stack was ready; full log:"),
        "{stderr_text}"
    );
    assert!(read_live_stacks(&caddy.caddy_dir).unwrap().is_empty());
    assert!(read_live_stack_owners(&caddy.caddy_dir).unwrap().is_empty());
}

#[test]
fn detach_probe_service_health_respects_cancellation() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let hold_open = Arc::new(AtomicBool::new(true));
    let hold_flag = hold_open.clone();
    let acceptor = thread::spawn(move || {
        if let Ok((stream, _)) = listener.accept() {
            while hold_flag.load(Ordering::Relaxed) {
                thread::sleep(Duration::from_millis(10));
            }
            drop(stream);
        }
    });

    let health = ResolvedHealthConfig {
        fixed_tcp_port: false,
        host: None,
        interval_ms: 30_000,
        kind: HealthKind::Http,
        port: None,
        retries: 0,
        timeout_ms: 30_000,
        url: Some(format!("http://127.0.0.1:{port}/health")),
    };
    let cancel = Arc::new(AtomicBool::new(false));
    let cancel_bg = cancel.clone();
    let trigger = thread::spawn(move || {
        thread::sleep(Duration::from_millis(50));
        cancel_bg.store(true, Ordering::SeqCst);
    });
    let started = Instant::now();
    let result = probe_service_health(&health, &cancel);
    let elapsed = started.elapsed();
    hold_open.store(false, Ordering::Relaxed);
    trigger.join().unwrap();
    acceptor.join().unwrap();

    assert_eq!(result, None);
    assert!(
        elapsed < Duration::from_secs(1),
        "probe took {elapsed:?} despite cancel"
    );
}

#[test]
fn detach_symlink_manifest_and_append_logs_across_restarts() {
    let fixture = tempfile::tempdir().unwrap();
    let root = fixture.path();
    let caddy = LiveCaddyGuard::start(root);
    let config_dir = write_config(root, &caddy.settings);
    let state_dir = root.join("state");
    let home_dir = root.join("home");
    fs::create_dir_all(&home_dir).unwrap();

    let project = root.join("project");
    fs::create_dir_all(&project).unwrap();
    let server_py = project.join("server.py");
    fs::write(
        &server_py,
        r#"import http.server, os
print("boot-marker", flush=True)
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200); self.end_headers(); self.wfile.write(b"ok")
    def log_message(self, *args): pass
http.server.HTTPServer(("127.0.0.1", int(os.environ["PORT"])), H).serve_forever()
"#,
    )
    .unwrap();
    let manifest_path = project.join("devhost.toml");
    fs::write(
        &manifest_path,
        format!(
            r#"name = "symlink-append"
[worktrees]
enabled = false
[services.web]
command = ["python3", {server:?}]
host = "symlink-append.localhost"
port = "auto"
[services.web.health]
timeout = 5000
interval = 50
"#,
            server = server_py.to_str().unwrap()
        ),
    )
    .unwrap();

    let links = root.join("links");
    let alias_dir = links.join("alias");
    fs::create_dir_all(&alias_dir).unwrap();
    let alias_manifest = alias_dir.join("devhost.toml");
    symlink(&manifest_path, &alias_manifest).unwrap();
    let linked_dir = links.join("dir");
    symlink(&project, &linked_dir).unwrap();
    let linked_manifest = linked_dir.join("devhost.toml");

    let bin = env!("CARGO_BIN_EXE_devhost");
    let run_cli = |args: &[&str]| {
        Command::new(bin)
            .args(args)
            .current_dir(root)
            .env("DEVHOST_STATE_DIR", &state_dir)
            .env("DEVHOST_CONFIG_DIR", &config_dir)
            .env("HOME", &home_dir)
            .env("AGENT", "1")
            .output()
            .expect("run devhost")
    };

    let first = run_cli(&[
        "start",
        "--detach",
        "--manifest",
        alias_manifest.to_str().unwrap(),
    ]);
    assert!(
        first.status.success(),
        "{}",
        String::from_utf8_lossy(&first.stderr)
    );
    let stacks = read_live_stacks(&caddy.caddy_dir).unwrap();
    assert_eq!(stacks.len(), 1);
    assert_eq!(stacks[0].manifest_path, alias_manifest.to_string_lossy());
    let first_pid = stacks[0].pid;
    let log_path = stacks[0].log_path.clone();

    let second = run_cli(&[
        "start",
        "--detach",
        "--manifest",
        linked_manifest.to_str().unwrap(),
    ]);
    assert!(second.status.success());
    let second_out = String::from_utf8_lossy(&second.stdout);
    assert!(
        second_out.contains(&format!(
            "Already running symlink-append (PID {first_pid})."
        )),
        "{second_out}"
    );
    assert_eq!(
        read_live_stacks(&caddy.caddy_dir).unwrap()[0].pid,
        first_pid
    );

    let stop1 = run_cli(&["stop", "--manifest", linked_manifest.to_str().unwrap()]);
    assert!(stop1.status.success());

    let third = run_cli(&[
        "start",
        "--detach",
        "--manifest",
        alias_manifest.to_str().unwrap(),
    ]);
    assert!(third.status.success());
    let stop2 = run_cli(&["stop", "--manifest", alias_manifest.to_str().unwrap()]);
    assert!(stop2.status.success());

    let log_text = fs::read_to_string(&log_path).unwrap();
    assert_eq!(
        log_text.matches("boot-marker").count(),
        2,
        "expected append-only log across restarts:\n{log_text}"
    );
}
