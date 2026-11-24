use super::*;
use crate::{
    devtools::server::ControlServer,
    services::{
        control::{RuntimeControl, RuntimeHandle},
        resolve::{PortResolutionOptions, resolve_service_ports},
    },
};
use async_tungstenite::{
    WebSocketStream,
    tokio::{ConnectStream, connect_async},
    tungstenite::{Message, client::IntoClientRequest},
};
use futures_util::StreamExt;
use serde_json::{Value, json};
use std::{fs, os::unix::fs::PermissionsExt, time::Duration};

pub(super) struct Fixture {
    server: Option<ControlServer>,
    pub(super) handle: RuntimeHandle,
    _control: RuntimeControl,
    pub(super) root: tempfile::TempDir,
}
impl Fixture {
    pub(super) fn new(scenario: &str) -> Self {
        let root = tempfile::tempdir().unwrap();
        fs::write(root.path().join("scenario"), scenario).unwrap();
        fs::write(root.path().join("devhost.toml"),"name='chat'\n[devtools.chat]\nenabled=true\nprompt='Project workflow'\n[services.web]\ncommand=['sleep','30']\nhealth.process=true\n").unwrap();
        let config = crate::manifest::read_manifest(root.path(), None).unwrap();
        let manifest = resolve_service_ports(&config, &PortResolutionOptions::default()).unwrap();
        let (mut handle, control) = RuntimeControl::channel();
        handle.live.initialize(&manifest);
        handle.live.configure(&root.path().join("caddy"), None);
        let mut store = Store::default();
        for (harness, name) in [(CODEX, "codex"), (CLAUDE, "claude")] {
            let path = root.path().join(name);
            fs::write(&path, include_str!("fixture.py")).unwrap();
            fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
            store.executables.insert(harness.into(), path);
        }
        handle.chat = Arc::new(store);
        let server = ControlServer::start(handle.clone()).unwrap();
        Self {
            server: Some(server),
            handle,
            _control: control,
            root,
        }
    }
    fn port(&self) -> u16 {
        self.server.as_ref().unwrap().port()
    }
    fn request(&self, method: &str, path: &str, body: &str, origin: bool) -> (u16, String) {
        let agent: ureq::Agent = ureq::Agent::config_builder()
            .proxy(None)
            .http_status_as_error(false)
            .timeout_global(Some(Duration::from_secs(5)))
            .build()
            .into();
        let mut request = http::Request::builder()
            .method(method)
            .uri(format!("http://127.0.0.1:{}{path}", self.port()))
            .header("Content-Type", "application/json");
        if origin {
            request = request.header("Origin", format!("http://127.0.0.1:{}", self.port()));
        }
        let mut response = agent
            .run(request.body(body).unwrap())
            .unwrap_or_else(|error| {
                let protocol: Vec<_> = ["codex-input.jsonl", "claude-input.jsonl"]
                    .map(|name| {
                        (
                            name,
                            fs::read_to_string(self.root.path().join(name)).unwrap_or_default(),
                        )
                    })
                    .into();
                panic!(
                    "{method} {path} failed: {error}; scenario={:?}; peer ready={:?}; native input={protocol:?}",
                    fs::read_to_string(self.root.path().join("scenario")),
                    ["codex-ready", "claude-ready"].map(|name| (name, self.root.path().join(name).exists()))
                );
            });
        (
            response.status().as_u16(),
            response.body_mut().read_to_string().unwrap(),
        )
    }
    pub(super) fn start(&self, harness: &str, resume: &str) -> Value {
        let (status,body)=self.request("POST","/__devhost__/chat/sessions",&json!({"harness":harness,"target":"project","pageURL":"https://chat.localhost","resumeId":resume}).to_string(),true);
        assert_eq!(status, 200, "{body}");
        serde_json::from_str(&body).unwrap()
    }
    async fn socket(&self, id: &str) -> WebSocketStream<ConnectStream> {
        let mut request = format!(
            "ws://127.0.0.1:{}/__devhost__/ws/chat?chatTarget=project&sessionId={id}",
            self.port()
        )
        .into_client_request()
        .unwrap();
        request.headers_mut().insert(
            "Origin",
            format!("http://127.0.0.1:{}", self.port()).parse().unwrap(),
        );
        connect_async(request).await.unwrap().0
    }
    fn input(&self, harness: &str) -> Vec<Value> {
        fs::read_to_string(self.root.path().join(if harness == CODEX {
            "codex-input.jsonl"
        } else {
            "claude-input.jsonl"
        }))
        .unwrap()
        .lines()
        .map(|s| serde_json::from_str(s).unwrap())
        .collect()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        self.server.take();
    }
}
async fn next(socket: &mut WebSocketStream<ConnectStream>) -> Value {
    loop {
        let message = tokio::time::timeout(Duration::from_secs(5), socket.next())
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        if let Message::Text(text) = message {
            return serde_json::from_str(&text).unwrap();
        }
    }
}
async fn until(socket: &mut WebSocketStream<ConnectStream>, kind: &str) -> Value {
    for _ in 0..100 {
        let v = next(socket).await;
        if v["type"] == kind {
            return v;
        }
    }
    panic!("missing {kind}")
}
async fn send(socket: &mut WebSocketStream<ConnectStream>, value: Value) {
    socket
        .send(Message::Text(value.to_string().into()))
        .await
        .unwrap();
}

#[tokio::test]
async fn native_queued_and_rejected_receipts_are_not_inferred_from_writes() {
    for (scenario, delivery) in [("queued", "queued"), ("refused", "")] {
        let fixture = Fixture::new(scenario);
        let info = fixture.start(CLAUDE, "");
        let mut socket = fixture.socket(info["id"].as_str().unwrap()).await;
        next(&mut socket).await;
        send(
            &mut socket,
            json!({"type":"send","commandId":"receipt","text":"private"}),
        )
        .await;
        let reply = until(&mut socket, "command_result").await;
        if delivery.is_empty() {
            assert!(reply["error"].as_str().unwrap().contains("did not run"));
        } else {
            assert_eq!(reply["delivery"], delivery);
        }
    }
}

async fn unconfirmed(harness: &str) {
    let fixture = Fixture::new("unconfirmed");
    let info = fixture.start(harness, "");
    let mut socket = fixture.socket(info["id"].as_str().unwrap()).await;
    next(&mut socket).await;
    send(
        &mut socket,
        json!({"type":"send","commandId":"once","text":"Do this once"}),
    )
    .await;
    loop {
        let frame = tokio::time::timeout(Duration::from_secs(35), socket.next())
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        let Message::Text(text) = frame else {
            panic!("closed before acknowledgement")
        };
        let reply: Value = serde_json::from_str(&text).unwrap();
        if reply["type"] == "command_result" {
            assert_eq!(reply["delivery"], "unconfirmed");
            assert!(reply.get("error").is_none());
            break;
        }
    }
    let packets = fixture.input(harness);
    assert_eq!(
        packets
            .iter()
            .filter(|v| v["method"] == "turn/start" || v["type"] == "user")
            .count(),
        1
    );
}
#[tokio::test]
async fn codex_native_timeout_does_not_resend() {
    unconfirmed(CODEX).await;
}
#[tokio::test]
async fn claude_native_timeout_does_not_resend() {
    unconfirmed(CLAUDE).await;
}

#[test]
fn server_shutdown_escalates_and_reaps_a_native_process_ignoring_term() {
    let mut fixture = Fixture::new("ignore-term");
    fixture.start(CODEX, "");
    let start = std::time::Instant::now();
    fixture.server.take();
    assert!(start.elapsed() < Duration::from_secs(5));
    assert!(fixture.handle.chat.cancel.is_cancelled());
}

#[test]
fn routes_discover_native_models_and_enforce_page_and_body_boundaries() {
    let fixture = Fixture::new("pagination");
    let (status, body) = fixture.request(
        "GET",
        "/__devhost__/chat/harnesses?chatTarget=project",
        "",
        false,
    );
    assert_eq!(status, 200, "{body}");
    let harnesses: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(
        harnesses["harnesses"][0]["models"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    assert_eq!(harnesses["harnesses"][1]["models"][0]["id"], "sonnet");
    for (method, path, body, origin, status) in [
        ("POST", "/__devhost__/chat/sessions", "{}", false, 403),
        ("POST", "/__devhost__/chat/sessions", "{}", true, 400),
        ("POST", "/__devhost__/chat/sessions", "{} {}", true, 400),
        (
            "POST",
            "/__devhost__/chat/sessions",
            "{\"unexpected\":1}",
            true,
            400,
        ),
        ("DELETE", "/__devhost__/chat/sessions", "", true, 405),
        (
            "GET",
            "/__devhost__/chat/sessions?chatTarget=unknown",
            "",
            false,
            400,
        ),
        (
            "POST",
            "/__devhost__/chat/sessions/missing/close?chatTarget=project",
            "",
            true,
            404,
        ),
        ("GET", "/__devhost__/chat/panel", "", false, 200),
        (
            "PUT",
            "/__devhost__/chat/panel",
            "{\"position\":{\"left\":-1}}",
            true,
            400,
        ),
        (
            "PUT",
            "/__devhost__/chat/panel",
            "{\"position\":{\"other\":1}}",
            true,
            400,
        ),
        (
            "PUT",
            "/__devhost__/chat/panel",
            "{\"position\":{\"left\":42,\"top\":10}}",
            true,
            204,
        ),
    ] {
        let (actual, body) = fixture.request(method, path, body, origin);
        assert_eq!(actual, status, "{path}: {body}");
    }
    let (_, body) = fixture.request("GET", "/__devhost__/chat/panel", "", false);
    assert_eq!(
        serde_json::from_str::<Value>(&body).unwrap(),
        json!({"position":{"left":42.0,"top":10.0}})
    );
}

#[test]
fn panel_recovers_corrupt_state_and_reports_unwritable_storage() {
    use sha2::{Digest, Sha256};
    let fixture = Fixture::new("normal");
    let manifest = fixture.handle.live.manifest().unwrap();
    let directory = fixture
        .handle
        .live
        .caddy_dir()
        .parent()
        .unwrap()
        .join("chat-panels");
    fs::create_dir_all(&directory).unwrap();
    let path = directory.join(format!(
        "{:x}.json",
        Sha256::digest(manifest.manifest_path.as_os_str().as_encoded_bytes())
    ));
    // The Go panel store uses this same directory, manifest hash and JSON shape.
    fs::write(&path, r#"{"position":{"left":123,"top":45}}"#).unwrap();
    let (status, body) = fixture.request("GET", "/__devhost__/chat/panel", "", false);
    assert_eq!(status, 200);
    assert_eq!(
        serde_json::from_str::<Value>(&body).unwrap(),
        json!({"position":{"left":123.0,"top":45.0}})
    );
    assert_eq!(
        fixture
            .request(
                "PUT",
                "/__devhost__/chat/panel",
                r#"{"position":{"left":67,"top":89}}"#,
                true
            )
            .0,
        204
    );
    assert_eq!(
        serde_json::from_slice::<Value>(&fs::read(&path).unwrap()).unwrap(),
        json!({"position":{"left":67.0,"top":89.0}})
    );
    for content in ["broken", "{\"position\":{\"left\":-1,\"top\":10}}"] {
        fs::write(&path, content).unwrap();
        let (status, body) = fixture.request("GET", "/__devhost__/chat/panel", "", false);
        assert_eq!(status, 200);
        assert_eq!(
            serde_json::from_str::<Value>(&body).unwrap(),
            json!({"position":null})
        );
    }
    fs::remove_file(&path).unwrap();
    fs::create_dir(&path).unwrap();
    assert_eq!(
        fixture
            .request("GET", "/__devhost__/chat/panel", "", false)
            .0,
        500
    );
    assert_eq!(
        fixture
            .request(
                "PUT",
                "/__devhost__/chat/panel",
                "{\"position\":null}",
                true
            )
            .0,
        500
    );
    fs::remove_dir(&path).unwrap();
    fs::remove_dir(&directory).unwrap();
    fs::write(&directory, "occupied").unwrap();
    let (status, body) = fixture.request(
        "PUT",
        "/__devhost__/chat/panel",
        "{\"position\":null}",
        true,
    );
    assert_eq!(status, 500);
    assert!(body.contains("create chat panel state"));
    assert_eq!(
        fixture
            .request("PUT", "/__devhost__/chat/panel", "{}", false)
            .0,
        403
    );
    assert_eq!(
        fixture
            .request("DELETE", "/__devhost__/chat/panel", "", false)
            .0,
        405
    );
    assert_eq!(
        fixture
            .request("GET", "/__devhost__/chat/sessions/missing/close", "", false)
            .0,
        405
    );
}

#[tokio::test]
async fn retired_native_process_rejects_new_input_without_waiting_for_acknowledgement() {
    let fixture = Fixture::new("normal");
    let process = process::Process::start(
        &fixture.handle.chat,
        CODEX,
        fixture.root.path(),
        "",
        false,
        |_| {},
    )
    .unwrap();
    process::initialize(&process).await.unwrap();
    process.close().await;
    let error = process
        .write(json!({"method":"initialized"}))
        .await
        .unwrap_err();
    assert!(error.to_string().contains("native input is closed"));
    let started = std::time::Instant::now();
    assert!(process.call("turn/start", json!({})).await.is_err());
    assert!(started.elapsed() < Duration::from_secs(1));
}

#[tokio::test]
async fn codex_reconnect_retains_native_frames_and_approval_ids_without_leaking_private_acks() {
    let fixture = Fixture::new("approval");
    let info = fixture.start(CODEX, "");
    let id = info["id"].as_str().unwrap();
    let mut first = fixture.socket(id).await;
    let initial = next(&mut first).await;
    assert_eq!(initial["type"], "snapshot");
    assert!(!initial["events"].as_array().unwrap().is_empty());
    let mut second = fixture.socket(id).await;
    next(&mut second).await;
    send(
        &mut first,
        json!({"type":"send","commandId":"a","text":"private prompt"}),
    )
    .await;
    let ack = until(&mut first, "command_result").await;
    assert_eq!(ack["delivery"], "queued");
    assert_eq!(ack["commandId"], "a");
    let state = until(&mut second, "event").await;
    assert_ne!(state["type"], "command_result");
    let pending: Value = serde_json::from_str("123456789012345678901234567890").unwrap();
    let mut restored = fixture.socket(id).await;
    let snapshot = next(&mut restored).await;
    assert_eq!(snapshot["pendingRequestIds"], json!([pending]));
    assert_eq!(snapshot["session"]["status"], "requires_action");
    send(
        &mut restored,
        json!({"type":"respond","requestId":pending,"result":{"decision":"accept"}}),
    )
    .await;
    loop {
        let state = until(&mut restored, "state").await;
        if state["pendingRequestIds"] == json!([]) {
            break;
        }
    }
    send(&mut restored, json!({"type":"interrupt"})).await;
    loop {
        let state = until(&mut restored, "state").await;
        if state["session"]["status"] == "idle" {
            break;
        }
    }
    let packets = fixture.input(CODEX);
    let turn = packets
        .iter()
        .find(|v| v["method"] == "turn/start")
        .unwrap();
    assert_eq!(turn["params"]["model"], "configured-model");
    assert!(
        turn["params"]["input"][0]["text"]
            .as_str()
            .unwrap()
            .contains("Devhost workflow instructions:\nProject workflow")
    );
    assert!(
        packets
            .iter()
            .any(|v| v["id"] == pending && v["result"]["decision"] == "accept")
    );
    drop((first, second, restored));
    assert!(
        fixture
            .handle
            .chat
            .list(fixture.root.path())
            .iter()
            .any(|s| s.id == id)
    );
    let (status, _) = fixture.request(
        "POST",
        &format!("/__devhost__/chat/sessions/{id}/close?chatTarget=project"),
        "",
        true,
    );
    assert_eq!(status, 200);
    let mut closed = fixture.socket(id).await;
    assert!(
        matches!(closed.next().await.unwrap().unwrap(),Message::Close(Some(frame)) if frame.code==async_tungstenite::tungstenite::protocol::frame::coding::CloseCode::Normal)
    );
    fixture.start(CODEX, "codex-native");
    assert_eq!(fixture.handle.chat.list(fixture.root.path()).len(), 1);
}

#[tokio::test]
async fn claude_approvals_pass_a_pending_send_and_native_confirmation_is_correlated() {
    let fixture = Fixture::new("approval");
    let info = fixture.start(CLAUDE, "");
    let id = info["id"].as_str().unwrap();
    let mut socket = fixture.socket(id).await;
    next(&mut socket).await;
    let uuid = "01234567-89ab-4def-8123-456789abcdef";
    send(
        &mut socket,
        json!({"type":"send","commandId":uuid,"text":"private annotation","model":"sonnet"}),
    )
    .await;
    loop {
        let state = until(&mut socket, "state").await;
        if state["session"]["status"] == "requires_action" {
            break;
        }
    }
    send(
        &mut socket,
        json!({"type":"respond","requestId":"approve","result":{"behavior":"allow"}}),
    )
    .await;
    let ack = until(&mut socket, "command_result").await;
    assert_eq!(ack["commandId"], uuid);
    assert_eq!(ack["delivery"], "started");
    send(&mut socket, json!({"type":"interrupt"})).await;
    loop {
        let state = until(&mut socket, "state").await;
        if state["session"]["status"] == "idle" {
            break;
        }
    }
    let packets = fixture.input(CLAUDE);
    assert!(
        packets
            .iter()
            .any(|v| v["request"]["subtype"] == "set_model" && v["request"]["model"] == "sonnet")
    );
    assert!(
        packets.iter().any(
            |v| v["request"]["subtype"] == "interrupt" && v["request"]["cancel_queued"] == true
        )
    );
    assert!(packets.iter().any(|v| v["uuid"] == uuid));
}

#[tokio::test]
async fn send_validation_and_native_steer_race_preserve_order() {
    let fixture = Fixture::new("steer-race");
    let info = fixture.start(CODEX, "");
    let mut socket = fixture.socket(info["id"].as_str().unwrap()).await;
    next(&mut socket).await;
    for (value, error) in [
        (json!({"type":"send","text":"no ID"}), "commandId"),
        (json!({"type":"send","commandId":"empty"}), "empty"),
        (
            json!({"type":"send","commandId":"bad-image","images":[{"dataURL":"data:image/png;base64,bad"}]}),
            "image",
        ),
        (
            json!({"type":"send","commandId":"unknown","extra":true}),
            "unknown field",
        ),
    ] {
        send(&mut socket, value).await;
        loop {
            let reply = next(&mut socket).await;
            if matches!(reply["type"].as_str(), Some("error" | "command_result")) {
                assert!(reply["error"].as_str().unwrap().contains(error), "{reply}");
                break;
            }
        }
    }
    for id in ["first", "second"] {
        send(&mut socket, json!({"type":"send","commandId":id,"text":id})).await;
        assert_eq!(
            until(&mut socket, "command_result").await["delivery"],
            "queued"
        );
    }
    let methods: Vec<_> = fixture
        .input(CODEX)
        .into_iter()
        .filter_map(|v| v["method"].as_str().map(str::to_owned))
        .filter(|s| s.starts_with("turn/"))
        .collect();
    assert_eq!(methods, ["turn/start", "turn/steer", "turn/start"]);
}

#[test]
fn native_discovery_and_startup_failures_are_bounded_and_cleaned() {
    for scenario in ["invalid-model", "cursor-loop", "malformed", "exit"] {
        let fixture = Fixture::new(scenario);
        let (status, body) = fixture.request(
            "GET",
            "/__devhost__/chat/harnesses?chatTarget=project",
            "",
            false,
        );
        assert_eq!(status, 200);
        let value: Value = serde_json::from_str(&body).unwrap();
        assert_eq!(value["harnesses"][0]["available"], false, "{body}");
        if matches!(scenario, "exit" | "malformed") {
            let (status, _) = fixture.request(
                "POST",
                "/__devhost__/chat/sessions",
                &json!({"harness":"codex","target":"project"}).to_string(),
                true,
            );
            assert_eq!(status, 502);
        }
    }
}

#[test]
fn replay_is_disk_backed_ordered_and_native_request_ids_are_exact() {
    let mut journal = journal::Journal::new().unwrap();
    for n in 0..200 {
        assert_eq!(
            journal.append(&json!({"text":"private","n":n})).unwrap(),
            n + 1
        );
    }
    let events = journal.events().unwrap();
    assert_eq!(events.len(), 200);
    assert_eq!(events[199]["payload"]["n"], 199);
    let id: Value = serde_json::from_str("123456789012345678901234567890").unwrap();
    assert_eq!(request_key(&id).unwrap(), "123456789012345678901234567890");
    assert!(request_key(&Value::Null).is_err());
    assert_eq!(request_key(&json!("escaped\n")).unwrap(), "\"escaped\\n\"");
    journal.error = Some("disk failed".into());
    assert!(journal.append(&Value::Null).is_err());
    assert!(journal.events().is_err());
}
