use super::control::origin;
use super::*;

fn project(runtime: &Runtime, name: &str, manifest: &str) -> PathBuf {
    let project = runtime.root.path().join(name);
    fs::create_dir(&project).unwrap();
    fs::write(
        project.join("devhost.toml"),
        format!("name={name:?}\n{manifest}"),
    )
    .unwrap();
    project
}

fn pid(project: &Path, name: &str) -> i32 {
    fs::read_to_string(project.join(name))
        .unwrap()
        .parse()
        .unwrap()
}

#[test]
fn daemon_inherited_output_and_invalid_log_bytes_do_not_block_readiness() {
    let runtime = Runtime::start();
    let listener = fixture_ports::reserve_listener();
    let port = listener.local_addr().unwrap().port();
    let project = project(
        &runtime,
        "daemon-pipes",
        &format!(
            "[services.daemon]\nport={port}\nlifecycle.mode='daemon'\nlifecycle.start=['python3','launcher.py']\nlifecycle.status=['sh','-c','test -f daemon.pid && kill -0 $(cat daemon.pid)']\nlifecycle.stop=['sh','-c','kill $(cat daemon.pid); rm daemon.pid; printf stopped > stopped']\nhealth.interval=25\nhealth.timeout=5000\n"
        ),
    );
    fs::write(
        project.join("launcher.py"),
        r#"import subprocess, sys
subprocess.Popen([sys.executable, 'daemon.py'])
"#,
    )
    .unwrap();
    fs::write(
        project.join("daemon.py"),
        format!(
            r#"import os, pathlib, socket, time
s = socket.socket()
s.bind(('127.0.0.1', {port}))
s.listen(5)
pathlib.Path('daemon.pid.pending').write_text(str(os.getpid()))
pathlib.Path('daemon.pid.pending').replace('daemon.pid')
os.write(1, b'opaque-\xff\n')
os.write(1, b'after-invalid-byte\n')
time.sleep(300)
"#
        ),
    )
    .unwrap();
    drop(listener);
    let mut process = super::lifecycle::launch(&runtime, &project, &[]);
    wait_until(|| project.join("daemon.pid").exists());
    let daemon = pid(&project, "daemon.pid");
    let origin = origin(&runtime, "daemon-pipes");
    super::lifecycle::ready(&origin);
    wait_until(|| {
        fs::read(project.join("lifecycle.log"))
            .unwrap()
            .windows(b"after-invalid-byte".len())
            .any(|text| text == b"after-invalid-byte")
    });
    assert!(procid::is_process_alive(daemon));
    super::lifecycle::stop(&runtime, &project, &mut process);
    assert_eq!(
        fs::read_to_string(project.join("stopped")).unwrap(),
        "stopped"
    );
    wait_until(|| !procid::is_process_alive(daemon));
    let listener = TcpListener::bind(("127.0.0.1", port)).unwrap();
    drop(listener);
}

#[test]
fn interrupt_cancels_a_cooperative_daemon_start_helper() {
    let runtime = Runtime::start();
    let listener = fixture_ports::reserve_listener();
    let port = listener.local_addr().unwrap().port();
    let project = project(
        &runtime,
        "daemon-cancel",
        &format!(
            "[services.daemon]\nport={port}\nlifecycle.mode='daemon'\nlifecycle.start=['python3','helper.py']\nlifecycle.status=['sh','-c','exit 1']\nlifecycle.stop=['sh','-c','exit 0']\n"
        ),
    );
    fs::write(
        project.join("helper.py"),
        r#"import os, pathlib, signal, sys, time
def terminate(signum, frame):
    pathlib.Path('terminated').write_text('TERM')
    sys.exit(0)
signal.signal(signal.SIGTERM, terminate)
pathlib.Path('helper.pid.pending').write_text(str(os.getpid()))
pathlib.Path('helper.pid.pending').replace('helper.pid')
while True:
    time.sleep(0.1)
"#,
    )
    .unwrap();
    let mut process = super::lifecycle::launch(&runtime, &project, &[]);
    wait_until(|| project.join("helper.pid").exists() || process.0.try_wait().unwrap().is_some());
    assert!(
        project.join("helper.pid").exists(),
        "{}",
        fs::read_to_string(project.join("lifecycle.log")).unwrap()
    );
    let helper = pid(&project, "helper.pid");
    let started = Instant::now();
    // SAFETY: this unreaped child belongs to the fixture.
    assert_eq!(
        unsafe { libc::kill(process.0.id() as i32, libc::SIGINT) },
        0
    );
    wait_until(|| process.0.try_wait().unwrap().is_some());
    assert!(started.elapsed() < Duration::from_secs(3));
    assert_eq!(process.0.wait().unwrap().code(), Some(130));
    assert_eq!(
        fs::read_to_string(project.join("terminated")).unwrap(),
        "TERM"
    );
    wait_until(|| !procid::is_process_alive(helper));
    assert!(
        read_live_stack_owners(&runtime.state().join("caddy"))
            .unwrap()
            .is_empty()
    );
}
