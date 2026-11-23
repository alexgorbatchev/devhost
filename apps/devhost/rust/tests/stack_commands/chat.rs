use super::*;

#[test]
fn native_chat_models_images_replay_and_shutdown_match_the_shared_protocol() {
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
    fs::write(project.join("scenario"), "normal").unwrap();
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
    let mut stack = Process(command.spawn().unwrap());
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
