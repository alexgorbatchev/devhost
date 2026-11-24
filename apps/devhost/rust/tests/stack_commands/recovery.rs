use super::control::{body, client, get, origin, post};
use super::lifecycle::{launch, ready, stop};
use super::*;

fn project(runtime: &Runtime, name: &str) -> PathBuf {
    let project = runtime.root.path().join(name);
    fs::create_dir_all(project.join("public")).unwrap();
    fs::write(project.join("public/note.txt"), "retained keeper").unwrap();
    fs::write(project.join("note.txt"), "recovered worker").unwrap();
    fs::write(project.join("worker.py"), "import http.server, os, pathlib, time\npid = os.getpid()\nwith open('launches', 'a') as output:\n output.write(str(pid) + '\\n')\nprint('worker readiness pending', flush=True)\nwhile not pathlib.Path('healthy').exists(): time.sleep(0.01)\nserver = http.server.HTTPServer(('127.0.0.1', int(os.environ['PORT'])), http.server.SimpleHTTPRequestHandler)\nserver.serve_forever()\n").unwrap();
    fs::write(project.join("devhost.toml"), format!("name={name:?}\n[worktrees]\nenabled=false\n[services.keeper]\nserve='public'\nhost='{name}-keeper'\n[services.worker]\ncommand=['python3','worker.py']\nport='auto'\nhost='{name}'\n[services.worker.health]\ntimeout=1000\ninterval=25\n")).unwrap();
    project
}

fn control_origin(runtime: &Runtime, name: &str) -> String {
    wait_until(|| {
        read_live_stacks(&runtime.state().join("caddy"))
            .unwrap()
            .iter()
            .any(|stack| stack.name == name && stack.control_port > 0)
    });
    origin(runtime, name)
}

#[track_caller]
fn routed(runtime: &Runtime, name: &str, action: &str) -> ureq::http::Response<ureq::Body> {
    let caller = std::panic::Location::caller();
    let started = Instant::now();
    client()
        .get(format!(
            "http://127.0.0.1:{}/note.txt",
            runtime.settings.http_port
        ))
        .header("Host", &format!("{name}.localhost"))
        .header("X-Devhost-Recovery", action)
        .header("Accept", "application/json")
        .call()
        .unwrap_or_else(|error| {
            panic!(
                "recovery {action} for {name} at {caller} failed after {:?}: {error}; lifecycle: {}; Caddy: {}",
                started.elapsed(),
                fs::read_to_string(runtime.root.path().join(name).join("lifecycle.log"))
                    .unwrap_or_default(),
                fs::read_to_string(runtime.state().join("caddy/caddy.stderr.log"))
                    .unwrap_or_default()
            )
        })
}

fn launches(project: &Path) -> Vec<i32> {
    fs::read_to_string(project.join("launches"))
        .unwrap_or_default()
        .lines()
        .map(|line| line.parse().unwrap())
        .collect()
}

#[track_caller]
fn restart(origin: &str, project: &Path) -> ureq::http::Response<ureq::Body> {
    let started = Instant::now();
    // A failed replacement follows two two-second late-listener cleanup windows
    // and the one-second health deadline; the ordinary five-second client races it.
    let client: ureq::Agent = ureq::Agent::config_builder()
        .proxy(None)
        .http_status_as_error(false)
        .timeout_global(Some(Duration::from_secs(10)))
        .build()
        .into();
    client
        .post(format!("{origin}/__devhost__/restart-service"))
        .header("Origin", origin)
        .header("Content-Type", "application/json")
        .send(json!({"serviceName":"worker"}).to_string())
        .unwrap_or_else(|error| {
            panic!(
                "restart failed after {:?}: {error}; log: {}",
                started.elapsed(),
                fs::read_to_string(project.join("lifecycle.log")).unwrap_or_default()
            )
        })
}

#[test]
fn foreground_timeout_and_crash_remain_recoverable_without_automatic_respawn() {
    let runtime = Runtime::start();
    let name = "recovery-contract";
    let project = project(&runtime, name);
    let mut process = launch(&runtime, &project, &[]);
    let origin = control_origin(&runtime, name);
    wait_until(|| {
        let mut response = routed(&runtime, name, "status");
        let text = response.body_mut().read_to_string().unwrap();
        serde_json::from_str::<Value>(&text)
            .is_ok_and(|status| status["phase"] == "unavailable" && status["canRestart"] == true)
    });
    let status = body(&mut routed(&runtime, name, "status"));
    assert_eq!(status["title"], "worker could not start", "{status}");
    assert!(
        status["message"]
            .as_str()
            .unwrap()
            .contains("did not pass its health check within 1000ms"),
        "{status}"
    );
    let mut probe = routed(&runtime, name, "probe");
    assert_eq!(probe.status(), 503);
    assert_eq!(probe.headers()["cache-control"], "no-store");
    assert_eq!(body(&mut probe)["phase"], "unavailable");
    assert_eq!(launches(&project).len(), 1);
    assert!(!procid::is_process_alive(launches(&project)[0]));
    assert_eq!(
        routed(&runtime, &format!("{name}-keeper"), "probe").status(),
        204
    );

    fs::write(project.join("healthy"), "ready").unwrap();
    assert_eq!(restart(&origin, &project).status(), 200);
    ready(&origin);
    assert_eq!(
        body(&mut routed(&runtime, name, "status"))["phase"],
        "ready"
    );
    assert_eq!(launches(&project).len(), 2);
    let crashed = launches(&project)[1];
    // SAFETY: this PID was published by the live service owned by this fixture.
    assert_eq!(unsafe { libc::kill(crashed, libc::SIGKILL) }, 0);
    wait_until(|| body(&mut routed(&runtime, name, "status"))["title"] == "worker exited");
    for _ in 0..3 {
        let status = body(&mut routed(&runtime, name, "status"));
        assert!(
            status["message"].as_str().unwrap().contains("137"),
            "{status}"
        );
        assert_eq!(routed(&runtime, name, "probe").status(), 503);
    }
    assert_eq!(
        launches(&project).len(),
        2,
        "requests must leave an exited service stopped"
    );
    assert!(process.0.try_wait().unwrap().is_none());
    assert_eq!(
        routed(&runtime, &format!("{name}-keeper"), "probe").status(),
        204
    );

    fs::remove_file(project.join("healthy")).unwrap();
    assert!(restart(&origin, &project).status().is_server_error());
    assert_eq!(
        body(&mut routed(&runtime, name, "status"))["canRestart"],
        true
    );
    fs::write(project.join("healthy"), "ready").unwrap();
    assert_eq!(restart(&origin, &project).status(), 200);
    ready(&origin);
    assert_eq!(launches(&project).len(), 4);
    stop(&runtime, &project, &mut process);
    for pid in launches(&project) {
        assert!(!procid::is_process_alive(pid));
    }
}

#[test]
fn concurrent_start_requests_launch_an_unselected_service_once() {
    let runtime = Runtime::start();
    let name = "request-start";
    let project = project(&runtime, name);
    let mut process = launch(&runtime, &project, &["keeper"]);
    let origin = control_origin(&runtime, name);
    ready(&origin);
    assert!(launches(&project).is_empty());
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(3));
    let statuses = thread::scope(|scope| {
        let requests: Vec<_> = (0..2)
            .map(|_| {
                let origin = origin.clone();
                let barrier = barrier.clone();
                scope.spawn(move || {
                    barrier.wait();
                    post(&origin, "start-service", json!({"serviceNames":["worker"]})).status()
                })
            })
            .collect();
        barrier.wait();
        wait_until(|| !launches(&project).is_empty());
        // Reads and the retained route must stay responsive during pending health.
        assert_eq!(get(&origin, "stack-info").status(), 200);
        assert_eq!(
            routed(&runtime, &format!("{name}-keeper"), "probe").status(),
            204
        );
        fs::write(project.join("healthy"), "ready").unwrap();
        requests
            .into_iter()
            .map(|request| request.join().unwrap())
            .collect::<Vec<_>>()
    });
    assert_eq!(
        statuses.iter().filter(|status| status.is_success()).count(),
        1,
        "{statuses:?}"
    );
    assert_eq!(
        statuses
            .iter()
            .filter(|status| status.is_server_error())
            .count(),
        1,
        "{statuses:?}"
    );
    ready(&origin);
    assert_eq!(launches(&project).len(), 1);
    assert_eq!(
        body(&mut routed(&runtime, name, "status"))["phase"],
        "ready"
    );
    stop(&runtime, &project, &mut process);
    assert!(!procid::is_process_alive(launches(&project)[0]));
}

#[test]
fn routed_traffic_renews_idle_shutdown_and_negative_timeout_disables_it() {
    for (name, timeout) in [("idle-traffic", "1s"), ("idle-disabled", "-1ns")] {
        let runtime = Runtime::start();
        let project = project(&runtime, name);
        fs::write(project.join("healthy"), "ready").unwrap();
        let mut process = launch(&runtime, &project, &["--idle-timeout", timeout]);
        let origin = control_origin(&runtime, name);
        ready(&origin);
        let port = body(&mut get(&origin, "stack-info"))["services"]
            .as_array()
            .unwrap()
            .iter()
            .find(|service| service["name"] == "worker")
            .unwrap()["port"]
            .as_u64()
            .unwrap() as u16;
        let pid = launches(&project)[0];
        let until = Instant::now() + Duration::from_secs(3);
        while Instant::now() < until {
            assert_eq!(
                routed(&runtime, &format!("{name}-keeper"), "probe").status(),
                204
            );
            assert!(process.0.try_wait().unwrap().is_none());
            thread::sleep(Duration::from_millis(100));
        }
        if timeout.starts_with('-') {
            // No HTTP or WebSocket traffic during more than the positive interval.
            let until = Instant::now() + Duration::from_secs(2);
            while Instant::now() < until {
                assert!(process.0.try_wait().unwrap().is_none());
                thread::sleep(Duration::from_millis(50));
            }
            stop(&runtime, &project, &mut process);
        } else {
            wait_until(|| process.0.try_wait().unwrap().is_some());
            assert!(
                fs::read_to_string(project.join("lifecycle.log"))
                    .unwrap()
                    .contains("Idle timeout of 1s reached")
            );
        }
        assert!(!procid::is_process_alive(pid));
        assert!(std::net::TcpStream::connect(("127.0.0.1", port)).is_err());
        assert!(
            read_live_stack_owners(&runtime.state().join("caddy"))
                .unwrap()
                .is_empty()
        );
        assert_eq!(
            routed(&runtime, &format!("{name}-keeper"), "probe").status(),
            404
        );
        assert!(
            client()
                .get(format!("http://{}/config/", runtime.settings.admin_address))
                .call()
                .unwrap()
                .status()
                .is_success()
        );
    }
}
