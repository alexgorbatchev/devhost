use std::sync::{Arc, Mutex};

use axum::{Router, http::StatusCode, routing::get};
use devhost_rust::services::stack_info::{format_stack_info, read_stack_info};
use tokio::sync::oneshot;

use super::*;

struct ControlServer {
    port: u16,
    response: Arc<Mutex<(StatusCode, String)>>,
    shutdown: Option<oneshot::Sender<()>>,
    worker: Option<thread::JoinHandle<()>>,
}

impl ControlServer {
    fn start(snapshot: Value) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let port = listener.local_addr().unwrap().port();
        let response = Arc::new(Mutex::new((StatusCode::OK, snapshot.to_string())));
        let state = response.clone();
        let app = Router::new().route(
            "/__devhost__/stack-info",
            get(move || {
                let response = state.lock().unwrap().clone();
                async move { response }
            }),
        );
        let (shutdown, receiver) = oneshot::channel();
        let worker = thread::spawn(move || {
            let runtime = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .unwrap();
            runtime.block_on(async move {
                let listener = tokio::net::TcpListener::from_std(listener).unwrap();
                axum::serve(listener, app)
                    .with_graceful_shutdown(async move {
                        let _ = receiver.await;
                    })
                    .await
                    .unwrap();
            });
        });
        Self {
            port,
            response,
            shutdown: Some(shutdown),
            worker: Some(worker),
        }
    }

    fn snapshot(&self, value: Value) {
        self.reply(StatusCode::OK, value.to_string());
    }

    fn reply(&self, status: StatusCode, body: String) {
        *self.response.lock().unwrap() = (status, body);
    }
}

impl Drop for ControlServer {
    fn drop(&mut self) {
        if let Some(shutdown) = self.shutdown.take() {
            let _ = shutdown.send(());
        }
        if let Some(worker) = self.worker.take() {
            worker.join().unwrap();
        }
    }
}

fn register(root: &Path, manifest: &Path, port: u16, extra: Value) {
    let mut owner = json!({
        "createdAt":"2023-11-14T22:13:20.987654321Z",
        "manifestPath":manifest,
        "stackName":"registered",
        "ownerPid":std::process::id(),
        "controlPort":port,
    });
    owner
        .as_object_mut()
        .unwrap()
        .extend(extra.as_object().unwrap().clone());
    record(root, "stacks/info.json", owner);
}

fn manifest(root: &Path) -> PathBuf {
    let path = root.join("project with spaces/devhost.toml");
    fs::create_dir_all(path.parent().unwrap().join("nested/deep")).unwrap();
    fs::write(&path, "name = 'registered'\n").unwrap();
    path
}

fn snapshot(state: &str) -> Value {
    json!({"name":"live stack", "starting":false, "services":[
        {"name":"web", "state":state, "primary":true, "port":8080,
         "urls":["https://web.localhost/"], "since":"2023-11-14T22:13:20Z"},
        {"name":"optional", "state":"not-started"}
    ]})
}

#[test]
fn inspection_uses_live_state_and_exit_status_in_both_output_modes() {
    let fixture = tempfile::tempdir().unwrap();
    let root = fixture.path();
    let manifest = manifest(root);
    let server = ControlServer::start(snapshot("ready"));
    register(root, &manifest, server.port, json!({"remote":true}));
    for (state, code, summary) in [
        ("ready", 0, "running"),
        ("starting", 1, "starting"),
        ("restarting", 1, "starting"),
        ("unhealthy", 1, "degraded"),
        ("exited", 1, "degraded"),
        ("unknown", 1, "degraded"),
    ] {
        server.snapshot(snapshot(state));
        for agent in ["0", "1"] {
            let output = run(
                root,
                &manifest.parent().unwrap().join("nested/deep"),
                agent,
                &["stack", "info"],
            );
            assert_eq!(output.status.code(), Some(code), "{state}: {output:?}");
            assert!(output.stderr.is_empty(), "{output:?}");
            let text = String::from_utf8(output.stdout).unwrap();
            if agent == "1" {
                assert!(text.contains("name=\"live stack\""), "{text}");
                assert!(text.contains(&format!("ready={}", code == 0)), "{text}");
                assert!(text.contains("remote=true"), "{text}");
                assert!(text.contains("name=web state="), "{text}");
                assert!(
                    text.contains("port=8080 url=https://web.localhost/"),
                    "{text}"
                );
                assert!(text.contains("createdAt=2023-11-14T22:13:20Z"), "{text}");
            } else {
                assert!(
                    text.contains(&format!("live stack · {summary} · PID")),
                    "{text}"
                );
                assert!(text.contains("web (primary)"), "{text}");
                assert!(text.contains("not started"), "{text}");
                assert!(text.contains("(no route)"), "{text}");
            }
        }
    }
    let mut starting = snapshot("ready");
    starting["starting"] = json!(true);
    server.snapshot(starting);
    let output = run(root, manifest.parent().unwrap(), "1", &["stack", "info"]);
    assert_eq!(output.status.code(), Some(1));
    assert!(String::from_utf8_lossy(&output.stdout).contains("ready=false"));
}

#[test]
fn inspection_matches_included_and_symlinked_manifests_and_refreshes_inputs() {
    let fixture = tempfile::tempdir().unwrap();
    let root = fixture.path();
    let manifest = manifest(root);
    let include = root.join("included/devhost.toml");
    let another = root.join("another/devhost.toml");
    let alias = root.join("alias/devhost.toml");
    for path in [&include, &another, &alias] {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
    }
    fs::write(&include, "").unwrap();
    fs::write(&another, "").unwrap();
    symlink(&include, &alias).unwrap();
    let mut live = snapshot("ready");
    live["manifestFiles"] = json!([include, manifest, alias, another, ""]);
    let server = ControlServer::start(live);
    register(
        root,
        &manifest,
        server.port,
        json!({"manifestFiles":[include]}),
    );
    for selected in [&manifest, &include, &alias] {
        let info = read_stack_info(&root.join("caddy"), selected).unwrap();
        assert_eq!(info.stack.name, "live stack");
        assert_eq!(info.stack.started_at, "2023-11-14T22:13:20Z");
        assert_eq!(
            info.stack.manifest_files,
            [
                manifest.display().to_string(),
                another.display().to_string(),
                include.display().to_string()
            ]
        );
        assert!(info.ready);
        let output = run(
            root,
            root,
            "1",
            &["stack", "info", "--manifest", selected.to_str().unwrap()],
        );
        assert!(output.status.success(), "{output:?}");
    }
    // An exact root registration wins over another stack that includes it.
    record(
        root,
        "stacks/other.json",
        json!({
            "createdAt":"2023-11-14T22:13:20Z", "stackName":"aaa", "ownerPid":std::process::id(),
            "manifestPath":root.join("other.toml"), "manifestFiles":[manifest]
        }),
    );
    let info = read_stack_info(&root.join("caddy"), &manifest).unwrap();
    assert_eq!(info.stack.name, "live stack");
    assert!(info.ready);
}

#[test]
fn inspection_reports_missing_starting_and_unreachable_owners() {
    let fixture = tempfile::tempdir().unwrap();
    let root = fixture.path();
    let manifest = manifest(root);
    let missing = read_stack_info(&root.join("caddy"), &manifest)
        .err()
        .unwrap();
    assert!(
        missing
            .message
            .contains("no running stack found for manifest:")
    );
    assert!(missing.hint.unwrap().contains("devhost start"));
    register(root, &root.join("other.toml"), 0, json!({}));
    let other = read_stack_info(&root.join("caddy"), &manifest)
        .err()
        .unwrap();
    assert!(other.hint.unwrap().contains("devhost stack list"));
    register(root, &manifest, 0, json!({}));
    let info = read_stack_info(&root.join("caddy"), &manifest).unwrap();
    assert!(!info.ready);
    assert_eq!(info.run_state, "starting");
    assert!(info.snapshot.services.is_empty());
    let occupied = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = occupied.local_addr().unwrap().port();
    drop(occupied);
    register(root, &manifest, port, json!({}));
    let error = read_stack_info(&root.join("caddy"), &manifest)
        .err()
        .unwrap();
    assert!(
        error
            .message
            .contains("read live state from stack registered (PID")
    );
    fs::write(root.join("caddy/stacks/info.json"), "invalid").unwrap();
    let error = read_stack_info(&root.join("caddy"), &manifest)
        .err()
        .unwrap();
    assert!(error.message.contains("read running stacks:"));
}

#[test]
fn inspection_rejects_failed_redirected_and_malformed_control_responses() {
    let fixture = tempfile::tempdir().unwrap();
    let root = fixture.path();
    let manifest = manifest(root);
    let server = ControlServer::start(snapshot("ready"));
    register(root, &manifest, server.port, json!({}));
    for (status, body, message) in [
        (
            StatusCode::SERVICE_UNAVAILABLE,
            "not ready",
            "control server returned 503",
        ),
        (StatusCode::FOUND, "moved", "control server returned 302"),
        (StatusCode::OK, "invalid JSON", "expected value"),
    ] {
        server.reply(status, body.to_owned());
        let error = read_stack_info(&root.join("caddy"), &manifest)
            .err()
            .unwrap();
        assert!(error.message.contains(message), "{}", error.message);
    }
}

#[test]
fn inspection_formats_failure_context_quoting_logs_and_elapsed_time() {
    let fixture = tempfile::tempdir().unwrap();
    let root = fixture.path();
    let manifest = manifest(root);
    let mut live = snapshot("exited");
    live["services"][0]["exitCode"] = json!(7);
    live["services"][0]["lastOutput"] =
        json!("failed \"request\"\\path\n\t\r\u{7}\u{8}\u{b}\u{c}\u{1b}\u{85}é");
    let server = ControlServer::start(live);
    let log = root.join("log files/stack.log");
    register(root, &manifest, server.port, json!({"logPath":log}));
    let info = read_stack_info(&root.join("caddy"), &manifest).unwrap();
    let agent = format_stack_info(&info, Mode::Agent, std::time::UNIX_EPOCH);
    assert!(agent.contains("mode=detached ready=false"), "{agent}");
    assert!(agent.contains("exitCode=7"), "{agent}");
    assert!(
        agent.contains("last=\"failed \\\"request\\\"\\\\path\\n\\t\\r\\a\\b\\v\\f\\x1b\\u0085é\""),
        "{agent}"
    );
    assert!(
        agent.contains(&format!("log=\"{}\"", log.display())),
        "{agent}"
    );
    let created = std::time::UNIX_EPOCH + Duration::from_secs(1_700_000_000);
    for (seconds, expected) in [
        (45, "45s"),
        (120, "2m"),
        (7200, "2h"),
        (7380, "2h 3m"),
        (172800, "2d"),
        (176400, "2d 1h"),
    ] {
        let human = format_stack_info(&info, Mode::Human, created + Duration::from_secs(seconds));
        assert!(
            human.contains(&format!("detached · up {expected}\n")),
            "{human}"
        );
        assert!(human.contains("exited 7"), "{human}");
        assert!(human.contains("  └ failed"), "{human}");
        assert!(
            human.contains(&format!("Log: {}", log.display())),
            "{human}"
        );
    }
    assert!(format_stack_info(&info, Mode::Human, std::time::UNIX_EPOCH).contains("up 0s"));
}
