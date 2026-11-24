use super::*;

type ActivitySocket = async_tungstenite::WebSocketStream<async_tungstenite::tokio::ConnectStream>;

async fn activity_event(socket: &mut ActivitySocket, matches: impl Fn(&Value) -> bool) -> Value {
    use async_tungstenite::tungstenite::Message;
    use futures_util::StreamExt;
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let Message::Text(text) = socket.next().await.unwrap().unwrap() else {
                panic!("activity stream closed before the expected event")
            };
            let value: Value = serde_json::from_str(&text).unwrap();
            assert!(value.get("sessionId").is_none());
            assert!(value.get("transcriptPath").is_none());
            assert!(!text.contains("private old history"));
            if matches(&value) {
                return value;
            }
            assert_ne!(
                value["eventType"], "turn_start",
                "unexpected activity: {value}"
            );
        }
    })
    .await
    .expect("expected native activity event")
}

#[cfg(target_os = "linux")]
fn opaque_harness() -> Process {
    use std::{ffi::OsString, os::unix::ffi::OsStringExt};
    let mut command = Command::new("sleep");
    command
        .arg0(OsString::from_vec(b"claude-opaque-\xff".to_vec()))
        .arg("300")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    // SAFETY: setsid is async-signal-safe and isolates this fixture's child group.
    unsafe {
        command.pre_exec(|| {
            if libc::setsid() < 0 {
                Err(std::io::Error::last_os_error())
            } else {
                Ok(())
            }
        });
    }
    let child = Process(command.spawn().unwrap());
    assert!(
        fs::read(format!("/proc/{}/cmdline", child.0.id()))
            .unwrap()
            .contains(&0xff)
    );
    child
}

#[test]
fn native_agent_discovery_and_activity_keep_sessions_private_and_checkout_scoped() {
    let runtime = Runtime::start();
    let project = runtime.root.path().join("activity");
    let home = runtime.root.path().join("home");
    let sessions = home.join(".claude/sessions");
    fs::create_dir_all(&project).unwrap();
    fs::create_dir_all(&sessions).unwrap();
    fs::write(project.join("devhost.toml"), "name='activity'\n[devtools.chat]\nenabled=true\n[services.web]\ncommand=['sleep','300']\nhealth.process=true\n").unwrap();
    #[cfg(target_os = "linux")]
    let harness = opaque_harness();
    #[cfg(not(target_os = "linux"))]
    let harness = sleeper();
    let working = sleeper();
    let unknown = sleeper();
    let idle = sleeper();
    let sibling = sleeper();
    let stale = sleeper();
    let empty = sleeper();
    let nested = project.join("nested");
    let sibling_directory = runtime.root.path().join("activity-sibling");
    fs::create_dir(&nested).unwrap();
    fs::create_dir(&sibling_directory).unwrap();
    let transcript = project.join("transcript.jsonl");
    fs::write(
        &transcript,
        "{\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":\"private old history\"}}\n",
    )
    .unwrap();
    fs::write(sessions.join("native.json"), json!({"sessionId":"private-native-id", "pid":harness.0.id(),"cwd":project,"status":"waiting","name":"Native task","transcriptPath":transcript}).to_string()).unwrap();
    for (name, process, cwd, status, started) in [
        ("working", &working, nested.as_path(), "busy", 0),
        ("unknown", &unknown, project.as_path(), "unrecognized", 0),
        ("idle", &idle, project.as_path(), "idle", 0),
        (
            "sibling",
            &sibling,
            sibling_directory.as_path(),
            "waiting",
            0,
        ),
        ("stale", &stale, project.as_path(), "waiting", 1),
        ("empty", &empty, Path::new(""), "waiting", 0),
    ] {
        let separate_transcript = project.join(format!("{name}.jsonl"));
        fs::write(&separate_transcript, "").unwrap();
        fs::write(sessions.join(format!("{name}.json")), json!({"sessionId":format!("private-{name}-id"),"pid":process.0.id(),"cwd":cwd,"status":status,"startedAt":started,"transcriptPath":separate_transcript}).to_string()).unwrap();
    }
    let subagents = project.join("private-native-id/subagents");
    fs::create_dir_all(&subagents).unwrap();
    fs::write(subagents.join("child.jsonl"), "{\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":\"private old subagent history\"}}\n").unwrap();
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
    let listed = value["agents"].as_array().unwrap();
    assert_eq!(listed.len(), 4, "{body}");
    for (agent, (process, state, subdirectory)) in listed.iter().zip([
        (&harness, "waiting", "."),
        (&working, "working", "nested"),
        (&unknown, "unknown", "."),
        (&idle, "idle", "."),
    ]) {
        assert_eq!(agent["key"], format!("claude-code:{}", process.0.id()));
        assert_eq!(agent["state"], state);
        assert_eq!(agent["subdirectory"], subdirectory);
        assert_eq!(agent["isOwned"], false);
    }
    assert!(!body.contains("private-") && !body.contains("transcript"));
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
        activity_event(&mut socket, |value| value["eventType"] == "run_started" && value["pid"] == harness.0.id()).await;
        use std::io::Write;
        let mut appended = OpenOptions::new().append(true).open(&transcript).unwrap();
        let text = "🦀".repeat(1030);
        writeln!(appended, "{}", json!({"type":"user","message":{"role":"user","content":text}})).unwrap();
        let delivered = activity_event(&mut socket, |value| value["eventType"] == "turn_start").await;
        assert_eq!(delivered["pid"], harness.0.id());
        assert_eq!(delivered["text"], format!("{}…", "🦀".repeat(1024)));
        let (mut reconnected, _) = async_tungstenite::tokio::connect_async(format!(
            "ws://127.0.0.1:{port}/__devhost__/ws/agents/activity?chatTarget=project"
        )).await.unwrap();
        activity_event(&mut reconnected, |value| value["eventType"] == "run_started" && value["pid"] == harness.0.id()).await;
        writeln!(appended, "{}", json!({"type":"user","message":{"role":"user","content":"private appended after reconnect"}})).unwrap();
        for stream in [&mut socket, &mut reconnected] {
            let delivered = activity_event(stream, |value| value["eventType"] == "turn_start").await;
            assert_eq!(delivered["text"], "private appended after reconnect");
            assert_eq!(delivered["pid"], harness.0.id());
        }
        reconnected.close(None).await.unwrap();
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
    for process in [
        &harness, &working, &unknown, &idle, &sibling, &stale, &empty,
    ] {
        assert!(
            procid::is_process_alive(process.0.id() as i32),
            "discovered foreign harness was stopped"
        );
    }
    let log = fs::read_to_string(project.join("stack.log")).unwrap();
    assert!(
        !log.contains("private old history")
            && !log.contains("private appended after reconnect")
            && !log.contains('🦀')
    );
    assert!(
        read_live_stacks(&runtime.state().join("caddy"))
            .unwrap()
            .is_empty()
    );
}
