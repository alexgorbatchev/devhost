use super::control::{body, get, origin};
use super::lifecycle::{launch, ready, stop};
use super::*;
use std::{
    io::{BufRead, BufReader, Write},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};

fn project(runtime: &Runtime, name: &str, health: &str) -> PathBuf {
    let project = runtime.root.path().join(name);
    fs::create_dir(&project).unwrap();
    fs::write(project.join("devhost.toml"), format!("name={name:?}\n[worktrees]\nenabled=false\n[services.worker]\ncommand=['sh','-c','printf %s $$ > worker.pid.pending; mv worker.pid.pending worker.pid; exec sleep 300']\n[services.worker.health]\n{health}\n")).unwrap();
    project
}

fn failed(project: &Path, diagnostic: &str) {
    wait_until(|| {
        fs::read_to_string(project.join("lifecycle.log"))
            .unwrap_or_default()
            .contains(diagnostic)
    });
}

fn finish(runtime: &Runtime, project: &Path, process: &mut Process) {
    wait_until(|| project.join("worker.pid").exists());
    let pid = fs::read_to_string(project.join("worker.pid"))
        .unwrap()
        .parse()
        .unwrap();
    stop(runtime, project, process);
    wait_until(|| !procid::is_process_alive(pid));
}

#[test]
fn process_health_ignores_network_timing_and_tcp_honors_intervals_and_deadlines() {
    let runtime = Runtime::start();
    let process_project = project(
        &runtime,
        "process-health",
        "process=true\ninterval=60000\ntimeout=1\nretries=1",
    );
    let mut process = launch(&runtime, &process_project, &[]);
    wait_until(|| {
        read_live_stacks(&runtime.state().join("caddy"))
            .unwrap()
            .iter()
            .any(|stack| stack.name == "process-health")
    });
    ready(&origin(&runtime, "process-health"));
    finish(&runtime, &process_project, &mut process);

    // A bound, non-listening socket rejects probes without releasing its port.
    let socket = socket2::Socket::new(
        socket2::Domain::IPV4,
        socket2::Type::STREAM,
        Some(socket2::Protocol::TCP),
    )
    .unwrap();
    socket
        .bind(
            &"127.0.0.1:0"
                .parse::<std::net::SocketAddr>()
                .unwrap()
                .into(),
        )
        .unwrap();
    let port = socket.local_addr().unwrap().as_socket().unwrap().port();
    for (name, interval, timeout, retries, diagnostic, minimum_ms) in [
        (
            "tcp-interval",
            600,
            10000,
            1,
            "failed its health check 2 consecutive times",
            500,
        ),
        (
            "tcp-deadline",
            200,
            850,
            0,
            "did not pass its health check within 850ms",
            800,
        ),
    ] {
        let project = project(
            &runtime,
            name,
            &format!("tcp={port}\ninterval={interval}\ntimeout={timeout}\nretries={retries}"),
        );
        let started = Instant::now();
        let mut process = launch(&runtime, &project, &[]);
        failed(&project, diagnostic);
        assert!(
            started.elapsed() >= Duration::from_millis(minimum_ms),
            "{name}: failure ignored configured probe timing"
        );
        let origin = origin(&runtime, name);
        wait_until(|| body(&mut get(&origin, "stack-info"))["starting"] == false);
        let snapshot = body(&mut get(&origin, "stack-info"));
        assert_eq!(snapshot["starting"], false, "{snapshot}");
        assert_ne!(snapshot["services"][0]["state"], "ready", "{snapshot}");
        finish(&runtime, &project, &mut process);
    }
}

struct HttpPeer {
    port: u16,
    attempts: Arc<Mutex<Vec<(Instant, u16)>>>,
    shutdown: Arc<AtomicBool>,
    thread: Option<thread::JoinHandle<()>>,
}

impl HttpPeer {
    fn start() -> Self {
        let listener = fixture_ports::reserve_listener();
        let port = listener.local_addr().unwrap().port();
        listener.set_nonblocking(true).unwrap();
        let attempts = Arc::new(Mutex::new(Vec::new()));
        let observed = attempts.clone();
        let shutdown = Arc::new(AtomicBool::new(false));
        let done = shutdown.clone();
        let thread = thread::spawn(move || {
            while !done.load(Ordering::Relaxed) {
                let (stream, _) = match listener.accept() {
                    Ok(connection) => connection,
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(5));
                        continue;
                    }
                    Err(error) => panic!("accept health request: {error}"),
                };
                stream.set_nonblocking(false).unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(1)))
                    .unwrap();
                stream
                    .set_write_timeout(Some(Duration::from_secs(1)))
                    .unwrap();
                let mut request = BufReader::new(stream);
                let mut line = String::new();
                request.read_line(&mut line).unwrap();
                let recover = line.contains("/eventually");
                loop {
                    line.clear();
                    if request.read_line(&mut line).unwrap() == 0 || line == "\r\n" {
                        break;
                    }
                }
                let status = {
                    let mut attempts = observed.lock().unwrap();
                    let status = if recover && attempts.len() >= 2 {
                        200
                    } else {
                        503
                    };
                    attempts.push((Instant::now(), status));
                    status
                };
                write!(
                    request.get_mut(),
                    "HTTP/1.1 {status} Health\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                )
                .unwrap();
            }
        });
        Self {
            port,
            attempts,
            shutdown,
            thread: Some(thread),
        }
    }
}

impl Drop for HttpPeer {
    fn drop(&mut self) {
        self.shutdown.store(true, Ordering::Relaxed);
        self.thread.take().unwrap().join().unwrap();
    }
}

#[test]
fn http_health_retries_at_configured_intervals_recovers_and_obeys_deadline() {
    let runtime = Runtime::start();
    let peer = HttpPeer::start();
    for (name, path, timeout) in [
        ("http-recover", "eventually", 5000),
        ("http-deadline", "unavailable", 850),
    ] {
        peer.attempts.lock().unwrap().clear();
        let project = project(
            &runtime,
            name,
            &format!(
                "http='http://127.0.0.1:{}/{path}'\ninterval=300\ntimeout={timeout}\nretries=0",
                peer.port
            ),
        );
        let mut process = launch(&runtime, &project, &[]);
        if path == "eventually" {
            // Control snapshots can probe health; observe startup's probes first.
            wait_until(|| {
                peer.attempts
                    .lock()
                    .unwrap()
                    .iter()
                    .any(|(_, status)| *status == 200)
            });
            ready(&origin(&runtime, name));
        } else {
            failed(&project, "did not pass its health check within 850ms");
        }
        let attempts = peer.attempts.lock().unwrap().clone();
        assert!(attempts.len() >= 3, "{attempts:?}");
        for pair in attempts[..3].windows(2) {
            assert!(
                pair[1].0.duration_since(pair[0].0) >= Duration::from_millis(250),
                "probe interval was ignored: {attempts:?}"
            );
        }
        assert_eq!(attempts[0].1, 503);
        assert_eq!(attempts[1].1, 503);
        if path == "eventually" {
            assert_eq!(attempts[2].1, 200);
        } else {
            assert_eq!(attempts[2].1, 503);
            assert!(attempts[0].0.elapsed() >= Duration::from_millis(800));
        }
        finish(&runtime, &project, &mut process);
    }
}
