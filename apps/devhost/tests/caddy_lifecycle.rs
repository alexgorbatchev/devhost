use std::{
    fs,
    io::{Read, Write},
    net::TcpListener,
    path::{Path, PathBuf},
    process::Command,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::Duration,
};

use cli_command_kit::Mode;
use devhost::{
    caddy::{self, routes::ActivateRouteOptions},
    config::CaddySettings,
};

#[path = "support/ports.rs"]
mod fixture_ports;

/// A port for a server a subprocess binds later, such as Caddy. The shared helper keeps it outside the kernel's
/// ephemeral range, so an outbound connection cannot take it between this release and that bind.
fn reserve_port() -> u16 {
    fixture_ports::reserve_listener()
        .local_addr()
        .unwrap()
        .port()
}

struct Backend {
    port: u16,
    stop: Arc<AtomicBool>,
    handle: Option<thread::JoinHandle<()>>,
}

impl Drop for Backend {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(handle) = self.handle.take() {
            handle.join().unwrap();
        }
    }
}

fn spawn_backend(body: &'static str) -> Backend {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let port = listener.local_addr().unwrap().port();
    let stop = Arc::new(AtomicBool::new(false));
    let flag = Arc::clone(&stop);
    let handle = thread::spawn(move || {
        while !flag.load(Ordering::Relaxed) {
            match listener.accept() {
                Ok((mut stream, _)) => {
                    let _ = stream.set_nonblocking(false);
                    let mut buf = [0u8; 1024];
                    let _ = stream.read(&mut buf);
                    let response = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                        body.len()
                    );
                    let _ = stream.write_all(response.as_bytes());
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(10));
                }
                Err(_) => break,
            }
        }
    });
    Backend {
        port,
        stop,
        handle: Some(handle),
    }
}

struct LiveCaddyGuard {
    dir: PathBuf,
    settings: CaddySettings,
}

impl Drop for LiveCaddyGuard {
    fn drop(&mut self) {
        let mut sink = Vec::new();
        if caddy::stop_in_directory(&self.dir, &self.settings, Mode::Agent, &mut sink).is_err() {
            // A refusal under test must not keep this fixture's native proxy alive.
            let running = caddy::files::read_applied_settings(&self.dir)
                .ok()
                .flatten()
                .unwrap_or_else(|| self.settings.clone());
            let _ = Command::new("caddy")
                .args(["stop", "--address", &running.admin_address])
                .output();
        }
    }
}

fn tls_connect(settings: &CaddySettings, host: &str) -> std::process::Output {
    Command::new("openssl")
        .args([
            "s_client",
            "-connect",
            &format!("127.0.0.1:{}", settings.https_port),
            "-servername",
            host,
            "-brief",
        ])
        .stdin(std::process::Stdio::null())
        .output()
        .unwrap()
}

fn wait_for_certificate(settings: &CaddySettings, host: &str) {
    let deadline = std::time::Instant::now() + Duration::from_secs(10);
    loop {
        let result = tls_connect(settings, host);
        if result.status.success() {
            return;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "TLS {host}: {}",
            String::from_utf8_lossy(&result.stderr)
        );
        thread::sleep(Duration::from_millis(10));
    }
}

fn has_caddy_on_path() -> bool {
    Command::new("caddy")
        .arg("version")
        .output()
        .is_ok_and(|out| out.status.success())
}

#[test]
fn two_isolated_live_caddy_instances_route_reload_and_stop_independently() {
    if !has_caddy_on_path() {
        return;
    }

    let fixture = tempfile::tempdir().unwrap();
    let dir_a = fixture.path().join("state-a/caddy");
    let dir_b = fixture.path().join("state-b/caddy");

    let settings_a = CaddySettings {
        admin_address: format!("127.0.0.1:{}", reserve_port()),
        bind_host: "127.0.0.1".to_owned(),
        http_enabled: true,
        http_port: reserve_port(),
        https_port: reserve_port(),
        stack_directory_host: "stacks-a.localhost".to_owned(),
        stack_directory_allow_remote: false,
    };
    let settings_b = CaddySettings {
        admin_address: format!("127.0.0.1:{}", reserve_port()),
        bind_host: "127.0.0.1".to_owned(),
        http_enabled: true,
        http_port: reserve_port(),
        https_port: reserve_port(),
        stack_directory_host: "stacks-b.localhost".to_owned(),
        stack_directory_allow_remote: false,
    };

    let guard_a = LiveCaddyGuard {
        dir: dir_a.clone(),
        settings: settings_a.clone(),
    };
    let guard_b = LiveCaddyGuard {
        dir: dir_b.clone(),
        settings: settings_b.clone(),
    };

    let mut log_a = Vec::new();
    caddy::start_in_directory(&dir_a, &settings_a, Mode::Agent, &mut log_a, false)
        .unwrap_or_else(|e| panic!("start A failed: {}", e.message));
    assert!(String::from_utf8_lossy(&log_a).contains("managed caddy started with"));

    let mut log_b = Vec::new();
    caddy::start_in_directory(&dir_b, &settings_b, Mode::Agent, &mut log_b, true)
        .unwrap_or_else(|e| panic!("start B failed: {}", e.message));
    assert!(String::from_utf8_lossy(&log_b).contains("managed caddy started with"));

    // Starting an already running instance succeeds idempotently.
    let mut again = Vec::new();
    let original_receipt = fs::read(dir_a.join("runtime.json")).unwrap();
    caddy::start_in_directory(&dir_a, &settings_a, Mode::Agent, &mut again, false)
        .unwrap_or_else(|e| panic!("second start failed: {}", e.message));
    assert!(String::from_utf8_lossy(&again).contains("managed caddy is already running with"));
    assert_eq!(
        fs::read(dir_a.join("runtime.json")).unwrap(),
        original_receipt
    );

    let backend_a = spawn_backend("hello-from-a");
    let backend_b = spawn_backend("hello-from-b");

    caddy::routes::claim_host(&dir_a, "web-a.localhost", "/tmp/a/devhost.toml").unwrap();
    caddy::routes::claim_host(&dir_b, "web-b.localhost", "/tmp/b/devhost.toml").unwrap();

    let route_a = ActivateRouteOptions {
        proxy_local_origin: false,
        app_bind_host: "127.0.0.1".to_owned(),
        app_port: backend_a.port,
        devtools_control_port: None,
        document_injection_port: None,
        host: "web-a.localhost".to_owned(),
        path: "/".to_owned(),
        service_name: "web".to_owned(),
        access_log_name: String::new(),
    };
    let route_b = ActivateRouteOptions {
        proxy_local_origin: false,
        app_bind_host: "127.0.0.1".to_owned(),
        app_port: backend_b.port,
        devtools_control_port: None,
        document_injection_port: None,
        host: "web-b.localhost".to_owned(),
        path: "/".to_owned(),
        service_name: "web".to_owned(),
        access_log_name: String::new(),
    };

    let mut reload_log = Vec::new();
    caddy::routes::replace_routes(
        &dir_a,
        &[],
        std::slice::from_ref(&route_a),
        "/tmp/a/devhost.toml",
        Mode::Agent,
        &mut reload_log,
        false,
    )
    .unwrap();
    caddy::routes::replace_routes(
        &dir_b,
        &[],
        std::slice::from_ref(&route_b),
        "/tmp/b/devhost.toml",
        Mode::Agent,
        &mut reload_log,
        true,
    )
    .unwrap();

    let agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(3)))
        .build()
        .new_agent();

    let body_a = agent
        .get(format!("http://127.0.0.1:{}/", settings_a.http_port))
        .header("Host", "web-a.localhost")
        .call()
        .unwrap()
        .body_mut()
        .read_to_string()
        .unwrap();
    assert_eq!(body_a, "hello-from-a");

    let body_b = agent
        .get(format!("http://127.0.0.1:{}/", settings_b.http_port))
        .header("Host", "web-b.localhost")
        .call()
        .unwrap()
        .body_mut()
        .read_to_string()
        .unwrap();
    assert_eq!(body_b, "hello-from-b");

    // An unreceipted managed server is upgraded once, even when clients race.
    let fixed = fs::read_to_string(dir_a.join("Caddyfile")).unwrap();
    let legacy = fixed.replacen(
        "    tls internal\n",
        "    tls internal {\n        on_demand\n    }\n",
        1,
    );
    fs::write(dir_a.join("Caddyfile"), legacy).unwrap();
    let reload = Command::new("caddy")
        .args([
            "reload",
            "--address",
            &settings_a.admin_address,
            "--config",
            dir_a.join("Caddyfile").to_str().unwrap(),
            "--adapter",
            "caddyfile",
        ])
        .output()
        .unwrap();
    assert!(
        reload.status.success(),
        "{}",
        String::from_utf8_lossy(&reload.stderr)
    );
    wait_for_certificate(&settings_a, "cached-unknown.example.com");
    // Restore the fixed policy by reload: the unknown certificate stays cached.
    caddy::start_in_directory(&dir_a, &settings_a, Mode::Agent, &mut again, true).unwrap();
    assert!(
        tls_connect(&settings_a, "cached-unknown.example.com")
            .status
            .success()
    );
    let root_ca = fs::read(dir_a.join("storage/pki/authorities/local/root.crt")).unwrap();
    let registration_paths: Vec<_> = fs::read_dir(dir_a.join("routes/.registrations"))
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .collect();
    let registrations: Vec<_> = registration_paths
        .iter()
        .map(|path| fs::read(path).unwrap())
        .collect();
    fs::remove_file(dir_a.join("runtime.json")).unwrap();
    let logs = thread::scope(|scope| {
        let starts: Vec<_> = (0..3)
            .map(|_| {
                scope.spawn(|| {
                    let mut output = Vec::new();
                    caddy::start_in_directory(&dir_a, &settings_a, Mode::Agent, &mut output, true)
                        .unwrap_or_else(|error| panic!("upgrade failed: {}", error.message));
                    output
                })
            })
            .collect();
        starts
            .into_iter()
            .map(|start| start.join().unwrap())
            .collect::<Vec<_>>()
    });
    assert_eq!(
        logs.iter()
            .filter(|log| String::from_utf8_lossy(log)
                .contains("Restarting shared Caddy for an updated runtime policy."))
            .count(),
        1
    );
    let upgraded_receipt = fs::read(dir_a.join("runtime.json")).unwrap();
    assert_ne!(upgraded_receipt, original_receipt);
    wait_for_certificate(&settings_a, "web-a.localhost");
    wait_for_certificate(&settings_a, "stacks-a.localhost");
    for host in [
        "cached-unknown.example.com",
        "fresh-unknown.example.com",
        "unknown.localhost",
    ] {
        assert!(
            !tls_connect(&settings_a, host).status.success(),
            "unexpected certificate for {host}"
        );
    }
    assert_eq!(
        fs::read(dir_a.join("storage/pki/authorities/local/root.crt")).unwrap(),
        root_ca
    );
    for (path, contents) in registration_paths.iter().zip(registrations) {
        assert_eq!(fs::read(path).unwrap(), contents);
    }
    assert_eq!(
        agent
            .get(format!("http://127.0.0.1:{}/", settings_a.http_port))
            .header("Host", "web-a.localhost")
            .call()
            .unwrap()
            .body_mut()
            .read_to_string()
            .unwrap(),
        "hello-from-a"
    );

    // A stale live PID never authorizes automatically stopping an unrelated process.
    let pid = fs::read(dir_a.join("caddy.pid")).unwrap();
    fs::write(dir_a.join("caddy.pid"), std::process::id().to_string()).unwrap();
    let error =
        caddy::start_in_directory(&dir_a, &settings_a, Mode::Agent, &mut again, true).unwrap_err();
    assert!(
        error.message.contains("refusing automatic restart"),
        "{}",
        error.message
    );
    fs::write(dir_a.join("caddy.pid"), pid).unwrap();
    assert_eq!(
        fs::read(dir_a.join("runtime.json")).unwrap(),
        upgraded_receipt
    );

    // An older client refuses every shared route/settings/lifecycle mutation.
    let mut future: serde_json::Value = serde_json::from_slice(&upgraded_receipt).unwrap();
    future["restartGeneration"] = 2.into();
    fs::write(
        dir_a.join("runtime.json"),
        serde_json::to_vec(&future).unwrap(),
    )
    .unwrap();
    let config_before = fs::read(dir_a.join("Caddyfile")).unwrap();
    assert!(
        caddy::ensure_managed_caddy_config(&dir_a, &settings_a)
            .unwrap_err()
            .contains("Upgrade this devhost")
    );
    assert!(
        caddy::start_in_directory(&dir_a, &settings_a, Mode::Agent, &mut again, true)
            .unwrap_err()
            .message
            .contains("restart generation 2")
    );
    assert!(
        caddy::stop_in_directory(&dir_a, &settings_a, Mode::Agent, &mut again)
            .unwrap_err()
            .message
            .contains("restart generation 2")
    );
    assert!(
        caddy::routes::apply_managed_settings(&dir_a, &settings_a, Mode::Agent, &mut again, true)
            .unwrap_err()
            .contains("restart generation 2")
    );
    assert!(
        caddy::routes::replace_routes(
            &dir_a,
            &[],
            std::slice::from_ref(&route_a),
            "/tmp/a/devhost.toml",
            Mode::Agent,
            &mut again,
            true
        )
        .unwrap_err()
        .contains("restart generation 2")
    );
    assert_eq!(fs::read(dir_a.join("Caddyfile")).unwrap(), config_before);
    fs::write(dir_a.join("runtime.json"), &upgraded_receipt).unwrap();

    // Current-generation start reloads through the applied address and retains its PID.
    let mut moved = settings_a.clone();
    moved.admin_address = format!("127.0.0.1:{}", reserve_port());
    caddy::start_in_directory(&dir_a, &moved, Mode::Agent, &mut again, true).unwrap();
    caddy::ensure_admin_available(&moved.admin_address).unwrap();
    assert_eq!(
        fs::read(dir_a.join("runtime.json")).unwrap(),
        upgraded_receipt
    );
    caddy::start_in_directory(&dir_a, &settings_a, Mode::Agent, &mut again, true).unwrap();

    let mut invalid = settings_a.clone();
    invalid.http_enabled = false;
    let reject_reload = dir_a.join("caddy");
    fs::write(
        &reject_reload,
        "#!/bin/sh\necho 'reload rejected' >&2\nexit 1\n",
    )
    .unwrap();
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&reject_reload, fs::Permissions::from_mode(0o700)).unwrap();
    }
    let rejected = caddy::start_in_directory(&dir_a, &invalid, Mode::Agent, &mut again, true);
    fs::remove_file(reject_reload).unwrap();
    assert!(
        rejected
            .unwrap_err()
            .message
            .contains("Caddy reload failed")
    );
    assert_eq!(
        caddy::files::read_applied_settings(&dir_a).unwrap(),
        Some(settings_a.clone())
    );
    assert_eq!(fs::read(dir_a.join("Caddyfile")).unwrap(), config_before);

    // Apply unchanged settings is a no-op; applying new stackDirectoryAllowRemote reloads cleanly.
    assert!(
        !caddy::routes::apply_managed_settings(
            &dir_a,
            &settings_a,
            Mode::Agent,
            &mut reload_log,
            true
        )
        .unwrap()
    );
    let mut updated_a = settings_a.clone();
    updated_a.stack_directory_allow_remote = true;
    assert!(
        caddy::routes::apply_managed_settings(
            &dir_a,
            &updated_a,
            Mode::Agent,
            &mut reload_log,
            true
        )
        .unwrap()
    );

    // Stop both instances cleanly and confirm pid & applied files are gone.
    let mut stop_log_a = Vec::new();
    caddy::stop_in_directory(&dir_a, &updated_a, Mode::Agent, &mut stop_log_a).unwrap();
    assert!(String::from_utf8_lossy(&stop_log_a).contains("managed caddy stopped."));
    assert!(!dir_a.join("caddy.pid").exists());
    assert_eq!(
        fs::read(dir_a.join("runtime.json")).unwrap(),
        upgraded_receipt
    );
    assert!(!dir_a.join("applied.json").exists());

    let mut stop_log_b = Vec::new();
    caddy::stop_in_directory(&dir_b, &settings_b, Mode::Agent, &mut stop_log_b).unwrap();
    assert!(String::from_utf8_lossy(&stop_log_b).contains("managed caddy stopped."));
    assert!(!dir_b.join("caddy.pid").exists());

    drop(guard_a);
    drop(guard_b);
    drop(backend_a);
    drop(backend_b);
}

#[test]
fn download_and_privileged_ports_handle_success_and_platform_checks() {
    let fixture = tempfile::tempdir().unwrap();
    let caddy_dir = fixture.path().join("caddy");

    // Mock HTTP server serving a fake caddy binary and a 500 error.
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    let server = thread::spawn(move || {
        for (status, body) in [
            ("200 OK", b"#!/bin/sh\necho ok\n".as_slice()),
            ("500 Internal Server Error", b"err".as_slice()),
        ] {
            let (mut stream, _) = listener.accept().unwrap();
            let mut buf = [0u8; 512];
            let _ = stream.read(&mut buf);
            let header = format!(
                "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            let _ = stream.write_all(header.as_bytes());
            let _ = stream.write_all(body);
        }
    });

    let base = format!("http://{addr}/download");
    let mut out = Vec::new();
    caddy::download_from_base(&caddy_dir, "linux", "x86_64", &base, Mode::Agent, &mut out).unwrap();
    assert!(caddy_dir.join("caddy").exists());
    assert!(String::from_utf8_lossy(&out).contains("Caddy downloaded to"));

    let err =
        caddy::download_from_base(&caddy_dir, "windows", "arm64", &base, Mode::Agent, &mut out)
            .unwrap_err();
    assert!(err.message.contains("Failed to download Caddy: 500"));
    server.join().unwrap();

    assert!(
        caddy::download_from_base(
            &caddy_dir,
            "freebsd",
            "x86_64",
            &base,
            Mode::Agent,
            &mut out
        )
        .unwrap_err()
        .message
        .contains("Unsupported OS")
    );
    assert!(
        caddy::download_from_base(&caddy_dir, "darwin", "mips", &base, Mode::Agent, &mut out)
            .unwrap_err()
            .message
            .contains("Unsupported Architecture")
    );

    // Privileged ports on macOS skips cleanly; non-Linux errors.
    let mut mac_out = Vec::new();
    caddy::privileged_ports_for(&caddy_dir, "darwin", "arm64", Mode::Agent, &mut mac_out).unwrap();
    assert!(
        String::from_utf8_lossy(&mac_out).contains("does not need privileged-port setup on macOS.")
    );
    assert!(
        caddy::privileged_ports_for(&caddy_dir, "windows", "amd64", Mode::Agent, &mut mac_out)
            .unwrap_err()
            .message
            .contains("supported on Linux only")
    );

    // Apply settings rollback when reload fails against a closed admin address.
    let rollback_dir = fixture.path().join("rollback/caddy");
    caddy::files::prepare_directories(&rollback_dir).unwrap();
    let initial = CaddySettings {
        admin_address: "127.0.0.1:0".to_owned(),
        ..CaddySettings::default()
    };
    caddy::files::write_applied_settings(&rollback_dir, &initial).unwrap();
    let mut changed = initial.clone();
    changed.https_port = 9443;
    let fake_caddy = rollback_dir.join("caddy");
    fs::write(&fake_caddy, "#!/bin/sh\necho 'reload err' >&2\nexit 1\n").unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&fake_caddy, fs::Permissions::from_mode(0o755)).unwrap();
    }
    let mut err_log = Vec::new();
    let err = caddy::routes::apply_managed_settings(
        &rollback_dir,
        &changed,
        Mode::Agent,
        &mut err_log,
        false,
    )
    .unwrap_err();
    assert!(err.contains("Caddy reload failed"), "{err}");
    assert!(String::from_utf8_lossy(&err_log).contains("caddy: reload err"));
    assert_eq!(
        caddy::files::read_applied_settings(&rollback_dir).unwrap(),
        Some(initial)
    );

    // CLI privileged-ports with a fake sudo binary on PATH succeeds and fails cleanly.
    #[cfg(target_os = "linux")]
    {
        let bin_dir = fixture.path().join("fake-bin");
        fs::create_dir_all(&bin_dir).unwrap();
        let sudo = bin_dir.join("sudo");
        fs::write(&sudo, "#!/bin/sh\nexit 0\n").unwrap();
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&sudo, fs::Permissions::from_mode(0o755)).unwrap();
        let state_dir = fixture.path().join("priv-state");
        fs::create_dir_all(state_dir.join("caddy")).unwrap();
        fs::write(state_dir.join("caddy/caddy"), "#!/bin/sh\n").unwrap();
        let ok = Command::new(env!("CARGO_BIN_EXE_devhost"))
            .args(["caddy", "privileged-ports"])
            .env("AGENT", "1")
            .env("DEVHOST_STATE_DIR", &state_dir)
            .env("PATH", &bin_dir)
            .output()
            .unwrap();
        assert!(ok.status.success(), "{:?}", ok.stderr);
        assert!(
            String::from_utf8_lossy(&ok.stderr)
                .contains("managed caddy low-port binding enabled for")
        );

        fs::write(&sudo, "#!/bin/sh\nexit 1\n").unwrap();
        let fail = Command::new(env!("CARGO_BIN_EXE_devhost"))
            .args(["caddy", "privileged-ports"])
            .env("AGENT", "1")
            .env("DEVHOST_STATE_DIR", &state_dir)
            .env("PATH", &bin_dir)
            .output()
            .unwrap();
        assert_eq!(fail.status.code(), Some(1));
        assert!(
            String::from_utf8_lossy(&fail.stderr)
                .contains("Managed Caddy privileged-port setup failed.")
        );
    }
}

#[test]
fn caddy_trust_and_start_error_paths_match_cli_contracts() {
    let fixture = tempfile::tempdir().unwrap();
    let root = fixture.path();
    fs::create_dir_all(root.join("config")).unwrap();
    fs::write(
        root.join("config/config.toml"),
        "[caddy]\nadminAddress = '127.0.0.1:0'\n",
    )
    .unwrap();

    let run = |args: &[&str], agent: &str| {
        Command::new(env!("CARGO_BIN_EXE_devhost"))
            .current_dir(root)
            .args(args)
            .env("AGENT", agent)
            .env("NO_COLOR", "1")
            .env("DEVHOST_STATE_DIR", "state")
            .env("DEVHOST_CONFIG_DIR", "config")
            .output()
            .unwrap()
    };

    let trust_stopped = run(&["caddy", "trust"], "1");
    assert_eq!(trust_stopped.status.code(), Some(1));
    assert!(
        String::from_utf8_lossy(&trust_stopped.stderr)
            .contains("Managed Caddy is not running. Run 'devhost caddy start' first.")
    );

    // Fake managed caddy binary failing with :443 permission denied
    let caddy_bin = root.join("state/caddy/caddy");
    fs::write(
        &caddy_bin,
        "#!/bin/sh\necho 'listen tcp :443: bind: permission denied' >&2\nexit 1\n",
    )
    .unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&caddy_bin, fs::Permissions::from_mode(0o755)).unwrap();
    }
    let start_human = run(&["caddy", "start"], "0");
    assert_eq!(start_human.status.code(), Some(1));
    let stderr = String::from_utf8_lossy(&start_human.stderr);
    let (summary, hint) = if cfg!(target_os = "macos") {
        (
            "loopback without privileges on macOS",
            "Use wildcard listeners",
        )
    } else {
        (
            "without privileged-port setup",
            "devhost caddy privileged-ports",
        )
    };
    assert!(stderr.contains(summary), "{stderr}");
    assert!(stderr.contains(hint), "{stderr}");

    // Foreign running admin API rejects both start and trust
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap().to_string();
    let server = thread::spawn(move || {
        for _ in 0..4 {
            let (mut stream, _) = listener.accept().unwrap();
            let mut buf = [0u8; 512];
            let _ = stream.read(&mut buf);
            let _ = stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n{}");
        }
    });
    fs::write(
        root.join("config/config.toml"),
        format!("[caddy]\nadminAddress = '{addr}'\n"),
    )
    .unwrap();
    let start_foreign = run(&["caddy", "start"], "1");
    assert!(String::from_utf8_lossy(&start_foreign.stderr).contains("not started by devhost"));
    let trust_foreign = run(&["caddy", "trust"], "1");
    assert!(String::from_utf8_lossy(&trust_foreign.stderr).contains("not started by devhost"));

    // Managed running admin API with fake caddy trust binary succeeding & failing
    fs::write(root.join("state/caddy/caddy.pid"), "12345").unwrap();
    fs::write(&caddy_bin, "#!/bin/sh\nexit 0\n").unwrap();
    let trust_ok = run(&["caddy", "trust"], "1");
    assert!(trust_ok.status.success(), "{:?}", trust_ok.stderr);
    assert!(String::from_utf8_lossy(&trust_ok.stderr).contains("managed caddy local CA trusted."));
    fs::write(&caddy_bin, "#!/bin/sh\necho 'sudo failed' >&2\nexit 1\n").unwrap();
    let trust_fail = run(&["caddy", "trust"], "1");
    assert_eq!(trust_fail.status.code(), Some(1));
    let fail_err = String::from_utf8_lossy(&trust_fail.stderr);
    assert!(fail_err.contains("caddy: sudo failed"), "{fail_err}");
    assert!(fail_err.contains("Caddy trust failed."), "{fail_err}");
    server.join().unwrap();
    let _ = Path::new(&caddy_bin);
}
