use super::*;

struct ReleaseHealth(PathBuf);

impl Drop for ReleaseHealth {
    fn drop(&mut self) {
        let _ = fs::write(&self.0, "release");
    }
}

#[test]
fn reads_remain_responsive_while_restart_waits_for_http_health() {
    let runtime = Runtime::start();
    let project = runtime.root.path().join("pending-control");
    fs::create_dir(&project).unwrap();
    fs::write(
        project.join("gated-health.py"),
        r#"import http.server, os, pathlib, time
launches = pathlib.Path('launches')
with launches.open('a') as output:
    output.write(str(os.getpid()) + '\n')
generation = len(launches.read_text().splitlines())
class Health(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if generation > 1:
            pathlib.Path('health-pending').write_text('pending')
            deadline = time.monotonic() + 30
            while not pathlib.Path('release-health').exists():
                if time.monotonic() > deadline:
                    raise RuntimeError('health gate was never released')
                time.sleep(0.01)
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b'healthy')
http.server.HTTPServer(('127.0.0.1', int(os.environ['PORT'])), Health).serve_forever()
"#,
    )
    .unwrap();
    fs::write(
        project.join("devhost.toml"),
        "name='pending-control'\n[worktrees]\nenabled=false\n[devtools.configEditor]\nenabled=true\n[services.worker]\ncommand=['python3','-u','gated-health.py']\nport='auto'\n[services.worker.health]\nhttp='/'\ntimeout=60000\ninterval=200\n",
    )
    .unwrap();
    let mut process = lifecycle::launch(&runtime, &project, &[]);
    let origin = origin(&runtime, "pending-control");
    lifecycle::ready(&origin);
    thread::scope(|scope| {
        let mutation = scope.spawn(|| {
            let agent: ureq::Agent = ureq::Agent::config_builder()
                .proxy(None)
                .http_status_as_error(false)
                .timeout_global(Some(Duration::from_secs(35)))
                .build()
                .into();
            agent
                .post(format!("{origin}/__devhost__/restart-service"))
                .header("Origin", &origin)
                .header("Content-Type", "application/json")
                .send(json!({"serviceName":"worker"}).to_string())
                .unwrap()
                .status()
        });
        // Release before the scoped thread joins, including on assertion failure.
        let _release = ReleaseHealth(project.join("release-health"));
        wait_until(|| project.join("health-pending").exists());
        assert!(
            !mutation.is_finished(),
            "restart completed before health succeeded"
        );
        for _ in 0..3 {
            for endpoint in [
                "stack-info",
                "config.json",
                "stacks/self",
                "stacks",
                "config/files",
            ] {
                let started = Instant::now();
                let mut response = client()
                    .get(format!("{origin}/__devhost__/{endpoint}"))
                    .call()
                    .unwrap_or_else(|error| panic!("pending restart blocked {endpoint}: {error}"));
                assert_eq!(response.status(), 200, "{endpoint}");
                let value = response.body_mut().read_to_string().unwrap();
                if endpoint == "stacks" {
                    assert!(value.contains("pending-control"), "{value}");
                    assert!(!value.contains("Stack details unavailable"), "{value}");
                } else {
                    let value: Value = serde_json::from_str(&value).unwrap();
                    assert!(value.is_object(), "{endpoint}: {value}");
                    if endpoint == "stacks/self" {
                        assert_eq!(value["error"], "", "{value}");
                        assert_eq!(value["name"], "pending-control");
                    }
                    if endpoint == "config/files" {
                        assert!(
                            value["files"]
                                .as_array()
                                .unwrap()
                                .iter()
                                .any(|file| file["path"]
                                    == project.join("devhost.toml").to_str().unwrap()),
                            "{value}"
                        );
                    }
                }
                assert!(
                    started.elapsed() < Duration::from_secs(2),
                    "pending restart blocked {endpoint}"
                );
                assert!(
                    !mutation.is_finished(),
                    "health gate stopped holding restart"
                );
            }
        }
        fs::write(project.join("release-health"), "release").unwrap();
        assert_eq!(mutation.join().unwrap(), 200);
    });
    lifecycle::ready(&origin);
    assert_eq!(
        fs::read_to_string(project.join("launches"))
            .unwrap()
            .lines()
            .count(),
        2
    );
    lifecycle::stop(&runtime, &project, &mut process);
}
