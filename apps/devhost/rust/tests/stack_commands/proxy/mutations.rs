use super::claims::{claim_project, claim_ready, routed_body};
use super::*;

fn stop_command(runtime: &Runtime, project: &Path) -> Process {
    let log = File::create(project.join("stop.log")).unwrap();
    let mut command = runtime.command();
    command
        .current_dir(project)
        .arg("stop")
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

    // Leave the real live owner's routes and claims but remove its registry
    // publication, as after an interrupted registry update.
    fs::remove_file(
        runtime
            .state()
            .join(format!("caddy/stacks/{}.json", orphan.0.id())),
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
            .any(|stack| stack.pid == replacement.0.id() as i32 && stack.control_port > 0);
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
            keeper.0.id()
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
        log.matches(&format!("Stopping zombie PID {}", orphan.0.id()))
            .count(),
        1,
        "{log}"
    );
    assert_eq!(
        log.matches(&format!("Stopped zombie PID {}", orphan.0.id()))
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
