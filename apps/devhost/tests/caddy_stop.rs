use std::{
    fs,
    io::{Read, Write},
    net::TcpListener,
    path::Path,
    process::Command,
    thread,
};

fn command(root: &Path, args: &[&str]) -> Command {
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_devhost"));
    cmd.current_dir(root)
        .args(args)
        .env("AGENT", "1")
        .env("NO_COLOR", "1")
        .env_remove("DEVHOST_STATE_DIR")
        .env_remove("XDG_STATE_HOME")
        .env_remove("DEVHOST_CONFIG_DIR")
        .env_remove("XDG_CONFIG_HOME")
        .env_remove("HOME")
        .env_remove("USERPROFILE");
    cmd
}

fn spawn_admin_server(requests: usize) -> (String, thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap().to_string();
    let handle = thread::spawn(move || {
        for _ in 0..requests {
            let (mut stream, _) = listener.accept().unwrap();
            let mut buffer = [0u8; 512];
            let _ = stream.read(&mut buffer);
            let _ = stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n{}");
        }
    });
    (address, handle)
}

#[test]
fn caddy_stop_handles_not_running_stale_pid_and_applied_settings() {
    let fixture = tempfile::tempdir().unwrap();
    let root = fixture.path();
    fs::create_dir_all(root.join("config")).unwrap();
    fs::write(
        root.join("config/config.toml"),
        "[caddy]\nadminAddress = '127.0.0.1:0'\nhttp = true\nhttpPort = 8080\nhttpsPort = 8443\nbindHost = '127.0.0.1'\nstackDirectoryHost = 'stacks.localhost'\nstackDirectoryAllowRemote = true\n",
    )
    .unwrap();

    let output = command(root, &["caddy", "stop"])
        .env("DEVHOST_STATE_DIR", "state")
        .env("DEVHOST_CONFIG_DIR", "config")
        .output()
        .unwrap();
    assert!(output.status.success(), "{:?}", output.stderr);
    assert_eq!(
        String::from_utf8(output.stderr).unwrap(),
        "devhost: managed caddy is not running.\n"
    );
    let caddyfile = fs::read_to_string(root.join("state/caddy/Caddyfile")).unwrap();
    assert!(caddyfile.contains("admin 127.0.0.1:0"));
    assert!(caddyfile.contains("http://:8080"));
    assert!(caddyfile.contains("https://:8443"));
    let stack_dir = fs::read_to_string(root.join("state/caddy/stack-directory.caddy")).unwrap();
    assert!(stack_dir.contains("https://stacks.localhost:8443"));
    assert!(stack_dir.contains("http://stacks.localhost:8080"));
    assert!(!stack_dir.contains("@remote not remote_ip"));
    assert!(root.join("state/caddy/route-not-found/index.html").exists());
    assert!(
        root.join("state/caddy/route-not-found/devhost-route-not-found.css")
            .exists()
    );
    assert!(
        root.join("state/caddy/route-not-found/stacks.html")
            .exists()
    );

    // Stale PID + applied.json removes both and renders with applied settings.
    fs::write(root.join("state/caddy/caddy.pid"), "99999999").unwrap();
    fs::write(
        root.join("state/caddy/applied.json"),
        r#"{"adminAddress":"127.0.0.1:0","bindHost":"::1","httpsPort":9443}"#,
    )
    .unwrap();
    let output = command(root, &["caddy", "stop"])
        .env("DEVHOST_STATE_DIR", "state")
        .env("DEVHOST_CONFIG_DIR", "config")
        .env("AGENT", "0")
        .output()
        .unwrap();
    assert!(output.status.success(), "{:?}", output.stderr);
    assert_eq!(
        String::from_utf8(output.stderr).unwrap(),
        "devhost | managed caddy is not running. Removed the stale pid file.\n"
    );
    assert!(!root.join("state/caddy/caddy.pid").exists());
    assert!(!root.join("state/caddy/applied.json").exists());
    let caddyfile = fs::read_to_string(root.join("state/caddy/Caddyfile")).unwrap();
    assert!(caddyfile.contains("default_bind [::1]"));
    assert!(caddyfile.contains("https://:9443"));

    // Invalid applied.json reports a parse error.
    fs::write(root.join("state/caddy/applied.json"), "{not-json").unwrap();
    let output = command(root, &["caddy", "stop"])
        .env("DEVHOST_STATE_DIR", "state")
        .env("DEVHOST_CONFIG_DIR", "config")
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(1));
    assert!(
        String::from_utf8(output.stderr)
            .unwrap()
            .contains("parse applied managed Caddy settings")
    );
}

#[test]
fn caddy_stop_rejects_foreign_instance_and_stops_managed_instance() {
    let fixture = tempfile::tempdir().unwrap();
    let root = fixture.path();
    let (address, server) = spawn_admin_server(3);
    fs::create_dir_all(root.join("config")).unwrap();
    fs::write(
        root.join("config/config.toml"),
        format!("[caddy]\nadminAddress = '{address}'\n"),
    )
    .unwrap();

    // Running admin API without caddy.pid is rejected as foreign.
    let output = command(root, &["caddy", "stop"])
        .env("DEVHOST_STATE_DIR", "state")
        .env("DEVHOST_CONFIG_DIR", "config")
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(1));
    assert!(
        String::from_utf8(output.stderr)
            .unwrap()
            .contains("not started by devhost")
    );

    // With a failing fake managed caddy binary, diagnostics are forwarded.
    let caddy_dir = root.join("state/caddy");
    let fake_caddy = caddy_dir.join("caddy");
    fs::write(caddy_dir.join("caddy.pid"), "12345").unwrap();
    fs::write(
        &fake_caddy,
        "#!/bin/sh\necho 'stop boom' >&2\necho 'extra detail'\nexit 1\n",
    )
    .unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&fake_caddy, fs::Permissions::from_mode(0o755)).unwrap();
    }
    let output = command(root, &["caddy", "stop"])
        .env("DEVHOST_STATE_DIR", "state")
        .env("DEVHOST_CONFIG_DIR", "config")
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(1));
    let stderr = String::from_utf8(output.stderr).unwrap();
    assert!(stderr.contains("caddy: stop boom"), "{stderr}");
    assert!(stderr.contains("caddy: extra detail"), "{stderr}");
    assert!(stderr.contains("Caddy stop failed."), "{stderr}");

    // With a succeeding fake managed caddy binary, pid/applied are removed.
    fs::write(&fake_caddy, "#!/bin/sh\nexit 0\n").unwrap();
    fs::write(
        caddy_dir.join("applied.json"),
        format!(r#"{{"adminAddress":"{address}"}}"#),
    )
    .unwrap();
    let output = command(root, &["caddy", "stop"])
        .env("DEVHOST_STATE_DIR", "state")
        .env("DEVHOST_CONFIG_DIR", "config")
        .output()
        .unwrap();
    assert!(output.status.success(), "{:?}", output.stderr);
    assert_eq!(
        String::from_utf8(output.stderr).unwrap(),
        "devhost: managed caddy stopped.\n"
    );
    assert!(!caddy_dir.join("caddy.pid").exists());
    assert!(!caddy_dir.join("applied.json").exists());
    server.join().unwrap();
}

#[test]
fn caddy_stop_rejects_invalid_config_and_active_stack_directory_host_claim() {
    let fixture = tempfile::tempdir().unwrap();
    let root = fixture.path();
    fs::create_dir_all(root.join("config")).unwrap();
    fs::write(
        root.join("config/config.toml"),
        "domainSuffix = 'bad'\n[caddy]\nadminAddress = ''\nbindHost = '10.0.0.1'\nhttp = 'yes'\nhttpPort = 0\nhttpsPort = 70000\nstackDirectoryHost = 'https://bad'\nstackDirectoryAllowRemote = 'nope'\n[remote]\nserverURL = 'http://example.com'\ncredentialFile = ''\nfingerprint = 'short'\nremotePort = 0\ndomainSuffix = 'bad'\nlocalSuffix = '.x'\n",
    )
    .unwrap();
    let output = command(root, &["caddy", "stop"])
        .env("DEVHOST_STATE_DIR", "state")
        .env("DEVHOST_CONFIG_DIR", "config")
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(1));
    let stderr = String::from_utf8(output.stderr).unwrap();
    for expected in [
        "remote.localSuffix was removed",
        "domainSuffix must be a hostname suffix",
        "caddy.adminAddress must be a non-empty string.",
        "caddy.bindHost must be one of",
        "caddy.http must be a boolean.",
        "caddy.httpPort must be an integer",
        "caddy.httpsPort must be an integer",
        "caddy.stackDirectoryHost must be a hostname",
        "caddy.stackDirectoryAllowRemote must be a boolean.",
        "remote.serverURL must be an HTTPS relay URL",
        "remote.credentialFile must name a private file",
        "remote.fingerprint must be the relay's complete base64 SHA-256 fingerprint.",
        "remote.remotePort must be an integer",
        "remote.domainSuffix must be a hostname suffix",
    ] {
        assert!(
            stderr.contains(expected),
            "missing {expected} in:\n{stderr}"
        );
    }

    // Wrong table types & bad relay URL variants
    fs::write(root.join("config/config.toml"), "caddy = 1\nremote = 2\n").unwrap();
    let output = command(root, &["caddy", "stop"])
        .env("DEVHOST_STATE_DIR", "state")
        .env("DEVHOST_CONFIG_DIR", "config")
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(1));
    let stderr = String::from_utf8(output.stderr).unwrap();
    assert!(stderr.contains("caddy must be a table."));
    assert!(stderr.contains("remote must be a table."));

    // Valid config with live stack and multiple route links populates stack-directory.caddy and route-not-found
    fs::write(
        root.join("config/config.toml"),
        "domainSuffix = '.local.test'\n[caddy]\nadminAddress = '127.0.0.1:0'\nbindHost = '::'\n[remote]\nserverURL = 'https://relay.example.com'\ncredentialFile = 'creds.txt'\nfingerprint = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='\nremotePort = 9001\ndomainSuffix = '-dev.example.com'\n",
    )
    .unwrap();
    let pid = std::process::id();
    let state = root.join("state/caddy");
    fs::create_dir_all(state.join("stacks")).unwrap();
    fs::create_dir_all(state.join("routes/.registrations")).unwrap();
    fs::write(
        state.join(format!("stacks/{pid}.json")),
        format!(
            r#"{{"createdAt":"2026-01-01T00:00:00.000Z","manifestPath":"/tmp/devhost.toml","ownerPid":{pid},"stackName":"demo","controlPort":45123}}"#
        ),
    )
    .unwrap();
    fs::write(state.join("routes/web.localhost.caddy"), "").unwrap();
    fs::write(
        state.join("routes/.registrations/web.localhost-a.json"),
        format!(
            r#"{{"host":"web.localhost","path":"/z","ownerPid":{pid},"manifestPath":"/tmp/devhost.toml"}}"#
        ),
    )
    .unwrap();
    fs::write(
        state.join("routes/.registrations/web.localhost-b.json"),
        format!(
            r#"{{"host":"web.localhost","path":"/app","ownerPid":{pid},"manifestPath":"/tmp/devhost.toml"}}"#
        ),
    )
    .unwrap();
    fs::write(
        state.join("routes/.registrations/orphan.localhost.json"),
        format!(
            r#"{{"host":"orphan.localhost","path":"/","ownerPid":{pid},"manifestPath":"/tmp/devhost.toml"}}"#
        ),
    )
    .unwrap();
    let output = command(root, &["caddy", "stop"])
        .env("DEVHOST_STATE_DIR", "state")
        .env("DEVHOST_CONFIG_DIR", "config")
        .output()
        .unwrap();
    assert!(output.status.success(), "{:?}", output.stderr);
    let stack_dir = fs::read_to_string(state.join("stack-directory.caddy")).unwrap();
    assert!(stack_dir.contains("reverse_proxy 127.0.0.1:45123"));
    let not_found = fs::read_to_string(state.join("route-not-found/index.html")).unwrap();
    assert!(not_found.contains("https://web.localhost/app"));
    assert!(!not_found.contains("orphan.localhost"));

    // Active route on stackDirectoryHost causes an error.
    fs::write(
        state.join("routes/.registrations/devhost.localhost.json"),
        format!(
            r#"{{"host":"devhost.localhost","path":"/","ownerPid":{pid},"manifestPath":"/tmp/devhost.toml"}}"#
        ),
    )
    .unwrap();
    let output = command(root, &["caddy", "stop"])
        .env("DEVHOST_STATE_DIR", "state")
        .env("DEVHOST_CONFIG_DIR", "config")
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(1));
    assert!(
        String::from_utf8(output.stderr)
            .unwrap()
            .contains("stack directory hostname devhost.localhost is already routed")
    );
    fs::remove_file(state.join("routes/.registrations/devhost.localhost.json")).unwrap();

    // Active host claim on stackDirectoryHost causes an error.
    fs::create_dir_all(state.join("routes/.host-claims")).unwrap();
    fs::write(
        state.join("routes/.host-claims/devhost.localhost.json"),
        format!(
            r#"{{"createdAt":"2026-01-01T00:00:00.000Z","host":"devhost.localhost","manifestPath":"/tmp/devhost.toml","ownerPid":{pid}}}"#
        ),
    )
    .unwrap();
    let output = command(root, &["caddy", "stop"])
        .env("DEVHOST_STATE_DIR", "state")
        .env("DEVHOST_CONFIG_DIR", "config")
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(1));
    assert!(
        String::from_utf8(output.stderr)
            .unwrap()
            .contains("stack directory hostname devhost.localhost is already claimed")
    );
}
