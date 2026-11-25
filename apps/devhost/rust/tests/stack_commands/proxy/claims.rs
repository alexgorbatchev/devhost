use super::*;

pub(super) fn claim_project(runtime: &Runtime, name: &str, hosts: &[&str]) -> PathBuf {
    let project = runtime.root.path().join(name);
    fs::create_dir(&project).unwrap();
    fs::write(project.join("index.html"), name).unwrap();
    fs::write(
        project.join("backend.py"),
        "import http.server, os, socketserver\nsocketserver.TCPServer.allow_reuse_address = True\nsocketserver.TCPServer(('127.0.0.1', int(os.environ['PORT'])), http.server.SimpleHTTPRequestHandler).serve_forever()\n",
    )
    .unwrap();
    fs::write(
        project.join("devhost.toml"),
        format!(
            "name={name:?}\n[worktrees]\nenabled=false\n[services.web]\ncommand=['python3','-u','backend.py']\nport='auto'\nhost={hosts:?}\nhealth.http='/'\n"
        ),
    )
    .unwrap();
    project
}

fn registration(runtime: &Runtime, host: &str) -> PathBuf {
    fs::read_dir(runtime.state().join("caddy/routes/.registrations"))
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .find(|path| {
            path.extension()
                .is_some_and(|extension| extension == "json")
                && serde_json::from_slice::<Value>(&fs::read(path).unwrap()).unwrap()["host"]
                    == host
        })
        .unwrap_or_else(|| panic!("no registration for {host}"))
}

#[track_caller]
pub(super) fn routed_body(runtime: &Runtime, host: &str) -> String {
    let mut last_error = None;
    for attempt in 0..5 {
        match control::client()
            .get(format!("http://127.0.0.1:{}/", runtime.settings.http_port))
            .header("Host", host)
            .header("Connection", "close")
            .call()
        {
            Ok(mut response) => {
                assert_eq!(response.status(), 200);
                return response.body_mut().read_to_string().unwrap();
            }
            Err(ureq::Error::Io(error))
                if attempt < 4
                    && matches!(
                        error.kind(),
                        std::io::ErrorKind::UnexpectedEof
                            | std::io::ErrorKind::ConnectionReset
                            | std::io::ErrorKind::ConnectionRefused
                    ) =>
            {
                last_error = Some(ureq::Error::Io(error));
                thread::sleep(Duration::from_millis(25));
            }
            Err(error) => {
                last_error = Some(error);
                break;
            }
        }
    }
    panic!(
        "routed request for {host} failed: {:?}; Caddy: {}",
        last_error.unwrap(),
        fs::read_to_string(runtime.state().join("caddy/caddy.stderr.log")).unwrap_or_default()
    );
}

pub(super) fn claim_ready(runtime: &Runtime, project: &Path, name: &str, process: &mut Process) {
    wait_until(|| {
        assert!(
            process.0.try_wait().unwrap().is_none(),
            "{}",
            fs::read_to_string(project.join("lifecycle.log")).unwrap()
        );
        read_live_stacks(&runtime.state().join("caddy"))
            .unwrap()
            .iter()
            .any(|stack| stack.name == name && stack.control_port > 0)
    });
    ready(&control::origin(runtime, name));
}

#[test]
fn stale_identities_release_hosts_while_live_claims_and_registrations_reject_takeover() {
    let runtime = Runtime::start();
    let mut sentinel = sleeper();
    let stale_hosts = ["stale-claim.localhost", "stale-registration.localhost"];
    let protected_hosts = ["claim-only.localhost", "registration-only.localhost"];
    let owner_project = claim_project(
        &runtime,
        "claim-owner",
        &[
            stale_hosts[0],
            stale_hosts[1],
            protected_hosts[0],
            protected_hosts[1],
        ],
    );
    let contender = claim_project(&runtime, "claim-contender", &protected_hosts);
    let stale = json!({
        "createdAt": "2026-11-24T00:00:00Z",
        "manifestPath": contender.join("devhost.toml"),
        "ownerPid": sentinel.0.id(),
        "ownerStartIdentity": "previous-process-start-identity",
        "host": stale_hosts[0],
        "appBindHost": "127.0.0.1",
        "appPort": 9234,
        "path": "/",
        "serviceName": "web"
    });
    record(
        &runtime.state(),
        &format!("routes/.host-claims/{}.json", stale_hosts[0]),
        stale.clone(),
    );
    let mut stale_registration = stale;
    stale_registration["host"] = json!(stale_hosts[1]);
    record(
        &runtime.state(),
        "routes/.registrations/previous-owner.json",
        stale_registration,
    );
    let mut owner = launch(&runtime, &owner_project, &[]);
    claim_ready(&runtime, &owner_project, "claim-owner", &mut owner);
    assert!(sentinel.0.try_wait().unwrap().is_none());
    for host in stale_hosts {
        assert_eq!(routed_body(&runtime, host), "claim-owner");
        let claim: Value = serde_json::from_slice(
            &fs::read(
                runtime
                    .state()
                    .join(format!("caddy/routes/.host-claims/{host}.json")),
            )
            .unwrap(),
        )
        .unwrap();
        assert_eq!(claim["ownerPid"], owner.0.id());
        let identity = claim["ownerStartIdentity"].as_str().unwrap();
        assert!(!identity.is_empty());
        assert!(procid::is_record_owner_alive(owner.0.id() as i32, identity));
    }
    assert!(
        !runtime
            .state()
            .join("caddy/routes/.registrations/previous-owner.json")
            .exists()
    );

    // Exercise each publication independently, using the real owner's records.
    // An interrupted registration must not make the remaining record ignorable.
    for (index, host) in protected_hosts.into_iter().enumerate() {
        let missing = if index == 0 {
            registration(&runtime, host)
        } else {
            runtime
                .state()
                .join(format!("caddy/routes/.host-claims/{host}.json"))
        };
        let saved = fs::read(&missing).unwrap();
        fs::remove_file(&missing).unwrap();
        let attempt = claim_project(&runtime, &format!("rejected-{index}"), &[host]);
        let manifest_path = attempt.join("devhost.toml");
        let manifest = fs::read_to_string(&manifest_path).unwrap();
        for kill_zombies in [false, true] {
            fs::write(
                &manifest_path,
                format!("killZombies={kill_zombies}\n{manifest}"),
            )
            .unwrap();
            let mut rejected = launch(&runtime, &attempt, &[]);
            wait_until(|| rejected.0.try_wait().unwrap().is_some());
            assert!(!rejected.0.wait().unwrap().success());
            let log = fs::read_to_string(attempt.join("lifecycle.log")).unwrap();
            assert!(
                log.contains(&format!(
                    "{host} is already claimed by PID {}",
                    owner.0.id()
                )),
                "{log}"
            );
            assert!(
                log.contains(owner_project.join("devhost.toml").to_str().unwrap()),
                "{log}"
            );
            assert!(owner.0.try_wait().unwrap().is_none());
            assert!(sentinel.0.try_wait().unwrap().is_none());
            assert_eq!(routed_body(&runtime, stale_hosts[0]), "claim-owner");
            let owners = read_live_stack_owners(&runtime.state().join("caddy")).unwrap();
            assert_eq!(owners.len(), 1, "{owners:?}");
        }
        fs::write(missing, saved).unwrap();
    }
    stop(&runtime, &owner_project, &mut owner);
    let mut next = launch(&runtime, &contender, &[]);
    claim_ready(&runtime, &contender, "claim-contender", &mut next);
    for host in protected_hosts {
        assert_eq!(routed_body(&runtime, host), "claim-contender");
    }
    stop(&runtime, &contender, &mut next);
    assert!(sentinel.0.try_wait().unwrap().is_none());
}
