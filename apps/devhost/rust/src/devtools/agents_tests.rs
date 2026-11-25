use super::{agents::Agents, server::ControlServer};
use crate::services::{
    control::{RuntimeControl, RuntimeHandle},
    resolve::{PortResolutionOptions, resolve_service_ports},
};
use agent_watcher::{
    Config, Harness,
    scanner::{ProcessMeta, ProcessSnapshot},
};
use async_tungstenite::{
    tokio::connect_async,
    tungstenite::{Message, client::IntoClientRequest},
};
use futures_util::StreamExt;
use serde_json::{Value, json};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::Path,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};
use tokio_util::sync::CancellationToken;

struct Fixture {
    server: Option<ControlServer>,
    handle: RuntimeHandle,
    _control: RuntimeControl,
    root: tempfile::TempDir,
    calls: Arc<AtomicUsize>,
}

impl Fixture {
    fn new(fail: bool) -> Self {
        let root = tempfile::tempdir().unwrap();
        fs::write(root.path().join("devhost.toml"), "name='agents'\n[devtools.chat]\nenabled=true\n[services.web]\ncommand=['sleep','30']\nhealth.process=true\n").unwrap();
        let config = crate::manifest::read_manifest(root.path(), None).unwrap();
        let manifest = resolve_service_ports(&config, &PortResolutionOptions::default()).unwrap();
        let (mut handle, control) = RuntimeControl::channel();
        handle.live.initialize(&manifest);
        handle.live.configure(root.path(), None);
        let calls = Arc::new(AtomicUsize::new(0));
        let count = calls.clone();
        let cwd = root.path().to_owned();
        handle.agents = Arc::new(Agents::new(Config {
            harnesses: vec![Harness::ClaudeCode, Harness::Opencode],
            claude_sessions_dirs: vec![root.path().join("sessions")],
            claude_projects_dir: root.path().join("projects"),
            opencode_db_path: root.path().join("corrupt.db"),
            process_snapshot_provider: Arc::new(move |_: &CancellationToken| {
                count.fetch_add(1, Ordering::SeqCst);
                if fail {
                    return Err(std::io::Error::other("process capture unavailable"));
                }
                Ok(ProcessSnapshot::from_processes([42, 43].map(|pid| {
                    ProcessMeta {
                        pid,
                        alive: true,
                        cwd: cwd.clone(),
                        name: "claude".into(),
                        ..Default::default()
                    }
                })))
            }),
            ..Default::default()
        }));
        fs::create_dir_all(root.path().join("sessions")).unwrap();
        fs::write(root.path().join("corrupt.db"), "not sqlite").unwrap();
        for (pid, cwd) in [
            (42, root.path().to_owned()),
            (43, root.path().with_extension("outside")),
        ] {
            fs::write(root.path().join(format!("sessions/{pid}.json")), json!({"sessionId":format!("secret-{pid}"), "pid":pid,"cwd":cwd,"status":"waiting","name":"A task","startedAt":1,"transcriptPath":root.path().join("transcript.jsonl")}).to_string()).unwrap();
        }
        fs::write(root.path().join("transcript.jsonl"), "{\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":\"old private history\"}}\n").unwrap();
        let server = ControlServer::start(handle.clone()).unwrap();
        Self {
            server: Some(server),
            handle,
            _control: control,
            root,
            calls,
        }
    }

    fn port(&self) -> u16 {
        self.server.as_ref().unwrap().port()
    }

    fn request(
        &self,
        method: &str,
        path: &str,
        headers: &[(&str, &str)],
    ) -> (u16, String, http::HeaderMap) {
        let agent: ureq::Agent = ureq::Agent::config_builder()
            .proxy(None)
            .http_status_as_error(false)
            .timeout_global(Some(Duration::from_secs(3)))
            .build()
            .into();
        let mut request = http::Request::builder()
            .method(method)
            .uri(format!("http://127.0.0.1:{}{path}", self.port()));
        for (name, value) in headers {
            request = request.header(*name, *value);
        }
        let mut response = agent.run(request.body("").unwrap()).unwrap();
        let status = response.status().as_u16();
        let headers = response.headers().clone();
        (
            status,
            response.body_mut().read_to_string().unwrap(),
            headers,
        )
    }
}

#[test]
fn lists_only_checkout_agents_without_native_identifiers_and_caches_partial_failures() {
    let fixture = Fixture::new(false);
    fixture
        .handle
        .agents
        .owned
        .lock()
        .unwrap()
        .insert("secret-42".into());
    for _ in 0..2 {
        let (status, body, headers) =
            fixture.request("GET", "/__devhost__/agents?chatTarget=project", &[]);
        assert_eq!(status, 200, "{body}");
        assert_eq!(headers["cache-control"], "no-store");
        let value: Value = serde_json::from_str(&body).unwrap();
        assert_eq!(value["agents"].as_array().unwrap().len(), 1);
        let agent = &value["agents"][0];
        assert_eq!(agent["key"], "claude-code:42");
        assert_eq!(agent["subdirectory"], ".");
        assert_eq!(agent["state"], "waiting");
        assert_eq!(agent["name"], "A task");
        assert_eq!(agent["isOwned"], true);
        assert_eq!(value["error"], "Some agents could not be listed.");
        assert!(!body.contains("secret-42") && !body.contains("transcript"));
    }
    assert_eq!(fixture.calls.load(Ordering::SeqCst), 1);
    assert!(!fixture.root.path().join("cursors.json").exists());
    let failed = Fixture::new(true);
    let (_, body, _) = failed.request("GET", "/__devhost__/agents?chatTarget=project", &[]);
    assert_eq!(
        serde_json::from_str::<Value>(&body).unwrap()["agents"],
        json!([])
    );
}

#[test]
fn activity_routes_follow_the_chat_toggle_across_manifest_reloads() {
    let fixture = Fixture::new(false);
    let mut manifest = fixture.handle.live.manifest().unwrap();
    for enabled in [false, true, false] {
        manifest.devtools.chat.enabled = enabled;
        fixture.handle.live.update_manifest(&manifest);
        for path in [
            "/__devhost__/agents",
            "/__devhost__/agents/activity",
            "/__devhost__/ws/agents/activity",
        ] {
            let (status, body, _) =
                fixture.request("GET", &format!("{path}?chatTarget=project"), &[]);
            if enabled {
                assert_ne!(status, 404, "{path}: {body}");
            } else {
                assert_eq!(status, 404, "{path}: {body}");
            }
        }
    }
}

#[test]
fn validates_targets_and_activity_origin_before_exposing_page_content() {
    let fixture = Fixture::new(false);
    for (method, path, headers, expected, text) in [
        (
            "POST",
            "/__devhost__/agents?chatTarget=project",
            vec![],
            405,
            "method not allowed",
        ),
        (
            "GET",
            "/__devhost__/agents",
            vec![],
            400,
            "unknown chat target",
        ),
        (
            "GET",
            "/__devhost__/agents?chatTarget=devhost",
            vec![],
            400,
            "no devhost source checkout",
        ),
        (
            "GET",
            "/__devhost__/agents?chatTarget=project",
            vec![("host", "attacker.example")],
            403,
            "Unrecognized",
        ),
        (
            "POST",
            "/__devhost__/agents/activity?chatTarget=project",
            vec![],
            405,
            "method not allowed",
        ),
        (
            "GET",
            "/__devhost__/agents/activity?chatTarget=project",
            vec![("host", "localhost")],
            403,
            "opens from",
        ),
        (
            "GET",
            "/__devhost__/agents/activity?chatTarget=project",
            vec![("x-forwarded-for", "203.0.113.5")],
            403,
            "opens from",
        ),
        (
            "GET",
            "/__devhost__/agents/activity",
            vec![],
            400,
            "unknown chat target",
        ),
    ] {
        let (status, body, _) = fixture.request(method, path, &headers);
        assert_eq!(status, expected, "{body}");
        assert!(body.contains(text), "{body}");
    }
    let (status, body, headers) = fixture.request(
        "GET",
        "/__devhost__/agents/activity?chatTarget=project",
        &[],
    );
    assert_eq!(status, 200);
    assert!(
        body.contains("agent-activity") && body.contains("including agents devhost did not start")
    );
    assert_eq!(headers["referrer-policy"], "no-referrer");
    assert_eq!(headers["cache-control"], "no-store");
    assert_eq!(fixture.calls.load(Ordering::SeqCst), 0);
    let config = super::configuration::injected_config(&fixture.handle);
    assert_eq!(
        config.control_origin,
        format!("http://127.0.0.1:{}", fixture.port())
    );
}

async fn next_text(
    label: &str,
    socket: &mut async_tungstenite::WebSocketStream<async_tungstenite::tokio::ConnectStream>,
) -> Value {
    loop {
        let next = tokio::time::timeout(Duration::from_secs(4), socket.next())
            .await
            .unwrap_or_else(|_| panic!("timed out waiting for {label}"))
            .unwrap()
            .unwrap();
        if let Message::Text(text) = next {
            return serde_json::from_str(&text).unwrap();
        }
    }
}

#[tokio::test]
async fn activity_skips_history_delivers_utf8_bounded_events_and_joins_before_shutdown() {
    let mut fixture = Fixture::new(false);
    let url = format!(
        "ws://127.0.0.1:{}/__devhost__/ws/agents/activity?chatTarget=project",
        fixture.port()
    );
    let mut bad = url.clone().into_client_request().unwrap();
    bad.headers_mut()
        .insert("origin", "http://attacker.example".parse().unwrap());
    assert!(connect_async(bad).await.is_err());
    let (mut first, _) = connect_async(&url).await.unwrap();
    let initial = next_text("first lifecycle", &mut first).await;
    assert_eq!(initial["eventType"], "run_started");
    assert_eq!(initial["pid"], 42);
    let text = "🦀".repeat(1030);
    let event = json!({"type":"user","message":{"role":"user","content":text}});
    let mut transcript = OpenOptions::new()
        .append(true)
        .open(fixture.root.path().join("transcript.jsonl"))
        .unwrap();
    writeln!(transcript, "{event}").unwrap();
    let delivered = next_text("appended turn", &mut first).await;
    assert_eq!(delivered["eventType"], "turn_start");
    assert_eq!(
        delivered["text"].as_str().unwrap(),
        format!("{}…", "🦀".repeat(1024))
    );
    assert!(delivered.get("sessionId").is_none() && delivered.get("transcriptPath").is_none());
    let (mut second, _) = connect_async(&url).await.unwrap();
    assert_eq!(
        next_text("second lifecycle", &mut second).await["eventType"],
        "run_started"
    );
    let config = fixture.handle.agents.clone();
    drop(fixture.server.take());
    assert!(config.cancel.is_cancelled());
    assert!(config.tasks.is_empty());
    for socket in [&mut first, &mut second] {
        let message = tokio::time::timeout(Duration::from_secs(2), socket.next())
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        let Message::Close(Some(close)) = message else {
            panic!("expected shutdown close, got {message:?}")
        };
        assert_eq!(u16::from(close.code), 1001);
        assert_eq!(close.reason, "Devhost stopping");
    }
}

#[test]
fn checkout_boundaries_do_not_accept_sibling_prefixes_or_empty_directories() {
    use super::agents::checkout_subdirectory;
    assert_eq!(
        checkout_subdirectory(Path::new("/repo/sub/../dir"), Path::new("/repo")),
        Some("dir".into())
    );
    assert_eq!(
        checkout_subdirectory(Path::new("/repo-else"), Path::new("/repo")),
        None
    );
    assert_eq!(
        checkout_subdirectory(Path::new(""), Path::new("/repo")),
        None
    );
}

#[test]
fn activity_targets_follow_routed_service_worktrees_and_refuse_stopped_repositories() {
    use super::{WorktreeRepository, project_context::query_root};
    let fixture = Fixture::new(false);
    let mut manifest = fixture.handle.live.manifest().unwrap();
    manifest.primary_service = "web".into();
    manifest.services.get_mut("web").unwrap().hosts = vec!["app.localhost".into()];
    for (name, path) in [("api", "/api/*"), ("exact", "/api/one")] {
        let mut service = manifest.services["web"].clone();
        service.name = name.into();
        service.path = Some(path.into());
        manifest.services.insert(name.into(), service);
    }
    fixture.handle.live.update_manifest(&manifest);
    let root = fixture.root.path();
    let repositories: Vec<_> = ["web", "api", "exact"]
        .into_iter()
        .map(|name| WorktreeRepository {
            name: name.into(),
            configured_path: root.display().to_string(),
            selected_path: root.join(name).display().to_string(),
            service_names: vec![name.into()],
            ..Default::default()
        })
        .collect();
    fixture.handle.live.repositories(repositories.clone());
    let query = |url: &str| {
        let encoded: String = url::form_urlencoded::Serializer::new(String::new())
            .append_pair("chatTarget", "project")
            .append_pair("pageURL", url)
            .finish();
        query_root(
            &fixture.handle,
            &http::Request::builder()
                .uri(format!("/?{encoded}"))
                .body(axum::body::Body::empty())
                .unwrap(),
        )
    };
    for (url, selected) in [
        ("https://app.localhost/api/one", "exact"),
        ("https://APP.localhost/api/two", "api"),
        ("https://app.localhost/api", "web"),
        ("https://elsewhere.localhost/api/one", "web"),
        ("invalid", "web"),
    ] {
        assert_eq!(query(url).unwrap(), root.join(selected), "{url}");
    }
    let mut blocked = repositories.clone();
    blocked[1].switching = true;
    fixture.handle.live.repositories(blocked);
    assert!(
        query("https://app.localhost/api/two")
            .unwrap_err()
            .contains("switching or stopped")
    );
    let mut failed = repositories.clone();
    failed[1].error = "restore failed".into();
    fixture.handle.live.repositories(failed);
    assert!(query("https://app.localhost/api/two").is_err());
    let mut nested = manifest.clone();
    nested.manifest_directory = root.join("subproject");
    fixture.handle.live.update_manifest(&nested);
    fixture.handle.live.repositories(repositories.clone());
    assert_eq!(
        query("https://app.localhost/api/two").unwrap(),
        root.join("api/subproject")
    );
    let mut external = repositories;
    external[1].configured_path = root.join("external").display().to_string();
    fixture.handle.live.repositories(external);
    assert_eq!(
        query("https://app.localhost/api/two").unwrap(),
        root.join("api")
    );
    fixture.handle.live.repositories(Vec::new());
    assert_eq!(
        query("https://app.localhost/api/two").unwrap(),
        root.join("subproject")
    );
}
