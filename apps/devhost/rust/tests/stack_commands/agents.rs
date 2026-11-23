use super::*;

#[test]
fn native_agent_discovery_and_activity_keep_sessions_private_and_checkout_scoped() {
    let runtime = Runtime::start();
    let project = runtime.root.path().join("activity");
    let home = runtime.root.path().join("home");
    let sessions = home.join(".claude/sessions");
    fs::create_dir_all(&project).unwrap();
    fs::create_dir_all(&sessions).unwrap();
    fs::write(project.join("devhost.toml"), "name='activity'\n[devtools.chat]\nenabled=true\n[services.web]\ncommand=['sleep','300']\nhealth.process=true\n").unwrap();
    let harness = sleeper();
    let transcript = project.join("transcript.jsonl");
    fs::write(
        &transcript,
        "{\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":\"private old history\"}}\n",
    )
    .unwrap();
    fs::write(sessions.join("native.json"), json!({"sessionId":"private-native-id", "pid":harness.0.id(),"cwd":project,"status":"waiting","name":"Native task","transcriptPath":transcript}).to_string()).unwrap();
    let log = fs::File::create(project.join("stack.log")).unwrap();
    let mut command = runtime.command();
    command
        .current_dir(&project)
        .args(["start", "--local"])
        .env("HOME", &home)
        .env("XDG_DATA_HOME", home.join(".local/share"))
        .env("CLAUDE_SESSIONS_DIR", &sessions)
        .env("CLAUDE_PROJECTS_DIR", home.join(".claude/projects"))
        .env("CODEX_HOME", home.join(".codex"))
        .env("CODEX_SESSIONS_DIR", home.join(".codex/sessions"))
        .env("PI_CODING_AGENT_DIR", home.join(".pi/agent"))
        .env("PI_SESSIONS_DIR", home.join(".pi/agent/sessions"))
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
        if let Some(stack) = read_live_stacks(&runtime.state().join("caddy"))
            .unwrap()
            .iter()
            .find(|stack| stack.name == "activity")
        {
            port = stack.control_port;
        }
        port > 0
    });
    let client: ureq::Agent = ureq::Agent::config_builder()
        .proxy(None)
        .http_status_as_error(false)
        .timeout_global(Some(Duration::from_secs(5)))
        .build()
        .into();
    let url = format!("http://127.0.0.1:{port}");
    let mut response = client
        .get(format!("{url}/__devhost__/agents?chatTarget=project"))
        .call()
        .unwrap();
    assert_eq!(response.status(), 200);
    assert_eq!(response.headers()["cache-control"], "no-store");
    let body = response.body_mut().read_to_string().unwrap();
    let value: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(value["agents"].as_array().unwrap().len(), 1, "{body}");
    let agent = &value["agents"][0];
    assert_eq!(agent["key"], format!("claude-code:{}", harness.0.id()));
    assert_eq!(agent["state"], "waiting");
    assert_eq!(agent["subdirectory"], ".");
    assert_eq!(agent["isOwned"], false);
    assert!(!body.contains("private-native-id") && !body.contains("transcript"));
    let mut page = client
        .get(format!(
            "{url}/__devhost__/agents/activity?chatTarget=project"
        ))
        .call()
        .unwrap();
    assert_eq!(page.status(), 200);
    assert_eq!(page.headers()["referrer-policy"], "no-referrer");
    assert!(
        page.body_mut()
            .read_to_string()
            .unwrap()
            .contains("including agents devhost did not start")
    );
    assert_eq!(
        client
            .get(format!(
                "{url}/__devhost__/agents/activity?chatTarget=project"
            ))
            .header("Host", "localhost")
            .call()
            .unwrap()
            .status(),
        403
    );
    let io = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    io.block_on(async {
        use futures_util::StreamExt;
        let (mut socket, _) = async_tungstenite::tokio::connect_async(format!(
            "ws://127.0.0.1:{port}/__devhost__/ws/agents/activity?chatTarget=project"
        ))
        .await
        .unwrap();
        let frame = tokio::time::timeout(Duration::from_secs(5), socket.next())
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        let async_tungstenite::tungstenite::Message::Text(frame) = frame else {
            panic!("expected lifecycle event")
        };
        let value: Value = serde_json::from_str(&frame).unwrap();
        assert_eq!(value["eventType"], "run_started");
        assert_eq!(value["pid"], harness.0.id());
        assert!(value.get("sessionId").is_none());
        unsafe {
            libc::kill(stack.0.id() as i32, libc::SIGTERM);
        }
        let closed = tokio::time::timeout(Duration::from_secs(5), socket.next())
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        let async_tungstenite::tungstenite::Message::Close(Some(close)) = closed else {
            panic!("expected shutdown close: {closed:?}")
        };
        assert_eq!(u16::from(close.code), 1001);
    });
    wait_until(|| stack.0.try_wait().unwrap().is_some());
    assert!(
        read_live_stacks(&runtime.state().join("caddy"))
            .unwrap()
            .is_empty()
    );
}
