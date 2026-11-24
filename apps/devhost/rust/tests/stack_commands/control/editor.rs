use super::*;
use async_tungstenite::tungstenite::{Message, client::IntoClientRequest};
use futures_util::StreamExt;

#[test]
fn editor_config_and_cursor_broadcast_preserve_the_browser_handler_boundary() {
    let runtime = Runtime::start();
    let name = "editor-channel-contract";
    let (project, mut process) = runtime.start_stack(name, false);
    let origin = origin(&runtime, name);
    lifecycle::ready(&origin);
    let manifest = project.join("devhost.toml");
    let base = fs::read_to_string(&manifest).unwrap();
    let url = format!(
        "{}/__devhost__/ws/react-highlight",
        origin.replacen("http:", "ws:", 1)
    );
    let io = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    io.block_on(async {
        let mut request = url.into_client_request().unwrap();
        request
            .headers_mut()
            .insert("Origin", "https://attacker.invalid".parse().unwrap());
        let error = async_tungstenite::tokio::connect_async(request.clone())
            .await
            .unwrap_err();
        assert!(matches!(error, async_tungstenite::tungstenite::Error::Http(response) if response.status() == 403));
        request
            .headers_mut()
            .insert("Origin", origin.parse().unwrap());
        let mut sockets = Vec::new();
        for _ in 0..2 {
            let (mut socket, _) = async_tungstenite::tokio::connect_async(request.clone())
                .await
                .unwrap();
            socket
                .send(Message::Ping(vec![1, 2, 3].into()))
                .await
                .unwrap();
            assert!(matches!(
                tokio::time::timeout(Duration::from_secs(5), socket.next())
                    .await
                    .unwrap()
                    .unwrap()
                    .unwrap(),
                Message::Pong(_)
            ));
            sockets.push(socket);
        }
        assert_eq!(get(&origin, "react-highlight/cursor").status(), 405);
        assert_eq!(
            client()
                .post(format!("{origin}/__devhost__/react-highlight/cursor"))
                .header("Origin", "https://attacker.invalid")
                .header("Content-Type", "application/json")
                .send("{\"locator\":\"src/App.tsx:12:3\"}")
                .unwrap()
                .status(),
            403
        );
        for invalid in ["{", "[]", "{\"locator\":42}", "{\"locator\":\"\"}"] {
            assert_eq!(
                client()
                    .post(format!("{origin}/__devhost__/react-highlight/cursor"))
                    .header("Origin", &origin)
                    .header("Content-Type", "application/json")
                    .send(invalid)
                    .unwrap()
                    .status(),
                400,
                "{invalid}"
            );
        }
        for (editor, enabled, payload) in [
            ("cursor", true, json!({"locator":"src/App.tsx:12:3"})),
            ("vscode", false, json!({"locator":"not-a-local-file:7"})),
            ("vscode-insiders", true, json!({"locator":null})),
            ("webstorm", false, json!({})),
        ] {
            fs::write(
                &manifest,
                format!("{base}\n[devtools.editor]\nenabled={enabled}\nide={editor:?}\n"),
            )
            .unwrap();
            wait_until(|| {
                let config = body(&mut get(&origin, "config.json"));
                config["componentEditor"] == editor && config["editorEnabled"] == enabled
            });
            let config = body(&mut get(&origin, "config.json"));
            assert_eq!(config["projectRootPath"], project.to_str().unwrap());
            assert_eq!(config["stackName"], name);
            let mut response = post(&origin, "react-highlight/cursor", payload.clone());
            assert_eq!(response.status(), 200);
            assert_eq!(body(&mut response), json!({"success":true}));
            for socket in &mut sockets {
                let frame = tokio::time::timeout(Duration::from_secs(5), socket.next())
                    .await
                    .unwrap()
                    .unwrap()
                    .unwrap();
                let Message::Text(text) = frame else {
                    panic!("missing cursor event")
                };
                let event: Value = serde_json::from_str(&text).unwrap();
                assert_eq!(event["kind"], "cursor");
                assert_eq!(event["locator"], payload["locator"]);
                assert_eq!(event["projectRoot"], project.to_str().unwrap());
                assert_eq!(event["stackName"], name);
                assert!(event["timestamp"].as_u64().unwrap() > 0);
            }
        }
        assert_eq!(
            fs::read_to_string(project.join("launches"))
                .unwrap()
                .lines()
                .count(),
            1,
            "editor configuration changes do not restart the worker"
        );
        unsafe {
            libc::kill(process.as_ref().unwrap().0.id() as i32, libc::SIGTERM);
        }
        for socket in &mut sockets {
            let frame = tokio::time::timeout(Duration::from_secs(5), socket.next())
                .await
                .unwrap()
                .unwrap()
                .unwrap();
            assert!(matches!(frame, Message::Close(Some(close)) if u16::from(close.code) == 1001));
        }
    });
    wait_until(|| process.as_mut().unwrap().0.try_wait().unwrap().is_some());
}
