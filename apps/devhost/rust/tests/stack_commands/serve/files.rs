use super::*;

fn spawn(runtime: &Runtime, directory: &Path, arguments: &[&str], log_name: &str) -> Process {
    let log = fs::File::create(directory.join(log_name)).unwrap();
    let mut command = runtime.command();
    command
        .current_dir(directory)
        .env("DEVHOST_MANIFEST", directory.join("invalid-override.toml"))
        .args(arguments)
        .stdin(Stdio::null())
        .stdout(log.try_clone().unwrap())
        .stderr(log);
    // SAFETY: setsid is async-signal-safe and isolates this fixture's child group.
    unsafe {
        command.pre_exec(|| {
            if libc::setsid() < 0 {
                Err(std::io::Error::last_os_error())
            } else {
                Ok(())
            }
        });
    }
    Process(command.spawn().unwrap())
}

fn stop(runtime: &Runtime, host: &str, process: &mut Process) {
    let output = runtime
        .command()
        .env("DEVHOST_MANIFEST", "/missing-standalone-manifest.toml")
        .args(["stop", "--session", &format!("serve-{host}")])
        .output()
        .unwrap();
    assert!(output.status.success(), "{output:?}");
    wait_until(|| process.0.try_wait().unwrap().is_some());
}

fn live(runtime: &Runtime, host: &str) -> caddy::stacks::LiveStack {
    let mut selected = None;
    wait_until(|| {
        selected = read_live_stacks(&runtime.state().join("caddy"))
            .unwrap()
            .into_iter()
            .find(|stack| stack.name == format!("serve-{host}") && stack.control_port > 0);
        selected.is_some()
    });
    let selected = selected.unwrap();
    assert!(selected.manifest_path.is_empty());
    assert!(!selected.remote);
    selected
}

#[test]
fn file_sessions_bypass_invalid_manifests_and_preserve_concurrent_host_owners() {
    let runtime = Runtime::start();
    let project = runtime.root.path().join("standalone files");
    fs::create_dir_all(project.join("first")).unwrap();
    fs::create_dir(project.join("second")).unwrap();
    fs::write(project.join("devhost.toml"), "invalid=[").unwrap();
    fs::write(project.join("invalid-override.toml"), "also-invalid=[").unwrap();
    fs::write(
        project.join("first/index.html"),
        "first standalone document",
    )
    .unwrap();
    fs::write(
        project.join("second/index.html"),
        "second standalone document",
    )
    .unwrap();
    let caddy_pid = fs::read_to_string(runtime.state().join("caddy/caddy.pid")).unwrap();
    let first_host = "standalone-first.localhost";
    let second_host = "standalone-second.localhost";
    let mut first = spawn(
        &runtime,
        &project,
        &["serve", "-d", first_host, "--dir", "first"],
        "first.log",
    );
    let mut second = spawn(
        &runtime,
        &project.join("second"),
        &["serve", "--domain", second_host],
        "second.log",
    );
    wait_until(|| response(&runtime, first_host).as_deref() == Some("first standalone document"));
    wait_until(|| response(&runtime, second_host).as_deref() == Some("second standalone document"));
    let first_owner = live(&runtime, first_host);
    let second_owner = live(&runtime, second_host);
    assert_ne!(first_owner.pid, second_owner.pid);

    let rejected = runtime
        .command()
        .current_dir(&project)
        .args(["serve", "--domain", first_host, "--dir", "second"])
        .output()
        .unwrap();
    assert!(!rejected.status.success(), "{rejected:?}");
    assert!(
        String::from_utf8_lossy(&rejected.stdout).contains("already claimed")
            || String::from_utf8_lossy(&rejected.stderr).contains("already claimed"),
        "{rejected:?}"
    );
    assert_eq!(live(&runtime, first_host).pid, first_owner.pid);
    assert_eq!(live(&runtime, second_host).pid, second_owner.pid);
    assert_eq!(
        response(&runtime, first_host).as_deref(),
        Some("first standalone document")
    );
    assert_eq!(
        response(&runtime, second_host).as_deref(),
        Some("second standalone document")
    );
    assert_eq!(
        read_live_stacks(&runtime.state().join("caddy"))
            .unwrap()
            .len(),
        2
    );

    stop(&runtime, first_host, &mut first);
    assert!(!first_owner.is_alive());
    assert_ne!(
        response(&runtime, first_host).as_deref(),
        Some("first standalone document")
    );
    assert_eq!(
        response(&runtime, second_host).as_deref(),
        Some("second standalone document")
    );
    assert!(second_owner.is_alive());
    assert_eq!(
        fs::read_to_string(runtime.state().join("caddy/caddy.pid")).unwrap(),
        caddy_pid
    );
    stop(&runtime, second_host, &mut second);
    assert!(
        read_live_stacks(&runtime.state().join("caddy"))
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        fs::read_to_string(runtime.state().join("caddy/caddy.pid")).unwrap(),
        caddy_pid
    );
}

#[test]
fn external_port_session_withdraws_only_its_route_and_preserves_the_backend() {
    let runtime = Runtime::start();
    let project = runtime.root.path().join("external standalone");
    fs::create_dir(&project).unwrap();
    fs::write(project.join("devhost.toml"), "invalid=[").unwrap();
    fs::write(project.join("invalid-override.toml"), "invalid=[").unwrap();
    fs::write(
        project.join("backend.py"),
        r#"import http.server, pathlib
class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-Type', 'text/plain')
        self.end_headers()
        self.wfile.write(b'external standalone backend')
    def log_message(self, *args): pass
server = http.server.HTTPServer(('127.0.0.1', 0), Handler)
pathlib.Path('port.pending').write_text(str(server.server_port))
pathlib.Path('port.pending').replace('port')
server.serve_forever()
"#,
    )
    .unwrap();
    let mut command = Command::new("python3");
    command
        .current_dir(&project)
        .arg("backend.py")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    // SAFETY: setsid is async-signal-safe and gives the backend its own owned group.
    unsafe {
        command.pre_exec(|| {
            if libc::setsid() < 0 {
                Err(std::io::Error::last_os_error())
            } else {
                Ok(())
            }
        });
    }
    let mut backend = Process(command.spawn().unwrap());
    wait_until(|| project.join("port").exists());
    let port = fs::read_to_string(project.join("port")).unwrap();
    let host = "external-standalone.localhost";
    let mut supervisor = spawn(
        &runtime,
        &project,
        &["serve", "-d", host, "-p", &port],
        "serve.log",
    );
    wait_until(|| response(&runtime, host).as_deref() == Some("external standalone backend"));
    let owner = live(&runtime, host);
    let caddy_pid = fs::read_to_string(runtime.state().join("caddy/caddy.pid")).unwrap();
    stop(&runtime, host, &mut supervisor);
    assert!(!owner.is_alive());
    assert!(backend.0.try_wait().unwrap().is_none());
    assert_ne!(
        response(&runtime, host).as_deref(),
        Some("external standalone backend")
    );
    let direct = ureq::Agent::config_builder()
        .proxy(None)
        .timeout_global(Some(Duration::from_secs(1)))
        .build()
        .new_agent()
        .get(format!("http://127.0.0.1:{port}/"))
        .call()
        .unwrap()
        .body_mut()
        .read_to_string()
        .unwrap();
    assert_eq!(direct, "external standalone backend");
    assert!(
        read_live_stacks(&runtime.state().join("caddy"))
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        fs::read_to_string(runtime.state().join("caddy/caddy.pid")).unwrap(),
        caddy_pid
    );
    let backend_pid = backend.0.id() as i32;
    drop(backend);
    assert!(!procid::is_process_alive(backend_pid));
}
