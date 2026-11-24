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

fn wait_log(project: &Path, diagnostic: &str) {
    wait_until(|| {
        fs::read_to_string(project.join("lifecycle.log"))
            .unwrap_or_default()
            .contains(diagnostic)
    });
}

struct WorkerCleanup(devhost_rust::services::containment::ServiceContainment);

impl Drop for WorkerCleanup {
    fn drop(&mut self) {
        // The containment records kernel start identities before any signal.
        self.0.signal(true, libc::SIGTERM);
        self.0.signal(true, libc::SIGKILL);
    }
}

fn interrupt_and_wait(runtime: &Runtime, project: &Path, process: &mut Process, expected: i32) {
    // SAFETY: the fixture owns this unreaped supervisor.
    assert_eq!(
        unsafe { libc::kill(process.0.id() as i32, libc::SIGINT) },
        0
    );
    wait_until(|| process.0.try_wait().unwrap().is_some());
    assert_eq!(
        process.0.wait().unwrap().code(),
        Some(expected),
        "{}: {}",
        project.display(),
        fs::read_to_string(project.join("lifecycle.log")).unwrap()
    );
    assert!(
        read_live_stack_owners(&runtime.state().join("caddy"))
            .unwrap()
            .is_empty()
    );
}

#[test]
fn daemon_status_start_and_stop_failures_preserve_readiness_and_cleanup_contracts() {
    use super::control::{body, get};

    let runtime = Runtime::start();
    // This listener belongs to the fixture, not the daemon. A healthy endpoint
    // must not conceal a failed lifecycle command or be killed during cleanup.
    let listener = fixture_ports::reserve_listener();
    let port = listener.local_addr().unwrap().port();
    for (name, status, start, stop, diagnostic, ready, exit) in [
        (
            "missing-status",
            "['./missing-daemon-status']",
            "['sh','-c','touch started']",
            "['sh','-c','touch stopped']",
            "start service daemon daemon status command",
            false,
            1,
        ),
        (
            "failed-start",
            "['sh','-c','exit 1']",
            "['sh','-c','touch started; exit 7']",
            "['sh','-c','touch stopped']",
            "daemon start command",
            false,
            130,
        ),
        (
            "failed-stop",
            "['sh','-c','test -f started']",
            "['sh','-c','touch started']",
            "['sh','-c','touch stopped; exit 7']",
            "",
            true,
            1,
        ),
    ] {
        let project = project(
            &runtime,
            name,
            &format!(
                "[worktrees]\nenabled=false\n[services.daemon]\nport={port}\nlifecycle.mode='daemon'\nlifecycle.status={status}\nlifecycle.start={start}\nlifecycle.stop={stop}\nhealth.tcp={port}\nhealth.interval=25\nhealth.timeout=5000\n"
            ),
        );
        let mut process = super::lifecycle::launch(&runtime, &project, &[]);
        wait_until(|| {
            assert!(
                process.0.try_wait().unwrap().is_none(),
                "{name}: {}",
                fs::read_to_string(project.join("lifecycle.log")).unwrap()
            );
            read_live_stacks(&runtime.state().join("caddy"))
                .unwrap()
                .iter()
                .any(|stack| stack.name == name)
        });
        let origin = origin(&runtime, name);
        if ready {
            super::lifecycle::ready(&origin);
        } else {
            wait_log(&project, diagnostic);
            let snapshot = body(&mut get(&origin, "stack-info"));
            assert!(
                snapshot["services"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .all(|service| service["state"] != "ready"),
                "{snapshot}"
            );
        }
        assert_eq!(project.join("started").exists(), name != "missing-status");
        interrupt_and_wait(&runtime, &project, &mut process, exit);
        assert_eq!(project.join("stopped").exists(), ready);
        if ready {
            wait_log(&project, "daemon stop command");
        }
        // Cleanup cannot take an independently owned healthy endpoint with it.
        assert!(std::net::TcpStream::connect(("127.0.0.1", port)).is_ok());
    }
}

#[test]
fn interrupt_escalates_for_a_term_ignoring_service() {
    interrupt_stubborn_worker(false);
}

#[test]
fn interrupt_escalates_for_a_term_ignoring_daemon_start_helper() {
    interrupt_stubborn_worker(true);
}

fn interrupt_stubborn_worker(daemon: bool) {
    let runtime = Runtime::start();
    let listener = fixture_ports::reserve_listener();
    let port = listener.local_addr().unwrap().port();
    let name = if daemon {
        "stubborn-daemon-helper"
    } else {
        "stubborn-service"
    };
    let manifest = if daemon {
        format!(
            "[services.worker]\nport={port}\nlifecycle.mode='daemon'\nlifecycle.status=['sh','-c','exit 1']\nlifecycle.start=['python3','worker.py']\nlifecycle.stop=['sh','-c','exit 0']\n"
        )
    } else {
        "[services.worker]\ncommand=['python3','worker.py']\nhealth.process=true\n".to_owned()
    };
    let project = project(&runtime, name, &manifest);
    fs::write(
        project.join("worker.py"),
        r#"import os, pathlib, signal, time
def ignore(signum, frame):
    pathlib.Path('term-seen').write_text('TERM')
signal.signal(signal.SIGTERM, ignore)
signal.signal(signal.SIGINT, signal.SIG_IGN)
pathlib.Path('worker.pid.pending').write_text(str(os.getpid()))
pathlib.Path('worker.pid.pending').replace('worker.pid')
while True:
    time.sleep(0.1)
"#,
    )
    .unwrap();
    let mut process = super::lifecycle::launch(&runtime, &project, &[]);
    wait_until(|| {
        assert!(
            process.0.try_wait().unwrap().is_none(),
            "{name}: {}",
            fs::read_to_string(project.join("lifecycle.log")).unwrap()
        );
        project.join("worker.pid").exists()
    });
    let worker = pid(&project, "worker.pid");
    let _cleanup = WorkerCleanup(
        devhost_rust::services::containment::ServiceContainment::start(
            worker,
            devhost_rust::services::containment::create_service_containment_token(),
        )
        .unwrap(),
    );
    if !daemon {
        super::lifecycle::ready(&origin(&runtime, name));
    }
    let started = Instant::now();
    interrupt_and_wait(&runtime, &project, &mut process, 130);
    if !daemon {
        assert!(
            started.elapsed() >= Duration::from_secs(9),
            "shutdown skipped the termination grace period"
        );
    }
    assert_eq!(
        fs::read_to_string(project.join("term-seen")).unwrap(),
        "TERM"
    );
    wait_until(|| !procid::is_process_alive(worker));
}

#[test]
fn failed_daemon_start_retries_failed_cleanup_during_shutdown() {
    let runtime = Runtime::start();
    let listener = fixture_ports::reserve_listener();
    let port = listener.local_addr().unwrap().port();
    let project = project(
        &runtime,
        "daemon-cleanup-retry",
        &format!(
            "[services.daemon]\nport={port}\nlifecycle.mode='daemon'\nlifecycle.start=['python3','launcher.py']\nlifecycle.status=['sh','-c','test -f daemon.pid && kill -0 $(cat daemon.pid)']\nlifecycle.stop=['python3','stop.py']\nhealth.interval=25\nhealth.timeout=5000\n"
        ),
    );
    fs::write(
        project.join("launcher.py"),
        "import pathlib, subprocess, sys, time\nsubprocess.Popen([sys.executable, 'daemon.py'])\nwhile not pathlib.Path('daemon.pid').exists(): time.sleep(0.01)\nsys.exit(7)\n",
    ).unwrap();
    fs::write(
        project.join("daemon.py"),
        format!("import os, pathlib, socket, time\ns = socket.socket()\ns.bind(('127.0.0.1', {port}))\ns.listen(5)\npathlib.Path('daemon.pid.pending').write_text(str(os.getpid()))\npathlib.Path('daemon.pid.pending').replace('daemon.pid')\nwhile True: time.sleep(0.1)\n"),
    ).unwrap();
    fs::write(
        project.join("stop.py"),
        "import os, pathlib, signal, sys\np = pathlib.Path('cleanup-attempted')\nif not p.exists():\n    p.write_text('first')\n    sys.exit(7)\nos.kill(int(pathlib.Path('daemon.pid').read_text()), signal.SIGTERM)\npathlib.Path('daemon.pid').unlink()\npathlib.Path('cleanup-completed').write_text('second')\n",
    ).unwrap();
    drop(listener);
    let mut process = super::lifecycle::launch(&runtime, &project, &[]);
    wait_until(|| project.join("daemon.pid").exists());
    let daemon = pid(&project, "daemon.pid");
    let _cleanup = WorkerCleanup(
        devhost_rust::services::containment::ServiceContainment::start(
            daemon,
            devhost_rust::services::containment::create_service_containment_token(),
        )
        .unwrap(),
    );
    wait_until(|| project.join("cleanup-attempted").exists());
    wait_log(&project, "daemon start command");
    wait_log(&project, "cleanup:");
    assert!(procid::is_process_alive(daemon));
    interrupt_and_wait(&runtime, &project, &mut process, 130);
    assert_eq!(
        fs::read_to_string(project.join("cleanup-completed")).unwrap(),
        "second"
    );
    wait_until(|| !procid::is_process_alive(daemon));
    drop(TcpListener::bind(("127.0.0.1", port)).unwrap());
}
