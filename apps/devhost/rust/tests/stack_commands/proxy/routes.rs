use super::*;

fn tls_request(runtime: &Runtime, host: &str, path: &str) -> Command {
    let mut command = Command::new("curl");
    command
        .args([
            "--silent",
            "--show-error",
            "--fail",
            "--noproxy",
            "*",
            "--connect-timeout",
            "3",
            "--max-time",
            "5",
            "--cacert",
        ])
        .arg(
            runtime
                .state()
                .join("caddy/storage/pki/authorities/local/root.crt"),
        )
        .arg("--resolve")
        .arg(format!("{host}:{}:127.0.0.1", runtime.settings.https_port))
        .arg(format!(
            "https://{host}:{}{path}",
            runtime.settings.https_port
        ));
    command
}

#[test]
fn path_precedence_aliases_directory_and_unknown_sni_follow_native_routes() {
    let runtime = Runtime::start();
    let project = runtime.root.path().join("route-precedence");
    fs::create_dir(&project).unwrap();
    fs::write(
        project.join("routed-backend.py"),
        r#"import http.server, json, os
class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        body = json.dumps({'service': os.environ['ROUTE_SERVICE'], 'path': self.path}).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)
http.server.HTTPServer(('127.0.0.1', int(os.environ['PORT'])), Handler).serve_forever()
"#,
    )
    .unwrap();
    let mut manifest = "name='route-precedence'\n[worktrees]\nenabled=false\n".to_owned();
    for (service, hosts, path) in [
        ("fallback", "['routes.localhost','alias.localhost']", "/"),
        ("api", "['routes.localhost','alias.localhost']", "/api/*"),
        (
            "metrics",
            "['routes.localhost','alias.localhost']",
            "/metrics",
        ),
        ("other", "['other.localhost']", "/"),
        ("only", "['only.localhost']", "/api/*"),
    ] {
        manifest.push_str(&format!(
            "[services.{service}]\ncommand=['python3','-u','routed-backend.py']\nport='auto'\nhost={hosts}\npath={path:?}\nhealth.http='/'\n[services.{service}.env]\nROUTE_SERVICE={service:?}\n"
        ));
    }
    fs::write(project.join("devhost.toml"), &manifest).unwrap();

    let invalid = runtime.root.path().join("overlapping-routes");
    fs::create_dir(&invalid).unwrap();
    fs::write(
        invalid.join("devhost.toml"),
        "name='overlapping-routes'\n[services.api]\ncommand=['true']\nport='auto'\nhost='routes.localhost'\npath='/api/*'\n[services.nested]\ncommand=['true']\nport='auto'\nhost='routes.localhost'\npath='/api/v2/*'\n",
    )
    .unwrap();
    let rejected = runtime
        .command()
        .current_dir(&invalid)
        .args(["service", "list"])
        .output()
        .unwrap();
    assert!(!rejected.status.success(), "{rejected:?}");
    let error = String::from_utf8(rejected.stderr).unwrap();
    assert!(error.contains("overlaps another routed service"), "{error}");
    assert!(
        read_live_stack_owners(&runtime.state().join("caddy"))
            .unwrap()
            .is_empty()
    );

    let mut process = launch(&runtime, &project, &[]);
    ready(&control::origin(&runtime, "route-precedence"));
    let url = format!("http://127.0.0.1:{}", runtime.settings.http_port);
    let mut expected = Vec::new();
    for host in ["routes.localhost", "alias.localhost"] {
        for (path, service) in [
            ("/", "fallback"),
            ("/api", "fallback"),
            ("/api/", "api"),
            ("/api/v2/items?limit=2", "api"),
            ("/apix/items", "fallback"),
            ("/metrics", "metrics"),
            ("/metrics/", "fallback"),
        ] {
            expected.push((host, path, service));
        }
    }
    expected.extend([
        ("other.localhost", "/api/v2/items?limit=2", "other"),
        ("only.localhost", "/api/v2/items?limit=2", "only"),
    ]);
    for &(host, path, service) in &expected {
        let mut response = control::client()
            .get(format!("{url}{path}"))
            .header("Host", host)
            .call()
            .unwrap();
        assert_eq!(response.status(), 200, "{host}{path}");
        let value = control::body(&mut response);
        assert_eq!(
            value,
            json!({"service":service,"path":path}),
            "{host}{path}"
        );
        // The first request can precede asynchronous certificate issuance.
        let deadline = Instant::now() + Duration::from_secs(15);
        let output = loop {
            let output = tls_request(&runtime, host, path).output().unwrap();
            if output.status.success() {
                break output;
            }
            assert!(Instant::now() < deadline, "{host}{path}: {output:?}");
            thread::sleep(Duration::from_millis(20));
        };
        assert_eq!(
            serde_json::from_slice::<Value>(&output.stdout).unwrap(),
            value,
            "{host}{path}"
        );
    }
    for (host, path) in [("only.localhost", "/"), ("unknown.localhost", "/api/items")] {
        assert_eq!(
            control::client()
                .get(format!("{url}{path}"))
                .header("Host", host)
                .call()
                .unwrap()
                .status(),
            404,
            "{host}{path}"
        );
    }
    for host in ["routes.localhost", "alias.localhost"] {
        let mut response = control::client()
            .get(format!("{url}/__devhost__/stack-info"))
            .header("Host", host)
            .call()
            .unwrap();
        assert_eq!(response.status(), 403);
        assert!(
            response
                .body_mut()
                .read_to_string()
                .unwrap()
                .contains("loopback")
        );
    }
    let mut directory = control::client()
        .get(format!("{url}/"))
        .header("Host", "devhost.localhost")
        .call()
        .unwrap();
    assert_eq!(directory.status(), 200);
    assert_eq!(directory.headers()["cache-control"], "no-store");
    assert!(
        directory
            .body_mut()
            .read_to_string()
            .unwrap()
            .contains("route-precedence")
    );
    assert_eq!(
        control::client()
            .get(format!("{url}/private"))
            .header("Host", "devhost.localhost")
            .call()
            .unwrap()
            .status(),
        404
    );
    assert_eq!(
        control::client()
            .post(format!("{url}/"))
            .header("Host", "devhost.localhost")
            .send_empty()
            .unwrap()
            .status(),
        405
    );
    let unknown = tls_request(&runtime, "unknown.localhost", "/")
        .output()
        .unwrap();
    assert_eq!(
        unknown.status.code(),
        Some(35),
        "unknown SNI must fail TLS rather than only HTTP or CA validation: {unknown:?}"
    );
    assert!(unknown.stdout.is_empty());
    stop(&runtime, &project, &mut process);
    assert_eq!(
        control::client()
            .get(format!("{url}/"))
            .header("Host", "routes.localhost")
            .call()
            .unwrap()
            .status(),
        404
    );
}
