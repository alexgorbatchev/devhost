use std::{
    collections::{BTreeMap, BTreeSet},
    ffi::OsString,
    fs,
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    os::unix::{ffi::OsStringExt, net::UnixListener, process::CommandExt},
    panic::{AssertUnwindSafe, catch_unwind},
    path::{Path, PathBuf},
    process::{Child, Command, ExitStatus, Stdio},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::{Duration, Instant},
};

use cli_command_kit::Mode;
use devhost::{
    caddy::{self, stacks::read_live_stacks},
    cliout::ServiceOutput,
    config::CaddySettings,
    daemon::{
        DaemonRecord, PROTOCOL_VERSION,
        client::{ensure_daemon, run_foreground},
        daemon_record_path,
        protocol::{FrameReader, LaunchKind, Request, ServerEvent, StoredLaunchSpec, write_frame},
        read_live_daemon, write_daemon_record,
    },
    manifest, procid,
    services::{
        containment::SERVICE_CONTAINMENT_TOKEN_ENV,
        detach::LaunchMetadata,
        resolve::{PortResolutionOptions, resolve_service_order, resolve_service_ports},
        stack::{StartStackOptions, start_stack},
    },
};

fn wait_child_with_timeout(child: &mut Child, timeout: Duration) -> ExitStatus {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if let Some(status) = child.try_wait().unwrap() {
            return status;
        }
        thread::sleep(Duration::from_millis(20));
    }
    let _ = child.kill();
    let _ = child.wait();
    panic!("child process did not exit within {timeout:?}");
}

fn free_port() -> u16 {
    static ALLOCATED: std::sync::OnceLock<Mutex<BTreeSet<u16>>> = std::sync::OnceLock::new();
    let mut allocated = ALLOCATED.get_or_init(Mutex::default).lock().unwrap();
    loop {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        if allocated.insert(port) {
            return port;
        }
    }
}

fn wait_until(timeout: Duration, mut check: impl FnMut() -> bool) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if check() {
            return true;
        }
        thread::sleep(Duration::from_millis(50));
    }
    check()
}

fn http_get_host(port: u16, host: &str, path: &str) -> String {
    let Ok(mut stream) = TcpStream::connect(("127.0.0.1", port)) else {
        return String::new();
    };
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    let req = format!("GET {path} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n");
    if stream.write_all(req.as_bytes()).is_err() {
        return String::new();
    }
    let mut body = String::new();
    let _ = stream.read_to_string(&mut body);
    body
}

struct IsolatedEnv {
    _root: tempfile::TempDir,
    root_path: PathBuf,
    state_dir: PathBuf,
    config_dir: PathBuf,
    settings: CaddySettings,
}

impl IsolatedEnv {
    fn start() -> Self {
        let root = tempfile::tempdir().unwrap();
        let root_path = root.path().to_path_buf();
        let state_dir = root_path.join("state");
        let caddy_dir = state_dir.join("caddy");
        let config_dir = root_path.join("config");
        fs::create_dir_all(&config_dir).unwrap();

        let settings = CaddySettings {
            admin_address: format!("127.0.0.1:{}", free_port()),
            bind_host: "127.0.0.1".to_owned(),
            http_enabled: true,
            http_port: free_port(),
            https_port: free_port(),
            stack_directory_host: "stacks.localhost".to_owned(),
            stack_directory_allow_remote: false,
        };
        fs::write(
            config_dir.join("config.toml"),
            format!(
                r#"[caddy]
adminAddress = {:?}
bindHost = {:?}
http = {}
httpPort = {}
httpsPort = {}
stackDirectoryHost = {:?}
"#,
                settings.admin_address,
                settings.bind_host,
                settings.http_enabled,
                settings.http_port,
                settings.https_port,
                settings.stack_directory_host,
            ),
        )
        .unwrap();

        let mut out = Vec::new();
        caddy::start_in_directory(&caddy_dir, &settings, Mode::Agent, &mut out, true)
            .unwrap_or_else(|error| {
                panic!(
                    "start isolated caddy: {error:?}\n{}",
                    String::from_utf8_lossy(&out)
                );
            });

        Self {
            _root: root,
            root_path,
            state_dir,
            config_dir,
            settings,
        }
    }

    fn bin() -> &'static str {
        env!("CARGO_BIN_EXE_devhost")
    }

    fn command(&self) -> Command {
        let mut cmd = Command::new(Self::bin());
        cmd.env("AGENT", "1")
            .env("DEVHOST_STATE_DIR", &self.state_dir)
            .env("DEVHOST_CONFIG_DIR", &self.config_dir)
            .env_remove("DEVHOST_MANIFEST");
        cmd
    }

    fn caddy_dir(&self) -> PathBuf {
        self.state_dir.join("caddy")
    }

    fn create_http_project(&self, name: &str, host: &str, tag_var: &str) -> PathBuf {
        let dir = self.root_path.join(name);
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join("server.py"),
            r#"import http.server, os, sys
port = int(os.environ["PORT"])
tag = os.environ.get("RESOLVED_TAG", "")
raw = os.environ.get("CUSTOM_TAG", "")
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        body = f"{tag}:{raw}".encode()
        self.send_response(200)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def do_HEAD(self):
        self.send_response(200)
        self.end_headers()
    def log_message(self, *args):
        pass
http.server.ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()
"#,
        )
        .unwrap();
        fs::write(
            dir.join("devhost.toml"),
            format!(
                r#"name = {name:?}

[services.web]
command = ["python3", "server.py"]
port = "auto"
host = {host:?}

[services.web.env]
RESOLVED_TAG = "{{{{ env.{tag_var} }}}}"
"#
            ),
        )
        .unwrap();
        dir
    }
}

impl Drop for IsolatedEnv {
    fn drop(&mut self) {
        if let Ok(stacks) = read_live_stacks(&self.caddy_dir()) {
            for stack in stacks {
                if !stack.daemon_socket.is_empty() {
                    let _ = devhost::daemon::client::stop_live_stack(
                        Path::new(&stack.daemon_socket),
                        &stack.stack_id,
                        stack.pid,
                        libc::SIGTERM,
                        Duration::from_secs(3),
                    );
                }
            }
        }
        let mut out = Vec::new();
        let _ = caddy::stop_in_directory(&self.caddy_dir(), &self.settings, Mode::Agent, &mut out);
    }
}

struct ChildGuard(Option<Child>);
impl Drop for ChildGuard {
    fn drop(&mut self) {
        if let Some(mut child) = self.0.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

#[test]
fn multiple_stacks_and_serve_sessions_share_one_daemon_isolate_env_and_auto_exit() {
    let env = IsolatedEnv::start();
    let proj_a = env.create_http_project("stack-alpha", "alpha-single", "CUSTOM_TAG");
    let proj_b = env.create_http_project("stack-beta", "beta-single", "CUSTOM_TAG");

    // Start stack A detached with CUSTOM_TAG=alpha
    let out_a = env
        .command()
        .current_dir(&proj_a)
        .env("CUSTOM_TAG", "alpha")
        .args(["start", "--detach"])
        .output()
        .unwrap();
    assert!(
        out_a.status.success(),
        "start A failed: {} {}",
        String::from_utf8_lossy(&out_a.stdout),
        String::from_utf8_lossy(&out_a.stderr)
    );

    // Start stack B detached with CUSTOM_TAG=beta
    let out_b = env
        .command()
        .current_dir(&proj_b)
        .env("CUSTOM_TAG", "beta")
        .args(["start", "--detach"])
        .output()
        .unwrap();
    assert!(
        out_b.status.success(),
        "start B failed: {} {}",
        String::from_utf8_lossy(&out_b.stdout),
        String::from_utf8_lossy(&out_b.stderr)
    );

    // Start a foreground static file serve session
    let files_dir = env.root_path.join("static-files");
    fs::create_dir_all(&files_dir).unwrap();
    fs::write(files_dir.join("index.html"), "hello-from-shared-daemon").unwrap();
    let mut fg_serve = ChildGuard(Some(
        env.command()
            .current_dir(&files_dir)
            .args(["serve", "--domain", "static-single.localhost"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap(),
    ));
    assert!(wait_until(Duration::from_secs(10), || {
        http_get_host(env.settings.http_port, "static-single.localhost", "/")
            .contains("hello-from-shared-daemon")
    }));

    // Start a detached command serve session
    let cmd_dir = env.root_path.join("cmd-serve");
    fs::create_dir_all(&cmd_dir).unwrap();
    let cmd_port = free_port();
    let cmd_out = env
        .command()
        .current_dir(&cmd_dir)
        .args([
            "serve",
            "--detach",
            "--name",
            "cmdsingle",
            "--",
            "python3",
            "-m",
            "http.server",
            &cmd_port.to_string(),
            "--bind",
            "127.0.0.1",
        ])
        .output()
        .unwrap();
    assert!(
        cmd_out.status.success(),
        "detached serve failed: {} {}",
        String::from_utf8_lossy(&cmd_out.stdout),
        String::from_utf8_lossy(&cmd_out.stderr)
    );

    // Verify all 4 stacks run inside the EXACT SAME single daemon PID with 4 distinct stack_ids
    let live = read_live_stacks(&env.caddy_dir()).unwrap();
    assert_eq!(live.len(), 4, "expected 4 live stacks: {live:?}");
    let daemon_pid = live[0].pid;
    let daemon_socket = live[0].daemon_socket.clone();
    assert!(!daemon_socket.is_empty());
    let stack_ids: BTreeSet<&str> = live.iter().map(|s| s.stack_id.as_str()).collect();
    assert_eq!(stack_ids.len(), 4, "stack IDs must be distinct: {live:?}");
    for stack in &live {
        assert_eq!(
            stack.pid, daemon_pid,
            "all stacks must share one daemon PID: {live:?}"
        );
        assert_eq!(stack.daemon_socket, daemon_socket);
    }
    let daemon_record = read_live_daemon(&env.state_dir).expect("live daemon.json");
    assert_eq!(daemon_record.pid, daemon_pid);

    // Verify per-stack environment isolation ({{ env.CUSTOM_TAG }} + child env)
    let resp_a = http_get_host(env.settings.http_port, "alpha-single.localhost", "/");
    let resp_b = http_get_host(env.settings.http_port, "beta-single.localhost", "/");
    assert!(resp_a.contains("alpha:alpha"), "unexpected A: {resp_a}");
    assert!(resp_b.contains("beta:beta"), "unexpected B: {resp_b}");

    // Verify stack directory page lists all 4 stacks with distinct IDs under the shared PID
    let dir_page = http_get_host(env.settings.http_port, "stacks.localhost", "/");
    assert!(dir_page.contains("stack-alpha"), "{dir_page}");
    assert!(dir_page.contains("stack-beta"), "{dir_page}");
    let json_start = dir_page
        .split("<script id=\"devhost-status-data\" type=\"application/json\">")
        .nth(1)
        .expect("status data script");
    let json_text = json_start.split("</script>").next().unwrap().trim();
    let payload: serde_json::Value = serde_json::from_str(json_text).unwrap();
    let dir_stacks = payload["stacks"].as_array().unwrap();
    assert_eq!(dir_stacks.len(), 4);
    let ui_ids: BTreeSet<&str> = dir_stacks
        .iter()
        .map(|s| s["id"].as_str().unwrap())
        .collect();
    assert_eq!(ui_ids.len(), 4);

    // Abruptly SIGKILL the foreground serve client -> daemon tears down ONLY that foreground session
    let mut fg_child = fg_serve.0.take().unwrap();
    let _ = fg_child.kill();
    let _ = fg_child.wait();
    assert!(wait_until(Duration::from_secs(5), || {
        read_live_stacks(&env.caddy_dir())
            .unwrap()
            .iter()
            .all(|s| s.name != "serve-static-single.localhost")
    }));
    // Other 3 stacks stay alive in the exact same daemon PID
    let after_kill = read_live_stacks(&env.caddy_dir()).unwrap();
    assert_eq!(after_kill.len(), 3);
    assert!(after_kill.iter().all(|s| s.pid == daemon_pid));
    assert!(
        http_get_host(env.settings.http_port, "alpha-single.localhost", "/")
            .contains("alpha:alpha")
    );
    assert!(
        http_get_host(env.settings.http_port, "beta-single.localhost", "/").contains("beta:beta")
    );

    // Stop stack A -> stack B and command serve remain untouched under the same daemon PID
    let stop_a = env
        .command()
        .current_dir(&proj_a)
        .arg("stop")
        .output()
        .unwrap();
    assert!(stop_a.status.success(), "{stop_a:?}");
    let after_stop_a = read_live_stacks(&env.caddy_dir()).unwrap();
    assert_eq!(after_stop_a.len(), 2);
    assert!(after_stop_a.iter().all(|s| s.pid == daemon_pid));
    assert!(
        http_get_host(env.settings.http_port, "beta-single.localhost", "/").contains("beta:beta")
    );

    // Stop command serve session
    let cmd_session = after_stop_a
        .iter()
        .find(|s| s.manifest_path.is_empty())
        .unwrap()
        .name
        .clone();
    let stop_cmd = env
        .command()
        .args(["stop", "--session", &cmd_session])
        .output()
        .unwrap();
    assert!(stop_cmd.status.success(), "{stop_cmd:?}");
    assert_eq!(read_live_stacks(&env.caddy_dir()).unwrap().len(), 1);
    assert!(procid::is_process_alive(daemon_pid));

    // Stop stack B (the LAST stack) -> daemon auto-exits and removes daemon.json & socket
    let stop_b = env
        .command()
        .current_dir(&proj_b)
        .arg("stop")
        .output()
        .unwrap();
    assert!(stop_b.status.success(), "{stop_b:?}");
    assert!(read_live_stacks(&env.caddy_dir()).unwrap().is_empty());
    assert!(
        wait_until(Duration::from_secs(3), || !procid::is_process_alive(
            daemon_pid
        )),
        "daemon PID {daemon_pid} did not auto-exit after stopping last stack"
    );
    assert!(!daemon_record_path(&env.state_dir).exists());
    assert!(!Path::new(&daemon_socket).exists());
}

#[test]
fn foreground_sigint_and_external_stop_preserve_peer_stack_and_exit_codes() {
    let env = IsolatedEnv::start();
    let peer = env.create_http_project("peer-detached", "peer-fg", "CUSTOM_TAG");
    let fg_proj = env.create_http_project("fg-signal", "fg-sig", "CUSTOM_TAG");

    let peer_out = env
        .command()
        .current_dir(&peer)
        .env("CUSTOM_TAG", "peer")
        .args(["start", "--detach"])
        .output()
        .unwrap();
    assert!(peer_out.status.success(), "{peer_out:?}");
    let daemon_pid = read_live_stacks(&env.caddy_dir()).unwrap()[0].pid;

    // 1. Start fg-signal in foreground, then send SIGINT -> exits 130, peer untouched
    let mut fg = env
        .command()
        .current_dir(&fg_proj)
        .env("CUSTOM_TAG", "fg1")
        .arg("start")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    assert!(wait_until(Duration::from_secs(10), || {
        http_get_host(env.settings.http_port, "fg-sig.localhost", "/").contains("fg1:fg1")
    }));
    let live = read_live_stacks(&env.caddy_dir()).unwrap();
    assert_eq!(live.len(), 2);
    assert!(live.iter().all(|s| s.pid == daemon_pid));

    // SAFETY: sending SIGINT to our own spawned foreground client child.
    unsafe {
        libc::kill(fg.id() as i32, libc::SIGINT);
    }
    let status = wait_child_with_timeout(&mut fg, Duration::from_secs(10));
    assert_eq!(status.code(), Some(128 + libc::SIGINT));
    assert!(wait_until(Duration::from_secs(3), || {
        read_live_stacks(&env.caddy_dir()).unwrap().len() == 1
    }));
    assert!(procid::is_process_alive(daemon_pid));
    assert!(http_get_host(env.settings.http_port, "peer-fg.localhost", "/").contains("peer:peer"));

    // 2. Start fg-signal in foreground again, then stop externally via `devhost stop` -> exits 143
    let mut fg2 = env
        .command()
        .current_dir(&fg_proj)
        .env("CUSTOM_TAG", "fg2")
        .arg("start")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    assert!(wait_until(Duration::from_secs(10), || {
        http_get_host(env.settings.http_port, "fg-sig.localhost", "/").contains("fg2:fg2")
    }));
    let stop_fg = env
        .command()
        .current_dir(&fg_proj)
        .arg("stop")
        .output()
        .unwrap();
    assert!(stop_fg.status.success(), "{stop_fg:?}");
    let status2 = wait_child_with_timeout(&mut fg2, Duration::from_secs(10));
    assert_eq!(status2.code(), Some(128 + libc::SIGTERM));
    assert!(procid::is_process_alive(daemon_pid));
    assert!(http_get_host(env.settings.http_port, "peer-fg.localhost", "/").contains("peer:peer"));

    // Stop peer -> daemon exits cleanly
    let stop_peer = env
        .command()
        .current_dir(&peer)
        .arg("stop")
        .output()
        .unwrap();
    assert!(stop_peer.status.success(), "{stop_peer:?}");
    assert!(wait_until(Duration::from_secs(3), || {
        !procid::is_process_alive(daemon_pid)
    }));
}

#[derive(Clone, Default)]
struct SharedBuf(Arc<Mutex<Vec<u8>>>);
impl Write for SharedBuf {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(buf);
        Ok(buf.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

#[test]
fn ensure_daemon_rejects_incompatible_protocol_and_warns_on_binary_mismatch() {
    let dir = tempfile::tempdir().unwrap();
    let sock_path = dir.path().join("mock.sock");
    let pid = std::process::id() as i32;
    let start_id = String::new();

    // Case 1: Incompatible protocol version fails with restart hint.
    let listener = UnixListener::bind(&sock_path).unwrap();
    write_daemon_record(
        dir.path(),
        &DaemonRecord {
            protocol_version: PROTOCOL_VERSION + 99,
            pid,
            start_identity: start_id.clone(),
            socket_path: sock_path.to_string_lossy().into_owned(),
            version: "9.9.9".to_owned(),
            exe_path: "/fake/devhost".to_owned(),
            exe_identity: "old-id".to_owned(),
            context_fingerprint: String::new(),
        },
    )
    .unwrap();
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut reader = FrameReader::new(stream.try_clone().unwrap());
        let req: Option<Request> = reader.read_frame().unwrap();
        assert!(matches!(req, Some(Request::Hello)));
        write_frame(
            &mut stream,
            &ServerEvent::Hello {
                protocol_version: PROTOCOL_VERSION + 99,
                pid,
                version: "9.9.9".to_owned(),
                exe_path: "/fake/devhost".to_owned(),
                exe_identity: "old-id".to_owned(),
                context_fingerprint: String::new(),
                draining: false,
            },
        )
        .unwrap();
    });
    let err = ensure_daemon(dir.path(), None, None, Mode::Agent).unwrap_err();
    server.join().unwrap();
    assert!(
        err.message.contains("incompatible protocol version"),
        "{err:?}"
    );
    assert!(
        err.hint
            .as_deref()
            .is_some_and(|h| h.contains("devhost restart")),
        "{err:?}"
    );

    // Case 2: Compatible protocol with different exe_identity warns and reuses daemon.
    let _ = fs::remove_file(&sock_path);
    let listener2 = UnixListener::bind(&sock_path).unwrap();
    write_daemon_record(
        dir.path(),
        &DaemonRecord {
            protocol_version: PROTOCOL_VERSION,
            pid,
            start_identity: start_id,
            socket_path: sock_path.to_string_lossy().into_owned(),
            version: "0.0.1".to_owned(),
            exe_path: "/fake/devhost".to_owned(),
            exe_identity: "different-binary-identity".to_owned(),
            context_fingerprint: String::new(),
        },
    )
    .unwrap();
    let server2 = thread::spawn(move || {
        let (mut stream, _) = listener2.accept().unwrap();
        let mut reader = FrameReader::new(stream.try_clone().unwrap());
        let req: Option<Request> = reader.read_frame().unwrap();
        assert!(matches!(req, Some(Request::Hello)));
        write_frame(
            &mut stream,
            &ServerEvent::Hello {
                protocol_version: PROTOCOL_VERSION,
                pid,
                version: "0.0.1".to_owned(),
                exe_path: "/fake/devhost".to_owned(),
                exe_identity: "different-binary-identity".to_owned(),
                context_fingerprint: String::new(),
                draining: false,
            },
        )
        .unwrap();
    });
    let out_buf = SharedBuf::default();
    let err_buf = SharedBuf::default();
    let output = ServiceOutput::new(
        Mode::Agent,
        Box::new(out_buf),
        Box::new(err_buf.clone()),
        &["devhost"],
    );
    let endpoint = ensure_daemon(dir.path(), None, Some(&output), Mode::Agent).unwrap();
    server2.join().unwrap();
    assert_eq!(endpoint.pid, pid);
    let stderr = String::from_utf8_lossy(&err_buf.0.lock().unwrap()).into_owned();
    assert!(
        stderr.contains("different executable") && stderr.contains("devhost restart"),
        "{stderr}"
    );
}

#[test]
fn daemon_handles_unknown_rpc_targets_retires_removed_cwd_and_shuts_down_on_sigterm() {
    let env = IsolatedEnv::start();
    let proj_keep = env.create_http_project("keep-stack", "keep-edge", "CUSTOM_TAG");
    let proj_vanish = env.create_http_project("vanish-stack", "vanish-edge", "CUSTOM_TAG");

    let out_keep = env
        .command()
        .current_dir(&proj_keep)
        .env("CUSTOM_TAG", "keep")
        .args(["start", "--detach"])
        .output()
        .unwrap();
    assert!(out_keep.status.success(), "{out_keep:?}");
    let out_vanish = env
        .command()
        .current_dir(&proj_vanish)
        .env("CUSTOM_TAG", "vanish")
        .args(["start", "--detach"])
        .output()
        .unwrap();
    assert!(out_vanish.status.success(), "{out_vanish:?}");

    let live = read_live_stacks(&env.caddy_dir()).unwrap();
    assert_eq!(live.len(), 2);
    let sock = PathBuf::from(&live[0].daemon_socket);
    let daemon_pid = live[0].pid;

    // Unknown stack IDs on StopStack and RestartStack return clean responses without hurting peers.
    assert!(
        devhost::daemon::client::stop_live_stack(
            &sock,
            "stk-nonexistent",
            daemon_pid,
            libc::SIGTERM,
            Duration::from_secs(2),
        )
        .unwrap()
    );
    let restart_err = devhost::daemon::client::restart_stack_in_daemon(
        &sock,
        "stk-nonexistent",
        &env.root_path.join("unused.log"),
        false,
    )
    .unwrap_err();
    assert!(restart_err.contains("no longer running"), "{restart_err}");

    // Remove proj_vanish working directory -> restart retires vanish-stack and replaces keep-stack in a new daemon.
    fs::remove_dir_all(&proj_vanish).unwrap();
    let restart_out = env
        .command()
        .current_dir(&env.root_path)
        .arg("restart")
        .output()
        .unwrap();
    assert!(restart_out.status.success(), "{restart_out:?}");
    let restart_stdout = String::from_utf8_lossy(&restart_out.stdout);
    assert!(
        restart_stdout.contains("launch directory was removed"),
        "{restart_stdout}"
    );
    assert!(wait_until(Duration::from_secs(10), || {
        http_get_host(env.settings.http_port, "keep-edge.localhost", "/").contains("keep:keep")
    }));
    let after = read_live_stacks(&env.caddy_dir()).unwrap();
    assert_eq!(after.len(), 1);
    assert_eq!(after[0].name, "keep-stack");
    assert_ne!(after[0].pid, daemon_pid);
    assert!(!procid::is_process_alive(daemon_pid));

    // Sending SIGTERM directly to the shared daemon stops hosted stacks and cleans up state.
    let new_daemon_pid = after[0].pid;
    let new_sock = PathBuf::from(&after[0].daemon_socket);
    // SAFETY: sending SIGTERM to the isolated test daemon process we own.
    unsafe {
        libc::kill(new_daemon_pid, libc::SIGTERM);
    }
    assert!(wait_until(Duration::from_secs(10), || {
        !procid::is_process_alive(new_daemon_pid)
    }));
    assert!(read_live_stacks(&env.caddy_dir()).unwrap().is_empty());
    assert!(!daemon_record_path(&env.state_dir).exists());
    assert!(!new_sock.exists());
}

#[test]
fn restart_upgrades_legacy_per_stack_process_into_shared_daemon() {
    let env = IsolatedEnv::start();
    let proj = env.create_http_project("legacy-upgrade", "legacy-up", "CUSTOM_TAG");
    let manifest_path = proj.join("devhost.toml");

    // Simulate a running pre-daemon per-stack process whose argv[1] is "start"
    // and whose stack record has no daemonSocket.
    fs::write(
        proj.join("start"),
        "trap 'exit 0' TERM; printf ready > ready.$$; while :; do sleep 0.05; done\n",
    )
    .unwrap();
    let mut legacy_cmd = Command::new("sh");
    legacy_cmd
        .arg("start")
        .arg("--manifest")
        .arg(&manifest_path)
        .current_dir(&proj)
        .env("DEVHOST_STATE_DIR", &env.state_dir)
        .env("DEVHOST_CONFIG_DIR", &env.config_dir)
        .env("HOME", env.root_path.join("home"))
        .env("CUSTOM_TAG", "upgraded-env")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    // SAFETY: setsid detaches the simulated legacy supervisor into its own session.
    unsafe {
        legacy_cmd.pre_exec(|| {
            if libc::setsid() < 0 {
                Err(std::io::Error::last_os_error())
            } else {
                Ok(())
            }
        });
    }
    let mut legacy_child = legacy_cmd.spawn().unwrap();
    let legacy_pid = legacy_child.id() as i32;
    let ready_file = proj.join(format!("ready.{legacy_pid}"));
    assert!(wait_until(Duration::from_secs(3), || ready_file.exists()));
    let _ = fs::remove_file(&ready_file);
    let legacy_identity = procid::start_identity(legacy_pid).unwrap_or_default();

    let stacks_dir = env.caddy_dir().join("stacks");
    fs::create_dir_all(&stacks_dir).unwrap();
    fs::write(
        stacks_dir.join(format!("{legacy_pid}.json")),
        serde_json::to_vec(&serde_json::json!({
            "remote": false,
            "createdAt": "2026-11-25T00:00:00Z",
            "manifestPath": manifest_path.to_string_lossy(),
            "manifestFiles": [manifest_path.to_string_lossy()],
            "ownerPid": legacy_pid,
            "ownerStartIdentity": legacy_identity,
            "stackName": "legacy-upgrade"
        }))
        .unwrap(),
    )
    .unwrap();

    // Run `devhost restart`: must stop legacy_pid and start the stack inside the shared daemon.
    let waiter =
        thread::spawn(move || wait_child_with_timeout(&mut legacy_child, Duration::from_secs(10)));
    let restart_out = env
        .command()
        .current_dir(&env.root_path)
        .arg("restart")
        .output()
        .unwrap();
    let legacy_status = waiter.join().unwrap();
    assert!(
        restart_out.status.success(),
        "restart failed on legacy stack: stdout={} stderr={}",
        String::from_utf8_lossy(&restart_out.stdout),
        String::from_utf8_lossy(&restart_out.stderr)
    );
    assert!(legacy_status.success() || legacy_status.code().is_some());

    assert!(wait_until(Duration::from_secs(10), || {
        http_get_host(env.settings.http_port, "legacy-up.localhost", "/")
            .contains("upgraded-env:upgraded-env")
    }));
    let live = read_live_stacks(&env.caddy_dir()).unwrap();
    assert_eq!(live.len(), 1);
    assert_eq!(live[0].name, "legacy-upgrade");
    assert!(
        !live[0].daemon_socket.is_empty(),
        "replacement must run in shared daemon"
    );
    assert_ne!(live[0].pid, legacy_pid);
    let daemon_pid = live[0].pid;

    let stop_out = env
        .command()
        .current_dir(&proj)
        .arg("stop")
        .output()
        .unwrap();
    assert!(stop_out.status.success(), "{stop_out:?}");
    assert!(wait_until(Duration::from_secs(3), || {
        !procid::is_process_alive(daemon_pid)
    }));
}

#[test]
fn token_inheritance_is_stripped_non_utf8_env_isolated_and_orphaned_claim_stop_preserves_daemon() {
    let env = IsolatedEnv::start();
    let make_env_echo = |name: &str, host: &str| {
        let dir = env.root_path.join(name);
        fs::create_dir_all(&dir).unwrap();
        let script = dir.join("srv.py");
        fs::write(
            &script,
            r#"import http.server, os, socketserver
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        tok = os.environ.get("DEVHOST_SERVICE_TOKEN", "")
        raw = os.environb.get(b"RAW_BYTES", b"").hex()
        body = f"tok={tok};raw={raw}".encode()
        self.send_response(200)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def log_message(self, *args):
        pass
class S(socketserver.TCPServer):
    allow_reuse_address = True
with S(("127.0.0.1", int(os.environ["PORT"])), H) as httpd:
    httpd.serve_forever()
"#,
        )
        .unwrap();
        fs::write(
            dir.join("devhost.toml"),
            format!(
                r#"name = {name:?}
[worktrees]
enabled = false
[services.app]
command = ["python3", {script:?}]
port = "auto"
host = {host:?}
[services.app.health]
http = "/"
timeout = 5000
interval = 50
"#
            ),
        )
        .unwrap();
        dir
    };

    let proj_a = make_env_echo("iso-a", "iso-a");
    let proj_b = make_env_echo("iso-b", "iso-b");

    let out_a = env
        .command()
        .current_dir(&proj_a)
        .env("RAW_BYTES", OsString::from_vec(vec![0xfe, b'A']))
        .args(["start", "--detach"])
        .output()
        .unwrap();
    assert!(out_a.status.success(), "{out_a:?}");

    let body_a = http_get_host(env.settings.http_port, "iso-a.localhost", "/");
    let tok_a = body_a
        .split("tok=")
        .nth(1)
        .and_then(|s| s.split(';').next())
        .unwrap()
        .to_owned();
    assert!(!tok_a.is_empty(), "{body_a}");
    assert!(body_a.contains("raw=fe41"), "{body_a}");

    // Launch stack B with stack A's DEVHOST_SERVICE_TOKEN and a distinct non-UTF-8 env var.
    let out_b = env
        .command()
        .current_dir(&proj_b)
        .env(SERVICE_CONTAINMENT_TOKEN_ENV, &tok_a)
        .env("RAW_BYTES", OsString::from_vec(vec![0xff, b'B']))
        .args(["start", "--detach"])
        .output()
        .unwrap();
    assert!(out_b.status.success(), "{out_b:?}");

    let body_b = http_get_host(env.settings.http_port, "iso-b.localhost", "/");
    let tok_b = body_b
        .split("tok=")
        .nth(1)
        .and_then(|s| s.split(';').next())
        .unwrap()
        .to_owned();
    assert!(!tok_b.is_empty(), "{body_b}");
    assert_ne!(tok_a, tok_b, "stack B must get its own containment token");
    assert!(
        body_b.contains("raw=ff42"),
        "stack B must inherit its own non-UTF-8 env var, not daemon's: {body_b}"
    );

    let live = read_live_stacks(&env.caddy_dir()).unwrap();
    assert_eq!(live.len(), 2);
    let daemon_pid = live[0].pid;

    #[cfg(target_os = "linux")]
    {
        let daemon_cwd = fs::read_link(format!("/proc/{daemon_pid}/cwd")).unwrap();
        assert_eq!(daemon_cwd, Path::new("/"), "daemon must chdir to /");
    }

    // Plant an orphaned host claim under the live daemon PID for an unrelated manifest
    // with no active stack record, then run `devhost stop --manifest` on it:
    // must clean up the orphan WITHOUT killing the shared daemon or live stacks!
    let orphan_proj = env.root_path.join("orphan-proj");
    fs::create_dir_all(&orphan_proj).unwrap();
    let orphan_manifest = orphan_proj.join("devhost.toml");
    fs::write(&orphan_manifest, "name = 'orphan'\n").unwrap();
    let claim_path = env
        .caddy_dir()
        .join("routes/.host-claims/orphan-ghost.localhost.json");
    fs::create_dir_all(claim_path.parent().unwrap()).unwrap();
    fs::write(
        &claim_path,
        serde_json::to_vec(&serde_json::json!({
            "createdAt": "2026-11-25T00:00:00Z",
            "host": "orphan-ghost.localhost",
            "manifestPath": orphan_manifest.to_string_lossy(),
            "ownerPid": daemon_pid,
            "ownerStartIdentity": live[0].owner_start_identity,
            "ownerStackId": "stk-dead-orphan"
        }))
        .unwrap(),
    )
    .unwrap();

    let stop_orphan = env
        .command()
        .current_dir(&orphan_proj)
        .args(["stop", "--manifest"])
        .arg(&orphan_manifest)
        .output()
        .unwrap();
    assert!(stop_orphan.status.success(), "{stop_orphan:?}");
    assert!(
        !claim_path.exists(),
        "orphaned host claim should be removed"
    );
    assert!(
        procid::is_process_alive(daemon_pid),
        "devhost stop must never signal a live shared daemon PID"
    );

    // Stop stack A -> stack B stays alive and healthy.
    let stop_a = env
        .command()
        .current_dir(&proj_a)
        .arg("stop")
        .output()
        .unwrap();
    assert!(stop_a.status.success(), "{stop_a:?}");
    assert!(http_get_host(env.settings.http_port, "iso-b.localhost", "/").contains("raw=ff42"));

    let stop_b = env
        .command()
        .current_dir(&proj_b)
        .arg("stop")
        .output()
        .unwrap();
    assert!(stop_b.status.success(), "{stop_b:?}");
    assert!(wait_until(Duration::from_secs(3), || {
        !procid::is_process_alive(daemon_pid)
    }));
}

#[test]
fn panic_inside_start_stack_unwinds_services_claims_routes_and_stack_record() {
    let env = IsolatedEnv::start();
    let proj = env.root_path.join("panic-proj");
    fs::create_dir_all(&proj).unwrap();
    let pid_file = proj.join("child.pid");
    let fixed_port = free_port();
    let script = proj.join("srv.py");
    fs::write(
        &script,
        format!(
            r#"import http.server, os, socketserver
with open({pid_file:?}, "w") as f:
    f.write(str(os.getpid()))
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Length", "2")
        self.end_headers()
        self.wfile.write(b"ok")
    def log_message(self, *args):
        pass
class S(socketserver.TCPServer):
    allow_reuse_address = True
with S(("127.0.0.1", int(os.environ["PORT"])), H) as httpd:
    httpd.serve_forever()
"#
        ),
    )
    .unwrap();
    let manifest_path = proj.join("devhost.toml");
    fs::write(
        &manifest_path,
        format!(
            r#"name = "panic-stack"
[worktrees]
enabled = false
[services.app]
command = ["python3", {script:?}]
port = {fixed_port}
host = "panic-unwind"
[services.app.health]
http = "/"
timeout = 5000
interval = 50
"#
        ),
    )
    .unwrap();

    let validated = manifest::read_manifest(&proj, Some(&manifest_path)).unwrap();
    let order = resolve_service_order(&validated).unwrap();
    let mut resolved =
        resolve_service_ports(&validated, &PortResolutionOptions::default()).unwrap();

    // Writer that panics right after the service is running and URLs are logged,
    // verifying StackCleanup::drop tears down everything on unwind.
    struct PanicOnUrlWriter {
        armed: Arc<AtomicBool>,
    }
    impl Write for PanicOnUrlWriter {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            let text = String::from_utf8_lossy(buf);
            if text.contains("panic-unwind.localhost") && self.armed.swap(false, Ordering::SeqCst) {
                panic!("injected supervisor panic after startup");
            }
            Ok(buf.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    let armed = Arc::new(AtomicBool::new(true));
    let output = ServiceOutput::new(
        Mode::Agent,
        Box::new(PanicOnUrlWriter {
            armed: armed.clone(),
        }),
        Box::new(SharedBuf::default()),
        &["panic-stack", "app", "devhost", "caddy"],
    );

    let result = catch_unwind(AssertUnwindSafe(|| {
        start_stack(
            &mut resolved,
            &order,
            StartStackOptions {
                stack_id: "stk-panic-test".to_owned(),
                daemon_socket: String::new(),
                command_serve_timeout: None,
                runtime_control: None,
                serve_session: false,
                runtime_errors: None,
                configuration: Some(validated),
                caddy_dir: env.caddy_dir(),
                config_path: Some(env.config_dir.join("config.toml")),
                environment: BTreeMap::new(),
                non_unicode_environment: Some(Vec::new()),
                output,
                debug_caddy: false,
                shutdown_grace_period: Some(Duration::from_secs(2)),
                idle_timeout: None,
                install_signal_handlers: false,
                external_cancel: None,
                external_signal: None,
                ready_notify: None,
                launch: LaunchMetadata::default(),
            },
        )
    }));
    assert!(result.is_err(), "expected injected panic");

    // Child service must have been stopped by StackCleanup::drop.
    let child_pid: i32 = fs::read_to_string(&pid_file)
        .unwrap()
        .trim()
        .parse()
        .unwrap();
    assert!(
        wait_until(Duration::from_secs(3), || !procid::is_process_alive(
            child_pid
        )),
        "leaked child process {child_pid} after panic unwind"
    );
    // Stack record, host claims, fixed-port claims, and route registrations must all be gone.
    assert!(read_live_stacks(&env.caddy_dir()).unwrap().is_empty());
    let has_files = |sub: &str| {
        let dir = env.caddy_dir().join(sub);
        dir.exists()
            && fs::read_dir(&dir)
                .unwrap()
                .flatten()
                .any(|e| e.path().extension().is_some_and(|ext| ext == "json"))
    };
    assert!(!has_files("routes/.host-claims"), "leaked host claims");
    assert!(!has_files("port-claims"), "leaked fixed-port claims");
    assert!(
        !has_files("routes/.registrations"),
        "leaked route registrations"
    );
}

#[test]
fn idle_exit_connect_race_retries_on_draining_daemon_and_succeeds() {
    let dir = tempfile::tempdir().unwrap();
    let sock1 = dir.path().join("draining.sock");
    let sock2 = dir.path().join("fresh.sock");
    let pid = std::process::id() as i32;

    let l1 = UnixListener::bind(&sock1).unwrap();
    let l2 = UnixListener::bind(&sock2).unwrap();
    write_daemon_record(
        dir.path(),
        &DaemonRecord {
            protocol_version: PROTOCOL_VERSION,
            pid,
            start_identity: String::new(),
            socket_path: sock1.to_string_lossy().into_owned(),
            version: "test".to_owned(),
            exe_path: String::new(),
            exe_identity: String::new(),
            context_fingerprint: String::new(),
        },
    )
    .unwrap();

    let state_for_server = dir.path().to_path_buf();
    let sock2_str = sock2.to_string_lossy().into_owned();
    let server = thread::spawn(move || {
        // Attempt 1: Hello reports ready, then Start hits idle shutdown (draining: true),
        // and daemon.json switches to fresh daemon sock2.
        let (mut s, _) = l1.accept().unwrap();
        let mut r = FrameReader::new(s.try_clone().unwrap());
        let _: Option<Request> = r.read_frame().unwrap();
        write_frame(
            &mut s,
            &ServerEvent::Hello {
                protocol_version: PROTOCOL_VERSION,
                pid,
                version: "test".to_owned(),
                exe_path: String::new(),
                exe_identity: String::new(),
                context_fingerprint: String::new(),
                draining: false,
            },
        )
        .unwrap();
        let (mut s, _) = l1.accept().unwrap();
        let mut r = FrameReader::new(s.try_clone().unwrap());
        let _: Option<Request> = r.read_frame().unwrap();
        write_daemon_record(
            &state_for_server,
            &DaemonRecord {
                protocol_version: PROTOCOL_VERSION,
                pid,
                start_identity: String::new(),
                socket_path: sock2_str,
                version: "test".to_owned(),
                exe_path: String::new(),
                exe_identity: String::new(),
                context_fingerprint: String::new(),
            },
        )
        .unwrap();
        write_frame(
            &mut s,
            &ServerEvent::Error {
                message: "daemon shutting down".to_owned(),
                draining: true,
            },
        )
        .unwrap();

        // Attempt 2: fresh daemon accepts Hello and Start -> Finished(0).
        let (mut s, _) = l2.accept().unwrap();
        let mut r = FrameReader::new(s.try_clone().unwrap());
        let _: Option<Request> = r.read_frame().unwrap();
        write_frame(
            &mut s,
            &ServerEvent::Hello {
                protocol_version: PROTOCOL_VERSION,
                pid,
                version: "test".to_owned(),
                exe_path: String::new(),
                exe_identity: String::new(),
                context_fingerprint: String::new(),
                draining: false,
            },
        )
        .unwrap();
        let (mut s, _) = l2.accept().unwrap();
        let mut r = FrameReader::new(s.try_clone().unwrap());
        let _: Option<Request> = r.read_frame().unwrap();
        write_frame(
            &mut s,
            &ServerEvent::Started {
                stack_id: "stk-retry".to_owned(),
                pid,
            },
        )
        .unwrap();
        write_frame(
            &mut s,
            &ServerEvent::Finished {
                exit_code: 0,
                failure: None,
                overlap: None,
                daemon_exiting: false,
            },
        )
        .unwrap();
    });

    let spec = StoredLaunchSpec {
        kind: LaunchKind::Serve {
            directory: dir.path().to_path_buf(),
            domain: "retry.localhost".to_owned(),
            port: Some(12345),
        },
        cwd: dir.path().to_path_buf(),
        environment: BTreeMap::new(),
        non_unicode_environment: Vec::new(),
        mode: Mode::Agent.into(),
        detached: false,
        log_path: String::new(),
    };
    let code = run_foreground(dir.path(), spec, Mode::Agent).unwrap();
    server.join().unwrap();
    assert_eq!(code, 0);
}
