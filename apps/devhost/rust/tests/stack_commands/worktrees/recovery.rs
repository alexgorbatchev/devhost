use super::*;

fn request(origin: &str, path: &str, value: Value) -> ureq::http::Response<ureq::Body> {
    // Failed switch and rollback each join children and monitor late listeners.
    let client: ureq::Agent = ureq::Agent::config_builder()
        .proxy(None)
        .http_status_as_error(false)
        .timeout_global(Some(Duration::from_secs(20)))
        .build()
        .into();
    client
        .post(format!("{origin}/__devhost__/{path}"))
        .header("Origin", origin)
        .header("Content-Type", "application/json")
        .send(value.to_string())
        .unwrap()
}

#[test]
fn failed_restoration_stops_every_member_until_a_member_retries_the_whole_group() {
    let runtime = Runtime::start();
    let name = "rollback-contract";
    let (project, linked, mut process) = saved::repository(&runtime, name);
    let origin = origin(&runtime, name);
    let repository = body(&mut get(&origin, "worktrees"))["repositories"][0].clone();
    let manifest = fs::read_to_string(project.join("devhost.toml")).unwrap()
        .replace("serve='public'", "command=['python3','-u','server.py']\ncwd='public'\nport='auto'\nhealth.interval=20\nhealth.timeout=500");
    let script = "import http.server,os,pathlib,sys\nif pathlib.Path('../poison').exists():\n pathlib.Path(pathlib.Path('../poison').read_text()).touch()\n sys.exit(7)\nif pathlib.Path('../fail').exists(): sys.exit(8)\nserver=http.server.HTTPServer(('127.0.0.1',int(os.environ['PORT'])),http.server.SimpleHTTPRequestHandler)\npathlib.Path('pid.pending').write_text(str(os.getpid()))\npathlib.Path('pid.pending').replace('pid')\nserver.serve_forever()\n";
    for checkout in [&linked, &project] {
        fs::write(checkout.join("public/server.py"), script).unwrap();
        fs::write(checkout.join("devhost.toml"), &manifest).unwrap();
    }
    wait_until(|| project.join("public/pid").exists());
    lifecycle::ready(&origin);
    assert_eq!(
        request(
            &origin,
            "worktrees",
            json!({"repositoryId":repository["id"],"path":linked})
        )
        .status(),
        200
    );
    wait_until(|| content(&runtime).as_deref() == Some("feature checkout"));
    fs::write(
        project.join("poison"),
        linked.join("fail").to_str().unwrap(),
    )
    .unwrap();
    let mut response = request(
        &origin,
        "worktrees",
        json!({"repositoryId":repository["id"],"path":project}),
    );
    assert_eq!(response.status(), 500, "{}", body(&mut response));
    let stopped = body(&mut get(&origin, "worktrees"))["repositories"][0].clone();
    assert_eq!(stopped["selectedPath"], linked.to_str().unwrap());
    assert_eq!(stopped["runningPath"], "", "{stopped}");
    assert!(!stopped["error"].as_str().unwrap().is_empty());
    assert!(linked.join("fail").exists());
    for (checkout, host, text) in [
        (&project, "worktree-contract.localhost", "main checkout"),
        (&linked, "worktree-contract.localhost", "feature checkout"),
        (
            &linked,
            "worktree-extra-contract.localhost",
            "feature extra",
        ),
    ] {
        assert_ne!(content_at(&runtime, host).as_deref(), Some(text));
        if let Ok(pid) = fs::read_to_string(checkout.join("public/pid")) {
            assert!(!procid::is_process_alive(pid.parse().unwrap()));
        }
    }
    assert_eq!(
        request(&origin, "restart-service", json!({"serviceName":"extra"})).status(),
        500
    );
    assert_eq!(
        body(&mut get(&origin, "worktrees"))["repositories"][0]["runningPath"],
        ""
    );
    fs::remove_file(project.join("poison")).unwrap();
    fs::remove_file(linked.join("fail")).unwrap();
    assert_eq!(
        request(&origin, "restart-service", json!({"serviceName":"extra"})).status(),
        200
    );
    lifecycle::ready(&origin);
    assert_eq!(content(&runtime).as_deref(), Some("feature checkout"));
    assert_eq!(
        content_at(&runtime, "worktree-extra-contract.localhost").as_deref(),
        Some("feature extra")
    );
    assert_eq!(
        body(&mut get(&origin, "worktrees"))["repositories"][0]["runningPath"],
        linked.to_str().unwrap()
    );
    lifecycle::stop(&runtime, &project, &mut process);
    git(
        &project,
        &["worktree", "remove", "--force", linked.to_str().unwrap()],
    );
}
