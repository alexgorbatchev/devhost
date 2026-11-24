use super::*;
use async_tungstenite::{
    WebSocketStream,
    tokio::ConnectStream,
    tungstenite::{Message, client::IntoClientRequest},
};
use futures_util::StreamExt;

type ChatSocket = WebSocketStream<ConnectStream>;

struct ChatFixture {
    stack: Process,
    runtime: Runtime,
    project: PathBuf,
    client: ureq::Agent,
    origin: String,
    port: u16,
}

fn start_chat(scenario: &str) -> ChatFixture {
    let runtime = Runtime::start();
    let project = runtime.root.path().join("chat");
    fs::create_dir_all(&project).unwrap();
    let bin = project.join("bin");
    fs::create_dir(&bin).unwrap();
    for name in ["claude", "codex"] {
        let path = bin.join(name);
        fs::write(&path, include_str!("../../src/devtools/chat/fixture.py")).unwrap();
        fs::set_permissions(path, fs::Permissions::from_mode(0o755)).unwrap();
    }
    fs::write(project.join("scenario"), scenario).unwrap();
    fs::write(project.join("devhost.toml"),"name='chat'\n[devtools.chat]\nenabled=true\nprompt='Project workflow'\n[services.web]\ncommand=['sleep','300']\nhealth.process=true\n").unwrap();
    let log = fs::File::create(project.join("stack.log")).unwrap();
    let mut command = runtime.command();
    let mut paths = vec![bin];
    paths.extend(std::env::split_paths(
        &std::env::var_os("PATH").unwrap_or_default(),
    ));
    command
        .current_dir(&project)
        .args(["start", "--local"])
        .env("PATH", std::env::join_paths(paths).unwrap())
        .stdin(Stdio::null())
        .stdout(log.try_clone().unwrap())
        .stderr(log);
    unsafe {
        command.pre_exec(|| {
            if libc::setsid() < 0 {
                Err(std::io::Error::last_os_error())
            } else {
                Ok(())
            }
        });
    }
    let stack = Process(command.spawn().unwrap());
    let mut port = 0;
    wait_until(|| {
        if let Some(owner) = read_live_stacks(&runtime.state().join("caddy"))
            .unwrap()
            .iter()
            .find(|s| s.name == "chat")
        {
            port = owner.control_port;
        }
        port > 0
    });
    let client: ureq::Agent = ureq::Agent::config_builder()
        .proxy(None)
        .http_status_as_error(false)
        .timeout_global(Some(Duration::from_secs(5)))
        .build()
        .into();
    let origin = format!("http://127.0.0.1:{port}");
    ChatFixture {
        stack,
        runtime,
        project,
        client,
        origin,
        port,
    }
}

#[test]
fn native_chat_models_images_replay_and_shutdown_match_the_shared_protocol() {
    let ChatFixture {
        mut stack,
        runtime,
        project,
        client,
        origin,
        port,
    } = start_chat("normal");
    let mut response = client
        .get(format!(
            "{origin}/__devhost__/chat/harnesses?chatTarget=project"
        ))
        .call()
        .unwrap();
    assert_eq!(response.status(), 200);
    let catalog: Value =
        serde_json::from_str(&response.body_mut().read_to_string().unwrap()).unwrap();
    for harness in catalog["harnesses"].as_array().unwrap() {
        assert_eq!(harness["available"], true, "{catalog}");
        assert!(!harness["models"].as_array().unwrap().is_empty());
    }
    let io = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    io.block_on(async{
        use async_tungstenite::tungstenite::{Message,client::IntoClientRequest};use futures_util::StreamExt;
        for harness in ["codex","claude-code"]{
            let mut response=client.post(format!("{origin}/__devhost__/chat/sessions")).header("Origin",&origin).header("Content-Type","application/json").send(json!({"harness":harness,"target":"project","pageURL":"https://chat.localhost"}).to_string()).unwrap();assert_eq!(response.status(),200);
            let info:Value=serde_json::from_str(&response.body_mut().read_to_string().unwrap()).unwrap();let id=info["id"].as_str().unwrap();assert_eq!(info["status"],"idle");
            let mut request=format!("ws://127.0.0.1:{port}/__devhost__/ws/chat?chatTarget=project&sessionId={id}").into_client_request().unwrap();request.headers_mut().insert("Origin",origin.parse().unwrap());
            let (mut socket,_)=async_tungstenite::tokio::connect_async(request.clone()).await.unwrap();
            let initial=tokio::time::timeout(Duration::from_secs(5),socket.next()).await.unwrap().unwrap().unwrap();let Message::Text(text)=initial else{panic!("missing snapshot")};let snapshot:Value=serde_json::from_str(&text).unwrap();assert_eq!(snapshot["type"],"snapshot");
            let png="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII=";
            socket.send(Message::Text(json!({"type":"send","commandId":"01234567-89ab-4def-8123-456789abcdef","text":"Review this annotated element","images":[{"dataURL":png}]}).to_string().into())).await.unwrap();
            let mut ack=false;
            for _ in 0..30{let frame=tokio::time::timeout(Duration::from_secs(5),socket.next()).await.unwrap().unwrap().unwrap();let Message::Text(text)=frame else{panic!("unexpected close")};let value:Value=serde_json::from_str(&text).unwrap();if value["type"]=="command_result"{assert_eq!(value["delivery"],if harness=="codex"{"queued"}else{"started"},"{value}");assert!(value.get("error").is_none(),"{value}");ack=true;break;}}
            assert!(ack);drop(socket);
            let (mut socket,_)=async_tungstenite::tokio::connect_async(request).await.unwrap();let Message::Text(text)=tokio::time::timeout(Duration::from_secs(5),socket.next()).await.unwrap().unwrap().unwrap()else{panic!("missing reconnect snapshot")};let snapshot:Value=serde_json::from_str(&text).unwrap();assert!(snapshot["events"].as_array().unwrap().len()>2);
            let mut response=client.post(format!("{origin}/__devhost__/chat/sessions/{id}/close?chatTarget=project")).header("Origin",&origin).send_empty().unwrap();assert_eq!(response.status(),200);let closed:Value=serde_json::from_str(&response.body_mut().read_to_string().unwrap()).unwrap();assert_eq!(closed["status"],"closed");
            loop{let frame=tokio::time::timeout(Duration::from_secs(5),socket.next()).await.unwrap().unwrap().unwrap();if let Message::Close(Some(frame))=frame{assert_eq!(u16::from(frame.code),1000);break;}}
            let packets=fs::read_to_string(project.join(if harness=="codex"{"codex-input.jsonl"}else{"claude-input.jsonl"})).unwrap();assert!(packets.contains("Project workflow"));assert!(packets.contains(if harness=="codex"{"data:image/png;base64"}else{"media_type"}));
        }
    });
    unsafe {
        libc::kill(stack.0.id() as i32, libc::SIGTERM);
    }
    wait_until(|| stack.0.try_wait().unwrap().is_some());
    let log = fs::read_to_string(project.join("stack.log")).unwrap();
    assert!(
        !log.contains("Review this annotated element") && !log.contains("iVBORw0KGgo"),
        "private input reached logs"
    );
    assert!(
        read_live_stacks(&runtime.state().join("caddy"))
            .unwrap()
            .is_empty()
    );
}

impl ChatFixture {
    fn session(&self, harness: &str) -> String {
        let mut response = self
            .client
            .post(format!("{}/__devhost__/chat/sessions", self.origin))
            .header("Origin", &self.origin)
            .header("Content-Type", "application/json")
            .send(
                json!({"harness":harness,"target":"project","pageURL":"https://chat.localhost"})
                    .to_string(),
            )
            .unwrap();
        assert_eq!(response.status(), 200);
        let info: Value =
            serde_json::from_str(&response.body_mut().read_to_string().unwrap()).unwrap();
        assert_eq!(info["status"], "idle");
        info["id"].as_str().unwrap().to_owned()
    }

    async fn socket(&self, id: &str) -> ChatSocket {
        let mut request = format!(
            "ws://127.0.0.1:{}/__devhost__/ws/chat?chatTarget=project&sessionId={id}",
            self.port
        )
        .into_client_request()
        .unwrap();
        request
            .headers_mut()
            .insert("Origin", self.origin.parse().unwrap());
        let mut socket = async_tungstenite::tokio::connect_async(request)
            .await
            .unwrap()
            .0;
        chat_until(&mut socket, |value| value["type"] == "snapshot").await;
        socket
    }

    fn close(&self, id: &str) {
        let mut response = self
            .client
            .post(format!(
                "{}/__devhost__/chat/sessions/{id}/close?chatTarget=project",
                self.origin
            ))
            .header("Origin", &self.origin)
            .send_empty()
            .unwrap();
        assert_eq!(response.status(), 200);
        let info: Value =
            serde_json::from_str(&response.body_mut().read_to_string().unwrap()).unwrap();
        assert_eq!(info["status"], "closed");
    }

    fn packets(&self, harness: &str) -> Vec<Value> {
        fs::read_to_string(self.project.join(if harness == "codex" {
            "codex-input.jsonl"
        } else {
            "claude-input.jsonl"
        }))
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect()
    }

    fn stop(&mut self) {
        // The fixture owns the supervisor and its independently managed peers.
        unsafe {
            libc::kill(self.stack.0.id() as i32, libc::SIGTERM);
        }
        wait_until(|| self.stack.0.try_wait().unwrap().is_some());
        assert!(
            read_live_stacks(&self.runtime.state().join("caddy"))
                .unwrap()
                .is_empty()
        );
        let log = fs::read_to_string(self.project.join("stack.log")).unwrap();
        for private in [
            "Private numbered",
            "Private approval",
            "Private receipt",
            "never log this",
        ] {
            assert!(
                !log.contains(private),
                "private chat content reached stack logs"
            );
        }
    }
}

async fn chat_send(socket: &mut ChatSocket, value: Value) {
    socket
        .send(Message::Text(value.to_string().into()))
        .await
        .unwrap();
}

async fn chat_until(socket: &mut ChatSocket, mut predicate: impl FnMut(&Value) -> bool) -> Value {
    tokio::time::timeout(Duration::from_secs(35), async {
        for _ in 0..200 {
            let message = socket.next().await.unwrap().unwrap();
            if let Message::Text(text) = message {
                let value: Value = serde_json::from_str(&text).unwrap();
                if predicate(&value) {
                    return value;
                }
            } else if let Message::Close(frame) = message {
                panic!("chat closed before expected message: {frame:?}");
            }
        }
        panic!("chat response exceeded bounded event count");
    })
    .await
    .expect("chat response exceeded native acknowledgement deadline")
}

#[test]
fn native_chat_ordered_steering_races_and_interrupts_match_the_shared_protocol() {
    for scenario in ["normal", "steer-race"] {
        let mut fixture = start_chat(scenario);
        let io = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        io.block_on(async {
            let id = fixture.session("codex");
            let mut socket = fixture.socket(&id).await;
            for command in ["first", "second", "third"] {
                chat_send(&mut socket, json!({"type":"send","commandId":command,"text":format!("Private numbered {command}")})).await;
            }
            for command in ["first", "second", "third"] {
                let result = chat_until(&mut socket, |value| value["type"] == "command_result").await;
                assert_eq!(result["commandId"], command);
                assert_eq!(result["delivery"], "queued", "{result}");
                assert!(result.get("error").is_none(), "{result}");
            }
            chat_send(&mut socket, json!({"type":"interrupt"})).await;
            chat_until(&mut socket, |value| value["type"] == "state" && value["session"]["status"] == "idle").await;
            fixture.close(&id);
            let packets = fixture.packets("codex");
            let methods: Vec<_> = packets.iter().filter_map(|value| value["method"].as_str()).filter(|method| method.starts_with("turn/")).collect();
            assert_eq!(methods, if scenario == "normal" {
                vec!["turn/start", "turn/steer", "turn/steer", "turn/interrupt"]
            } else {
                vec!["turn/start", "turn/steer", "turn/start", "turn/steer", "turn/start", "turn/interrupt"]
            });
        });
        fixture.stop();
    }
}

#[test]
fn native_chat_approvals_bypass_pending_sends_and_preserve_exact_ids() {
    for harness in ["codex", "claude-code"] {
        let mut fixture = start_chat("approval");
        let io = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        io.block_on(async {
            let id = fixture.session(harness);
            let mut socket = fixture.socket(&id).await;
            let command = "01234567-89ab-4def-8123-456789abcdef";
            chat_send(&mut socket, json!({"type":"send","commandId":command,"text":"Private approval input"})).await;
            let state = chat_until(&mut socket, |value| {
                if harness == "claude-code" { assert_ne!(value["type"], "command_result", "send confirmed before approval: {value}"); }
                value["type"] == "state" && value["session"]["status"] == "requires_action"
            }).await;
            let pending: Value = if harness == "codex" { serde_json::from_str("123456789012345678901234567890").unwrap() } else { json!("approve") };
            assert_eq!(state["pendingRequestIds"], json!([pending]));
            chat_send(&mut socket, json!({"type":"respond","requestId":"stale","result":{"decision":"accept"}})).await;
            let rejected = chat_until(&mut socket, |value| value["type"] == "error").await;
            assert!(!rejected["error"].as_str().unwrap().is_empty());
            chat_send(&mut socket, json!({"type":"respond","requestId":pending,"result":{"decision":"accept","behavior":"allow"}})).await;
            if harness == "claude-code" {
                let receipt = chat_until(&mut socket, |value| value["type"] == "command_result").await;
                assert_eq!(receipt["commandId"], command);
                assert_eq!(receipt["delivery"], "started");
                assert!(receipt.get("error").is_none());
            }
            chat_send(&mut socket, json!({"type":"interrupt"})).await;
            chat_until(&mut socket, |value| value["type"] == "state" && value["session"]["status"] == "idle").await;
            fixture.close(&id);
            let packets = fixture.packets(harness);
            let responses: Vec<_> = packets.iter().filter(|value| if harness == "codex" { value.get("result").is_some() } else { value["type"] == "control_response" }).collect();
            assert_eq!(responses.len(), 1, "stale approval reached native process: {responses:?}");
            if harness == "codex" {
                assert_eq!(responses[0]["id"], pending);
            } else {
                assert_eq!(responses[0]["response"]["request_id"], pending);
                assert!(packets.iter().any(|value| value["request"]["subtype"] == "interrupt" && value["request"]["cancel_queued"] == true));
            }
            assert_eq!(packets.iter().filter(|value| value["method"] == "turn/start" || value["type"] == "user").count(), 1);
        });
        fixture.stop();
    }
}

#[test]
fn native_chat_queued_refused_and_unconfirmed_receipts_do_not_resend() {
    for (scenario, harness, delivery) in [
        ("queued", "claude-code", "queued"),
        ("refused", "claude-code", ""),
        ("unconfirmed", "codex", "unconfirmed"),
        ("unconfirmed", "claude-code", "unconfirmed"),
    ] {
        let mut fixture = start_chat(scenario);
        let io = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        io.block_on(async {
            let id = fixture.session(harness);
            let mut socket = fixture.socket(&id).await;
            let command = "01234567-89ab-4def-8123-456789abcdef";
            chat_send(
                &mut socket,
                json!({"type":"send","commandId":command,"text":"Private receipt input"}),
            )
            .await;
            let receipt = chat_until(&mut socket, |value| value["type"] == "command_result").await;
            assert_eq!(receipt["commandId"], command);
            if delivery.is_empty() {
                assert!(!receipt["error"].as_str().unwrap().is_empty());
                assert!(receipt.get("delivery").is_none());
            } else {
                assert_eq!(receipt["delivery"], delivery, "{receipt}");
                assert!(receipt.get("error").is_none());
            }
            drop(socket);
            let reconnected = fixture.socket(&id).await;
            fixture.close(&id);
            drop(reconnected);
            assert_eq!(
                fixture
                    .packets(harness)
                    .iter()
                    .filter(|value| value["method"] == "turn/start" || value["type"] == "user")
                    .count(),
                1,
                "reconnect resent native input"
            );
        });
        fixture.stop();
    }
}

#[test]
fn native_chat_close_and_stack_shutdown_reap_peers_ignoring_term_and_eof() {
    for harness in ["codex", "claude-code"] {
        for stop_stack in [false, true] {
            let mut fixture = start_chat("ignore-term");
            let id = fixture.session(harness);
            let peer = if harness == "codex" {
                "codex"
            } else {
                "claude"
            };
            let pid = fs::read_to_string(fixture.project.join(format!("{peer}-ready")))
                .unwrap()
                .parse::<i32>()
                .unwrap();
            assert!(procid::is_process_alive(pid));
            if stop_stack {
                fixture.stop();
            } else {
                fixture.close(&id);
            }
            assert!(fixture.project.join(format!("{peer}-term")).exists());
            assert!(
                !procid::is_process_alive(pid),
                "native peer survived shutdown"
            );
            if !stop_stack {
                fixture.stop();
            }
        }
    }
}

#[test]
fn native_chat_panel_state_uses_private_manifest_storage_and_recovers_corruption() {
    use sha2::{Digest, Sha256};

    let mut fixture = start_chat("normal");
    let endpoint = format!("{}/__devhost__/chat/panel", fixture.origin);
    let manifest = fixture.project.join("devhost.toml").canonicalize().unwrap();
    let path = fixture.runtime.state().join("chat-panels").join(format!(
        "{:x}.json",
        Sha256::digest(manifest.as_os_str().as_encoded_bytes())
    ));
    let layout = json!({"position":{"left":12,"top":34}});
    let put = |body: String| {
        fixture
            .client
            .put(&endpoint)
            .header("Origin", &fixture.origin)
            .header("Content-Type", "application/json")
            .send(body)
            .unwrap()
            .status()
            .as_u16()
    };
    assert_eq!(put(layout.to_string()), 204);
    let saved = fs::read(&path).unwrap();
    assert_eq!(
        fs::metadata(&path).unwrap().permissions().mode() & 0o777,
        0o600
    );
    let stored: Value = serde_json::from_slice(&saved).unwrap();
    for axis in ["left", "top"] {
        assert_eq!(
            stored["position"][axis].as_f64(),
            layout["position"][axis].as_f64()
        );
    }
    for body in [
        "broken",
        r#"{"position":{"left":-1,"top":1}}"#,
        r#"{"other":1}"#,
    ] {
        assert_eq!(put(body.to_owned()), 400);
        assert_eq!(fs::read(&path).unwrap(), saved);
    }
    for damaged in ["broken", r#"{"position":{"left":-1,"top":1}}"#] {
        fs::write(&path, damaged).unwrap();
        let mut response = fixture.client.get(&endpoint).call().unwrap();
        assert_eq!(response.status(), 200);
        let recovered: Value =
            serde_json::from_str(&response.body_mut().read_to_string().unwrap()).unwrap();
        assert!(recovered["position"].is_null());
    }
    fs::remove_file(&path).unwrap();
    fs::create_dir(&path).unwrap();
    let sentinel = path.join("sentinel");
    fs::write(&sentinel, "preserve").unwrap();
    assert_eq!(fixture.client.get(&endpoint).call().unwrap().status(), 500);
    assert_eq!(put(layout.to_string()), 500);
    assert_eq!(fs::read_to_string(sentinel).unwrap(), "preserve");
    fixture.stop();
}
