use super::claims::{claim_project, claim_ready, routed_body};
use super::*;

fn stop_command(runtime: &Runtime, project: &Path) -> Process {
    let mut command = runtime.command();
    command.current_dir(project).arg("stop");
    logged_command(command, &project.join("stop.log"))
}

fn logged_command(mut command: Command, path: &Path) -> Process {
    let log = File::create(path).unwrap();
    command
        .stdin(Stdio::null())
        .stdout(log.try_clone().unwrap())
        .stderr(log);
    // SAFETY: setsid is async-signal-safe and isolates the owned command group.
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

struct FailedRestartGate(PathBuf);

impl Drop for FailedRestartGate {
    fn drop(&mut self) {
        // Restore native reload/stop before releasing a command holding the lock.
        let _ = fs::remove_file(self.0.join("caddy"));
        let _ = fs::write(self.0.join("release-restart"), "");
    }
}

#[test]
fn failed_caddy_restart_releases_a_concurrent_route_withdrawal() {
    let runtime = Runtime::start();
    let keeper_project = claim_project(&runtime, "restart-keeper", &["restart-keeper.localhost"]);
    let stopped_project = claim_project(&runtime, "restart-stop", &["restart-stop.localhost"]);
    fs::write(
        stopped_project.join("backend.py"),
        "import http.server, os, pathlib, signal, socketserver, sys\ndef stop(*_):\n pathlib.Path('stop-entered').write_text('')\n sys.exit(0)\nsignal.signal(signal.SIGTERM, stop)\nsocketserver.TCPServer.allow_reuse_address = True\nsocketserver.TCPServer(('127.0.0.1', int(os.environ['PORT'])), http.server.SimpleHTTPRequestHandler).serve_forever()\n",
    )
    .unwrap();
    let mut keeper = launch(&runtime, &keeper_project, &[]);
    claim_ready(&runtime, &keeper_project, "restart-keeper", &mut keeper);
    let mut stopped = launch(&runtime, &stopped_project, &[]);
    claim_ready(&runtime, &stopped_project, "restart-stop", &mut stopped);
    assert_eq!(
        routed_body(&runtime, "restart-stop.localhost"),
        "restart-stop"
    );
    let directory = runtime.state().join("caddy");
    let pid = fs::read(directory.join("caddy.pid")).unwrap();
    let ca = fs::read(directory.join("storage/pki/authorities/local/root.crt")).unwrap();
    let mut receipt: Value =
        serde_json::from_slice(&fs::read(directory.join("runtime.json")).unwrap()).unwrap();
    receipt["restartGeneration"] = 0.into();
    let receipt = serde_json::to_vec(&receipt).unwrap();
    fs::write(directory.join("runtime.json"), &receipt).unwrap();
    let launcher = directory.join("caddy");
    fs::write(
        &launcher,
        "#!/bin/sh\nif [ \"$1\" = stop ]; then\n : > restart-pending\n n=0\n while [ ! -f release-restart ] && [ \"$n\" -lt 1000 ]; do sleep 0.02; n=$((n+1)); done\n echo 'fixture stop rejected' >&2\n exit 1\nfi\nexec caddy \"$@\"\n",
    )
    .unwrap();
    fs::set_permissions(&launcher, fs::Permissions::from_mode(0o700)).unwrap();
    let gate = FailedRestartGate(directory.clone());
    let mut command = runtime.command();
    command.args(["caddy", "start"]);
    let mut restarting = logged_command(command, &runtime.root.path().join("restart.log"));
    wait_until(|| directory.join("restart-pending").exists());
    let mut stopping = stop_command(&runtime, &stopped_project);
    // The stop must reach the service while the restart holds Caddy; on a timeout, both commands' logs say where it waits.
    let deadline = Instant::now() + Duration::from_secs(15);
    while !stopped_project.join("stop-entered").exists() {
        assert!(
            Instant::now() < deadline,
            "stop never reached the service
stop: {}
restart: {}
stack logs: {}",
            fs::read_to_string(stopped_project.join("stop.log")).unwrap_or_default(),
            fs::read_to_string(runtime.root.path().join("restart.log")).unwrap_or_default(),
            fs::read_dir(runtime.state().join("logs"))
                .map(|entries| entries
                    .flatten()
                    .map(|entry| format!(
                        "{}:
{}",
                        entry.path().display(),
                        fs::read_to_string(entry.path()).unwrap_or_default()
                    ))
                    .collect::<Vec<_>>()
                    .join(
                        "
"
                    ))
                .unwrap_or_default()
        );
        thread::sleep(Duration::from_millis(20));
    }
    assert!(stopping.0.try_wait().unwrap().is_none());
    assert!(restarting.0.try_wait().unwrap().is_none());
    assert_eq!(
        routed_body(&runtime, "restart-keeper.localhost"),
        "restart-keeper"
    );
    assert_eq!(fs::read(directory.join("runtime.json")).unwrap(), receipt);
    drop(gate);
    wait_until(|| restarting.0.try_wait().unwrap().is_some());
    assert!(!restarting.0.wait().unwrap().success());
    let diagnostic = fs::read_to_string(runtime.root.path().join("restart.log")).unwrap();
    assert!(diagnostic.contains("Caddy stop failed"), "{diagnostic}");
    wait_until(|| stopping.0.try_wait().unwrap().is_some());
    assert!(stopping.0.wait().unwrap().success());
    wait_until(|| stopped.0.try_wait().unwrap().is_some());
    assert_unrouted(&runtime, "restart-stop.localhost");
    assert!(keeper.0.try_wait().unwrap().is_none());
    assert_eq!(
        routed_body(&runtime, "restart-keeper.localhost"),
        "restart-keeper"
    );
    assert_eq!(fs::read(directory.join("caddy.pid")).unwrap(), pid);
    assert_eq!(fs::read(directory.join("runtime.json")).unwrap(), receipt);
    assert_eq!(
        fs::read(directory.join("storage/pki/authorities/local/root.crt")).unwrap(),
        ca
    );
}

fn assert_unrouted(runtime: &Runtime, host: &str) {
    assert_eq!(
        control::client()
            .get(format!("http://127.0.0.1:{}/", runtime.settings.http_port))
            .header("Host", host)
            .call()
            .unwrap()
            .status(),
        404,
        "{host}"
    );
}

#[test]
fn concurrent_stop_orphan_recovery_and_rejected_takeover_preserve_other_routes() {
    let runtime = Runtime::start();
    let mut sentinel = sleeper();
    let keeper_project = claim_project(&runtime, "mutation-keeper", &["mutation-keeper.localhost"]);
    let orphan_project = claim_project(&runtime, "mutation-orphan", &["mutation-orphan.localhost"]);
    let stopped_project = claim_project(&runtime, "mutation-stop", &["mutation-stop.localhost"]);
    let rejected_project = claim_project(
        &runtime,
        "mutation-rejected",
        &["mutation-keeper.localhost"],
    );
    let mut keeper = launch(&runtime, &keeper_project, &[]);
    claim_ready(&runtime, &keeper_project, "mutation-keeper", &mut keeper);
    let mut orphan = launch(&runtime, &orphan_project, &[]);
    claim_ready(&runtime, &orphan_project, "mutation-orphan", &mut orphan);
    let mut stopped = launch(&runtime, &stopped_project, &[]);
    claim_ready(&runtime, &stopped_project, "mutation-stop", &mut stopped);
    let caddy_pid = fs::read(runtime.state().join("caddy/caddy.pid")).unwrap();

    let initial_stacks = read_live_stacks(&runtime.state().join("caddy")).unwrap();
    let keeper_stack = initial_stacks
        .iter()
        .find(|stack| stack.name == "mutation-keeper")
        .unwrap()
        .clone();
    let orphan_stack = initial_stacks
        .iter()
        .find(|stack| stack.name == "mutation-orphan")
        .unwrap()
        .clone();

    // Leave the real live owner's routes and claims but remove its registry
    // publication, as after an interrupted registry update.
    fs::remove_file(
        runtime
            .state()
            .join(format!("caddy/stacks/{}.json", orphan_stack.stack_id)),
    )
    .unwrap();
    record(
        &runtime.state(),
        "routes/.registrations/stale-mutation.json",
        json!({
            "createdAt":"2026-11-24T00:00:00Z",
            "host":"mutation-keeper.localhost",
            "manifestPath":orphan_project.join("devhost.toml"),
            "ownerPid":sentinel.0.id(),
            "ownerStartIdentity":"previous-process-start-identity",
            "appBindHost":"127.0.0.1", "appPort":9234, "path":"/", "serviceName":"stale"
        }),
    );

    let mut replacement = launch(&runtime, &orphan_project, &[]);
    let mut stopping = stop_command(&runtime, &stopped_project);
    let mut rejected = launch(&runtime, &rejected_project, &[]);
    let deadline = Instant::now() + Duration::from_secs(20);
    let mut samples = 0;
    loop {
        assert!(keeper.0.try_wait().unwrap().is_none());
        assert!(sentinel.0.try_wait().unwrap().is_none());
        assert_eq!(
            routed_body(&runtime, "mutation-keeper.localhost"),
            "mutation-keeper"
        );
        samples += 1;
        assert!(
            replacement.0.try_wait().unwrap().is_none(),
            "{}",
            fs::read_to_string(orphan_project.join("lifecycle.log")).unwrap()
        );
        let replacement_published = read_live_stacks(&runtime.state().join("caddy"))
            .unwrap()
            .iter()
            .any(|stack| {
                stack.name == "mutation-orphan"
                    && stack.stack_id != orphan_stack.stack_id
                    && stack.control_port > 0
            });
        if replacement_published
            && stopping.0.try_wait().unwrap().is_some()
            && rejected.0.try_wait().unwrap().is_some()
            && orphan.0.try_wait().unwrap().is_some()
        {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "concurrent mutation did not settle: orphan {}; stop {}; rejection {}",
            fs::read_to_string(orphan_project.join("lifecycle.log")).unwrap(),
            fs::read_to_string(stopped_project.join("stop.log")).unwrap(),
            fs::read_to_string(rejected_project.join("lifecycle.log")).unwrap()
        );
        thread::sleep(Duration::from_millis(20));
    }
    assert!(
        samples > 1,
        "fixture did not observe pending concurrent mutations"
    );
    assert!(stopping.0.wait().unwrap().success());
    assert!(!rejected.0.wait().unwrap().success());
    let rejected_log = fs::read_to_string(rejected_project.join("lifecycle.log")).unwrap();
    assert!(
        rejected_log.contains(&format!(
            "mutation-keeper.localhost is already claimed by PID {}",
            keeper_stack.pid
        )),
        "{rejected_log}"
    );
    wait_until(|| stopped.0.try_wait().unwrap().is_some());
    claim_ready(
        &runtime,
        &orphan_project,
        "mutation-orphan",
        &mut replacement,
    );
    assert_eq!(
        routed_body(&runtime, "mutation-orphan.localhost"),
        "mutation-orphan"
    );
    assert_unrouted(&runtime, "mutation-stop.localhost");
    assert_eq!(
        fs::read(runtime.state().join("caddy/caddy.pid")).unwrap(),
        caddy_pid
    );
    assert!(
        !runtime
            .state()
            .join("caddy/routes/.registrations/stale-mutation.json")
            .exists()
    );
    let log = fs::read_to_string(orphan_project.join("lifecycle.log")).unwrap();
    assert_eq!(
        log.matches(&format!("Stopping zombie stack {}", orphan_stack.stack_id))
            .count(),
        1,
        "{log}"
    );
    assert_eq!(
        log.matches(&format!("Stopped zombie stack {}", orphan_stack.stack_id))
            .count(),
        1,
        "{log}"
    );
    let owners = read_live_stack_owners(&runtime.state().join("caddy")).unwrap();
    assert_eq!(owners.len(), 2, "{owners:?}");

    let mut stopping_replacement = stop_command(&runtime, &orphan_project);
    wait_until(|| stopping_replacement.0.try_wait().unwrap().is_some());
    assert!(stopping_replacement.0.wait().unwrap().success());
    wait_until(|| replacement.0.try_wait().unwrap().is_some());
    assert_unrouted(&runtime, "mutation-orphan.localhost");
    assert_eq!(
        routed_body(&runtime, "mutation-keeper.localhost"),
        "mutation-keeper"
    );
    stop(&runtime, &keeper_project, &mut keeper);
    assert!(sentinel.0.try_wait().unwrap().is_none());
}
