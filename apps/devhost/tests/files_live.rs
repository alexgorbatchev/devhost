use std::{fs, os::unix::fs::symlink};

use axum::{
    body::to_bytes,
    http::{HeaderMap, Method, StatusCode, Uri, header},
};
use devhost::{files::FileHandler, services::serve::FileServer};

#[path = "support/ports.rs"]
mod fixture_ports;

/// An address for a server these tests stop and start again on the same port. A port the kernel picked for `:0` is
/// in its ephemeral range, where an outbound connection can take it while the server is down.
fn restartable_address() -> String {
    let port = fixture_ports::reserve_listener()
        .local_addr()
        .unwrap()
        .port();
    format!("127.0.0.1:{port}")
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn served_root_remains_pinned_after_directory_replacement() {
    let fixture = tempfile::tempdir().unwrap();
    let root = fixture.path().join("public");
    let outside = fixture.path().join("outside");
    fs::create_dir(&root).unwrap();
    fs::create_dir(&outside).unwrap();
    fs::write(root.join("note.txt"), "public document").unwrap();
    fs::write(outside.join("note.txt"), "private document").unwrap();
    let handler = FileHandler::open(&root).unwrap();
    fs::rename(&root, fixture.path().join("moved")).unwrap();
    symlink(&outside, &root).unwrap();
    let response = handler.serve(&Method::GET, &Uri::from_static("/note.txt"), "");
    let body = to_bytes(response.into_body(), 1024).await.unwrap();
    assert_eq!(&body[..], b"public document");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn files_support_ranges_conditions_and_live_edits() {
    let root = tempfile::tempdir().unwrap();
    fs::write(root.path().join("note.txt"), "0123456789").unwrap();
    let handler = FileHandler::open(root.path()).unwrap();
    let uri = Uri::from_static("/note.txt");
    let response = handler.serve(&Method::GET, &uri, "");
    let modified = response.headers()[header::LAST_MODIFIED].clone();
    assert_eq!(response.headers()[header::CONTENT_LENGTH], "10");
    assert_eq!(
        response.headers()[header::CONTENT_TYPE],
        "text/plain; charset=utf-8"
    );
    let mut headers = HeaderMap::new();
    headers.insert(header::RANGE, "bytes=2-5".parse().unwrap());
    let response = handler.serve_with_headers(&Method::GET, &uri, &headers, "");
    assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
    assert_eq!(response.headers()[header::CONTENT_RANGE], "bytes 2-5/10");
    assert_eq!(
        &to_bytes(response.into_body(), 1024).await.unwrap()[..],
        b"2345"
    );
    headers.clear();
    headers.insert(header::IF_MODIFIED_SINCE, modified);
    let response = handler.serve_with_headers(&Method::GET, &uri, &headers, "");
    assert_eq!(response.status(), StatusCode::NOT_MODIFIED);
    assert!(!response.headers().contains_key(header::ACCEPT_RANGES));
    headers.insert(header::IF_MODIFIED_SINCE, "invalid date".parse().unwrap());
    assert_eq!(
        handler
            .serve_with_headers(&Method::GET, &uri, &headers, "")
            .status(),
        StatusCode::OK
    );
    headers.clear();
    headers.insert(header::RANGE, "bytes=50-60".parse().unwrap());
    assert_eq!(
        handler
            .serve_with_headers(&Method::GET, &uri, &headers, "")
            .status(),
        StatusCode::RANGE_NOT_SATISFIABLE
    );
    fs::write(root.path().join("note.txt"), "edited").unwrap();
    let response = handler.serve(&Method::GET, &uri, "");
    assert_eq!(
        &to_bytes(response.into_body(), 1024).await.unwrap()[..],
        b"edited"
    );
    let response = handler.serve(&Method::HEAD, &uri, "");
    assert_eq!(response.headers()[header::CONTENT_LENGTH], "6");
    assert!(
        to_bytes(response.into_body(), 1024)
            .await
            .unwrap()
            .is_empty()
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn range_errors_multipart_and_preconditions_match_http_file_semantics() {
    let root = tempfile::tempdir().unwrap();
    fs::write(root.path().join("note.txt"), "0123456789").unwrap();
    fs::write(root.path().join("empty"), "").unwrap();
    let handler = FileHandler::open(root.path()).unwrap();
    let uri = Uri::from_static("/note.txt");
    let modified = handler.serve(&Method::GET, &uri, "").headers()[header::LAST_MODIFIED].clone();
    for (range, status, body) in [
        (
            "garbage",
            StatusCode::RANGE_NOT_SATISFIABLE,
            "invalid range\n",
        ),
        (
            "bytes=50-60",
            StatusCode::RANGE_NOT_SATISFIABLE,
            "invalid range: failed to overlap\n",
        ),
        (
            "bytes=0-18446744073709551615",
            StatusCode::RANGE_NOT_SATISFIABLE,
            "invalid range\n",
        ),
        ("bytes=-100", StatusCode::PARTIAL_CONTENT, "0123456789"),
        ("bytes=+1-+3", StatusCode::PARTIAL_CONTENT, "123"),
        ("bytes=0-9,0-9", StatusCode::OK, "0123456789"),
    ] {
        let headers = HeaderMap::from_iter([(header::RANGE, range.parse().unwrap())]);
        let response = handler.serve_with_headers(&Method::GET, &uri, &headers, "");
        assert_eq!(response.status(), status, "{range}");
        if status == StatusCode::RANGE_NOT_SATISFIABLE {
            assert!(!response.headers().contains_key(header::CACHE_CONTROL));
        }
        assert_eq!(
            to_bytes(response.into_body(), 1024).await.unwrap(),
            body,
            "{range}"
        );
    }
    let mut headers = HeaderMap::from_iter([(header::RANGE, "bytes=0-1,5-6".parse().unwrap())]);
    let response = handler.serve_with_headers(&Method::GET, &uri, &headers, "");
    assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
    let boundary = response.headers()[header::CONTENT_TYPE]
        .to_str()
        .unwrap()
        .split("boundary=")
        .nth(1)
        .unwrap()
        .to_owned();
    let length: usize = response.headers()[header::CONTENT_LENGTH]
        .to_str()
        .unwrap()
        .parse()
        .unwrap();
    let body = to_bytes(response.into_body(), 4096).await.unwrap();
    assert_eq!(body.len(), length);
    let body = String::from_utf8(body.to_vec()).unwrap();
    assert!(body.contains(
        "Content-Range: bytes 0-1/10\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n01\r\n"
    ));
    assert!(body.contains("\r\n\r\n56\r\n"));
    assert!(body.ends_with(&format!("--{boundary}--\r\n")));
    let head = handler.serve_with_headers(&Method::HEAD, &uri, &headers, "");
    assert_eq!(head.status(), StatusCode::PARTIAL_CONTENT);
    assert!(to_bytes(head.into_body(), 4096).await.unwrap().is_empty());
    headers.insert(header::RANGE, "bytes=0-1".parse().unwrap());
    headers.insert(header::IF_RANGE, modified);
    assert_eq!(
        handler
            .serve_with_headers(&Method::GET, &uri, &headers, "")
            .status(),
        StatusCode::PARTIAL_CONTENT
    );
    headers.insert(header::IF_RANGE, "\"unknown\"".parse().unwrap());
    assert_eq!(
        handler
            .serve_with_headers(&Method::GET, &uri, &headers, "")
            .status(),
        StatusCode::OK
    );
    for (name, value, status) in [
        (
            header::IF_MATCH,
            "\"unknown\"",
            StatusCode::PRECONDITION_FAILED,
        ),
        (header::IF_MATCH, "*", StatusCode::OK),
        (
            header::IF_UNMODIFIED_SINCE,
            "Wed, 21 Oct 2015 07:28:00 GMT",
            StatusCode::PRECONDITION_FAILED,
        ),
        (header::IF_NONE_MATCH, "*", StatusCode::NOT_MODIFIED),
        (header::IF_NONE_MATCH, "\"unknown\"", StatusCode::OK),
    ] {
        let headers = HeaderMap::from_iter([(name, value.parse().unwrap())]);
        let response = handler.serve_with_headers(&Method::GET, &uri, &headers, "");
        assert_eq!(response.status(), status);
        if status == StatusCode::PRECONDITION_FAILED || status == StatusCode::NOT_MODIFIED {
            assert!(!response.headers().contains_key(header::CONTENT_TYPE));
            assert!(
                to_bytes(response.into_body(), 1024)
                    .await
                    .unwrap()
                    .is_empty()
            );
        }
    }
    let headers = HeaderMap::from_iter([(header::RANGE, "bytes=-4".parse().unwrap())]);
    let response =
        handler.serve_with_headers(&Method::GET, &Uri::from_static("/empty"), &headers, "");
    assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
    assert_eq!(response.headers()[header::CONTENT_RANGE], "bytes 0--1/0");
    assert!(
        to_bytes(response.into_body(), 1024)
            .await
            .unwrap()
            .is_empty()
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn file_content_types_and_directory_indexes_follow_content() {
    let root = tempfile::tempdir().unwrap();
    let handler = FileHandler::open(root.path()).unwrap();
    for (name, bytes, mime) in [
        (
            "plain",
            b"plain text".as_slice(),
            "text/plain; charset=utf-8",
        ),
        (
            "binary",
            b"\0\x01\x02".as_slice(),
            "application/octet-stream",
        ),
        ("picture", b"\x89PNG\r\n\x1a\n".as_slice(), "image/png"),
        (
            "utf16",
            b"\xFF\xFEh\0i\0".as_slice(),
            "text/plain; charset=utf-16le",
        ),
        (
            "code.js",
            b"alert(1)".as_slice(),
            "text/javascript; charset=utf-8",
        ),
    ] {
        fs::write(root.path().join(name), bytes).unwrap();
        let response = handler.serve(&Method::GET, &format!("/{name}").parse().unwrap(), "");
        assert_eq!(response.headers()[header::CONTENT_TYPE], mime, "{name}");
        assert_eq!(
            &to_bytes(response.into_body(), 1024).await.unwrap()[..],
            bytes
        );
    }
    fs::write(root.path().join("README.md"), "# Markdown index").unwrap();
    fs::write(root.path().join("index.html"), "<h1>Preferred index</h1>").unwrap();
    let response = handler.serve(&Method::GET, &Uri::from_static("/"), "");
    assert_eq!(
        &to_bytes(response.into_body(), 1024).await.unwrap()[..],
        b"<h1>Preferred index</h1>"
    );
    fs::remove_file(root.path().join("index.html")).unwrap();
    let response = handler.serve(&Method::GET, &Uri::from_static("/"), "");
    let body = to_bytes(response.into_body(), 2_000_000).await.unwrap();
    assert!(String::from_utf8_lossy(&body).contains("# Markdown index"));
    assert!(String::from_utf8_lossy(&body).contains("\"entries\":null"));
}

#[test]
fn file_server_shutdown_closes_idle_clients_and_releases_port() {
    use std::{
        io::Read,
        net::{TcpListener, TcpStream},
        time::{Duration, Instant},
    };
    let root = tempfile::tempdir().unwrap();
    let mut server = FileServer::start(root.path(), &restartable_address()).unwrap();
    let port = server.port();
    let mut idle = TcpStream::connect(("127.0.0.1", port)).unwrap();
    idle.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
    let started = Instant::now();
    server.stop();
    assert!(started.elapsed() < Duration::from_secs(2));
    let mut byte = [0];
    match idle.read(&mut byte) {
        Ok(0) => {}
        Err(error)
            if matches!(
                error.kind(),
                std::io::ErrorKind::ConnectionReset | std::io::ErrorKind::ConnectionAborted
            ) => {}
        result => panic!("idle connection remained open: {result:?}"),
    }
    // Use the same reuse-address semantics as a real service replacement.
    // A plain listener can reject a released port while connections are in TIME_WAIT.
    let mut replacement = FileServer::start(root.path(), &format!("127.0.0.1:{port}")).unwrap();
    assert!(FileServer::start(root.path(), &format!("127.0.0.1:{port}")).is_err());
    replacement.stop();
    assert!(FileServer::start(&root.path().join("missing"), "127.0.0.1:0").is_err());
    // A port held by a live listener fails at once, without waiting for closing connections to release it.
    let occupied = TcpListener::bind("127.0.0.1:0").unwrap();
    let attempted = Instant::now();
    assert!(FileServer::start(root.path(), &occupied.local_addr().unwrap().to_string()).is_err());
    assert!(attempted.elapsed() < Duration::from_secs(1));
}

#[test]
fn file_server_restarts_after_closing_an_http_connection() {
    use std::{
        io::{Read, Write},
        net::TcpStream,
        time::Duration,
    };

    let root = tempfile::tempdir().unwrap();
    fs::write(root.path().join("note.txt"), "served content").unwrap();
    let mut server = FileServer::start(root.path(), &restartable_address()).unwrap();
    let address = format!("127.0.0.1:{}", server.port());
    assert!(FileServer::start(root.path(), &address).is_err());
    let mut client = TcpStream::connect(&address).unwrap();
    client
        .set_read_timeout(Some(Duration::from_secs(2)))
        .unwrap();
    client
        .write_all(b"GET /note.txt HTTP/1.1\r\nHost: localhost\r\n\r\n")
        .unwrap();
    let mut response = Vec::new();
    while !response.ends_with(b"served content") {
        let mut bytes = [0; 4096];
        let count = client.read(&mut bytes).unwrap();
        assert_ne!(count, 0, "response ended before the file body");
        response.extend_from_slice(&bytes[..count]);
    }
    server.stop();
    assert_eq!(client.read(&mut [0]).unwrap(), 0);
    drop(client);
    let mut replacement = FileServer::start(root.path(), &address).unwrap();
    replacement.stop();
}

#[test]
fn file_server_restarts_when_inherited_listener_is_released() {
    use std::{io::Write, os::fd::AsRawFd, os::unix::net::UnixStream};

    struct Child {
        pid: libc::pid_t,
        release: UnixStream,
    }
    impl Drop for Child {
        fn drop(&mut self) {
            let _ = self.release.write_all(b"x");
            // SAFETY: pid identifies this test's child; no other owner waits it.
            while unsafe { libc::waitpid(self.pid, std::ptr::null_mut(), 0) } < 0 {
                if std::io::Error::last_os_error().kind() != std::io::ErrorKind::Interrupted {
                    break;
                }
            }
        }
    }

    let root = tempfile::tempdir().unwrap();
    let mut server = FileServer::start(root.path(), &restartable_address()).unwrap();
    let address = format!("127.0.0.1:{}", server.port());
    let (release, held) = UnixStream::pair().unwrap();
    let held_fd = held.as_raw_fd();
    // SAFETY: the child calls only async-signal-safe syscalls and _exit, never
    // Rust destructors or runtime code inherited from the multithreaded parent.
    let pid = unsafe { libc::fork() };
    assert!(pid >= 0, "fork: {}", std::io::Error::last_os_error());
    if pid == 0 {
        let mut byte = [0_u8];
        // SAFETY: held_fd was valid at fork and remains open in the child;
        // byte is writable. Alarm bounds the child if the parent terminates.
        unsafe {
            libc::alarm(10);
            libc::read(held_fd, byte.as_mut_ptr().cast(), byte.len());
            libc::_exit(0);
        }
    }
    let child = Child { pid, release };
    drop(held);
    server.stop();
    #[cfg(target_os = "macos")]
    {
        assert!(FileServer::start(root.path(), &address).is_err());
        drop(child);
    }
    let mut replacement = FileServer::start(root.path(), &address).unwrap();
    replacement.stop();
    #[cfg(not(target_os = "macos"))]
    drop(child);
}
