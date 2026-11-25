use super::server::ControlServer;
use crate::services::{
    control::{RuntimeControl, RuntimeHandle, RuntimeRequest},
    resolve::{PortResolutionOptions, ResolvedManifest, resolve_service_ports},
};
use async_tungstenite::{tokio::connect_async, tungstenite::Message};
use futures_util::StreamExt;
use serde_json::{Value, json};
use std::{fs, path::Path, thread, time::Duration};

struct Fixture {
    // Stop the listener and sampler before removing their configuration directory.
    server: ControlServer,
    handle: RuntimeHandle,
    control: Option<RuntimeControl>,
    manifest: ResolvedManifest,
    root: tempfile::TempDir,
}

impl Fixture {
    fn new() -> Self {
        let root = tempfile::tempdir().unwrap();
        fs::write(root.path().join("devhost.toml"), "name='controls'\n[devtools.configEditor]\nenabled=true\n[devtools.resources]\npollInterval='250ms'\n[services.web]\ncommand=['sleep','30']\nhealth.process=true\n[services.optional]\ncommand=['sleep','30']\nhealth.process=true\n").unwrap();
        let config = crate::manifest::read_manifest(root.path(), None).unwrap();
        let manifest = resolve_service_ports(
            &config,
            &PortResolutionOptions {
                requested: vec!["web".to_owned()],
                ..Default::default()
            },
        )
        .unwrap();
        let (handle, control) = RuntimeControl::channel();
        handle.live.initialize(&manifest);
        handle.live.configure(root.path(), None);
        handle
            .live
            .set_config_path(Some(root.path().join("config.toml")));
        crate::caddy::files::write_applied_settings(root.path(), &Default::default()).unwrap();
        let server = ControlServer::start(handle.clone()).unwrap();
        Self {
            server,
            handle,
            control: Some(control),
            manifest,
            root,
        }
    }

    fn request(
        &self,
        method: &str,
        path: &str,
        body: &str,
        headers: &[(&str, &str)],
    ) -> (u16, String) {
        http(self.server.port(), method, path, body, headers)
    }

    fn json(&self, path: &str, body: Value) -> (u16, Value) {
        let (status, body) = self.request(
            "POST",
            path,
            &body.to_string(),
            &[("content-type", "application/json")],
        );
        (
            status,
            serde_json::from_str(&body).unwrap_or_else(|_| json!({"error":body})),
        )
    }

    fn validate_candidates(&mut self) -> thread::JoinHandle<()> {
        let control = self.control.take().unwrap();
        let root = self.root.path().join("devhost.toml");
        thread::spawn(move || {
            while let Ok(RuntimeRequest::CheckConfig {
                path,
                content,
                result,
            }) = control.requests.recv_timeout(Duration::from_millis(500))
            {
                let validation =
                    crate::manifest::read_with_override_env(&root, &path, &content, None)
                        .map(|_| ())
                        .map_err(|e| e.message);
                let _ = result.send(validation);
            }
        })
    }
}

fn http(
    port: u16,
    method: &str,
    path: &str,
    body: &str,
    headers: &[(&str, &str)],
) -> (u16, String) {
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .proxy(None)
        .http_status_as_error(false)
        .timeout_global(Some(Duration::from_secs(3)))
        .build()
        .into();
    let url = format!("http://127.0.0.1:{port}/__devhost__/{path}");
    let mut request = http::Request::builder().method(method).uri(url);
    for (key, value) in headers {
        request = request.header(*key, *value);
    }
    let request = request.body(body.to_owned()).unwrap();
    let mut response = agent.run(request).unwrap();
    let status = response.status().as_u16();
    let body = response.body_mut().read_to_string().unwrap();
    (status, body)
}

#[test]
fn configuration_editor_creates_private_machine_config_directory_on_first_save() {
    use std::os::unix::fs::PermissionsExt;
    let mut fixture = Fixture::new();
    let path = fixture.root.path().join("new/config/devhost/config.toml");
    fixture.handle.live.set_config_path(Some(path.clone()));
    let worker = fixture.validate_candidates();
    let (status, saved) = fixture.json(
        "config/save",
        json!({"path":path,"content":"domainSuffix='localhost'\n","baseVersion":""}),
    );
    assert_eq!(status, 200, "{saved}");
    assert_eq!(
        fs::read_to_string(&path).unwrap(),
        "domainSuffix='localhost'\n"
    );
    assert_eq!(
        fs::metadata(&path).unwrap().permissions().mode() & 0o777,
        0o600
    );
    for directory in ["new", "new/config", "new/config/devhost"] {
        assert_eq!(
            fs::metadata(fixture.root.path().join(directory))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o700
        );
    }
    worker.join().unwrap();
}

#[test]
fn configuration_editor_checks_versions_validation_permissions_and_disabled_state() {
    let mut fixture = Fixture::new();
    let worker = fixture.validate_candidates();
    let path = fixture.root.path().join("devhost.toml");
    let original = fs::read_to_string(&path).unwrap();
    let (status, body) = fixture.request("GET", "config/files", "", &[]);
    assert_eq!(status, 200);
    let files: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(files["files"].as_array().unwrap().len(), 2);
    let version = files["files"][0]["version"].as_str().unwrap();
    assert_eq!(version.len(), 64);
    assert_eq!(files["files"][1]["version"], "");
    let (status, body) = fixture.request("GET", "config/schema", "", &[]);
    assert_eq!(status, 200);
    let schema: Value = serde_json::from_str(&body).unwrap();
    assert!(
        schema["manifest"]["tables"]["services.*"]
            .as_array()
            .unwrap()
            .contains(&json!("command"))
    );
    assert_eq!(fixture.request("POST", "config/save", "{}", &[]).0, 415);
    assert_eq!(
        fixture
            .request(
                "POST",
                "config/save",
                "{}",
                &[("origin", "http://evil.test")]
            )
            .0,
        403
    );
    assert_eq!(fixture.request("DELETE", "config/validate", "", &[]).0, 405);
    assert_eq!(
        fixture
            .json(
                "config/validate",
                json!({"path":fixture.root.path().join("secret"),"content":""})
            )
            .0,
        403
    );
    assert_eq!(
        fixture
            .json(
                "config/validate",
                json!({"path":path,"content":"","unknown":true})
            )
            .0,
        400
    );
    let (status, syntax) =
        fixture.json("config/validate", json!({"path":path,"content":"name = ["}));
    assert_eq!(status, 200);
    assert_eq!(syntax["issues"][0]["line"], 1);
    let (_, invalid) = fixture.json(
        "config/validate",
        json!({"path":path,"content":"name='changed'\n[services.web]\nwat=true"}),
    );
    assert!(!invalid["issues"].as_array().unwrap().is_empty());
    assert_eq!(invalid["issues"][0]["keyPath"], "services.web.wat");
    let candidate = original.replace("name='controls'", "name='changed'");
    let (_, valid) = fixture.json("config/validate", json!({"path":path,"content":candidate}));
    assert_eq!(valid["issues"], json!([]));
    assert_eq!(fs::read_to_string(&path).unwrap(), original);
    let (_, conflict) = fixture.json(
        "config/save",
        json!({"path":path,"content":candidate,"baseVersion":"stale"}),
    );
    assert_eq!(conflict["content"], original);
    assert_eq!(conflict["version"], version);
    let (status, _) = fixture.json(
        "config/save",
        json!({"path":path,"content":"name=[","baseVersion":version}),
    );
    assert_eq!(status, 422);
    assert_eq!(
        fixture
            .request(
                "POST",
                "config/save",
                &json!({"path":path,"content":candidate,"baseVersion":version}).to_string(),
                &[
                    ("content-type", "application/json"),
                    ("x-forwarded-for", "192.0.2.1")
                ]
            )
            .0,
        403
    );
    let (status, saved) = fixture.json(
        "config/save",
        json!({"path":path,"content":candidate,"baseVersion":version}),
    );
    assert_eq!(status, 200);
    assert_ne!(saved["version"], version);
    assert_eq!(fs::read_to_string(&path).unwrap(), candidate);
    assert_eq!(fs::read_dir(fixture.root.path()).unwrap().count(), 2);
    fixture.manifest.devtools.config_editor_enabled = false;
    fixture.handle.live.update_manifest(&fixture.manifest);
    assert_eq!(fixture.request("GET", "config/files", "", &[]).0, 404);
    worker.join().unwrap();
    fixture.manifest.devtools.config_editor_enabled = true;
    fixture.handle.live.update_manifest(&fixture.manifest);
    let (status, unavailable) =
        fixture.json("config/validate", json!({"path":path,"content":candidate}));
    assert_eq!(status, 200);
    assert_eq!(
        unavailable["issues"][0]["message"],
        "devhost is shutting down"
    );
    assert_eq!(
        fixture
            .json("start-service", json!({"serviceNames":["optional"]}))
            .0,
        500
    );
    assert_eq!(fixture.request("POST", "restart-stack", "", &[]).0, 500);
}

#[test]
fn snapshot_guards_and_reads_are_independent_of_pending_mutations() {
    let fixture = Fixture::new();
    let port = fixture.server.port();
    let mutation = thread::spawn(move || {
        http(
            port,
            "POST",
            "start-service",
            r#"{"serviceNames":["optional"]}"#,
            &[("content-type", "application/json")],
        )
    });
    let RuntimeRequest::Start { names, result } = fixture
        .control
        .as_ref()
        .unwrap()
        .requests
        .recv_timeout(Duration::from_secs(2))
        .unwrap()
    else {
        panic!("expected start")
    };
    assert_eq!(names, ["optional"]);
    let (status, body) = fixture.request("GET", "stack-info", "", &[]);
    assert_eq!(status, 200);
    let snapshot: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(snapshot["services"][1]["state"], "not-started");
    assert_eq!(
        fixture.request("HEAD", "stack-info", "", &[]),
        (200, String::new())
    );
    for (method, headers, status) in [
        ("GET", vec![("host", "evil.test")], 403),
        ("GET", vec![("origin", "http://evil.test")], 403),
        (
            "GET",
            vec![("x-forwarded-for", "127.0.0.1, 192.0.2.1")],
            403,
        ),
        ("DELETE", vec![], 405),
    ] {
        assert_eq!(
            fixture.request(method, "stack-info", "", &headers).0,
            status
        );
    }
    assert_eq!(fixture.request("GET", "stacks/self", "", &[]).0, 200);
    assert_eq!(
        fixture
            .request(
                "GET",
                "stacks/self",
                "",
                &[("sec-fetch-site", "cross-site")]
            )
            .0,
        403
    );
    assert_eq!(
        fixture
            .request(
                "GET",
                "stacks/self",
                "",
                &[
                    ("sec-fetch-site", "cross-site"),
                    ("sec-fetch-mode", "navigate")
                ]
            )
            .0,
        200
    );
    assert_eq!(fixture.request("GET", "stacks", "", &[]).0, 200);
    result.send(Ok(())).unwrap();
    assert_eq!(mutation.join().unwrap().0, 204);
    let port = fixture.server.port();
    let restart = thread::spawn(move || http(port, "POST", "restart-stack", "", &[]));
    let RuntimeRequest::RestartStack { result } = fixture
        .control
        .as_ref()
        .unwrap()
        .requests
        .recv_timeout(Duration::from_secs(2))
        .unwrap()
    else {
        panic!("expected stack restart")
    };
    result.send(Err("restart rejected".to_owned())).unwrap();
    assert_eq!(restart.join().unwrap().0, 500);
}

#[test]
fn directory_aggregates_registered_owners_filters_details_and_enforces_remote_policy() {
    use crate::caddy::{files::write_applied_settings, stacks::*};
    let mut fixture = Fixture::new();
    fixture.manifest.services.get_mut("web").unwrap().hosts = vec!["control.test".to_owned()];
    fixture.manifest.services.get_mut("web").unwrap().port = Some(fixture.server.port());
    fixture.manifest.services.get_mut("web").unwrap().path = Some("/".to_owned());
    fixture.handle.live.update_manifest(&fixture.manifest);
    fixture.handle.live.finish_startup();
    let mut owner = RegisterStackOptions {
        stack_id: String::new(),
        daemon_socket: String::new(),
        remote: false,
        log_path: String::new(),
        control_port: fixture.server.port(),
        manifest_files: Vec::new(),
        manifest_path: fixture
            .root
            .path()
            .join("devhost.toml")
            .display()
            .to_string(),
        stack_name: "registered-owner".to_owned(),
    };
    register_stack(fixture.root.path(), &owner).unwrap();
    let page = |body: &str| -> Value {
        let data = body
            .split("<script id=\"devhost-status-data\" type=\"application/json\">")
            .nth(1)
            .unwrap();
        serde_json::from_str(data.split("</script>").next().unwrap().trim()).unwrap()
    };
    for query in ["CONTROLS", "control.test", "optional", "config.toml"] {
        let (status, body) = fixture.request("GET", &format!("stacks?q={query}"), "", &[]);
        assert_eq!(status, 200);
        assert_eq!(page(&body)["stacks"][0]["name"], "controls", "{query}");
        assert!(body.contains("File does not exist; defaults apply."));
    }
    let (status, body) = fixture.request("GET", "stacks?q=not-present", "", &[]);
    assert_eq!(status, 200);
    assert!(body.contains("No matching stacks."));
    for path in ["stacks", "stacks/self"] {
        assert_eq!(fixture.request("HEAD", path, "", &[]), (200, String::new()));
        assert_eq!(fixture.request("DELETE", path, "", &[]).0, 405);
        assert_eq!(
            fixture
                .request("GET", path, "", &[("origin", "http://evil.test")])
                .0,
            403
        );
        assert_eq!(
            fixture
                .request("GET", path, "", &[("x-forwarded-for", "192.0.2.1")])
                .0,
            403
        );
    }
    let settings = crate::config::CaddySettings {
        stack_directory_allow_remote: true,
        ..Default::default()
    };
    write_applied_settings(fixture.root.path(), &settings).unwrap();
    let host = settings.stack_directory_hostname();
    let remote = [("host", host), ("x-forwarded-for", "192.0.2.1")];
    assert_eq!(fixture.request("GET", "stacks", "", &remote).0, 200);
    assert_eq!(fixture.request("GET", "stacks/self", "", &remote).0, 403);
    assert_eq!(
        fixture
            .request("GET", "stacks", "", &[("host", "evil.test")])
            .0,
        403
    );
    owner.control_port = 0;
    register_stack(fixture.root.path(), &owner).unwrap();
    let (_, unavailable) = fixture.request("GET", "stacks", "", &[]);
    assert!(unavailable.contains("registered-owner"));
    assert!(unavailable.contains("Stack details unavailable: control server is not available"));
    owner.control_port = fixture.server.port();
    register_stack(fixture.root.path(), &owner).unwrap();
    fs::write(
        fixture.root.path().join("config.toml"),
        vec![b'x'; (1 << 20) + 1],
    )
    .unwrap();
    let (_, self_details) = fixture.request("GET", "stacks/self", "", &[]);
    let self_details: Value = serde_json::from_str(&self_details).unwrap();
    assert!(
        self_details["configs"][1]["error"]
            .as_str()
            .unwrap()
            .contains("too large")
    );
    fs::write(fixture.root.path().join("applied.json"), "invalid").unwrap();
    assert_eq!(fixture.request("GET", "stacks", "", &[]).0, 503);
    fs::remove_file(fixture.root.path().join("applied.json")).unwrap();
    assert_eq!(fixture.request("GET", "stacks", "", &[]).0, 503);
    write_applied_settings(fixture.root.path(), &settings).unwrap();
    let record = fs::read_dir(fixture.root.path().join("stacks"))
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .find(|path| {
            path.extension()
                .is_some_and(|extension| extension == "json")
        })
        .unwrap();
    fs::write(record, "invalid").unwrap();
    assert_eq!(fixture.request("GET", "stacks", "", &[]).0, 503);
}

type Socket = async_tungstenite::WebSocketStream<async_tungstenite::tokio::ConnectStream>;
async fn websocket(port: u16, path: &str) -> Socket {
    connect_async(format!("ws://127.0.0.1:{port}/__devhost__/{path}"))
        .await
        .unwrap()
        .0
}
async fn message(socket: &mut Socket) -> Message {
    tokio::time::timeout(Duration::from_secs(3), socket.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap()
}
async fn payload(socket: &mut Socket) -> Value {
    serde_json::from_str(message(socket).await.to_text().unwrap()).unwrap()
}

async fn closing_message(socket: &mut Socket) -> Message {
    // Updates sent before shutdown remain ordered ahead of the close frame.
    tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            let received = message(socket).await;
            if !received.is_text() {
                return received;
            }
        }
    })
    .await
    .expect("websocket did not close within the shutdown deadline")
}

#[test]
fn websocket_streams_deliver_retained_logs_health_cursor_resources_and_close_on_reload() {
    let fixture = Fixture::new();
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    runtime.block_on(async {
        fixture.handle.live.record_log("web", "stdout", "ready");
        let mut logs = websocket(fixture.server.port(), "ws/logs").await;
        let initial = payload(&mut logs).await;
        assert_eq!(initial["type"], "snapshot");
        assert_eq!(initial["entries"][0]["serviceName"], "web");
        fixture.handle.live.record_log("web", "stderr", "failed");
        assert_eq!(payload(&mut logs).await["entry"]["stream"], "stderr");
        let mut health = websocket(fixture.server.port(), "ws/health").await;
        let initial = payload(&mut health).await;
        assert_eq!(initial["services"][0]["name"], "web");
        assert_eq!(initial["stoppedServices"][0]["name"], "optional");
        let selected = fixture.root.path().join("selected");
        fixture
            .handle
            .live
            .repositories(vec![crate::devtools::WorktreeRepository {
                configured_path: fixture.root.path().display().to_string(),
                selected_path: selected.display().to_string(),
                service_names: vec!["web".to_owned()],
                ..Default::default()
            }]);
        fixture
            .control
            .as_ref()
            .unwrap()
            .dirty
            .lock()
            .unwrap()
            .insert("web".to_owned());
        super::streams::publish_health(&fixture.handle)
            .await
            .unwrap();
        let updated = payload(&mut health).await;
        assert_eq!(updated["services"][0]["dirty"], true);
        assert_eq!(
            updated["services"][0]["projectRootPath"],
            selected.display().to_string()
        );
        assert_eq!(updated["repositories"][0]["serviceNames"], json!(["web"]));
        fixture.handle.live.failed("web", "failure");
        fixture
            .handle
            .live
            .configuration_reloaded("manifest", "invalid edit");
        let updated = payload(&mut health).await;
        assert_eq!(updated["configuration"][0]["error"], "invalid edit");
        let mut cursor = websocket(fixture.server.port(), "ws/react-highlight").await;
        assert_eq!(
            fixture
                .json("react-highlight/cursor", json!({"locator":"src/app.tsx:2"}))
                .0,
            200
        );
        let update = payload(&mut cursor).await;
        assert_eq!(update["locator"], "src/app.tsx:2");
        assert_eq!(update["stackName"], "controls");
        assert_eq!(
            fixture
                .json("react-highlight/cursor", json!({"locator":""}))
                .0,
            400
        );
        let mut resources = websocket(fixture.server.port(), "ws/resources").await;
        let mut reading = payload(&mut resources).await;
        while reading.get("memory").is_none() {
            reading = payload(&mut resources).await;
        }
        assert!(reading["memory"]["totalBytes"].as_u64().unwrap() > 0);
        assert!(reading["memory"]["percent"].as_f64().unwrap() <= 100.0);
        assert!(reading["cpu"]["cores"].as_u64().unwrap() > 0);
        let mut disabled = fixture.manifest.clone();
        disabled.devtools.resources.enabled = false;
        fixture.handle.live.update_manifest(&disabled);
        let Message::Close(Some(close)) = closing_message(&mut resources).await else {
            panic!("expected disabled close")
        };
        assert_eq!(u16::from(close.code), 1000);
        assert!(
            connect_async(format!(
                "ws://127.0.0.1:{}/__devhost__/ws/resources",
                fixture.server.port()
            ))
            .await
            .is_err()
        );
        fixture.handle.live.events.stopping.send_replace(true);
        for socket in [&mut logs, &mut health, &mut cursor] {
            let Message::Close(Some(close)) = closing_message(socket).await else {
                panic!("expected shutdown close")
            };
            assert_eq!(u16::from(close.code), 1001);
        }
    });
}

#[test]
fn control_cross_origin_checks_match_safe_methods_and_legacy_origin_fallback() {
    use axum::http::{HeaderMap, HeaderValue, Method};
    let mut headers = HeaderMap::new();
    headers.insert("origin", HeaderValue::from_static("https://localhost:4400"));
    assert!(
        super::request_guard::check_cross_origin(&Method::POST, &headers, "localhost:4400", None)
            .is_ok()
    );
    assert!(
        super::request_guard::check_cross_origin(&Method::POST, &headers, "LOCALHOST:4400", None)
            .is_err()
    );
    headers.insert("sec-fetch-site", HeaderValue::from_static(""));
    assert!(
        super::request_guard::check_cross_origin(&Method::POST, &headers, "localhost:4400", None)
            .is_ok()
    );
    headers.insert("sec-fetch-site", HeaderValue::from_static("cross-site"));
    assert!(
        super::request_guard::check_cross_origin(&Method::POST, &headers, "localhost:4400", None)
            .is_err()
    );
    headers.insert("upgrade", HeaderValue::from_static("websocket"));
    headers.insert("connection", HeaderValue::from_static("upgrade"));
    assert!(
        super::request_guard::check_cross_origin(&Method::GET, &headers, "localhost:4400", None)
            .is_ok()
    );
}

#[test]
fn configuration_diagnostics_identify_the_setting_to_highlight() {
    for (issue, expected) in [
        ("manifest Unrecognized key: \"extra\"", "extra"),
        ("services.web Unrecognized key: \"wat\"", "services.web.wat"),
        (
            "services.web.port Expected an integer.",
            "services.web.port",
        ),
        (
            "devtools.resources.*.enabled Expected a boolean.",
            "devtools.resources.*.enabled",
        ),
        ("services..port Expected an integer.", ""),
        ("services.*.port. Expected an integer.", ""),
        ("unknown.value is invalid", ""),
        ("manifest must be a table", ""),
        ("Cannot read manifest", ""),
    ] {
        assert_eq!(
            crate::manifest::validation::issue_key_path(issue),
            expected,
            "{issue}"
        );
    }
    for (issue, expected) in [
        ("Unrecognized key: \"remote.extra\"", "remote.extra"),
        ("Unrecognized key: broken", ""),
        ("caddy.httpsPort Expected an integer.", "caddy.httpsPort"),
        ("remote.serverURL is invalid", ""),
    ] {
        assert_eq!(crate::config::issue_key_path(issue), expected, "{issue}");
    }
}

#[test]
fn configuration_file_replacement_preserves_symlink_and_permissions() {
    let root = tempfile::tempdir().unwrap();
    let target = root.path().join("real.toml");
    fs::write(&target, "old").unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::{PermissionsExt, symlink};
        fs::set_permissions(&target, fs::Permissions::from_mode(0o640)).unwrap();
        let link = root.path().join("link.toml");
        symlink(&target, &link).unwrap();
        super::config_files::write_file(&link, b"new").unwrap();
        assert!(link.is_symlink());
        assert_eq!(fs::read_to_string(&target).unwrap(), "new");
        assert_eq!(
            fs::metadata(&target).unwrap().permissions().mode() & 0o777,
            0o640
        );
    }
    let missing = root.path().join("missing.toml");
    assert_eq!(
        super::config_files::read_file(missing, "config")
            .unwrap()
            .version,
        ""
    );
    assert!(super::resources::space(0, 0).is_err());
    assert_eq!(super::resources::space(50, 100).unwrap()["percent"], 50.0);
    assert!(
        super::resource_disk::read().unwrap()["totalBytes"]
            .as_u64()
            .unwrap()
            > 0
    );
    let stack: crate::statuspage::Stack =
        serde_json::from_value(json!({"services":[{"urls":null}],"configs":null})).unwrap();
    assert!(stack.services[0].urls.is_empty());
    assert!(stack.configs.is_empty());
    assert!(Path::new(&stack.directory).as_os_str().is_empty());
    let directory = root.path().join("directory.toml");
    fs::create_dir(&directory).unwrap();
    assert!(super::config_files::read_file(directory.clone(), "config").is_err());
    assert!(super::config_files::write_file(&directory, b"replacement").is_err());
    assert!(directory.is_dir());
    super::config_files::write_file(&root.path().join("absent/config.toml"), b"replacement")
        .unwrap();
    assert_eq!(
        fs::read(root.path().join("absent/config.toml")).unwrap(),
        b"replacement"
    );
    assert_eq!(
        fs::read_dir(root.path()).unwrap().count(),
        if cfg!(unix) { 4 } else { 3 }
    );
}

#[test]
fn routed_configuration_and_assets_follow_live_feature_settings() {
    let mut fixture = Fixture::new();
    let mut database = fixture.manifest.services["web"].clone();
    database.name = "database".to_owned();
    database.hosts = vec!["database.test".to_owned()];
    database.path = Some("/db/*".to_owned());
    fixture
        .manifest
        .services
        .insert(database.name.clone(), database);
    let web = fixture.manifest.services.get_mut("web").unwrap();
    web.hosts = vec!["web.test".to_owned(), "alias.test".to_owned()];
    web.depends_on = vec!["database".to_owned()];
    fixture.handle.live.update_manifest(&fixture.manifest);
    let config = super::configuration::injected_config(&fixture.handle);
    assert_eq!(config.routed_services[0].host, "alias.test");
    assert_eq!(config.routed_services[0].dependencies, ["database"]);
    assert_eq!(config.routed_services[1].path, "/db/*");
    assert!(super::configuration::injects(&fixture.manifest, "web"));
    assert!(!super::configuration::injects(
        &fixture.manifest,
        "database"
    ));
    assert!(!super::configuration::injects(&fixture.manifest, "missing"));
    let (status, body) = fixture.request("GET", "config.json", "", &[]);
    assert_eq!(status, 200, "{body}");
    let body: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(body["stackName"], "controls");
    assert!(body["configEditorEnabled"].as_bool().unwrap());
    fixture.manifest.devtools.config_editor_enabled = false;
    fixture.handle.live.update_manifest(&fixture.manifest);
    let (_, body) = fixture.request("GET", "config.json", "", &[]);
    let body: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(body["configEditorEnabled"], false);
    assert_eq!(
        fixture
            .request("GET", "config.json", "", &[("host", "evil.test")])
            .0,
        403
    );
}

#[test]
fn websocket_origin_checks_accept_same_origin_and_reject_foreign_origins() {
    use async_tungstenite::tungstenite::{Error, client::IntoClientRequest};
    let fixture = Fixture::new();
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    runtime.block_on(async {
        let url = format!(
            "ws://127.0.0.1:{}/__devhost__/ws/logs",
            fixture.server.port()
        );
        for (origin, allowed) in [
            (format!("http://127.0.0.1:{}", fixture.server.port()), true),
            ("https://evil.test".to_owned(), false),
        ] {
            let mut request = url.as_str().into_client_request().unwrap();
            request
                .headers_mut()
                .insert("origin", origin.parse().unwrap());
            match connect_async(request).await {
                Ok((mut socket, _)) => {
                    assert!(allowed);
                    assert_eq!(payload(&mut socket).await["type"], "snapshot");
                    socket.close(None).await.unwrap();
                }
                Err(Error::Http(response)) => {
                    assert!(!allowed);
                    assert_eq!(response.status(), 403);
                }
                Err(error) => panic!("unexpected WebSocket failure: {error}"),
            }
        }
    });
}
