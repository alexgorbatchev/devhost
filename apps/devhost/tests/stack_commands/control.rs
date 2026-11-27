use super::*;

#[path = "control/editor.rs"]
mod editor;
#[path = "control/logs.rs"]
mod logs;
#[path = "control/pending.rs"]
mod pending;
#[path = "control/resources.rs"]
mod resources;

pub(super) fn client() -> ureq::Agent {
    ureq::Agent::config_builder()
        .proxy(None)
        .http_status_as_error(false)
        .timeout_global(Some(Duration::from_secs(5)))
        .build()
        .into()
}

pub(super) fn origin(runtime: &Runtime, name: &str) -> String {
    let mut port = 0;
    wait_until(|| {
        port = read_live_stacks(&runtime.state().join("caddy"))
            .unwrap()
            .into_iter()
            .find(|stack| stack.name == name)
            .map_or(0, |stack| stack.control_port);
        port > 0
    });
    format!("http://127.0.0.1:{port}")
}

pub(super) fn get(origin: &str, path: &str) -> ureq::http::Response<ureq::Body> {
    client()
        .get(format!("{origin}/__devhost__/{path}"))
        .call()
        .unwrap()
}

pub(super) fn post(origin: &str, path: &str, value: Value) -> ureq::http::Response<ureq::Body> {
    client()
        .post(format!("{origin}/__devhost__/{path}"))
        .header("Origin", origin)
        .header("Content-Type", "application/json")
        .send(value.to_string())
        .unwrap()
}

pub(super) fn body(response: &mut ureq::http::Response<ureq::Body>) -> Value {
    serde_json::from_str(&response.body_mut().read_to_string().unwrap()).unwrap()
}

pub(super) fn reload_count(project: &Path) -> usize {
    fs::read_to_string(project.join("original.log"))
        .unwrap()
        .matches("configuration reloaded:")
        .count()
}

fn enable_editor(project: &Path, origin: &str) -> String {
    let manifest = project.join("devhost.toml");
    let content = format!(
        "{}\n[devtools.configEditor]\nenabled=true\n",
        fs::read_to_string(&manifest).unwrap()
    );
    fs::write(manifest, &content).unwrap();
    wait_until(|| get(origin, "config/files").status() == 200);
    content
}

#[test]
fn config_editor_guards_versions_validation_and_atomic_saves_match() {
    let runtime = Runtime::start();
    let (project, _process) = runtime.start_stack("config-contract", false);
    let origin = origin(&runtime, "config-contract");
    assert_eq!(get(&origin, "config/files").status(), 404);
    let manifest = project.join("devhost.toml");
    let include = project.join("parts/included.toml");
    fs::create_dir(include.parent().unwrap()).unwrap();
    let included_content = "[services.optional]\ncommand=['sleep','300']\nhealth.process=true\n";
    fs::write(&include, included_content).unwrap();
    fs::write(
        &manifest,
        format!(
            "includes='parts/*.toml'\n{}",
            fs::read_to_string(&manifest).unwrap()
        ),
    )
    .unwrap();
    let content = enable_editor(&project, &origin);
    wait_until(|| {
        body(&mut get(&origin, "config/files"))["files"]
            .as_array()
            .unwrap()
            .iter()
            .any(|file| file["path"] == include.to_str().unwrap())
    });
    let mut response = get(&origin, "config/files");
    assert_eq!(response.headers()["cache-control"], "no-store");
    let files = body(&mut response);
    let included = files["files"]
        .as_array()
        .unwrap()
        .iter()
        .find(|file| file["path"] == include.to_str().unwrap())
        .expect("config editor discovers manifest include files");
    assert_eq!(included["kind"], "include");
    assert_eq!(included["content"], included_content);
    assert_eq!(included["version"].as_str().unwrap().len(), 64);
    let file = files["files"]
        .as_array()
        .unwrap()
        .iter()
        .find(|file| file["path"] == manifest.to_str().unwrap())
        .unwrap();
    assert_eq!(file["kind"], "manifest");
    assert_eq!(file["content"], content);
    let version = file["version"].as_str().unwrap();
    assert_eq!(version.len(), 64);
    let mut response = get(&origin, "config/schema");
    assert_eq!(response.status(), 200);
    let schema = body(&mut response);
    assert!(schema["manifest"].is_object());
    assert!(schema["config"].is_object());
    let response = client()
        .post(format!("{origin}/__devhost__/config/save"))
        .header("Origin", "https://attacker.invalid")
        .send("{}")
        .unwrap();
    assert_eq!(response.status(), 403);
    assert_eq!(get(&origin, "config/validate").status(), 405);
    assert_eq!(
        post(
            &origin,
            "config/validate",
            json!({"path":project.join("private"),"content":""})
        )
        .status(),
        403
    );
    let mut response = post(
        &origin,
        "config/validate",
        json!({"path":manifest,"content":content}),
    );
    assert_eq!(response.status(), 200);
    assert_eq!(body(&mut response)["issues"], json!([]));
    let mut response = post(
        &origin,
        "config/validate",
        json!({"path":manifest,"content":"name = ["}),
    );
    assert_eq!(response.status(), 200);
    let issues = body(&mut response);
    assert!(!issues["issues"].as_array().unwrap().is_empty());
    assert!(issues["issues"][0]["line"].as_u64().unwrap() >= 1);
    let edited = format!("{content}\n# saved through the native editor\n");
    assert_eq!(
        post(
            &origin,
            "config/save",
            json!({"path":manifest,"content":edited,"baseVersion":"stale"})
        )
        .status(),
        409
    );
    assert_eq!(
        post(
            &origin,
            "config/save",
            json!({"path":manifest,"content":"name = [","baseVersion":version})
        )
        .status(),
        422
    );
    assert_eq!(fs::read_to_string(&manifest).unwrap(), content);
    fs::set_permissions(&manifest, fs::Permissions::from_mode(0o640)).unwrap();
    let mut response = post(
        &origin,
        "config/save",
        json!({"path":manifest,"content":edited,"baseVersion":version}),
    );
    assert_eq!(response.status(), 200);
    assert_ne!(body(&mut response)["version"], version);
    assert_eq!(fs::read_to_string(&manifest).unwrap(), edited);
    assert_eq!(
        fs::metadata(&manifest).unwrap().permissions().mode() & 0o777,
        0o640
    );
    assert_eq!(
        post(
            &origin,
            "config/save",
            json!({"path":manifest,"content":content,"baseVersion":version})
        )
        .status(),
        409
    );
    assert!(fs::read_dir(&project).unwrap().all(|entry| {
        !entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with(".tmp")
    }));
    let config_path = runtime.config.join("config.toml");
    let listener = fixture_ports::reserve_listener();
    let next_http_port = listener.local_addr().unwrap().port();
    drop(listener);
    let config_content = fs::read_to_string(&config_path).unwrap().replace(
        &format!("httpPort = {}", runtime.settings.http_port),
        &format!("httpPort = {next_http_port}"),
    );
    let discovered = body(&mut get(&origin, "config/files"));
    let machine = discovered["files"]
        .as_array()
        .unwrap()
        .iter()
        .find(|file| file["path"] == config_path.to_str().unwrap())
        .unwrap();
    assert_eq!(machine["kind"], "config");
    let mut accepted = post(
        &origin,
        "config/save",
        json!({"path":config_path,"content":config_content,"baseVersion":machine["version"]}),
    );
    assert_eq!(
        accepted.status(),
        200,
        "{}",
        accepted.body_mut().read_to_string().unwrap()
    );
    let accepted_version = body(&mut accepted)["version"].clone();
    let changed_listener = format!("http://127.0.0.1:{next_http_port}/");
    wait_until(|| {
        client()
            .get(&changed_listener)
            .call()
            .is_ok_and(|response| response.status() == 404)
    });
    wait_until(|| std::net::TcpStream::connect(("127.0.0.1", runtime.settings.http_port)).is_err());
    assert_eq!(
        post(
            &origin,
            "config/save",
            json!({"path":config_path,"content":config_content.replace(&format!("httpPort = {next_http_port}"), "httpPort = 0"),"baseVersion":accepted_version})
        )
        .status(),
        422
    );
    assert_eq!(fs::read_to_string(&config_path).unwrap(), config_content);
    assert_eq!(
        client().get(&changed_listener).call().unwrap().status(),
        404
    );
    let previous_config = runtime.root.path().join("previous-config");
    fs::rename(&runtime.config, &previous_config).unwrap();
    let response = post(
        &origin,
        "config/save",
        json!({"path":config_path,"content":config_content,"baseVersion":""}),
    );
    assert_eq!(response.status(), 200);
    assert_eq!(fs::read_to_string(&config_path).unwrap(), config_content);
    assert_eq!(
        fs::metadata(&config_path).unwrap().permissions().mode() & 0o777,
        0o600
    );
    assert_eq!(
        fs::metadata(&runtime.config).unwrap().permissions().mode() & 0o777,
        0o700
    );
}

#[test]
fn control_mutations_streams_resources_and_origin_guards_match() {
    use async_tungstenite::tungstenite::{Message, client::IntoClientRequest};
    use futures_util::StreamExt;
    let runtime = Runtime::start();
    let (project, mut process) = runtime.start_stack("control-contract", false);
    let origin = origin(&runtime, "control-contract");
    wait_until(|| {
        let snapshot = body(&mut get(&origin, "stack-info"));
        snapshot["starting"] == false
            && snapshot["services"]
                .as_array()
                .unwrap()
                .iter()
                .any(|service| service["name"] == "worker" && service["state"] == "ready")
    });
    let manifest = project.join("devhost.toml");
    let content = format!(
        "{}\n[devtools.resources]\nenabled=true\n[devtools.resources.cpu]\nenabled=true\npollInterval='250ms'\n[devtools.resources.memory]\nenabled=true\npollInterval='250ms'\n[devtools.resources.disk]\nenabled=true\npollInterval='250ms'\n",
        fs::read_to_string(&manifest).unwrap()
    );
    let before = reload_count(&project);
    fs::write(&manifest, content).unwrap();
    wait_until(|| reload_count(&project) > before);
    wait_until(|| body(&mut get(&origin, "config.json"))["resourcesEnabled"] == true);
    let mut response = get(&origin, "config.json");
    assert_eq!(response.headers()["cache-control"], "no-store");
    assert!(body(&mut response).is_object());
    assert_eq!(get(&origin, "stack-info").status(), 200);
    for path in ["start-service", "restart-service", "restart-stack"] {
        assert_eq!(get(&origin, path).status(), 405, "{path}");
        assert_eq!(
            client()
                .post(format!("{origin}/__devhost__/{path}"))
                .header("Origin", "https://attacker.invalid")
                .send("{}")
                .unwrap()
                .status(),
            403,
            "{path}"
        );
    }
    assert_eq!(post(&origin, "restart-service", json!({})).status(), 400);
    assert_eq!(post(&origin, "start-service", json!({})).status(), 400);
    let launches = || {
        fs::read_to_string(project.join("launches"))
            .unwrap()
            .lines()
            .count()
    };
    assert_eq!(launches(), 1);
    let mut response = post(&origin, "restart-service", json!({"serviceName":"worker"}));
    assert_eq!(
        response.status(),
        200,
        "{}",
        response.body_mut().read_to_string().unwrap()
    );
    wait_until(|| launches() >= 2);
    lifecycle::ready(&origin);
    assert_eq!(launches(), 2, "service restart launches exactly once");
    assert_eq!(
        post(&origin, "start-service", json!({"serviceNames":["worker"]})).status(),
        500
    );
    let before_owners = read_live_stacks(&runtime.state().join("caddy")).unwrap();
    assert_eq!(before_owners.len(), 1);
    let original_pid = before_owners[0].pid;
    let original_stack_id = before_owners[0].stack_id.clone();
    assert_eq!(post(&origin, "restart-stack", json!({})).status(), 204);
    wait_until(|| launches() >= 3);
    lifecycle::ready(&origin);
    assert_eq!(launches(), 3, "whole-stack restart launches exactly once");
    assert!(process.as_mut().unwrap().0.try_wait().unwrap().is_none());
    let owners = read_live_stacks(&runtime.state().join("caddy")).unwrap();
    assert_eq!(owners.len(), 1);
    assert_eq!(owners[0].pid, original_pid);
    assert_eq!(owners[0].stack_id, original_stack_id);
    let io = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    io.block_on(async {
        logs::verify(&project, &origin).await;
        let mut sockets = Vec::new();
        for path in ["health", "logs", "resources"] {
            let url = format!("{}/__devhost__/ws/{path}", origin.replacen("http:", "ws:", 1));
            let mut request = url.into_client_request().unwrap();
            request.headers_mut().insert("Origin", "https://attacker.invalid".parse().unwrap());
            let error = async_tungstenite::tokio::connect_async(request.clone()).await.unwrap_err();
            assert!(matches!(error, async_tungstenite::tungstenite::Error::Http(response) if response.status() == 403));
            request.headers_mut().insert("Origin", origin.parse().unwrap());
            let (mut socket, _) = async_tungstenite::tokio::connect_async(request).await.unwrap();
            loop {
                let frame = tokio::time::timeout(Duration::from_secs(5), socket.next()).await.unwrap().unwrap().unwrap();
                let Message::Text(text) = frame else { panic!("missing {path} initial snapshot") };
                let value: Value = serde_json::from_str(&text).unwrap();
                match path {
                    "health" => assert!(value["services"].as_array().unwrap().iter().any(|service| service["name"] == "worker" && service["status"] == true)),
                    "logs" => { assert_eq!(value["type"], "snapshot"); assert!(value["entries"].is_array()); },
                    _ => {
                        if value.get("disk").is_none() { continue; }
                        assert!(value["cpu"]["cores"].as_u64().unwrap() > 0);
                        assert!((0.0..=100.0).contains(&value["cpu"]["percent"].as_f64().unwrap()));
                        for resource in ["memory", "disk"] {
                            let total = value[resource]["totalBytes"].as_u64().unwrap();
                            let used = value[resource]["usedBytes"].as_u64().unwrap();
                            let percent = value[resource]["percent"].as_f64().unwrap();
                            assert!(total > 0);
                            assert!(used <= total, "{resource}: {value}");
                            assert!((0.0..=100.0).contains(&percent));
                            assert!((percent - used as f64 / total as f64 * 100.0).abs() < 0.01,
                                "{resource} percentage must use byte units: {value}");
                        }
                    }
                }
                break;
            }
            sockets.push(socket);
        }
        assert_eq!(get(&origin, "react-highlight/cursor").status(), 405);
        assert_eq!(post(&origin, "react-highlight/cursor", json!({"locator":""})).status(), 400);
        let url = format!("{}/__devhost__/ws/react-highlight", origin.replacen("http:", "ws:", 1));
        let (mut cursor, _) = async_tungstenite::tokio::connect_async(url).await.unwrap();
        cursor.send(Message::Ping(vec![1, 2, 3].into())).await.unwrap();
        assert!(matches!(tokio::time::timeout(Duration::from_secs(5), cursor.next()).await.unwrap().unwrap().unwrap(), Message::Pong(_)));
        for locator in [json!("src/App.tsx:12:3"), Value::Null] {
            assert_eq!(post(&origin, "react-highlight/cursor", json!({"locator":locator})).status(), 200);
            let frame = tokio::time::timeout(Duration::from_secs(5), cursor.next()).await.unwrap().unwrap().unwrap();
            let Message::Text(text) = frame else { panic!("missing cursor event") };
            let value: Value = serde_json::from_str(&text).unwrap();
            assert_eq!(value["kind"], "cursor");
            assert_eq!(value["locator"], locator);
            assert_eq!(value["projectRoot"], project.to_str().unwrap());
            assert!(value.get("stackName").is_none() && value.get("timestamp").is_none());
        }
        sockets.push(cursor);
        unsafe { libc::kill(process.as_mut().unwrap().0.id() as i32, libc::SIGTERM); }
        for mut socket in sockets {
            loop {
                let frame = tokio::time::timeout(Duration::from_secs(5), socket.next()).await.unwrap().unwrap().unwrap();
                if let Message::Close(Some(frame)) = frame { assert_eq!(u16::from(frame.code), 1001); break; }
            }
        }
    });
    wait_until(|| process.as_mut().unwrap().0.try_wait().unwrap().is_some());
}
