use super::*;
use async_tungstenite::{WebSocketStream, tokio::TokioAdapter, tungstenite::Message};
use futures_util::StreamExt;

type Socket = WebSocketStream<TokioAdapter<tokio::net::TcpStream>>;

async fn connect(origin: &str, small_buffer: bool) -> Socket {
    let address = origin.strip_prefix("http://").unwrap();
    let stream = std::net::TcpStream::connect(address).unwrap();
    if small_buffer {
        use std::os::fd::AsRawFd;
        let size: libc::c_int = 4096;
        // SAFETY: the descriptor is live and size points to a correctly sized integer.
        assert_eq!(
            unsafe {
                libc::setsockopt(
                    stream.as_raw_fd(),
                    libc::SOL_SOCKET,
                    libc::SO_RCVBUF,
                    (&size as *const libc::c_int).cast(),
                    std::mem::size_of_val(&size) as libc::socklen_t,
                )
            },
            0
        );
    }
    stream.set_nonblocking(true).unwrap();
    let stream = tokio::net::TcpStream::from_std(stream).unwrap();
    let url = format!("ws://{address}/__devhost__/ws/logs");
    async_tungstenite::tokio::client_async(url, stream)
        .await
        .unwrap()
        .0
}

async fn frame(socket: &mut Socket) -> Value {
    let frame = tokio::time::timeout(Duration::from_secs(25), socket.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    let Message::Text(text) = frame else {
        panic!("missing log frame: {frame:?}")
    };
    serde_json::from_str(&text).unwrap()
}

async fn snapshot(origin: &str, phase: usize, count: usize) -> Value {
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        let mut socket = connect(origin, false).await;
        let value = frame(&mut socket).await;
        assert_eq!(value["type"], "snapshot");
        let entries = value["entries"].as_array().unwrap();
        if entries.last().is_some_and(|entry| {
            entry["line"]
                .as_str()
                .unwrap()
                .contains(&format!("burst{phase}-{} ", count - 1))
        }) {
            assert_eq!(entries.len(), 512);
            for (offset, entry) in entries.iter().enumerate() {
                assert_eq!(entry["serviceName"], "worker");
                assert_eq!(entry["stream"], "stdout");
                assert!(
                    entry["line"]
                        .as_str()
                        .unwrap()
                        .contains(&format!("burst{phase}-{} ", count - 512 + offset))
                );
                if offset > 0 {
                    assert_eq!(
                        entry["id"].as_u64().unwrap(),
                        entries[offset - 1]["id"].as_u64().unwrap() + 1
                    );
                }
            }
            return value;
        }
        assert!(
            Instant::now() < deadline,
            "log retention did not reach final burst entry"
        );
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

pub(super) async fn verify(project: &Path, origin: &str) {
    fs::write(
        project.join("log-bursts.py"),
        r#"import pathlib, time
for phase, count, width in [(1, 1024, 16), (2, 4096, 2048)]:
    gate = pathlib.Path(f'emit-{phase}')
    deadline = time.monotonic() + 30
    while not gate.exists():
        if time.monotonic() > deadline:
            raise RuntimeError('log fixture gate was never released')
        time.sleep(0.01)
    for index in range(count):
        print(f'burst{phase}-{index} ' + 'x' * width, flush=True)
        if phase == 2:
            time.sleep(0.0005)
    pathlib.Path(f'emitted-{phase}').write_text('done')
time.sleep(300)
"#,
    )
    .unwrap();
    let manifest = project.join("devhost.toml");
    let content = fs::read_to_string(&manifest).unwrap();
    let original = content
        .lines()
        .find(|line| line.starts_with("command = "))
        .unwrap();
    let reloads = || {
        fs::read_to_string(project.join("original.log"))
            .unwrap()
            .matches("configuration reloaded:")
            .count()
    };
    let before = reloads();
    fs::write(
        &manifest,
        content.replace(original, "command = ['python3', '-u', 'log-bursts.py']"),
    )
    .unwrap();
    wait_until(|| reloads() > before);
    assert_eq!(
        post(origin, "restart-service", json!({"serviceName":"worker"})).status(),
        200
    );
    lifecycle::ready(origin);
    fs::write(project.join("emit-1"), "ready").unwrap();
    wait_until(|| project.join("emitted-1").exists());
    snapshot(origin, 1, 1024).await;
    let mut slow = connect(origin, true).await;
    assert_eq!(frame(&mut slow).await["type"], "snapshot");
    let mut fast = connect(origin, false).await;
    assert_eq!(frame(&mut fast).await["type"], "snapshot");
    fs::write(project.join("emit-2"), "ready").unwrap();
    let deadline = Instant::now() + Duration::from_secs(25);
    let mut received = 0;
    loop {
        let value = frame(&mut fast).await;
        assert_eq!(value["type"], "entry");
        let line = value["entry"]["line"].as_str().unwrap();
        assert!(
            line.contains(&format!("burst2-{received} ")),
            "unexpected burst entry: {line}"
        );
        received += 1;
        if received % 512 == 0 {
            let started = Instant::now();
            assert_eq!(get(origin, "stack-info").status(), 200);
            assert!(
                started.elapsed() < Duration::from_secs(2),
                "unread log consumer blocked control requests"
            );
        }
        if received == 4096 {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "active log consumer stopped making progress"
        );
    }
    wait_until(|| project.join("emitted-2").exists());
    snapshot(origin, 2, 4096).await;
    drop(slow);
    drop(fast);
}
