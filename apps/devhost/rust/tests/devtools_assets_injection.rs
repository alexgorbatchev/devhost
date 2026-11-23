use std::{
    collections::BTreeMap,
    fs::{self, File},
    io::Read,
    net::TcpListener as StdTcpListener,
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    thread::{self, JoinHandle},
    time::{Duration, SystemTime},
};

use axum::{
    Router,
    body::Body,
    http::{HeaderMap, HeaderValue, Method, Request, StatusCode, Uri, header},
    response::{IntoResponse, Response},
    routing::any,
};
use cli_command_kit::Mode;
use devhost_rust::{
    caddy::{
        devtools_origin::{DevtoolsRouteOwner, allows_devtools_url},
        files as caddy_files,
        routes::{ActivateRouteOptions, replace_routes},
    },
    config::CaddySettings,
    devtools::{
        INJECTED_SCRIPT_PATH, RECOVERY_HEADER, RecoveryState, Worktree, WorktreeDirectory,
        WorktreeOwner, WorktreeRepository,
        assets::{AssetStore, asset_routes, asset_version, select_asset_encoding},
        dev_source::{
            DEV_SOURCE_DIR_ENV, DevSourceCheckout, format_js_error, load_dev_source_checkout,
            resolve_dev_source_directory,
        },
        document_injection::{
            DocumentInjectionOptions, DocumentInjectionServer, inject_devtools_script,
        },
        page_preview::{page_preview_state, preview_routes},
        request_guard::{
            check_cross_origin, is_json_request, is_state_changing_request, serves_request_host,
        },
    },
    files::FileHandler,
};
use tokio::sync::oneshot;

struct TestHttpServer {
    port: u16,
    shutdown_tx: Option<oneshot::Sender<()>>,
    thread: Option<JoinHandle<()>>,
}

#[test]
fn injection_preserves_legacy_bytes_decodes_compression_and_accepts_large_documents() {
    use std::io::Write;
    let legacy = b"<html><body>caf\xe9</body></html>".to_vec();
    let mut gzip = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
    gzip.write_all(&legacy).unwrap();
    let gzip = gzip.finish().unwrap();
    let mut deflate = flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::default());
    deflate.write_all(&legacy).unwrap();
    let deflate = deflate.finish().unwrap();
    let source = legacy.clone();
    let upstream = TestHttpServer::start(Router::new().fallback(any(move |req: Request<Body>| {
        let (bytes, encoding) = match req.uri().path() {
            "/gzip" => (gzip.clone(), Some("gzip")),
            "/deflate" => (deflate.clone(), Some("deflate")),
            "/bad-gzip" => (b"bad gzip".to_vec(), Some("gzip")),
            "/unsupported" => (source.clone(), Some("br")),
            "/large" => {
                let mut bytes = vec![b'a'; 64 * 1024 * 1024 + 32];
                bytes.extend_from_slice(b"</body>");
                (bytes, None)
            }
            _ => (source.clone(), None),
        };
        async move {
            let mut response =
                Response::builder().header(header::CONTENT_TYPE, "text/html; charset=iso-8859-1");
            if let Some(encoding) = encoding {
                response = response.header(header::CONTENT_ENCODING, encoding);
            }
            response.body(Body::from(bytes)).unwrap()
        }
    })));
    let proxy = DocumentInjectionServer::start(DocumentInjectionOptions {
        backend_host: "127.0.0.1".to_owned(),
        backend_port: upstream.port,
        should_inject: Some(Arc::new(|| true)),
        get_recovery: None,
        restart: None,
        worktrees: None,
    })
    .unwrap();
    let agent = test_agent();
    let script = format!(r#"<script type="module" src="{INJECTED_SCRIPT_PATH}"></script>"#);
    let expected = [
        b"<html><body>caf\xe9".as_slice(),
        script.as_bytes(),
        b"</body></html>",
    ]
    .concat();
    for path in ["/legacy", "/gzip", "/deflate"] {
        let (status, headers, bytes) = read_response_bytes(
            agent
                .get(format!("http://127.0.0.1:{}{path}", proxy.port()))
                .call()
                .unwrap(),
        );
        assert_eq!(status, StatusCode::OK);
        assert_eq!(bytes, expected, "{path}");
        assert!(!headers.contains_key(header::CONTENT_ENCODING));
        assert_eq!(
            headers[header::CONTENT_TYPE],
            "text/html; charset=iso-8859-1"
        );
    }
    let (status, _, bytes) = read_response_bytes(
        agent
            .get(format!("http://127.0.0.1:{}/large", proxy.port()))
            .call()
            .unwrap(),
    );
    assert_eq!(status, StatusCode::OK);
    assert_eq!(bytes.len(), 64 * 1024 * 1024 + 32 + script.len() + 7);
    assert!(bytes.ends_with(format!("{script}</body>").as_bytes()));
    let (status, _, _) = read_response_bytes(
        agent
            .get(format!("http://127.0.0.1:{}/bad-gzip", proxy.port()))
            .call()
            .unwrap(),
    );
    assert_eq!(status, StatusCode::BAD_GATEWAY);
    let (_, headers, bytes) = read_response_bytes(
        agent
            .get(format!("http://127.0.0.1:{}/unsupported", proxy.port()))
            .call()
            .unwrap(),
    );
    assert_eq!(headers[header::CONTENT_ENCODING], "br");
    assert_eq!(bytes, legacy);
}

impl TestHttpServer {
    fn start(app: Router) -> Self {
        let std_listener = StdTcpListener::bind("127.0.0.1:0").expect("bind ephemeral port");
        std_listener.set_nonblocking(true).expect("set nonblocking");
        let port = std_listener.local_addr().expect("local addr").port();
        let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
        let thread = thread::spawn(move || {
            let rt = tokio::runtime::Builder::new_multi_thread()
                .worker_threads(2)
                .enable_all()
                .build()
                .expect("tokio test runtime");
            rt.block_on(async move {
                let listener =
                    tokio::net::TcpListener::from_std(std_listener).expect("tokio listener");
                let _ = axum::serve(listener, app)
                    .with_graceful_shutdown(async move {
                        let _ = shutdown_rx.await;
                    })
                    .await;
            });
        });
        Self {
            port,
            shutdown_tx: Some(shutdown_tx),
            thread: Some(thread),
        }
    }

    fn url(&self, path: &str) -> String {
        format!("http://127.0.0.1:{}{path}", self.port)
    }
}

impl Drop for TestHttpServer {
    fn drop(&mut self) {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }
        if let Some(handle) = self.thread.take() {
            let _ = handle.join();
        }
    }
}

fn test_agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(5)))
        .max_redirects(0)
        .http_status_as_error(false)
        .proxy(None)
        .build()
        .new_agent()
}

fn read_response_bytes(
    mut resp: ureq::http::Response<ureq::Body>,
) -> (StatusCode, HeaderMap, Vec<u8>) {
    let status = StatusCode::from_u16(resp.status().as_u16()).expect("valid status");
    let mut headers = HeaderMap::new();
    for (name, value) in resp.headers() {
        if let Ok(hn) = axum::http::HeaderName::from_bytes(name.as_str().as_bytes())
            && let Ok(hv) = HeaderValue::from_bytes(value.as_bytes())
        {
            headers.append(hn, hv);
        }
    }
    let mut bytes = Vec::new();
    resp.body_mut()
        .as_reader()
        .read_to_end(&mut bytes)
        .expect("read response body");
    (status, headers, bytes)
}

fn header_str<'a>(headers: &'a HeaderMap, name: &str) -> &'a str {
    headers
        .get(name)
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default()
}

fn unused_port() -> u16 {
    StdTcpListener::bind("127.0.0.1:0")
        .expect("bind port")
        .local_addr()
        .expect("addr")
        .port()
}

fn worktree_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize()
        .expect("canonicalize worktree root")
}

#[test]
fn asset_routes_and_content_negotiation() {
    let store = AssetStore::new(None, br#"{"stackName":"demo"}"#.to_vec());
    let server = TestHttpServer::start(asset_routes(store.clone()));
    let agent = test_agent();

    // Config endpoint: no-store, ETag, 304, HEAD, set_config_json, 405 on POST.
    let (status, hdrs, body) = read_response_bytes(
        agent
            .get(server.url("/__devhost__/config.json"))
            .call()
            .expect("get config"),
    );
    assert_eq!(status, StatusCode::OK);
    assert_eq!(header_str(&hdrs, "cache-control"), "no-store");
    assert_eq!(header_str(&hdrs, "vary"), "Accept-Encoding");
    assert_eq!(header_str(&hdrs, "x-content-type-options"), "nosniff");
    assert_eq!(
        header_str(&hdrs, "content-type"),
        "application/json; charset=utf-8"
    );
    assert_eq!(body, br#"{"stackName":"demo"}"#);
    let etag = header_str(&hdrs, "etag").to_owned();
    assert!(etag.starts_with('"') && etag.ends_with('"'));

    for inm in [etag.clone(), format!("W/{etag}"), "*".to_owned()] {
        let (st, _, b) = read_response_bytes(
            agent
                .get(server.url("/__devhost__/config.json"))
                .header("If-None-Match", &inm)
                .call()
                .expect("conditional config"),
        );
        assert_eq!(st, StatusCode::NOT_MODIFIED);
        assert!(b.is_empty());
    }

    let (st, head_hdrs, head_body) = read_response_bytes(
        agent
            .head(server.url("/__devhost__/config.json"))
            .call()
            .expect("head config"),
    );
    assert_eq!(st, StatusCode::OK);
    assert!(head_body.is_empty());
    assert_eq!(
        header_str(&head_hdrs, "content-length"),
        body.len().to_string()
    );

    store.set_config_json(br#"{"stackName":"updated"}"#.to_vec());
    let (_, _, updated) = read_response_bytes(
        agent
            .get(server.url("/__devhost__/config.json"))
            .call()
            .expect("get updated config"),
    );
    assert_eq!(updated, br#"{"stackName":"updated"}"#);

    let (st, post_hdrs, _) = read_response_bytes(
        agent
            .post(server.url("/__devhost__/config.json"))
            .send_empty()
            .expect("post config"),
    );
    assert_eq!(st, StatusCode::METHOD_NOT_ALLOWED);
    assert_eq!(header_str(&post_hdrs, "allow"), "GET, HEAD");

    // 406 Not Acceptable when identity q=0 and no gzip exists.
    let (st, hdrs406, _) = read_response_bytes(
        agent
            .get(server.url("/__devhost__/config.json"))
            .header("Accept-Encoding", "identity;q=0")
            .call()
            .expect("406 config"),
    );
    assert_eq!(st, StatusCode::NOT_ACCEPTABLE);
    assert_eq!(header_str(&hdrs406, "cache-control"), "no-store");
    assert_eq!(header_str(&hdrs406, "vary"), "Accept-Encoding");
    assert_eq!(header_str(&hdrs406, "x-content-type-options"), "nosniff");

    // Versioned injected script: 307 redirect, query preservation, empty ?v=, wrong ?v=, immutable + gzip.
    let (st, redir_hdrs, _) = read_response_bytes(
        agent
            .get(server.url("/__devhost__/inject.js"))
            .call()
            .expect("get inject"),
    );
    assert_eq!(st, StatusCode::TEMPORARY_REDIRECT);
    assert_eq!(header_str(&redir_hdrs, "cache-control"), "no-store");
    let location = header_str(&redir_hdrs, "location").to_owned();
    assert!(location.starts_with("/__devhost__/inject.js?v="));
    let expected_ver = location.strip_prefix("/__devhost__/inject.js?v=").unwrap();
    assert_eq!(expected_ver.len(), 64);

    let (st, keep_hdrs, _) = read_response_bytes(
        agent
            .get(server.url("/__devhost__/inject.js?foo=1&v="))
            .call()
            .expect("get inject empty v"),
    );
    assert_eq!(st, StatusCode::TEMPORARY_REDIRECT);
    assert_eq!(
        header_str(&keep_hdrs, "location"),
        format!("/__devhost__/inject.js?foo=1&v={expected_ver}")
    );

    let (st, wrong_hdrs, _) = read_response_bytes(
        agent
            .get(server.url("/__devhost__/inject.js?v=badhash"))
            .call()
            .expect("wrong hash"),
    );
    assert_eq!(st, StatusCode::NOT_FOUND);
    assert_eq!(header_str(&wrong_hdrs, "cache-control"), "no-store");

    let (st, js_hdrs, js_body) = read_response_bytes(
        agent
            .get(server.url(&location))
            .call()
            .expect("versioned inject"),
    );
    assert_eq!(st, StatusCode::OK);
    assert_eq!(
        header_str(&js_hdrs, "cache-control"),
        "public, max-age=31536000, immutable"
    );
    assert_eq!(
        header_str(&js_hdrs, "content-type"),
        "application/javascript; charset=utf-8"
    );
    assert_eq!(asset_version(&js_body), expected_ver);

    let (st, gz_hdrs, gz_body) = read_response_bytes(
        agent
            .get(server.url(&location))
            .header("Accept-Encoding", "gzip")
            .call()
            .expect("gzip inject"),
    );
    assert_eq!(st, StatusCode::OK);
    assert_eq!(header_str(&gz_hdrs, "content-encoding"), "gzip");
    assert_eq!(&gz_body[..2], &[0x1f, 0x8b]);

    let (st, star_hdrs, _) = read_response_bytes(
        agent
            .get(server.url(&location))
            .header("Accept-Encoding", "*")
            .call()
            .expect("wildcard gzip"),
    );
    assert_eq!(st, StatusCode::OK);
    assert_eq!(header_str(&star_hdrs, "content-encoding"), "gzip");

    // Chunk assets in embedded internal/devtools/dist/assets.
    let assets_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../internal/devtools/dist/assets");
    let mut tested_js = false;
    let mut tested_woff2 = false;
    for entry in fs::read_dir(&assets_dir)
        .expect("read dist/assets")
        .flatten()
    {
        let file_name = entry.file_name().to_string_lossy().into_owned();
        if !tested_js && file_name.ends_with(".js") {
            let (st, hdrs, _) = read_response_bytes(
                agent
                    .get(server.url(&format!("/__devhost__/assets/{file_name}")))
                    .call()
                    .expect("chunk js"),
            );
            assert_eq!(st, StatusCode::OK);
            assert_eq!(
                header_str(&hdrs, "content-type"),
                "application/javascript; charset=utf-8"
            );
            assert_eq!(
                header_str(&hdrs, "cache-control"),
                "public, max-age=31536000, immutable"
            );
            tested_js = true;
        }
        if !tested_woff2 && file_name.ends_with(".woff2") {
            let (st, hdrs, _) = read_response_bytes(
                agent
                    .get(server.url(&format!("/__devhost__/assets/{file_name}")))
                    .call()
                    .expect("chunk woff2"),
            );
            assert_eq!(st, StatusCode::OK);
            assert_eq!(header_str(&hdrs, "content-type"), "font/woff2");
            tested_woff2 = true;
        }
    }
    assert!(tested_js, "expected at least one bundled JS asset");
    assert!(tested_woff2, "expected at least one bundled woff2 asset");

    for bad_asset in [
        "/__devhost__/assets/missing.js",
        "/__devhost__/assets/readme.txt",
        "/__devhost__/assets/..",
        "/__devhost__/assets/a/b.js",
    ] {
        let (st, hdrs, _) = read_response_bytes(
            agent
                .get(server.url(bad_asset))
                .call()
                .expect("invalid asset path"),
        );
        assert_eq!(st, StatusCode::NOT_FOUND, "path {bad_asset}");
        assert_eq!(header_str(&hdrs, "cache-control"), "no-store");
    }

    // Redux monitor document and versioned assets.
    let (st, hdrs, body) = read_response_bytes(
        agent
            .get(server.url("/__devhost__/redux"))
            .call()
            .expect("redux doc"),
    );
    assert_eq!(st, StatusCode::OK);
    assert_eq!(header_str(&hdrs, "cache-control"), "no-store");
    assert_eq!(
        header_str(&hdrs, "content-type"),
        "text/html; charset=utf-8"
    );
    assert!(String::from_utf8_lossy(&body).contains("Redux DevTools"));

    for (path, expected_ct) in [
        ("/__devhost__/redux.js", "text/javascript; charset=utf-8"),
        (
            "/__devhost__/redux-monitor.js",
            "text/javascript; charset=utf-8",
        ),
        ("/__devhost__/redux-monitor.css", "text/css; charset=utf-8"),
    ] {
        let (st, hdrs, _) = read_response_bytes(agent.get(server.url(path)).call().expect("redux"));
        assert_eq!(st, StatusCode::TEMPORARY_REDIRECT, "{path}");
        let loc = header_str(&hdrs, "location").to_owned();
        let (st, hdrs, body) =
            read_response_bytes(agent.get(server.url(&loc)).call().expect("redux ver"));
        assert_eq!(st, StatusCode::OK);
        assert_eq!(header_str(&hdrs, "content-type"), expected_ct);
        assert_eq!(
            header_str(&hdrs, "cache-control"),
            "public, max-age=31536000, immutable"
        );
        assert!(!body.is_empty());
    }

    let (st, hdrs, _) = read_response_bytes(
        agent
            .post(server.url("/__devhost__/redux.js"))
            .send_empty()
            .expect("post redux"),
    );
    assert_eq!(st, StatusCode::METHOD_NOT_ALLOWED);
    assert_eq!(header_str(&hdrs, "allow"), "GET, HEAD");
    assert_eq!(header_str(&hdrs, "cache-control"), "no-store");

    // select_asset_encoding edge cases.
    assert_eq!(
        select_asset_encoding(&["gzip;q=0.5, identity;q=0.9"], true),
        (None, true)
    );
    assert_eq!(
        select_asset_encoding(&["gzip;q=1.000, identity;q=0."], true),
        (Some("gzip"), true)
    );
    assert_eq!(select_asset_encoding(&["gzip;q=2"], true), (None, true));
    assert_eq!(select_asset_encoding(&["*;q=0"], false), (None, false));
}

#[test]
fn dev_source_checkout_and_rebuild() {
    let dir = tempfile::tempdir().expect("tempdir");
    assert!(DevSourceCheckout::new(dir.path()).is_err());

    let ui_src = dir.path().join("packages/devhost-ui/src/devtools");
    fs::create_dir_all(&ui_src).expect("mkdir ui src");
    assert!(DevSourceCheckout::new(dir.path()).is_err());

    let app_dir = dir.path().join("apps/devhost");
    fs::create_dir_all(app_dir.join("justfile")).expect("wrong type justfile");
    assert!(DevSourceCheckout::new(dir.path()).is_err());
    fs::remove_dir_all(app_dir.join("justfile")).expect("rm dir justfile");

    let justfile_path = app_dir.join("justfile");
    fs::write(
        &justfile_path,
        "build-devtools-bundle:\n\tmkdir -p internal/devtools/dist\n\tprintf 'console.log(\"rebuilt\");\\n' > internal/devtools/dist/devtools.js\n\tprintf '/* redux */\\n' > internal/devtools/dist/redux.js\n",
    )
    .expect("write justfile");

    // resolve_dev_source_directory & load_dev_source_checkout.
    let empty_env = BTreeMap::new();
    let manifest_dir = dir.path().join("project");
    fs::create_dir_all(&manifest_dir).expect("mkdir manifest");
    assert_eq!(
        resolve_dev_source_directory(&empty_env, &manifest_dir),
        None
    );

    let mut rel_env = BTreeMap::new();
    rel_env.insert(DEV_SOURCE_DIR_ENV.to_owned(), "..".to_owned());
    assert_eq!(
        resolve_dev_source_directory(&rel_env, &manifest_dir),
        Some(manifest_dir.join(".."))
    );
    let (loaded, warn) =
        load_dev_source_checkout(&rel_env, &manifest_dir, None).expect("load rel checkout");
    assert!(loaded.is_some());
    assert!(warn.is_none());

    let mut bad_env = BTreeMap::new();
    bad_env.insert(
        DEV_SOURCE_DIR_ENV.to_owned(),
        "/no/such/devhost/checkout".to_owned(),
    );
    assert!(load_dev_source_checkout(&bad_env, &manifest_dir, None).is_err());

    let (fallback, warn) = load_dev_source_checkout(&empty_env, &manifest_dir, Some(dir.path()))
        .expect("builtin fallback");
    assert!(fallback.is_some());
    assert!(warn.is_none());

    let (missing_builtin, warn) =
        load_dev_source_checkout(&empty_env, &manifest_dir, Some(&manifest_dir))
            .expect("invalid builtin returns warning");
    assert!(missing_builtin.is_none());
    assert!(warn.expect("warning").contains("embedded devtools assets"));

    let (none_res, none_warn) = load_dev_source_checkout(&empty_env, &manifest_dir, None).unwrap();
    assert!(none_res.is_none() && none_warn.is_none());

    // Timestamps: make initial dist newer than source; test ignored dotfiles / test files.
    let dist_dir = app_dir.join("internal/devtools/dist");
    fs::create_dir_all(&dist_dir).expect("mkdir dist");
    let source_ts = SystemTime::UNIX_EPOCH + Duration::from_secs(1_700_000_000);
    let newer_ts = SystemTime::UNIX_EPOCH + Duration::from_secs(1_700_000_100);
    let newest_ts = SystemTime::UNIX_EPOCH + Duration::from_secs(1_700_000_200);

    let main_ts = ui_src.join("main.ts");
    fs::write(&main_ts, "export const a = 1;\n").expect("write main.ts");
    File::open(&main_ts)
        .unwrap()
        .set_modified(source_ts)
        .unwrap();

    // Test files and hidden files newer than dist do NOT trigger rebuild.
    for ignored in [".hidden.ts", "main.test.ts", "other.spec.tsx"] {
        let p = ui_src.join(ignored);
        fs::write(&p, "ignored\n").unwrap();
        File::open(&p).unwrap().set_modified(newest_ts).unwrap();
    }

    let devtools_js = dist_dir.join("devtools.js");
    fs::write(&devtools_js, "console.log(\"cached\");\n").unwrap();
    File::open(&devtools_js)
        .unwrap()
        .set_modified(newer_ts)
        .unwrap();

    let logs = Arc::new(Mutex::new(Vec::<String>::new()));
    let logs_cb = logs.clone();
    let checkout = DevSourceCheckout::new(dir.path()).expect("checkout");
    assert_eq!(checkout.root_path(), dir.path());
    assert_eq!(checkout.source_directory_path(), ui_src);
    assert_eq!(checkout.assets_directory_path(), dist_dir);

    let store = AssetStore::new(Some(checkout), b"{}".to_vec()).with_logger(Arc::new(move |msg| {
        logs_cb.lock().unwrap().push(msg.to_owned());
    }));
    let server = TestHttpServer::start(asset_routes(store.clone()));
    let agent = test_agent();

    let (st, hdrs, body) = read_response_bytes(
        agent
            .get(server.url("/__devhost__/inject.js"))
            .call()
            .expect("cached dev inject"),
    );
    assert_eq!(st, StatusCode::OK);
    assert_eq!(header_str(&hdrs, "cache-control"), "no-store");
    assert_eq!(body, b"console.log(\"cached\");\n");
    assert!(logs.lock().unwrap().is_empty());

    // Now make a real source file newer than compiled dist -> triggers rebuild via just!
    let sub_dir = ui_src.join("nested");
    fs::create_dir_all(&sub_dir).unwrap();
    let helper_ts = sub_dir.join("helper.ts");
    fs::write(&helper_ts, "export const b = 2;\n").unwrap();
    File::open(&helper_ts)
        .unwrap()
        .set_modified(newest_ts)
        .unwrap();

    let (st, _, rebuilt_body) = read_response_bytes(
        agent
            .get(server.url("/__devhost__/inject.js"))
            .call()
            .expect("rebuilt dev inject"),
    );
    assert_eq!(st, StatusCode::OK);
    assert_eq!(rebuilt_body, b"console.log(\"rebuilt\");\n");
    assert!(
        logs.lock()
            .unwrap()
            .iter()
            .any(|l| l.contains("Rebuilding assets"))
    );

    // No-op justfile that does not write requested redux-monitor.css -> 503.
    let (st, _, body) = read_response_bytes(
        agent
            .get(server.url("/__devhost__/redux-monitor.css"))
            .call()
            .expect("missing css after noop"),
    );
    assert_eq!(st, StatusCode::SERVICE_UNAVAILABLE);
    assert!(String::from_utf8_lossy(&body).contains("without writing"));

    // Failing justfile -> format_js_error on /__devhost__/inject.js, 503 on redux.js.
    fs::write(
        &justfile_path,
        "build-devtools-bundle:\n\techo 'broken bundle' >&2\n\texit 1\n",
    )
    .unwrap();
    File::open(&helper_ts)
        .unwrap()
        .set_modified(SystemTime::UNIX_EPOCH + Duration::from_secs(1_800_000_000))
        .unwrap();
    let (st, _, err_js) = read_response_bytes(
        agent
            .get(server.url("/__devhost__/inject.js"))
            .call()
            .expect("error js banner"),
    );
    assert_eq!(st, StatusCode::OK);
    let err_js_text = String::from_utf8_lossy(&err_js);
    assert!(err_js_text.contains("DEVHOST COMPILATION ERROR:"));
    assert!(err_js_text.contains("broken bundle"));

    let (st, hdrs, _) = read_response_bytes(
        agent
            .get(server.url("/__devhost__/redux.js"))
            .call()
            .expect("error redux"),
    );
    assert_eq!(st, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(header_str(&hdrs, "cache-control"), "no-store");

    let js_banner = format_js_error("line 1");
    assert!(js_banner.contains("banner.style.background = \"#ff3333\""));
}

#[derive(Default)]
struct CapturedUpstream {
    x_devhost_injected: String,
    x_forwarded_host: String,
    x_forwarded_proto: String,
    has_accept_encoding: bool,
}

#[test]
fn document_injection_and_recovery_proxy() {
    let captured = Arc::new(Mutex::new(CapturedUpstream::default()));
    let captured_ref = captured.clone();

    let upstream_app = Router::new().fallback(any(move |req: Request<Body>| {
        let cap = captured_ref.clone();
        async move {
            {
                let mut guard = cap.lock().unwrap();
                guard.x_devhost_injected =
                    header_str(req.headers(), "x-devhost-injected").to_owned();
                guard.x_forwarded_host = header_str(req.headers(), "x-forwarded-host").to_owned();
                guard.x_forwarded_proto = header_str(req.headers(), "x-forwarded-proto").to_owned();
                guard.has_accept_encoding = req.headers().contains_key(header::ACCEPT_ENCODING);
            }
            match req.uri().path() {
                "/html" => Response::builder()
                    .status(StatusCode::OK)
                    .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
                    .header("content-security-policy", "default-src 'self'")
                    .header("content-security-policy-report-only", "default-src 'none'")
                    .body(Body::from(
                        "<!doctype html><html><body><h1>Hi</h1></BODY></html>",
                    ))
                    .unwrap(),
                "/fragment" => Response::builder()
                    .status(StatusCode::OK)
                    .header(header::CONTENT_TYPE, "text/html")
                    .body(Body::from("<div>no close tag</div>"))
                    .unwrap(),
                "/json" => Response::builder()
                    .status(StatusCode::OK)
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(r#"{"ok":true}"#))
                    .unwrap(),
                "/redirect" => Response::builder()
                    .status(StatusCode::FOUND)
                    .header(header::LOCATION, "/next")
                    .body(Body::empty())
                    .unwrap(),
                "/missing" => Response::builder()
                    .status(StatusCode::NOT_FOUND)
                    .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
                    .body(Body::from("upstream missing"))
                    .unwrap(),
                "/api-missing" => Response::builder()
                    .status(StatusCode::NOT_FOUND)
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(r#"{"err":404}"#))
                    .unwrap(),
                "/boom" => Response::builder()
                    .status(StatusCode::INTERNAL_SERVER_ERROR)
                    .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
                    .body(Body::from("upstream boom"))
                    .unwrap(),
                _ => (StatusCode::NOT_FOUND, "nope").into_response(),
            }
        }
    }));
    let upstream = TestHttpServer::start(upstream_app);

    let inject_flag = Arc::new(AtomicBool::new(true));
    let recovery_state = Arc::new(Mutex::new(RecoveryState {
        stack: "demo".to_owned(),
        service: "web".to_owned(),
        phase: "ready".to_owned(),
        title: String::new(),
        message: String::new(),
        address: format!("127.0.0.1:{}", upstream.port),
        can_restart: true,
        logs: vec!["[web] ready".to_owned()],
        repositories: Vec::new(),
    }));
    let restart_fail = Arc::new(AtomicBool::new(false));
    let restart_count = Arc::new(Mutex::new(0usize));

    let inj_clone = inject_flag.clone();
    let rec_clone = recovery_state.clone();
    let rf_clone = restart_fail.clone();
    let rc_clone = restart_count.clone();

    let mut proxy = DocumentInjectionServer::start(DocumentInjectionOptions {
        backend_host: "127.0.0.1".to_owned(),
        backend_port: upstream.port,
        should_inject: Some(Arc::new(move || inj_clone.load(Ordering::SeqCst))),
        get_recovery: Some(Arc::new(move || {
            // Runtime status readers may perform their own synchronous async probes.
            tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .unwrap()
                .block_on(async { rec_clone.lock().unwrap().clone() })
        })),
        restart: Some(Arc::new(move || {
            *rc_clone.lock().unwrap() += 1;
            if rf_clone.load(Ordering::SeqCst) {
                Err("restart boom".to_owned())
            } else {
                Ok(())
            }
        })),
        worktrees: Some(Arc::new(|_req| {
            Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(r#"{"switched":true}"#))
                .unwrap()
        })),
    })
    .expect("start DocumentInjectionServer");

    let agent = test_agent();
    let proxy_url = |path: &str| format!("http://127.0.0.1:{}{path}", proxy.port());

    // HTML injection + CSP stripping + forwarded headers + Accept-Encoding removal.
    let (st, hdrs, body) = read_response_bytes(
        agent
            .get(proxy_url("/html"))
            .header("Host", "app.localhost")
            .header("Accept-Encoding", "br")
            .header(RECOVERY_HEADER, "")
            .call()
            .expect("proxy html"),
    );
    assert_eq!(st, StatusCode::OK);
    let html = String::from_utf8_lossy(&body);
    assert!(html.contains(&format!(
        r#"<h1>Hi</h1><script type="module" src="{INJECTED_SCRIPT_PATH}"></script></BODY>"#
    )));
    assert!(!hdrs.contains_key("content-security-policy"));
    assert!(!hdrs.contains_key("content-security-policy-report-only"));
    {
        let cap = captured.lock().unwrap();
        assert_eq!(cap.x_devhost_injected, "true");
        assert_eq!(cap.x_forwarded_host, "app.localhost");
        assert_eq!(cap.x_forwarded_proto, "https");
        assert!(!cap.has_accept_encoding);
    }

    // Fragment without </body> appends tag at end.
    let (_, _, frag) =
        read_response_bytes(agent.get(proxy_url("/fragment")).call().expect("fragment"));
    assert!(String::from_utf8_lossy(&frag).ends_with("</script>"));

    // Unicode </body> branch in inject_devtools_script.
    let unicode_doc = "<div>\u{0130}</div></body>";
    assert!(inject_devtools_script(unicode_doc).contains("</div><script"));
    assert!(inject_devtools_script("plain").ends_with("</script>"));

    // Non-HTML and should_inject=false pass through untouched.
    let (_, _, json_body) =
        read_response_bytes(agent.get(proxy_url("/json")).call().expect("json"));
    assert_eq!(json_body, br#"{"ok":true}"#);

    inject_flag.store(false, Ordering::SeqCst);
    let (_, hdrs_no_inj, body_no_inj) =
        read_response_bytes(agent.get(proxy_url("/html")).call().expect("no inject"));
    assert!(hdrs_no_inj.contains_key("content-security-policy"));
    assert!(!String::from_utf8_lossy(&body_no_inj).contains(INJECTED_SCRIPT_PATH));
    inject_flag.store(true, Ordering::SeqCst);

    // Upstream 404/500 document & probe substitution vs non-document passthrough.
    let (_, _, api_404) = read_response_bytes(
        agent
            .get(proxy_url("/api-missing"))
            .call()
            .expect("api 404 passthrough"),
    );
    assert_eq!(api_404, br#"{"err":404}"#);
    let (st_html_404, _, html_404) = read_response_bytes(
        agent
            .get(proxy_url("/missing"))
            .call()
            .expect("non-document html 404 injects without recovery replacement"),
    );
    assert_eq!(st_html_404, StatusCode::NOT_FOUND);
    assert_eq!(
        String::from_utf8_lossy(&html_404),
        format!(r#"upstream missing<script type="module" src="{INJECTED_SCRIPT_PATH}"></script>"#)
    );

    recovery_state.lock().unwrap().repositories = vec![WorktreeRepository {
        id: "r1".to_owned(),
        name: "app".to_owned(),
        selected_path: "/main".to_owned(),
        worktrees: vec![Worktree {
            path: "/main".to_owned(),
            branch: "main".to_owned(),
            available: true,
            directories: vec![WorktreeDirectory {
                name: "web".to_owned(),
                cwd: "/main".to_owned(),
            }],
            owners: vec![WorktreeOwner {
                id: "o1".to_owned(),
                name: "demo".to_owned(),
                pid: 1,
                manifest_path: "/main/devhost.toml".to_owned(),
                urls: Vec::new(),
            }],
            ..Worktree::default()
        }],
        ..WorktreeRepository::default()
    }];
    let (st, hdrs, doc_404) = read_response_bytes(
        agent
            .get(proxy_url("/missing"))
            .header("Sec-Fetch-Dest", "document")
            .call()
            .expect("doc 404 recovery"),
    );
    assert_eq!(st, StatusCode::NOT_FOUND);
    assert_eq!(header_str(&hdrs, "cache-control"), "no-store");
    let text_404 = String::from_utf8_lossy(&doc_404);
    assert!(text_404.contains("Choose another worktree below"));
    assert!(text_404.contains(INJECTED_SCRIPT_PATH));

    let (st, _, probe_500) = read_response_bytes(
        agent
            .get(proxy_url("/boom"))
            .header(RECOVERY_HEADER, "probe")
            .call()
            .expect("probe 500"),
    );
    assert_eq!(st, StatusCode::INTERNAL_SERVER_ERROR);
    assert!(String::from_utf8_lossy(&probe_500).contains("web could not load"));

    let (st, _, head_500) = read_response_bytes(
        agent
            .head(proxy_url("/boom"))
            .header("Sec-Fetch-Dest", "document")
            .call()
            .expect("head 500"),
    );
    assert_eq!(st, StatusCode::INTERNAL_SERVER_ERROR);
    assert!(head_500.is_empty());

    // Ready probes short-circuit to 204 no-store.
    for path in ["/html", "/redirect"] {
        let (st, hdrs, b) = read_response_bytes(
            agent
                .get(proxy_url(path))
                .header(RECOVERY_HEADER, "probe")
                .call()
                .expect("probe 204"),
        );
        assert_eq!(st, StatusCode::NO_CONTENT);
        assert_eq!(header_str(&hdrs, "cache-control"), "no-store");
        assert!(b.is_empty());
    }

    // Recovery control actions.
    let (st, hdrs, st_json) = read_response_bytes(
        agent
            .get(proxy_url("/"))
            .header(RECOVERY_HEADER, "status")
            .call()
            .expect("status json"),
    );
    assert_eq!(st, StatusCode::OK);
    assert_eq!(header_str(&hdrs, "content-type"), "application/json");
    assert!(String::from_utf8_lossy(&st_json).contains("\"phase\":\"ready\""));

    let (st, hdrs, _) = read_response_bytes(
        agent
            .post(proxy_url("/"))
            .header(RECOVERY_HEADER, "status")
            .send_empty()
            .expect("post status 405"),
    );
    assert_eq!(st, StatusCode::METHOD_NOT_ALLOWED);
    assert_eq!(header_str(&hdrs, "allow"), "GET");

    let (st, _, wt_body) = read_response_bytes(
        agent
            .get(proxy_url("/"))
            .header(RECOVERY_HEADER, "worktrees")
            .call()
            .expect("worktrees"),
    );
    assert_eq!(st, StatusCode::OK);
    assert_eq!(wt_body, br#"{"switched":true}"#);

    let (st, hdrs, _) = read_response_bytes(
        agent
            .get(proxy_url("/"))
            .header(RECOVERY_HEADER, "restart")
            .call()
            .expect("get restart 405"),
    );
    assert_eq!(st, StatusCode::METHOD_NOT_ALLOWED);
    assert_eq!(header_str(&hdrs, "allow"), "POST");

    // Cross-origin rejection vs matching Origin.
    let (st, _, _) = read_response_bytes(
        agent
            .post(proxy_url("/"))
            .header(RECOVERY_HEADER, "restart")
            .header("Sec-Fetch-Site", "cross-site")
            .send_empty()
            .expect("cross-site"),
    );
    assert_eq!(st, StatusCode::FORBIDDEN);

    let (st, _, _) = read_response_bytes(
        agent
            .post(proxy_url("/"))
            .header(RECOVERY_HEADER, "restart")
            .header("Host", "app.localhost")
            .header("X-Forwarded-Proto", "https")
            .header("Origin", "https://evil.example")
            .send_empty()
            .expect("bad origin"),
    );
    assert_eq!(st, StatusCode::FORBIDDEN);

    let (st, _, _) = read_response_bytes(
        agent
            .post(proxy_url("/"))
            .header(RECOVERY_HEADER, "restart")
            .header("Host", "app.localhost")
            .header("X-Forwarded-Proto", "https")
            .header("Origin", "https://app.localhost")
            .send_empty()
            .expect("good origin restart"),
    );
    assert_eq!(st, StatusCode::NO_CONTENT);
    assert_eq!(*restart_count.lock().unwrap(), 1);

    restart_fail.store(true, Ordering::SeqCst);
    let (st, _, _) = read_response_bytes(
        agent
            .post(proxy_url("/"))
            .header(RECOVERY_HEADER, "restart")
            .send_empty()
            .expect("restart fail 503"),
    );
    assert_eq!(st, StatusCode::SERVICE_UNAVAILABLE);

    recovery_state.lock().unwrap().can_restart = false;
    let (st, _, _) = read_response_bytes(
        agent
            .post(proxy_url("/"))
            .header(RECOVERY_HEADER, "restart")
            .send_empty()
            .expect("cannot restart 409"),
    );
    assert_eq!(st, StatusCode::CONFLICT);

    let (st, _, _) = read_response_bytes(
        agent
            .get(proxy_url("/"))
            .header(RECOVERY_HEADER, "unknown-action")
            .call()
            .expect("unknown 400"),
    );
    assert_eq!(st, StatusCode::BAD_REQUEST);

    // Non-ready phase: HTML for browser, JSON for API client, HEAD empty, probe 503.
    {
        let mut guard = recovery_state.lock().unwrap();
        guard.phase = "starting".to_owned();
        guard.title = "Starting web".to_owned();
        guard.message = "Waiting...".to_owned();
    }
    let (st, _, body_html) = read_response_bytes(
        agent
            .get(proxy_url("/html"))
            .header("Sec-Fetch-Dest", "document")
            .header("Accept", "application/json, text/html")
            .call()
            .expect("starting doc"),
    );
    assert_eq!(st, StatusCode::SERVICE_UNAVAILABLE);
    assert!(String::from_utf8_lossy(&body_html).contains("Starting web"));

    let (st, hdrs_json, body_json) = read_response_bytes(
        agent
            .get(proxy_url("/html"))
            .header("Accept", "application/json")
            .call()
            .expect("starting json"),
    );
    assert_eq!(st, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(header_str(&hdrs_json, "content-type"), "application/json");
    assert!(String::from_utf8_lossy(&body_json).contains("\"phase\":\"starting\""));

    let (st, _, probe_starting) = read_response_bytes(
        agent
            .get(proxy_url("/html"))
            .header(RECOVERY_HEADER, "probe")
            .call()
            .expect("starting probe get"),
    );
    assert_eq!(st, StatusCode::SERVICE_UNAVAILABLE);
    assert!(String::from_utf8_lossy(&probe_starting).contains("Starting web"));

    let (st, _, head_starting) = read_response_bytes(
        agent
            .head(proxy_url("/html"))
            .call()
            .expect("starting head"),
    );
    assert_eq!(st, StatusCode::SERVICE_UNAVAILABLE);
    assert!(head_starting.is_empty());

    // Switch backend to an unreachable port -> 502 recovery page, and stop proxy cleanly.
    recovery_state.lock().unwrap().phase = "ready".to_owned();
    proxy.set_backend("::1", unused_port());
    let (st, _, body_502) = read_response_bytes(
        agent
            .get(proxy_url("/html"))
            .header("Sec-Fetch-Dest", "document")
            .call()
            .expect("502 recovery"),
    );
    assert_eq!(st, StatusCode::BAD_GATEWAY);
    assert!(String::from_utf8_lossy(&body_502).contains("could not load"));
    proxy.stop();

    // Separate server without recovery hooks: 502 renders unavailable page with injected script, 409 restart, 501 worktrees.
    let mut plain_proxy = DocumentInjectionServer::start(DocumentInjectionOptions {
        backend_host: "127.0.0.1".to_owned(),
        backend_port: unused_port(),
        should_inject: None,
        get_recovery: None,
        restart: None,
        worktrees: None,
    })
    .expect("start plain proxy");
    let (st, _, unavail) = read_response_bytes(
        agent
            .get(format!("http://127.0.0.1:{}/", plain_proxy.port()))
            .call()
            .expect("plain 502"),
    );
    assert_eq!(st, StatusCode::BAD_GATEWAY);
    let unavail_text = String::from_utf8_lossy(&unavail);
    assert!(unavail_text.contains("Service unavailable"));
    assert!(unavail_text.contains(INJECTED_SCRIPT_PATH));
    plain_proxy.stop();

    let mut minimal_recovery = DocumentInjectionServer::start(DocumentInjectionOptions {
        backend_host: "127.0.0.1".to_owned(),
        backend_port: upstream.port,
        should_inject: None,
        get_recovery: Some(Arc::new(|| RecoveryState {
            phase: "ready".to_owned(),
            can_restart: true,
            ..RecoveryState::default()
        })),
        restart: None,
        worktrees: None,
    })
    .expect("minimal recovery proxy");
    let min_url = format!("http://127.0.0.1:{}/", minimal_recovery.port());
    assert_eq!(
        read_response_bytes(
            agent
                .post(&min_url)
                .header(RECOVERY_HEADER, "restart")
                .send_empty()
                .unwrap()
        )
        .0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        read_response_bytes(
            agent
                .get(&min_url)
                .header(RECOVERY_HEADER, "worktrees")
                .call()
                .unwrap()
        )
        .0,
        StatusCode::NOT_IMPLEMENTED
    );
    minimal_recovery.stop();
}

#[test]
fn request_guard_and_devtools_origin() {
    let mut ws_headers = HeaderMap::new();
    ws_headers.insert(header::UPGRADE, HeaderValue::from_static("websocket"));
    ws_headers.insert(
        header::CONNECTION,
        HeaderValue::from_static("keep-alive, Upgrade"),
    );
    assert!(!is_state_changing_request(&Method::GET, &HeaderMap::new()));
    assert!(!is_state_changing_request(&Method::HEAD, &HeaderMap::new()));
    assert!(!is_state_changing_request(
        &Method::OPTIONS,
        &HeaderMap::new()
    ));
    assert!(is_state_changing_request(&Method::GET, &ws_headers));
    assert!(is_state_changing_request(&Method::POST, &HeaderMap::new()));

    assert!(check_cross_origin(&Method::GET, &HeaderMap::new(), "localhost", None).is_ok());
    assert!(check_cross_origin(&Method::GET, &ws_headers, "localhost", None).is_ok());

    let mut same_site = HeaderMap::new();
    same_site.insert("sec-fetch-site", HeaderValue::from_static("same-origin"));
    assert!(check_cross_origin(&Method::POST, &same_site, "localhost", None).is_ok());

    let mut json_hdrs = HeaderMap::new();
    assert!(!is_json_request(&json_hdrs));
    json_hdrs.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/json; charset=utf-8"),
    );
    assert!(is_json_request(&json_hdrs));
    json_hdrs.insert(header::CONTENT_TYPE, HeaderValue::from_static("text/plain"));
    assert!(!is_json_request(&json_hdrs));

    let own_true = |port: u16, url: &str| Ok(port == 4100 && url == "https://web.localhost/");
    let own_err = |_port: u16, _url: &str| Err("boom".to_owned());
    assert!(serves_request_host(
        "localhost:3000",
        None,
        4100,
        None::<&fn(u16, &str) -> Result<bool, String>>,
    ));
    assert!(serves_request_host(
        "127.0.0.1:3000",
        None,
        4100,
        None::<&fn(u16, &str) -> Result<bool, String>>,
    ));
    assert!(serves_request_host(
        "[::1]:8443",
        Some("https"),
        4100,
        None::<&fn(u16, &str) -> Result<bool, String>>,
    ));
    assert!(!serves_request_host(
        "web.localhost",
        Some("https"),
        4100,
        None::<&fn(u16, &str) -> Result<bool, String>>,
    ));
    assert!(serves_request_host(
        "web.localhost",
        Some("https"),
        4100,
        Some(&own_true),
    ));
    assert!(!serves_request_host(
        "web.localhost",
        Some("http"),
        4100,
        Some(&own_true),
    ));
    assert!(!serves_request_host(
        "web.localhost",
        Some("https"),
        4100,
        Some(&own_err),
    ));

    // allows_devtools_url against registered routes in temp caddy dir.
    let dir = tempfile::tempdir().expect("temp caddy dir");
    let caddy_dir = dir.path().join("caddy");
    caddy_files::prepare_directories(&caddy_dir).expect("prepare caddy dirs");
    let owner = DevtoolsRouteOwner {
        manifest_path: "/tmp/a/devhost.toml".to_owned(),
        control_port: 4100,
        owner_pid: Some(std::process::id() as i32),
    };
    assert!(!allows_devtools_url(&caddy_dir, &owner, "https://app.localhost/").unwrap());

    let mut log = Vec::new();
    let web_route = ActivateRouteOptions {
        proxy_local_origin: false,
        app_bind_host: "127.0.0.1".to_owned(),
        app_port: 3000,
        devtools_control_port: Some(4100),
        document_injection_port: None,
        host: "app.localhost".to_owned(),
        path: "/*".to_owned(),
        service_name: "web".to_owned(),
        access_log_name: "stack-a".to_owned(),
    };
    let api_route = ActivateRouteOptions {
        proxy_local_origin: false,
        app_bind_host: "127.0.0.1".to_owned(),
        app_port: 3001,
        devtools_control_port: Some(4200),
        document_injection_port: None,
        host: "app.localhost".to_owned(),
        path: "/api/*".to_owned(),
        service_name: "api".to_owned(),
        access_log_name: "stack-b".to_owned(),
    };
    replace_routes(
        &caddy_dir,
        &[],
        &[web_route, api_route],
        "/tmp/a/devhost.toml",
        Mode::Agent,
        &mut log,
        true,
    )
    .expect("register routes");

    let mut settings = CaddySettings {
        http_enabled: true,
        http_port: 8080,
        https_port: 8443,
        ..CaddySettings::default()
    };
    caddy_files::write_applied_settings(&caddy_dir, &settings).expect("write applied settings");

    assert!(allows_devtools_url(&caddy_dir, &owner, "https://app.localhost:8443/page").unwrap());
    assert!(allows_devtools_url(&caddy_dir, &owner, "http://app.localhost:8080/page").unwrap());
    assert!(!allows_devtools_url(&caddy_dir, &owner, "https://app.localhost/page").unwrap());
    assert!(
        !allows_devtools_url(
            &caddy_dir,
            &owner,
            "https://app.localhost:8443/__devhost__/ui"
        )
        .unwrap()
    );
    assert!(
        !allows_devtools_url(
            &caddy_dir,
            &owner,
            "https://app.localhost:8443/foo/../__devhost__/ui"
        )
        .unwrap()
    );
    assert!(!allows_devtools_url(&caddy_dir, &owner, "https://app.localhost:8443/api/v1").unwrap());
    assert!(!allows_devtools_url(&caddy_dir, &owner, "not-a-url").unwrap());
    assert!(
        !allows_devtools_url(&caddy_dir, &owner, "https://user:pass@app.localhost:8443/").unwrap()
    );
    assert!(!allows_devtools_url(&caddy_dir, &owner, "ftp://app.localhost:8443/").unwrap());

    let wrong_owner = DevtoolsRouteOwner {
        manifest_path: "/tmp/other/devhost.toml".to_owned(),
        control_port: 4100,
        owner_pid: Some(std::process::id() as i32),
    };
    assert!(!allows_devtools_url(&caddy_dir, &wrong_owner, "https://app.localhost:8443/").unwrap());

    settings.http_enabled = false;
    caddy_files::write_applied_settings(&caddy_dir, &settings).unwrap();
    assert!(!allows_devtools_url(&caddy_dir, &owner, "http://app.localhost:8080/page").unwrap());
}

#[test]
fn file_handler_confinement_and_rendering() {
    let dir = tempfile::tempdir().expect("temp files root");
    let root = dir.path().join("served");
    let outside = dir.path().join("outside.txt");
    fs::create_dir_all(root.join("subdir")).unwrap();
    fs::create_dir_all(root.join("lower")).unwrap();
    fs::create_dir_all(root.join("dir")).unwrap();
    fs::create_dir_all(root.join("escaped_index_dir")).unwrap();
    fs::create_dir_all(root.join(".hidden_dir")).unwrap();

    fs::write(&outside, "secret outside").unwrap();
    fs::write(root.join("index.md"), "# Welcome\nHello docs\n").unwrap();
    fs::write(root.join("subdir/README.md"), "# Subdir README\n").unwrap();
    fs::write(root.join("lower/readme.md"), "# Lower readme\n").unwrap();
    fs::write(root.join("dir/notes.txt"), "note body\n").unwrap();
    fs::write(root.join("hello world.txt"), "spaced").unwrap();
    fs::write(root.join(".secret"), "hidden").unwrap();
    fs::write(root.join(".hidden_dir/file.txt"), "hidden dir file").unwrap();
    fs::write(root.join("escaped_index_dir/visible.txt"), "visible").unwrap();

    #[cfg(unix)]
    {
        use std::os::unix::fs::symlink;
        symlink(&outside, root.join("escape_link")).unwrap();
        symlink(&outside, root.join("dir/escape_in_dir.txt")).unwrap();
        symlink(&outside, root.join("escaped_index_dir/index.html")).unwrap();
        symlink(".secret", root.join("dot_link")).unwrap();
        symlink(
            root.canonicalize().unwrap().join("dir/notes.txt"),
            root.join("abs_in_link"),
        )
        .unwrap();
        symlink("subdir/../dir/notes.txt", root.join("rel_parent_link")).unwrap();
        symlink(
            root.canonicalize().unwrap().join("dir/../../outside.txt"),
            root.join("abs_parent_escape"),
        )
        .unwrap();
        symlink("loop_b", root.join("loop_a")).unwrap();
        symlink("loop_a", root.join("loop_b")).unwrap();
    }

    assert!(FileHandler::open(&dir.path().join("missing")).is_err());
    assert!(FileHandler::open(&outside).is_err());

    let handler = FileHandler::open(&root).expect("open FileHandler");
    let app = Router::new().fallback(any(move |method: Method, uri: Uri| {
        let h = handler.clone();
        async move { h.serve(&method, &uri, "/files") }
    }));
    let server = TestHttpServer::start(app);
    let agent = test_agent();

    let (st, hdrs, _) = read_response_bytes(
        agent
            .post(server.url("/files/"))
            .send_empty()
            .expect("post 405"),
    );
    assert_eq!(st, StatusCode::METHOD_NOT_ALLOWED);
    assert_eq!(header_str(&hdrs, "allow"), "GET, HEAD");

    let (st, redir_hdrs, _) = read_response_bytes(
        agent
            .get(server.url("/files/dir?q=1"))
            .call()
            .expect("dir redirect"),
    );
    assert_eq!(st, StatusCode::MOVED_PERMANENTLY);
    assert_eq!(header_str(&redir_hdrs, "location"), "/files/dir/?q=1");

    assert_eq!(
        read_response_bytes(
            agent
                .get(server.url("/files/dir/notes.txt/"))
                .call()
                .unwrap()
        )
        .0,
        StatusCode::NOT_FOUND
    );

    // Markdown root index and HEAD.
    let (st, hdrs, root_html) =
        read_response_bytes(agent.get(server.url("/files/")).call().unwrap());
    assert_eq!(st, StatusCode::OK);
    assert_eq!(
        header_str(&hdrs, "content-type"),
        "text/html; charset=utf-8"
    );
    assert!(String::from_utf8_lossy(&root_html).contains("# Welcome"));

    let (st, _, root_head) = read_response_bytes(agent.head(server.url("/files/")).call().unwrap());
    assert_eq!(st, StatusCode::OK);
    assert!(root_head.is_empty());

    assert!(
        String::from_utf8_lossy(
            &read_response_bytes(agent.get(server.url("/files/subdir/")).call().unwrap()).2
        )
        .contains("Subdir README")
    );
    assert!(
        String::from_utf8_lossy(
            &read_response_bytes(agent.get(server.url("/files/lower/")).call().unwrap()).2
        )
        .contains("Lower readme")
    );

    // Directory listing excludes escaping symlinks & dotfiles.
    let (st, _, dir_html) =
        read_response_bytes(agent.get(server.url("/files/dir/")).call().unwrap());
    assert_eq!(st, StatusCode::OK);
    let dir_text = String::from_utf8_lossy(&dir_html);
    assert!(dir_text.contains("notes.txt"));
    assert!(!dir_text.contains("escape_in_dir.txt"));

    // Escaping index.html symlink is ignored so directory listing serves instead of outside.txt.
    let (st, _, escaped_idx_html) = read_response_bytes(
        agent
            .get(server.url("/files/escaped_index_dir/"))
            .call()
            .unwrap(),
    );
    assert_eq!(st, StatusCode::OK);
    let escaped_idx_text = String::from_utf8_lossy(&escaped_idx_html);
    assert!(escaped_idx_text.contains("visible.txt"));
    assert!(!escaped_idx_text.contains("secret outside"));

    // Static file + percent decoding + bad escape rejection + dotfiles/traversal/symlinks.
    let (st, hdrs, txt) = read_response_bytes(
        agent
            .get(server.url("/files/hello%20world.txt"))
            .call()
            .unwrap(),
    );
    assert_eq!(st, StatusCode::OK);
    assert_eq!(
        header_str(&hdrs, "content-type"),
        "text/plain; charset=utf-8"
    );
    assert_eq!(txt, b"spaced");

    for denied in [
        "/files/%ZZ",
        "/files/%00",
        "/files/..",
        "/files/../outside.txt",
        "/files/.secret",
        "/files/.hidden_dir/file.txt",
        "/files/escape_link",
        "/files/dot_link",
        "/files/abs_parent_escape",
        "/files/loop_a",
    ] {
        let (st, hdrs, _) = read_response_bytes(agent.get(server.url(denied)).call().unwrap());
        assert_eq!(st, StatusCode::NOT_FOUND, "denied path {denied}");
        assert_eq!(header_str(&hdrs, "cache-control"), "no-cache");
        assert_eq!(header_str(&hdrs, "x-content-type-options"), "nosniff");
    }

    for allowed in ["/files/abs_in_link", "/files/rel_parent_link"] {
        let (st, _, body) = read_response_bytes(agent.get(server.url(allowed)).call().unwrap());
        assert_eq!(st, StatusCode::OK, "allowed path {allowed}");
        assert_eq!(body, b"note body\n");
    }
}

#[test]
fn page_preview_gallery() {
    let agent = test_agent();

    // Without dev_source, preview routes return 404.
    let no_src_store = AssetStore::new(None, b"{}".to_vec());
    let no_src_srv = TestHttpServer::start(preview_routes(no_src_store));
    assert_eq!(
        read_response_bytes(
            agent
                .get(no_src_srv.url("/__devhost__/pages/"))
                .call()
                .unwrap()
        )
        .0,
        StatusCode::NOT_FOUND
    );

    // With real checkout dev_source, all preview routes + files/notes.md work.
    let checkout = DevSourceCheckout::new(&worktree_root()).expect("worktree checkout");
    let store = AssetStore::new(Some(checkout), b"{}".to_vec());
    let srv = TestHttpServer::start(preview_routes(store));

    let (st, hdrs, gallery) =
        read_response_bytes(agent.get(srv.url("/__devhost__/pages/")).call().unwrap());
    assert_eq!(st, StatusCode::OK);
    assert_eq!(
        header_str(&hdrs, "content-type"),
        "text/html; charset=utf-8"
    );
    assert!(String::from_utf8_lossy(&gallery).contains("Standalone page previews"));

    let (st, css_hdrs, css_body) = read_response_bytes(
        agent
            .get(srv.url("/__devhost__/pages/status.css"))
            .call()
            .unwrap(),
    );
    assert_eq!(st, StatusCode::OK);
    assert_eq!(
        header_str(&css_hdrs, "content-type"),
        "text/css; charset=utf-8"
    );
    assert!(!css_body.is_empty());

    let (st, _, rnf) = read_response_bytes(
        agent
            .get(srv.url("/__devhost__/pages/route-not-found"))
            .call()
            .unwrap(),
    );
    assert_eq!(st, StatusCode::NOT_FOUND);
    let rnf_text = String::from_utf8_lossy(&rnf);
    assert!(rnf_text.contains("web.localhost"));
    assert!(rnf_text.contains("/__devhost__/pages/files/"));

    let (st, _, rnf_empty) = read_response_bytes(
        agent
            .get(srv.url("/__devhost__/pages/route-not-found-empty"))
            .call()
            .unwrap(),
    );
    assert_eq!(st, StatusCode::NOT_FOUND);
    assert!(String::from_utf8_lossy(&rnf_empty).contains("No devhost hostnames are active"));

    let (st, _, unavail) = read_response_bytes(
        agent
            .get(srv.url("/__devhost__/pages/backend-unavailable"))
            .call()
            .unwrap(),
    );
    assert_eq!(st, StatusCode::BAD_GATEWAY);
    assert!(String::from_utf8_lossy(&unavail).contains("Service unavailable"));

    assert!(page_preview_state("unknown").is_none());
    for (name, expected_status) in [
        ("starting", StatusCode::SERVICE_UNAVAILABLE),
        ("failed", StatusCode::SERVICE_UNAVAILABLE),
        ("external", StatusCode::SERVICE_UNAVAILABLE),
        ("worktrees", StatusCode::INTERNAL_SERVER_ERROR),
        ("404", StatusCode::NOT_FOUND),
        ("500", StatusCode::INTERNAL_SERVER_ERROR),
        ("502", StatusCode::BAD_GATEWAY),
        ("503", StatusCode::SERVICE_UNAVAILABLE),
        ("504", StatusCode::GATEWAY_TIMEOUT),
    ] {
        let (st, hdrs, body) = read_response_bytes(
            agent
                .get(srv.url(&format!("/__devhost__/pages/{name}")))
                .call()
                .unwrap(),
        );
        assert_eq!(st, expected_status, "preview {name}");
        assert_eq!(header_str(&hdrs, "cache-control"), "no-store");
        assert!(!body.is_empty());

        let (head_st, _, head_b) = read_response_bytes(
            agent
                .head(srv.url(&format!("/__devhost__/pages/{name}")))
                .call()
                .unwrap(),
        );
        assert_eq!(head_st, expected_status);
        assert!(head_b.is_empty());
    }

    for action in ["status", "worktrees"] {
        let (st, hdrs, json) = read_response_bytes(
            agent
                .get(srv.url("/__devhost__/pages/worktrees"))
                .header(RECOVERY_HEADER, action)
                .call()
                .unwrap(),
        );
        assert_eq!(st, StatusCode::OK);
        assert_eq!(header_str(&hdrs, "content-type"), "application/json");
        assert!(String::from_utf8_lossy(&json).contains("preview-project"));
    }

    assert_eq!(
        read_response_bytes(
            agent
                .get(srv.url("/__devhost__/pages/500"))
                .header(RECOVERY_HEADER, "probe")
                .call()
                .unwrap()
        )
        .0,
        StatusCode::INTERNAL_SERVER_ERROR
    );
    assert_eq!(
        read_response_bytes(
            agent
                .get(srv.url("/__devhost__/pages/500"))
                .header(RECOVERY_HEADER, "bogus")
                .call()
                .unwrap()
        )
        .0,
        StatusCode::BAD_REQUEST
    );

    let (st, _, post_body) = read_response_bytes(
        agent
            .post(srv.url("/__devhost__/pages/500"))
            .send_empty()
            .unwrap(),
    );
    assert_eq!(st, StatusCode::CONFLICT);
    assert!(String::from_utf8_lossy(&post_body).contains("Preview only."));

    for path in ["/__devhost__/pages/500", "/__devhost__/pages/"] {
        let (st, hdrs, _) = read_response_bytes(agent.delete(srv.url(path)).call().unwrap());
        assert_eq!(st, StatusCode::METHOD_NOT_ALLOWED);
        assert_eq!(header_str(&hdrs, "allow"), "GET, HEAD");
    }

    let (st, _, notes_list) = read_response_bytes(
        agent
            .get(srv.url("/__devhost__/pages/files/"))
            .call()
            .unwrap(),
    );
    assert_eq!(st, StatusCode::OK);
    assert!(String::from_utf8_lossy(&notes_list).contains("notes.md"));

    let (st, _, notes_html) = read_response_bytes(
        agent
            .get(srv.url("/__devhost__/pages/files/notes.md"))
            .call()
            .unwrap(),
    );
    assert_eq!(st, StatusCode::OK);
    assert!(String::from_utf8_lossy(&notes_html).contains("notes.md"));

    assert_eq!(
        read_response_bytes(
            agent
                .get(srv.url("/__devhost__/pages/nope"))
                .call()
                .unwrap()
        )
        .0,
        StatusCode::NOT_FOUND
    );
}
