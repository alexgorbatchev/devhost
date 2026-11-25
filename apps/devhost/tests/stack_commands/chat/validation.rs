use super::*;

const PNG: &str = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII=";

async fn rejected(socket: &mut ChatSocket, payload: &str) {
    socket
        .send(Message::Text(payload.to_owned().into()))
        .await
        .unwrap();
    let result = chat_until(socket, |value| {
        value["type"] == "error" || value["type"] == "command_result"
    })
    .await;
    assert!(
        !result["error"].as_str().unwrap_or_default().is_empty(),
        "{result}"
    );
    assert!(result.get("delivery").is_none(), "{result}");
}

fn contains_text(value: &Value, expected: &str) -> bool {
    match value {
        Value::String(text) => text == expected,
        Value::Array(values) => values.iter().any(|value| contains_text(value, expected)),
        Value::Object(values) => values.values().any(|value| contains_text(value, expected)),
        _ => false,
    }
}

#[test]
fn invalid_inputs_never_reach_providers_and_page_context_survives_workflow_append() {
    let mut fixture = start_chat("normal");
    let io = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    let context = json!({
        "title":"Private annotated page <&> 🦀",
        "url":"https://chat.localhost/path?secret=private-context",
        "markers":[{"number":1,"selector":"button[data-action=save]","source":"src/App.tsx:7"}],
        "shapes":[{"type":"rectangle","x":12,"y":34}],
        "screenshot":{"width":1,"height":1}
    });
    let text = format!("Review this private context\n\nPage context:\n{context}");
    let expected = format!("{text}\n\nDevhost workflow instructions:\nProject workflow");
    io.block_on(async {
        for harness in ["codex", "claude-code"] {
            let id = fixture.session(harness);
            let mut socket = fixture.socket(&id).await;
            let before = fixture.packets(harness).len();
            for payload in [
                "{",
                "[]",
                r#"{"type":"send","commandId":"empty"}"#,
                r#"{"type":"send","text":"Private rejected input"}"#,
                r#"{"type":"send","commandId":"unknown","text":"Private rejected input","unexpected":true}"#,
                r#"{"type":"send","commandId":"wrong-type","text":42}"#,
                r#"{"type":"respond","requestId":"unknown"}"#,
                r#"{"type":"unsupported"}"#,
                r#"{"type":"send","commandId":"trailing","text":"Private rejected input"} {}"#,
                r#"{"type":"send","commandId":"nested","images":[{"dataURL":"x","unexpected":true}]}"#,
            ] {
                rejected(&mut socket, payload).await;
            }
            for image in [
                "https://example.invalid/image.png".to_owned(),
                "data:image/gif;base64,AA==".to_owned(),
                "data:image/png;base64,!invalid!".to_owned(),
                "data:image/png;base64,AA==".to_owned(),
                PNG.replacen("image/png", "image/jpeg", 1),
            ] {
                rejected(&mut socket, &json!({
                    "type":"send","commandId":"invalid-image","text":"Private rejected input",
                    "images":[{"dataURL":image}]
                }).to_string()).await;
            }
            let mut oversized = json!({"type":"send","commandId":"workflow-limit","text":""});
            let limit = 8 * 1024 * 1024;
            let padding = limit - 10 - oversized.to_string().len();
            oversized["text"] = json!("x".repeat(padding));
            let payload = oversized.to_string();
            assert_eq!(payload.len(), limit - 10);
            rejected(&mut socket, &payload).await;
            assert_eq!(fixture.packets(harness).len(), before, "rejected command reached {harness}");
            drop(socket);
            let (mut socket, snapshot) = fixture.replay(&id).await;
            assert!(snapshot["events"].as_array().unwrap().iter().all(|event| {
                event["payload"]["method"] != "turn/started" && event["payload"]["type"] != "user"
            }), "rejected command started a provider turn: {snapshot}");
            chat_send(&mut socket, json!({
                "type":"send","commandId":"01234567-89ab-4def-8123-456789abcdef",
                "text":text,"images":[{"dataURL":PNG}]
            })).await;
            let result = chat_until(&mut socket, |value| value["type"] == "command_result").await;
            assert!(result.get("error").is_none(), "{result}");
            assert_eq!(result["delivery"], if harness == "codex" { "queued" } else { "started" });
            assert!(fixture.packets(harness).iter().any(|packet| contains_text(packet, &expected)), "page context changed in {harness} input");
            fixture.close(&id);
            drop(socket);
        }
    });
    fixture.stop();
    let log = fs::read_to_string(fixture.project.join("stack.log")).unwrap();
    for private in [
        "Private rejected input",
        "private-context",
        "Private annotated page",
        "iVBORw0KGgo",
    ] {
        assert!(
            !log.contains(private),
            "private context reached public logs"
        );
    }
}
