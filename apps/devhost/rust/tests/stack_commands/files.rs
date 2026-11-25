use super::*;

#[path = "files/ranges.rs"]
mod ranges;

fn client() -> ureq::Agent {
    ureq::Agent::config_builder()
        .proxy(None)
        .http_status_as_error(false)
        .timeout_global(Some(Duration::from_secs(5)))
        .max_redirects(0)
        .build()
        .into()
}

fn request(runtime: &Runtime, path: &str) -> ureq::http::Response<ureq::Body> {
    client()
        .get(format!(
            "http://127.0.0.1:{}{path}",
            runtime.settings.http_port
        ))
        .header("Host", "restart-serve.localhost")
        .call()
        .unwrap()
}

#[test]
fn file_sessions_preserve_http_ranges_conditions_and_live_content() {
    let runtime = Runtime::start();
    let _process = runtime.start_serve();
    wait_until(|| runtime.serve_response().as_deref() == Some("preserved serve session"));
    let root = runtime.root.path().join("served files");
    fs::write(root.join("note.txt"), "0123456789").unwrap();
    let mut response = request(&runtime, "/note.txt");
    assert_eq!(response.status(), 200);
    assert_eq!(
        response.headers()["content-type"],
        "text/plain; charset=utf-8"
    );
    assert_eq!(response.headers()["content-length"], "10");
    let modified = response.headers()["last-modified"].clone();
    assert_eq!(response.body_mut().read_to_string().unwrap(), "0123456789");
    let url = format!("http://127.0.0.1:{}/note.txt", runtime.settings.http_port);
    ranges::check(&runtime, modified.to_str().unwrap());
    let mut response = client()
        .get(&url)
        .header("Host", "restart-serve.localhost")
        .header("If-Modified-Since", modified)
        .call()
        .unwrap();
    assert_eq!(response.status(), 304);
    assert!(response.body_mut().read_to_vec().unwrap().is_empty());
    fs::write(root.join("note.txt"), "edited").unwrap();
    let mut response = client()
        .head(&url)
        .header("Host", "restart-serve.localhost")
        .call()
        .unwrap();
    assert_eq!(response.status(), 200);
    assert_eq!(response.headers()["content-length"], "6");
    assert!(response.body_mut().read_to_vec().unwrap().is_empty());
    assert_eq!(
        request(&runtime, "/note.txt")
            .body_mut()
            .read_to_string()
            .unwrap(),
        "edited"
    );
}

#[test]
fn file_sessions_pin_roots_hide_private_paths_and_render_shared_pages() {
    let runtime = Runtime::start();
    let _process = runtime.start_serve();
    wait_until(|| runtime.serve_response().as_deref() == Some("preserved serve session"));
    let root = runtime.root.path().join("served files");
    let outside = runtime.root.path().join("private");
    fs::create_dir(&outside).unwrap();
    fs::write(outside.join("secret.txt"), "private content").unwrap();
    fs::write(root.join(".hidden"), "private content").unwrap();
    symlink(&outside, root.join("escape")).unwrap();
    fs::create_dir(root.join("listing")).unwrap();
    fs::write(root.join("listing/a & b.txt"), "listed content").unwrap();
    fs::write(root.join("listing/.secret"), "private content").unwrap();
    fs::write(
        root.join("README.md"),
        "# Markdown index\n\n[Unsafe](javascript:alert(1))",
    )
    .unwrap();
    assert_eq!(
        request(&runtime, "/").body_mut().read_to_string().unwrap(),
        "preserved serve session"
    );
    for path in [
        "/.hidden",
        "/escape/secret.txt",
        "/listing/.secret",
        "/%2e%2e/private/secret.txt",
    ] {
        let mut response = request(&runtime, path);
        assert_eq!(response.status(), 404, "{path}");
        assert!(
            !response
                .body_mut()
                .read_to_string()
                .unwrap()
                .contains("private content")
        );
    }
    fs::remove_file(root.join("index.html")).unwrap();
    let mut response = request(&runtime, "/");
    assert_eq!(response.status(), 200);
    let body = response.body_mut().read_to_string().unwrap();
    assert!(body.contains("# Markdown index"));
    assert!(
        body.contains("id=\"devhost-status-data\""),
        "missing shared page bootstrap"
    );
    let mut response = request(&runtime, "/listing/");
    assert_eq!(response.status(), 200);
    let body = response.body_mut().read_to_string().unwrap();
    assert!(
        body.contains("a &amp; b.txt") || body.contains("a & b.txt"),
        "missing listed filename"
    );
    assert!(!body.contains(".secret"));
    let moved = runtime.root.path().join("pinned");
    fs::rename(&root, &moved).unwrap();
    symlink(&outside, &root).unwrap();
    assert_eq!(
        request(&runtime, "/listing/a%20%26%20b.txt")
            .body_mut()
            .read_to_string()
            .unwrap(),
        "listed content"
    );
    assert_eq!(request(&runtime, "/secret.txt").status(), 404);
}
