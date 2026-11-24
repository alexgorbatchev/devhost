use super::control::{body, client, get, origin, post};
use super::*;

pub(super) fn launch(runtime: &Runtime, project: &Path, selections: &[&str]) -> Process {
    let log = File::create(project.join("lifecycle.log")).unwrap();
    let mut command = runtime.command();
    command
        .current_dir(project)
        .args(["start", "--local"])
        .args(selections)
        .env_remove("BASH_ENV")
        .stdin(Stdio::null())
        .stdout(log.try_clone().unwrap())
        .stderr(log);
    // SAFETY: setsid is async-signal-safe and gives this fixture its own group.
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

fn wait_log(project: &Path, text: &str) {
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        let log = fs::read_to_string(project.join("lifecycle.log")).unwrap_or_default();
        if log.contains(text) {
            return;
        }
        assert!(Instant::now() < deadline, "missing {text}: {log}");
        thread::sleep(Duration::from_millis(20));
    }
}

pub(super) fn ready(origin: &str) {
    wait_until(|| {
        let snapshot = body(&mut get(origin, "stack-info"));
        snapshot["starting"] == false
            && snapshot["services"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|service| service["state"] != "not-started")
                .all(|service| service["state"] == "ready")
    });
}

fn health(origin: &str) -> Value {
    use async_tungstenite::tungstenite::client::IntoClientRequest;
    let address: std::net::SocketAddr = origin.strip_prefix("http://").unwrap().parse().unwrap();
    let stream = std::net::TcpStream::connect_timeout(&address, Duration::from_secs(5)).unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .unwrap();
    stream
        .set_write_timeout(Some(Duration::from_secs(5)))
        .unwrap();
    let mut request = format!(
        "{}/__devhost__/ws/health",
        origin.replace("http://", "ws://")
    )
    .into_client_request()
    .unwrap();
    request
        .headers_mut()
        .insert("Origin", origin.parse().unwrap());
    let (mut websocket, _) = async_tungstenite::tungstenite::client(request, stream).unwrap();
    let snapshot = serde_json::from_str(websocket.read().unwrap().to_text().unwrap()).unwrap();
    let _ = websocket.close(None);
    snapshot
}

pub(super) fn stop(runtime: &Runtime, project: &Path, process: &mut Process) {
    let output = runtime
        .command()
        .current_dir(project)
        .arg("stop")
        .output()
        .unwrap();
    assert!(output.status.success(), "{output:?}");
    wait_until(|| process.0.try_wait().unwrap().is_some());
    assert!(
        read_live_stack_owners(&runtime.state().join("caddy"))
            .unwrap()
            .is_empty()
    );
}

#[test]
fn pending_http_health_request_is_canceled_before_backend_timeout() {
    use std::io::BufRead;

    let runtime = Runtime::start();
    let listener = fixture_ports::reserve_listener();
    listener.set_nonblocking(true).unwrap();
    let port = listener.local_addr().unwrap().port();
    let project = runtime.root.path().join("http-cancel");
    fs::create_dir(&project).unwrap();
    fs::write(
        project.join("devhost.toml"),
        format!("name='http-cancel'\n[worktrees]\nenabled=false\n[services.worker]\ncommand=['sh','-c','printf %s $$ > worker.pid; exec sleep 300']\nport='auto'\n[services.worker.health]\nhttp='http://127.0.0.1:{port}/health'\ninterval=30000\ntimeout=60000\n"),
    )
    .unwrap();
    let mut process = launch(&runtime, &project, &["--detach"]);
    let mut accepted = None;
    wait_until(|| {
        assert!(
            process.0.try_wait().unwrap().is_none(),
            "{}",
            fs::read_to_string(project.join("lifecycle.log")).unwrap()
        );
        match listener.accept() {
            Ok((stream, _)) => {
                accepted = Some(stream);
                true
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => false,
            Err(error) => panic!("accept health request: {error}"),
        }
    });
    let pending = accepted.unwrap();
    pending
        .set_read_timeout(Some(Duration::from_secs(3)))
        .unwrap();
    let mut pending = std::io::BufReader::new(pending);
    let mut request = String::new();
    pending.read_line(&mut request).unwrap();
    assert_eq!(request, "GET /health HTTP/1.1\r\n");
    let worker_pid = fs::read_to_string(project.join("worker.pid"))
        .unwrap()
        .parse::<i32>()
        .unwrap();
    let origin = origin(&runtime, "http-cancel");
    let snapshot = body(&mut get(&origin, "stack-info"));
    assert_eq!(snapshot["starting"], true, "{snapshot}");
    assert!(
        snapshot["services"]
            .as_array()
            .unwrap()
            .iter()
            .all(|service| service["state"] != "ready"),
        "{snapshot}"
    );
    let started = Instant::now();
    // SAFETY: this is the detached-start parent spawned by this fixture.
    assert_eq!(
        unsafe { libc::kill(process.0.id() as i32, libc::SIGTERM) },
        0
    );
    let deadline = started + Duration::from_secs(5);
    let status = loop {
        if let Some(status) = process.0.try_wait().unwrap() {
            break status;
        }
        assert!(
            Instant::now() < deadline,
            "shutdown waited for the unresponsive HTTP peer: {}",
            fs::read_to_string(project.join("lifecycle.log")).unwrap()
        );
        thread::sleep(Duration::from_millis(20));
    };
    assert!(!status.success());
    // Keep the peer open until shutdown completes: EOF must not release the probe.
    drop(pending);
    assert!(!procid::is_process_alive(worker_pid));
    assert!(
        read_live_stacks(&runtime.state().join("caddy"))
            .unwrap()
            .is_empty()
    );
    assert!(
        read_live_stack_owners(&runtime.state().join("caddy"))
            .unwrap()
            .is_empty()
    );
    let log = fs::read_to_string(project.join("lifecycle.log")).unwrap();
    assert!(log.contains("Startup log tail:"), "{log}");
    assert!(
        log.contains("received SIGTERM (signal 15) before the stack was ready; full log:"),
        "{log}"
    );
}

#[test]
fn included_groups_dependencies_always_start_watches_and_start_stopped_match() {
    let runtime = Runtime::start();
    let project = runtime.root.path().join("selection-contract");
    let child = project.join("included");
    fs::create_dir_all(child.join("src")).unwrap();
    fs::create_dir(child.join("src/node_modules")).unwrap();
    fs::write(child.join("src/input.txt"), "initial").unwrap();
    fs::write(child.join("worker.sh"), "printf '%s|%s|%s\\n' \"$1\" \"$PWD\" \"$MARK\" >> ../launches\nprintf '%s' \"$$\" > \"$1.pid\"\nif [ \"$1\" = web ]; then exec python3 -m http.server \"$PORT\" --bind 127.0.0.1; fi\nexec sleep 300\n").unwrap();
    fs::write(
        project.join("devhost.toml"),
        "name='selection-contract'\nincludes=['included/services.toml']\n[groups]\napp=['web']\n",
    )
    .unwrap();
    let mut services = String::new();
    for name in ["base", "web", "always", "spare"] {
        let health = if name == "web" {
            "port='auto'\nhealth.http='/'"
        } else {
            "health.process=true"
        };
        services.push_str(&format!("[services.{name}]\ncommand=['sh','worker.sh','{name}']\n{health}\n[services.{name}.env]\nMARK='included-environment'\n"));
        if name == "web" {
            // Insert service settings before the environment subtable.
            services = services.replace(
                "[services.web.env]",
                "dependsOn=['base']\nwatch=['src']\n[services.web.env]",
            );
        }
        if name == "always" {
            services = services.replace(
                "[services.always.env]",
                "alwaysStart=true\n[services.always.env]",
            );
        }
    }
    fs::write(child.join("services.toml"), services).unwrap();
    let mut process = launch(&runtime, &project, &["app"]);
    wait_until(|| {
        read_live_stacks(&runtime.state().join("caddy"))
            .unwrap()
            .iter()
            .any(|stack| stack.name == "selection-contract" && stack.control_port > 0)
    });
    let origin = origin(&runtime, "selection-contract");
    ready(&origin);
    let launches = fs::read_to_string(project.join("launches")).unwrap();
    let names: Vec<_> = launches
        .lines()
        .map(|line| line.split('|').next().unwrap())
        .collect();
    assert_eq!(names.len(), 3);
    assert!(
        names.iter().position(|name| *name == "base").unwrap()
            < names.iter().position(|name| *name == "web").unwrap()
    );
    assert!(names.contains(&"always"));
    for line in launches.lines() {
        assert!(
            line.ends_with(&format!("|{}|included-environment", child.display())),
            "{line}"
        );
    }
    let old_pid = fs::read_to_string(child.join("web.pid"))
        .unwrap()
        .parse::<i32>()
        .unwrap();
    assert!(!child.join("spare.pid").exists());
    assert!(
        health(&origin)["stoppedServices"]
            .as_array()
            .unwrap()
            .iter()
            .any(|service| service["name"] == "spare")
    );
    fs::write(child.join("src/node_modules/ignored.js"), "ignored").unwrap();
    fs::write(child.join("src/input.txt"), "changed").unwrap();
    wait_until(|| {
        health(&origin)["services"]
            .as_array()
            .unwrap()
            .iter()
            .any(|service| service["name"] == "web" && service["dirty"] == true)
    });
    let response = post(
        &origin,
        "restart-service",
        json!({"serviceNames":["missing","web"]}),
    );
    assert!(response.status().is_server_error());
    assert_eq!(
        fs::read_to_string(child.join("web.pid")).unwrap(),
        old_pid.to_string()
    );
    assert_eq!(
        post(
            &origin,
            "restart-service",
            json!({"serviceNames":["web","web"]})
        )
        .status(),
        200
    );
    ready(&origin);
    wait_until(|| {
        fs::read_to_string(project.join("launches"))
            .unwrap()
            .lines()
            .count()
            >= 4
    });
    assert_eq!(
        fs::read_to_string(project.join("launches"))
            .unwrap()
            .lines()
            .count(),
        4,
        "a duplicate restart batch must restart web exactly once"
    );
    assert!(!procid::is_process_alive(old_pid));
    assert!(
        !health(&origin)["services"]
            .as_array()
            .unwrap()
            .iter()
            .any(|service| service["name"] == "web" && service["dirty"] == true)
    );
    assert_eq!(
        post(&origin, "start-service", json!({"serviceNames":["spare"]})).status(),
        204
    );
    ready(&origin);
    wait_until(|| child.join("spare.pid").exists());
    let pids: Vec<_> = ["base", "web", "always", "spare"]
        .into_iter()
        .map(|name| {
            fs::read_to_string(child.join(format!("{name}.pid")))
                .unwrap()
                .parse::<i32>()
                .unwrap()
        })
        .collect();
    stop(&runtime, &project, &mut process);
    for pid in pids {
        assert!(
            !procid::is_process_alive(pid),
            "service {pid} survived stop"
        );
    }
}

fn response(runtime: &Runtime, host: &str) -> Option<String> {
    client()
        .get(format!(
            "http://127.0.0.1:{}/note.txt",
            runtime.settings.http_port
        ))
        .header("Host", host)
        .call()
        .ok()?
        .body_mut()
        .read_to_string()
        .ok()
}

#[test]
fn rejected_reload_preserves_routes_and_new_include_glob_recovers_match() {
    let runtime = Runtime::start();
    let project = runtime.root.path().join("reload-contract");
    fs::create_dir_all(project.join("public")).unwrap();
    fs::write(project.join("public/note.txt"), "live document").unwrap();
    let manifest =
        "name='reload-contract'\n[services.files]\nserve='public'\nhost='reload-contract'\n";
    let path = project.join("devhost.toml");
    fs::write(&path, manifest).unwrap();
    let mut process = launch(&runtime, &project, &[]);
    wait_until(|| {
        response(&runtime, "reload-contract.localhost").as_deref() == Some("live document")
    });
    let origin = origin(&runtime, "reload-contract");
    ready(&origin);
    fs::write(&path, "invalid=[").unwrap();
    wait_log(&project, "configuration reload rejected:");
    assert_eq!(
        response(&runtime, "reload-contract.localhost").as_deref(),
        Some("live document")
    );
    fs::write(
        &path,
        manifest.replace(
            "serve='public'",
            "command=['/missing-devhost-comparison-command']\nport='auto'",
        ),
    )
    .unwrap();
    wait_log(&project, "start reloaded service files:");
    assert_eq!(
        response(&runtime, "reload-contract.localhost").as_deref(),
        Some("live document")
    );
    fs::create_dir(project.join("included")).unwrap();
    fs::write(project.join("included/first.toml"), "invalid=[").unwrap();
    fs::write(&path, format!("includes=['included/*.toml']\n{manifest}")).unwrap();
    // A failed read must still register the new include directory for recovery.
    wait_log(&project, "included/first.toml");
    fs::write(
        project.join("included/first.toml"),
        "[services.extra]\nserve='../public'\nhost='reload-extra'\n",
    )
    .unwrap();
    wait_until(|| response(&runtime, "reload-extra.localhost").as_deref() == Some("live document"));
    fs::write(
        project.join("included/second.toml"),
        "[services.added]\nserve='../public'\nhost='reload-added'\n",
    )
    .unwrap();
    wait_until(|| response(&runtime, "reload-added.localhost").as_deref() == Some("live document"));
    fs::write(
        &path,
        manifest.replace("host='reload-contract'", "host='reload-next'"),
    )
    .unwrap();
    wait_until(|| response(&runtime, "reload-next.localhost").as_deref() == Some("live document"));
    assert_ne!(
        response(&runtime, "reload-contract.localhost").as_deref(),
        Some("live document")
    );
    assert_ne!(
        response(&runtime, "reload-extra.localhost").as_deref(),
        Some("live document")
    );
    stop(&runtime, &project, &mut process);
}
