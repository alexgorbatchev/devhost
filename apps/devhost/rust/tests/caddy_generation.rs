use std::{
    fs::{self, File},
    os::unix::fs::PermissionsExt,
    path::Path,
    process::{Command, Output, Stdio},
    sync::atomic::{AtomicUsize, Ordering},
    thread,
    time::{Duration, Instant},
};

#[path = "support/ports.rs"]
mod fixture_ports;

static CLI_INVOCATIONS: AtomicUsize = AtomicUsize::new(0);

fn cli(root: &Path, action: &str) -> Output {
    let invocation = CLI_INVOCATIONS.fetch_add(1, Ordering::Relaxed);
    let stdout_path = root.join(format!("cli-{invocation}.stdout"));
    let stderr_path = root.join(format!("cli-{invocation}.stderr"));
    let stdout_file = File::create(&stdout_path).unwrap();
    let stderr_file = File::create(&stderr_path).unwrap();
    let status = Command::new(
        std::env::var_os("DEVHOST_CADDY_TEST_BINARY")
            .unwrap_or_else(|| env!("CARGO_BIN_EXE_devhost").into()),
    )
    .args(["caddy", action])
    .env("AGENT", "1")
    .env("DEVHOST_CONFIG_DIR", root.join("config"))
    .env("DEVHOST_STATE_DIR", root.join("state"))
    .stdin(Stdio::null())
    .stdout(Stdio::from(stdout_file))
    .stderr(Stdio::from(stderr_file))
    .status()
    .unwrap();
    Output {
        status,
        stdout: fs::read(&stdout_path).unwrap(),
        stderr: fs::read(&stderr_path).unwrap(),
    }
}

fn succeeded(output: Output) -> String {
    assert!(
        output.status.success(),
        "stdout: {}\nstderr: {}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    )
}

struct Cleanup<'a>(&'a Path);
impl Drop for Cleanup<'_> {
    fn drop(&mut self) {
        // A failed assertion must restore the real command before stopping Caddy.
        let _ = fs::remove_file(self.0.join("state/caddy/caddy"));
        let _ = cli(self.0, "stop");
    }
}

#[test]
fn native_cli_restart_receipt_and_settings_contract_matches_go() {
    let fixture = tempfile::tempdir().unwrap();
    let root = fixture.path();
    fs::create_dir(root.join("config")).unwrap();
    // Retain reservations together until the configuration is ready.
    let mut listeners: Vec<_> = (0..4).map(|_| fixture_ports::reserve_listener()).collect();
    let ports: Vec<_> = listeners
        .iter()
        .map(|listener| listener.local_addr().unwrap().port())
        .collect();
    let config = |admin| {
        format!(
            "[caddy]\nadminAddress = '127.0.0.1:{admin}'\nbindHost = '127.0.0.1'\nhttp = true\nhttpPort = {}\nhttpsPort = {}\nstackDirectoryHost = 'generation.localhost'\n",
            ports[1], ports[2]
        )
    };
    fs::write(root.join("config/config.toml"), config(ports[0])).unwrap();
    // Accept TCP connections without answering HTTP, exercising the admin deadline.
    let unreachable_admin = listeners.remove(0);
    drop(listeners);
    let _cleanup = Cleanup(root);
    let directory = root.join("state/caddy");
    fs::create_dir_all(&directory).unwrap();
    let launcher = directory.join("caddy");
    let write_launcher = |text| {
        fs::write(&launcher, text).unwrap();
        fs::set_permissions(&launcher, fs::Permissions::from_mode(0o700)).unwrap();
    };
    write_launcher("#!/bin/sh\nexit 0\n");
    let started = Instant::now();
    let unreachable = cli(root, "start");
    let elapsed = started.elapsed();
    assert!(!unreachable.status.success(), "{unreachable:?}");
    assert!(
        String::from_utf8_lossy(&unreachable.stderr).contains("did not become ready"),
        "{unreachable:?}"
    );
    assert!(elapsed >= Duration::from_millis(1500), "{elapsed:?}");
    assert!(elapsed < Duration::from_secs(6), "{elapsed:?}");
    assert!(!directory.join("runtime.json").exists());
    assert!(!directory.join("applied.json").exists());
    fs::remove_file(&launcher).unwrap();
    drop(unreachable_admin);
    succeeded(cli(root, "start"));
    let receipt = fs::read(directory.join("runtime.json")).unwrap();
    let value: serde_json::Value = serde_json::from_slice(&receipt).unwrap();
    assert_eq!(value["restartGeneration"], 1);
    assert!(value["pid"].as_i64().unwrap() > 0);
    assert!(!value["startIdentity"].as_str().unwrap().is_empty());
    let ca = fs::read(directory.join("storage/pki/authorities/local/root.crt")).unwrap();
    let pid = fs::read_to_string(directory.join("caddy.pid")).unwrap();
    let applied = fs::read(directory.join("applied.json")).unwrap();
    let mut older = value.clone();
    older["restartGeneration"] = 0.into();
    let older = serde_json::to_vec(&older).unwrap();
    fs::write(directory.join("runtime.json"), &older).unwrap();
    write_launcher("#!/bin/sh\necho 'stop rejected' >&2\nexit 1\n");
    let rejected = cli(root, "start");
    assert!(!rejected.status.success(), "{rejected:?}");
    assert!(String::from_utf8_lossy(&rejected.stderr).contains("Caddy stop failed"));
    assert_eq!(fs::read(directory.join("runtime.json")).unwrap(), older);
    assert_eq!(fs::read(directory.join("applied.json")).unwrap(), applied);
    assert_eq!(
        fs::read_to_string(directory.join("caddy.pid")).unwrap(),
        pid
    );
    devhost_rust::caddy::ensure_admin_available(&format!("127.0.0.1:{}", ports[0])).unwrap();
    write_launcher(&format!(
        "#!/bin/sh\nif [ \"$1\" = start ]; then printf '%s' '{}' > caddy.pid; fi\nexit 0\n",
        pid.trim()
    ));
    let no_op = cli(root, "start");
    assert!(!no_op.status.success(), "{no_op:?}");
    assert!(
        String::from_utf8_lossy(&no_op.stderr).contains("did not start a fresh process"),
        "{no_op:?}"
    );
    assert_eq!(fs::read(directory.join("runtime.json")).unwrap(), older);
    assert_eq!(
        fs::read_to_string(directory.join("caddy.pid"))
            .unwrap()
            .trim(),
        pid.trim()
    );
    fs::remove_file(&launcher).unwrap();
    fs::remove_file(directory.join("runtime.json")).unwrap();
    let outputs = thread::scope(|scope| {
        let starts: Vec<_> = (0..3).map(|_| scope.spawn(|| cli(root, "start"))).collect();
        starts
            .into_iter()
            .map(|start| succeeded(start.join().unwrap()))
            .collect::<Vec<_>>()
    });
    assert_eq!(outputs.iter().filter(|output| output.contains("Restarting shared Caddy for an updated runtime policy. Proxy connections briefly drop.")).count(), 1);
    let upgraded = fs::read(directory.join("runtime.json")).unwrap();
    assert_ne!(upgraded, receipt);
    assert_eq!(
        fs::read(directory.join("storage/pki/authorities/local/root.crt")).unwrap(),
        ca
    );
    fs::write(root.join("config/config.toml"), config(ports[3])).unwrap();
    assert!(succeeded(cli(root, "start")).contains("managed caddy is already running"));
    devhost_rust::caddy::ensure_admin_available(&format!("127.0.0.1:{}", ports[3])).unwrap();
    assert_eq!(fs::read(directory.join("runtime.json")).unwrap(), upgraded);
    let mut future: serde_json::Value = serde_json::from_slice(&upgraded).unwrap();
    future["restartGeneration"] = 2.into();
    fs::write(
        directory.join("runtime.json"),
        serde_json::to_vec(&future).unwrap(),
    )
    .unwrap();
    let refused = cli(root, "stop");
    fs::write(directory.join("runtime.json"), &upgraded).unwrap();
    assert_eq!(refused.status.code(), Some(1));
    assert!(
        String::from_utf8_lossy(&refused.stderr)
            .contains("Upgrade this devhost instance before changing shared Caddy configuration")
    );
    succeeded(cli(root, "stop"));
    assert_eq!(fs::read(directory.join("runtime.json")).unwrap(), upgraded);
    assert!(!directory.join("caddy.pid").exists());
    assert!(!directory.join("applied.json").exists());
}

#[test]
fn failed_restart_is_retryable_and_cannot_certify_the_same_process() {
    use cli_command_kit::Mode;
    use devhost_rust::{caddy, config::CaddySettings};
    use std::os::unix::fs::PermissionsExt;
    let fixture = tempfile::tempdir().unwrap();
    let directory = fixture.path().join("caddy");
    let listeners: Vec<_> = (0..3).map(|_| fixture_ports::reserve_listener()).collect();
    let ports: Vec<_> = listeners
        .iter()
        .map(|listener| listener.local_addr().unwrap().port())
        .collect();
    let settings = CaddySettings {
        admin_address: format!("127.0.0.1:{}", ports[0]),
        bind_host: "127.0.0.1".to_owned(),
        http_port: ports[1],
        https_port: ports[2],
        stack_directory_host: "retry.localhost".to_owned(),
        ..CaddySettings::default()
    };
    drop(listeners);
    caddy::files::prepare_directories(&directory).unwrap();
    struct NativeCleanup<'a>(&'a CaddySettings);
    impl Drop for NativeCleanup<'_> {
        fn drop(&mut self) {
            let _ = Command::new("caddy")
                .args(["stop", "--address", &self.0.admin_address])
                .output();
        }
    }
    let _cleanup = NativeCleanup(&settings);
    let binary = directory.join("caddy");
    let write_binary = |text: &str| {
        fs::write(&binary, text).unwrap();
        fs::set_permissions(&binary, fs::Permissions::from_mode(0o700)).unwrap();
    };
    // A launcher reporting success without a ready server cannot publish proof.
    write_binary("#!/bin/sh\nexit 0\n");
    let mut output = Vec::new();
    assert!(
        caddy::start_in_directory(&directory, &settings, Mode::Agent, &mut output, true).is_err()
    );
    assert!(String::from_utf8_lossy(&output).contains("did not become ready"));
    assert!(!directory.join("runtime.json").exists());
    fs::remove_file(&binary).unwrap();
    caddy::start_in_directory(&directory, &settings, Mode::Agent, &mut output, true).unwrap();
    let receipt = fs::read(directory.join("runtime.json")).unwrap();
    let mut older: serde_json::Value = serde_json::from_slice(&receipt).unwrap();
    older["restartGeneration"] = 0.into();
    let older = serde_json::to_vec(&older).unwrap();
    fs::write(directory.join("runtime.json"), &older).unwrap();
    let pid = fs::read_to_string(directory.join("caddy.pid")).unwrap();
    write_binary("#!/bin/sh\necho 'stop rejected' >&2\nexit 1\n");
    let error = caddy::start_in_directory(&directory, &settings, Mode::Agent, &mut output, true)
        .unwrap_err();
    assert!(error.message.contains("Caddy stop failed"));
    assert_eq!(fs::read(directory.join("runtime.json")).unwrap(), older);
    assert_eq!(
        fs::read_to_string(directory.join("caddy.pid")).unwrap(),
        pid
    );
    // Neither a no-op stop nor a no-op start may turn an old owner into fresh proof.
    write_binary(&format!(
        "#!/bin/sh\nif [ \"$1\" = start ]; then printf '%s' '{}' > caddy.pid; fi\nexit 0\n",
        pid.trim()
    ));
    output.clear();
    assert!(
        caddy::start_in_directory(&directory, &settings, Mode::Agent, &mut output, true).is_err()
    );
    assert!(String::from_utf8_lossy(&output).contains("did not start a fresh process"));
    assert_eq!(fs::read(directory.join("runtime.json")).unwrap(), older);
    fs::remove_file(&binary).unwrap();
    caddy::start_in_directory(&directory, &settings, Mode::Agent, &mut output, true).unwrap();
    assert_ne!(fs::read(directory.join("runtime.json")).unwrap(), receipt);
    // Stack/serve startup shares the same upgrade mechanism.
    fs::remove_file(directory.join("runtime.json")).unwrap();
    assert!(
        caddy::ensure_managed_caddy_runtime(&directory, &settings, Mode::Agent, &mut output, true)
            .unwrap()
    );
    assert!(
        !caddy::ensure_managed_caddy_runtime(&directory, &settings, Mode::Agent, &mut output, true)
            .unwrap()
    );
    caddy::stop_in_directory(&directory, &settings, Mode::Agent, &mut output).unwrap();
}
