use super::*;
use devhost::caddy::stacks::read_live_stacks;
use serde_json::{Value, json};
#[cfg(target_os = "linux")]
use std::os::unix::process::CommandExt;

#[cfg(target_os = "linux")]
struct Owner(std::process::Child);

#[cfg(target_os = "linux")]
impl Drop for Owner {
    fn drop(&mut self) {
        // SAFETY: this fixture owns the isolated process group and joins it.
        unsafe { libc::kill(-(self.0.id() as i32), libc::SIGKILL) };
        let _ = self.0.wait();
    }
}

fn git(root: &Path, args: &[&str]) {
    let result = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(args)
        .env_remove("GIT_DIR")
        .env_remove("GIT_WORK_TREE")
        .output()
        .unwrap();
    assert!(
        result.status.success(),
        "{args:?}: {}",
        String::from_utf8_lossy(&result.stderr)
    );
}

fn repository(root: &Path) -> (PathBuf, PathBuf, String) {
    let project = root.join("project");
    let linked = root.join("feature");
    for name in ["api", "web"] {
        fs::create_dir_all(project.join(name)).unwrap();
        fs::write(project.join(name).join("note.txt"), format!("main {name}")).unwrap();
    }
    let body = "name = 'runtime'\n[services.api]\nserve = 'api'\nhost = 'api.localhost'\n[services.web]\nserve = 'web'\nhost = 'web.localhost'\ndependsOn = ['api']\n".to_owned();
    write_manifest(root, &body);
    git(&project, &["init", "-b", "main"]);
    git(&project, &["add", "."]);
    git(
        &project,
        &[
            "-c",
            "user.name=Fixture",
            "-c",
            "user.email=fixture@example.test",
            "commit",
            "-m",
            "fixture",
        ],
    );
    git(
        &project,
        &["worktree", "add", "-b", "feature", linked.to_str().unwrap()],
    );
    for name in ["api", "web"] {
        fs::write(
            linked.join(name).join("note.txt"),
            format!("feature {name}"),
        )
        .unwrap();
    }
    (project, linked, body)
}

fn request(caddy: &LiveCaddyGuard, method: &str, body: Option<Value>) -> (u16, Value) {
    let port = read_live_stacks(&caddy.caddy_dir)
        .unwrap()
        .into_iter()
        .find(|stack| stack.pid == std::process::id() as i32)
        .unwrap()
        .control_port;
    let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(20)))
        .unwrap();
    let body = body.map(|body| body.to_string()).unwrap_or_default();
    write!(stream, "{method} /__devhost__/worktrees HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{body}", body.len()).unwrap();
    let mut response = String::new();
    stream.read_to_string(&mut response).unwrap();
    let (headers, body) = response.split_once("\r\n\r\n").unwrap();
    let status = headers.split_whitespace().nth(1).unwrap().parse().unwrap();
    (
        status,
        serde_json::from_str(body).unwrap_or_else(|_| json!({"error": body})),
    )
}

fn snapshot(caddy: &LiveCaddyGuard) -> Value {
    let (status, value) = request(caddy, "GET", None);
    assert_eq!(status, 200, "{value}");
    value["repositories"][0].clone()
}

fn switch(caddy: &LiveCaddyGuard, id: &Value, path: &Path) -> (u16, Value) {
    request(
        caddy,
        "POST",
        Some(json!({"repositoryId": id, "path": path})),
    )
}

fn assert_switch_ok(caddy: &LiveCaddyGuard, id: &Value, path: &Path) {
    let (status, result) = switch(caddy, id, path);
    assert_eq!(status, 200, "{result}");
}

fn assert_content(caddy: &LiveCaddyGuard, checkout: &str) {
    for name in ["api", "web"] {
        assert!(
            wait_until(Duration::from_secs(5), || http_get_host(
                caddy.settings.http_port,
                &format!("{name}.localhost"),
                "/note.txt"
            )
            .contains(&format!("{checkout} {name}"))),
            "missing {checkout} {name}"
        );
    }
}

#[test]
fn whole_stack_switch_rollback_and_saved_selection_use_the_original_stack_identity() {
    let fixture = tempfile::tempdir().unwrap();
    let root = fixture.path();
    let caddy = LiveCaddyGuard::start(root);
    let (project, linked, body) = repository(root);
    let mut stack = Stack::start(root, &caddy, None);
    assert_content(&caddy, "main");
    let initial = snapshot(&caddy);
    assert_eq!(initial["serviceNames"], json!(["api", "web"]));
    let (status, result) = switch(&caddy, &initial["id"], &linked);
    assert_eq!(status, 200, "{result}");
    assert_content(&caddy, "feature");
    assert_eq!(snapshot(&caddy)["runningPath"], linked.to_str().unwrap());
    assert_eq!(
        read_live_stacks(&caddy.caddy_dir).unwrap()[0].manifest_path,
        project.join("devhost.toml").to_str().unwrap()
    );
    let mut failing = body.clone();
    for name in ["api", "web"] {
        failing = failing.replace(
            &format!("serve = '{name}'"),
            &format!("command = ['sh', '-c', 'exit 7']\ncwd = '{name}'\nhealth.tcp = {}\nhealth.interval = 20\nhealth.timeout = 500", free_port()),
        );
    }
    fs::write(project.join("devhost.toml"), failing).unwrap();
    let (status, result) = switch(&caddy, &initial["id"], &project);
    assert_eq!(status, 500, "{result}");
    assert_content(&caddy, "feature");
    assert_eq!(snapshot(&caddy)["selectedPath"], linked.to_str().unwrap());
    stack.wait_log("Worktree switch failed: feature -> project");
    fs::write(project.join("devhost.toml"), &body).unwrap();
    stack.stop();
    let mut restored = Stack::start(root, &caddy, None);
    assert_content(&caddy, "feature");
    let selected = snapshot(&caddy);
    assert_eq!(selected["configuredPath"], project.to_str().unwrap());
    assert_eq!(selected["runningPath"], linked.to_str().unwrap());
    let (status, result) = switch(&caddy, &selected["id"], &linked);
    assert_eq!(status, 200, "{result}");
    restored.wait_log("worktree switched: feature -> feature");
    restored.stop();
}

#[test]
fn selected_manifest_reload_refresh_recovery_and_disabling_follow_the_selected_checkout() {
    let fixture = tempfile::tempdir().unwrap();
    let root = fixture.path();
    let caddy = LiveCaddyGuard::start(root);
    let (project, linked, body) = repository(root);
    let mut stack = Stack::start(root, &caddy, None);
    let id = snapshot(&caddy)["id"].clone();
    assert_switch_ok(&caddy, &id, &linked);
    fs::write(
        linked.join("devhost.toml"),
        body.replace("name = 'runtime'", "name = 'renamed'")
            + "\n[services.worker]\ncommand = ['sleep', '300']\nhealth.process = true\n",
    )
    .unwrap();
    stack.wait_log("configuration reloaded:");
    assert!(
        snapshot(&caddy)["serviceNames"]
            .as_array()
            .unwrap()
            .contains(&json!("worker"))
    );
    assert_content(&caddy, "feature");
    fs::remove_dir_all(linked.join("web")).unwrap();
    let failed = snapshot(&caddy);
    assert_eq!(failed["runningPath"], "");
    assert!(failed["error"].as_str().unwrap().contains("unavailable"));
    assert!(stack.restart(&["web"]).is_err());
    assert_switch_ok(&caddy, &id, &project);
    assert_content(&caddy, "main");
    fs::create_dir(linked.join("web")).unwrap();
    fs::write(linked.join("web/note.txt"), "feature web").unwrap();
    fs::write(linked.join("devhost.toml"), &body).unwrap();
    assert_switch_ok(&caddy, &id, &linked);
    fs::write(
        linked.join("devhost.toml"),
        body.replace(
            "name = 'runtime'",
            "name = 'runtime'\n[worktrees]\nenabled = false",
        ),
    )
    .unwrap();
    assert!(wait_until(
        Duration::from_secs(10),
        || snapshot(&caddy)["selectedPath"] == project.to_str().unwrap()
    ));
    assert_content(&caddy, "main");
    fs::write(
        project.join("devhost.toml"),
        body.replace(
            "name = 'runtime'",
            "name = 'runtime'\n[worktrees]\nenabled = false",
        ),
    )
    .unwrap();
    assert!(wait_until(Duration::from_secs(10), || request(
        &caddy, "GET", None
    )
    .0 == 501));
    fs::write(project.join("devhost.toml"), &body).unwrap();
    assert!(wait_until(Duration::from_secs(10), || request(
        &caddy, "GET", None
    )
    .0 == 200));
    assert_eq!(snapshot(&caddy)["selectedPath"], project.to_str().unwrap());
    stack.stop();
}

#[test]
fn failed_rollback_stops_the_group_until_an_explicit_worktree_recovery() {
    let fixture = tempfile::tempdir().unwrap();
    let root = fixture.path();
    let caddy = LiveCaddyGuard::start(root);
    let (project, linked, _) = repository(root);
    let body = "name = 'runtime'\n[services.api]\ncommand = ['python3', '-u', 'server.py']\ncwd = 'api'\nport = 'auto'\nhost = 'api.localhost'\nhealth.interval = 20\nhealth.timeout = 5000\n[services.web]\ncommand = ['python3', '-u', 'server.py']\ncwd = 'web'\nport = 'auto'\nhost = 'web.localhost'\nhealth.interval = 20\nhealth.timeout = 5000\ndependsOn = ['api']\n";
    let script = "import http.server, os, pathlib, socketserver, sys\nif pathlib.Path('../poison').exists():\n    pathlib.Path(pathlib.Path('../poison').read_text()).touch()\n    sys.exit(7)\nif pathlib.Path('../fail').exists():\n    sys.exit(8)\nsocketserver.TCPServer.allow_reuse_address = True\nsocketserver.TCPServer(('127.0.0.1', int(os.environ['PORT'])), http.server.SimpleHTTPRequestHandler).serve_forever()\n";
    for checkout in [&project, &linked] {
        fs::write(checkout.join("devhost.toml"), body).unwrap();
        for name in ["api", "web"] {
            fs::write(checkout.join(name).join("server.py"), script).unwrap();
        }
    }
    let mut stack = Stack::start(root, &caddy, None);
    let id = snapshot(&caddy)["id"].clone();
    assert_switch_ok(&caddy, &id, &linked);
    fs::write(
        project.join("poison"),
        linked.join("fail").to_str().unwrap(),
    )
    .unwrap();
    let (status, result) = switch(&caddy, &id, &project);
    assert_eq!(status, 500, "{result}");
    let stopped = snapshot(&caddy);
    assert_eq!(stopped["selectedPath"], linked.to_str().unwrap());
    assert_eq!(stopped["runningPath"], "", "{stopped}");
    assert!(!stopped["error"].as_str().unwrap().is_empty());
    assert!(stack.restart(&["web"]).is_err());
    fs::remove_file(project.join("poison")).unwrap();
    fs::remove_file(linked.join("fail")).unwrap();
    stack.restart(&["web"]).unwrap();
    assert_content(&caddy, "feature");
    assert_eq!(snapshot(&caddy)["runningPath"], linked.to_str().unwrap());
    stack.stop();
}

#[test]
fn unavailable_saved_checkout_starts_stopped_and_can_return_to_the_configured_checkout() {
    let fixture = tempfile::tempdir().unwrap();
    let root = fixture.path();
    let caddy = LiveCaddyGuard::start(root);
    let (project, linked, _) = repository(root);
    let mut stack = Stack::start(root, &caddy, None);
    let id = snapshot(&caddy)["id"].clone();
    assert_switch_ok(&caddy, &id, &linked);
    stack.stop();
    fs::remove_dir_all(&linked).unwrap();
    let mut restored = Stack::start(root, &caddy, None);
    let stopped = snapshot(&caddy);
    assert_eq!(stopped["selectedPath"], linked.to_str().unwrap());
    assert_eq!(stopped["runningPath"], "");
    assert!(!stopped["error"].as_str().unwrap().is_empty());
    assert_switch_ok(&caddy, &id, &project);
    assert_content(&caddy, "main");
    restored.stop();
}

#[test]
fn accepted_checkout_survives_a_retired_claim_cleanup_failure() {
    let fixture = tempfile::tempdir().unwrap();
    let root = fixture.path();
    let caddy = LiveCaddyGuard::start(root);
    let (_, linked, body) = repository(root);
    let mut stack = Stack::start(root, &caddy, None);
    let id = snapshot(&caddy)["id"].clone();
    let record = caddy
        .caddy_dir
        .join("routes/.host-claims/api.localhost.json");
    let original = fs::read(&record).unwrap();
    let command = format!(
        "printf malformed > '{}'; exec python3 -c \"import http.server, os, socketserver; socketserver.TCPServer.allow_reuse_address = True; socketserver.TCPServer(('127.0.0.1', int(os.environ['PORT'])), http.server.SimpleHTTPRequestHandler).serve_forever()\"",
        record.display()
    );
    let command = serde_json::to_string(&["sh", "-c", &command]).unwrap();
    fs::write(
        linked.join("devhost.toml"),
        body.replace("host = 'api.localhost'", "host = 'next-api.localhost'")
            .replace(
                "serve = 'api'",
                &format!("command = {command}\ncwd = 'api'\nport = 'auto'\nhealth.timeout = 2000"),
            ),
    )
    .unwrap();
    let (status, result) = switch(&caddy, &id, &linked);
    assert_eq!(status, 500, "{result}");
    assert!(result.to_string().contains("parse host claim"), "{result}");
    fs::write(&record, original).unwrap();
    assert!(
        http_get_host(caddy.settings.http_port, "next-api.localhost", "/note.txt")
            .contains("feature api")
    );
    assert!(
        http_get_host(caddy.settings.http_port, "web.localhost", "/note.txt")
            .contains("feature web")
    );
    let accepted = snapshot(&caddy);
    assert_eq!(accepted["selectedPath"], linked.to_str().unwrap());
    assert_eq!(accepted["runningPath"], linked.to_str().unwrap());
    let selections = fs::read_dir(root.join("state/worktrees")).unwrap();
    let saved = selections
        .map(|entry| entry.unwrap().path().join("active.json"))
        .find(|path| path.exists())
        .unwrap();
    let saved: Value = serde_json::from_slice(&fs::read(saved).unwrap()).unwrap();
    assert_eq!(saved["path"], linked.to_str().unwrap());
    stack.stop();
}

#[test]
#[cfg(target_os = "linux")]
fn occupied_checkouts_require_the_current_owner_identity_before_stopping() {
    let fixture = tempfile::tempdir().unwrap();
    let root = fixture.path();
    let caddy = LiveCaddyGuard::start(root);
    let (_, linked, _) = repository(root);
    let mut stack = Stack::start(root, &caddy, None);
    let mut owner = Owner(
        Command::new("sleep")
            .arg("300")
            .process_group(0)
            .spawn()
            .unwrap(),
    );
    let pid = owner.0.id() as i32;
    let boot = fs::read_to_string("/proc/sys/kernel/random/boot_id").unwrap();
    let stat = fs::read_to_string(format!("/proc/{pid}/stat")).unwrap();
    let ticks = stat
        .rsplit_once(')')
        .unwrap()
        .1
        .split_whitespace()
        .nth(19)
        .unwrap();
    let identity = format!("{}:{ticks}", boot.trim());
    let path = linked.join("devhost.toml");
    let record = json!({"ownerPid":pid,"ownerStartIdentity":identity,"manifestPath":path,"manifestFiles":[path],"createdAt":"2026-11-23T00:00:00Z","stackName":"occupant"});
    let record_path = caddy.caddy_dir.join("stacks").join(format!("{pid}.json"));
    fs::write(&record_path, record.to_string()).unwrap();
    let route = json!({"appBindHost":"127.0.0.1","appPort":12345,"createdAt":"2026-11-23T00:00:00Z","host":"occupant.localhost","manifestPath":path,"ownerPid":pid,"ownerStartIdentity":identity,"path":"/review/*","serviceName":"web"});
    fs::write(
        caddy.caddy_dir.join("routes/.registrations/occupant.json"),
        route.to_string(),
    )
    .unwrap();
    let repo = snapshot(&caddy);
    let checkout = repo["worktrees"]
        .as_array()
        .unwrap()
        .iter()
        .find(|entry| entry["path"] == linked.to_str().unwrap())
        .unwrap();
    assert_eq!(checkout["available"], false);
    assert_eq!(checkout["owners"][0]["pid"], pid);
    assert_eq!(
        checkout["owners"][0]["urls"],
        json!([format!(
            "https://occupant.localhost:{}/review/",
            caddy.settings.https_port
        )])
    );
    assert_eq!(switch(&caddy, &repo["id"], &linked).0, 500);
    for (id, path, owner_id) in [
        (
            json!("unknown"),
            linked.clone(),
            checkout["owners"][0]["id"].clone(),
        ),
        (
            repo["id"].clone(),
            root.join("project"),
            checkout["owners"][0]["id"].clone(),
        ),
        (repo["id"].clone(), linked.clone(), json!("stale")),
    ] {
        assert_eq!(
            request(
                &caddy,
                "POST",
                Some(json!({"repositoryId":id,"path":path,"stopOwnerId":owner_id}))
            )
            .0,
            500
        );
        assert!(owner.0.try_wait().unwrap().is_none());
    }
    let (status, result) = request(
        &caddy,
        "POST",
        Some(
            json!({"repositoryId":repo["id"],"path":linked,"stopOwnerId":checkout["owners"][0]["id"]}),
        ),
    );
    assert_eq!(status, 200, "{result}");
    owner.0.wait().unwrap();
    fs::remove_file(caddy.caddy_dir.join("routes/.registrations/occupant.json")).unwrap();
    assert_switch_ok(&caddy, &repo["id"], &linked);
    assert_content(&caddy, "feature");
    stack.stop();
}
