#![cfg(any(target_os = "linux", target_os = "macos"))]

use std::{
    fs::{self, OpenOptions},
    net::TcpListener,
    os::unix::{
        fs::{PermissionsExt, symlink},
        process::CommandExt,
    },
    path::{Path, PathBuf},
    process::{Child, Command, Output, Stdio},
    thread,
    time::{Duration, Instant},
};

use cli_command_kit::Mode;
use devhost_rust::{
    caddy::{
        self,
        stacks::{read_live_stack_owners, read_live_stacks},
    },
    config::CaddySettings,
    procid,
};
use serde_json::{Value, json};

#[path = "stack_commands/agents.rs"]
mod agents;
#[path = "stack_commands/chat.rs"]
mod chat;
#[path = "stack_commands/info.rs"]
mod info;

fn binary() -> PathBuf {
    std::env::var_os("DEVHOST_STACK_TEST_BINARY")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_BIN_EXE_devhost")))
}

#[track_caller]
fn wait_until(mut ready: impl FnMut() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(15);
    while !ready() {
        assert!(Instant::now() < deadline, "condition did not become ready");
        thread::sleep(Duration::from_millis(20));
    }
}

struct Process(Child);
impl Drop for Process {
    fn drop(&mut self) {
        let pid = self.0.id() as i32;
        unsafe {
            libc::kill(-pid, libc::SIGTERM);
        }
        let deadline = Instant::now() + Duration::from_secs(3);
        while self.0.try_wait().ok().flatten().is_none() && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(20));
        }
        unsafe {
            libc::kill(-pid, libc::SIGKILL);
        }
        let _ = self.0.wait();
    }
}

fn sleeper() -> Process {
    let mut command = Command::new("sleep");
    command
        .arg("300")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    unsafe {
        command.pre_exec(|| {
            if libc::setsid() < 0 {
                Err(std::io::Error::last_os_error())
            } else {
                Ok(())
            }
        });
    }
    Process(command.spawn().unwrap())
}

fn record(root: &Path, relative: &str, value: Value) {
    let path = root.join("caddy").join(relative);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, serde_json::to_vec(&value).unwrap()).unwrap();
}

fn run(root: &Path, cwd: &Path, agent: &str, args: &[&str]) -> Output {
    Command::new(binary())
        .args(args)
        .current_dir(cwd)
        .env("AGENT", agent)
        .env("DEVHOST_STATE_DIR", root)
        .env_remove("DEVHOST_MANIFEST")
        .output()
        .unwrap()
}

#[test]
fn list_and_find_all_owner_record_types_with_stable_raw_output() {
    let fixture = tempfile::tempdir().unwrap();
    let root = fixture.path();
    let process = sleeper();
    let pid = process.0.id();
    let manifest = root.join("project with spaces/devhost.toml");
    fs::create_dir_all(manifest.parent().unwrap()).unwrap();
    fs::write(&manifest, "name = 'demo'\n").unwrap();
    symlink(manifest.parent().unwrap(), root.join("alias")).unwrap();
    let mut owner =
        json!({"createdAt":"2026-11-23T00:00:00Z", "manifestPath":manifest, "ownerPid":pid});
    owner["stackName"] = json!("DemoStack");
    record(root, "stacks/one.json", owner.clone());
    owner["host"] = json!("Web.Localhost");
    record(root, "routes/.host-claims/one.json", owner.clone());
    owner["bindHost"] = json!("127.0.0.1");
    owner["port"] = json!(9234);
    record(root, "port-claims/one.json", owner.clone());
    owner["appBindHost"] = json!("127.0.0.1");
    owner["appPort"] = json!(9234);
    owner["path"] = json!("/");
    owner["serviceName"] = json!("web");
    record(root, "routes/.registrations/one.json", owner.clone());
    // A second manifest exists only in port claims; records are deduplicated
    // after filtering, and sorted by manifest then PID rather than record type.
    let second = root.join("aaa.toml");
    owner["manifestPath"] = json!(second);
    record(root, "port-claims/two.json", owner.clone());
    owner["ownerStartIdentity"] = json!("reused-pid");
    owner["manifestPath"] = json!(root.join("stale.toml"));
    record(root, "port-claims/stale.json", owner);
    let all = format!(
        "{pid}\t{}\n{pid}\t{}\n",
        second.display(),
        manifest.display()
    );
    let selected = format!("{pid}\t{}\n", manifest.display());
    for agent in ["0", "1"] {
        let output = run(root, root, agent, &["stack", "list"]);
        assert!(output.status.success(), "{:?}", output);
        assert_eq!(String::from_utf8(output.stdout).unwrap(), all);
        assert!(output.stderr.is_empty());
        for query in [
            "demoSTACK",
            "WEB.localhost",
            "https://WEB.localhost:443/path?q=x#frag",
            "alias/devhost.toml",
            "project with spaces",
            "http://user:pass@Web.Localhost/",
        ] {
            let output = run(root, root, agent, &["stack", "find", query]);
            assert!(output.status.success(), "{query}: {:?}", output);
            assert_eq!(
                String::from_utf8(output.stdout).unwrap(),
                selected,
                "{query}"
            );
            assert!(output.stderr.is_empty());
        }
        for query in ["missing", "https://missing.localhost/"] {
            let output = run(root, root, agent, &["stack", "find", query]);
            assert!(output.status.success());
            assert!(output.stdout.is_empty());
            assert!(output.stderr.is_empty());
        }
        for (query, diagnostic) in [
            ("  ", "stack query must not be empty"),
            (
                "ftp://web.localhost",
                "stack query must be an HTTP(S) URL, hostname, or name",
            ),
            (
                "http://[invalid",
                "stack query must be an HTTP(S) URL, hostname, or name",
            ),
        ] {
            let output = run(root, root, agent, &["stack", "find", query]);
            assert!(!output.status.success());
            assert!(String::from_utf8_lossy(&output.stderr).contains(diagnostic));
            assert!(output.stdout.is_empty());
        }
    }
    assert_eq!(
        read_live_stack_owners(&root.join("caddy")).unwrap().len(),
        2
    );
    fs::write(root.join("caddy/stacks/one.json"), "invalid JSON").unwrap();
    for agent in ["0", "1"] {
        for args in [vec!["stack", "list"], vec!["stack", "find", "demo"]] {
            let output = run(root, root, agent, &args);
            assert!(!output.status.success());
            assert!(output.stdout.is_empty());
            assert!(String::from_utf8_lossy(&output.stderr).contains("Stack record is malformed"));
        }
    }
}

struct Runtime {
    root: tempfile::TempDir,
    settings: CaddySettings,
    config: PathBuf,
}

impl Runtime {
    fn start() -> Self {
        // Serialize allocation through Caddy's bind and retain prior choices.
        static PORTS: std::sync::OnceLock<std::sync::Mutex<std::collections::BTreeSet<u16>>> =
            std::sync::OnceLock::new();
        let mut allocated = PORTS.get_or_init(Default::default).lock().unwrap();
        let root = tempfile::tempdir().unwrap();
        let listeners: Vec<_> = (0..3)
            .map(|_| {
                loop {
                    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
                    if allocated.insert(listener.local_addr().unwrap().port()) {
                        break listener;
                    }
                }
            })
            .collect();
        let ports: Vec<_> = listeners
            .iter()
            .map(|listener| listener.local_addr().unwrap().port())
            .collect();
        let settings = CaddySettings {
            admin_address: format!("127.0.0.1:{}", ports[0]),
            bind_host: "127.0.0.1".to_owned(),
            http_enabled: true,
            http_port: ports[1],
            https_port: ports[2],
            stack_directory_host: String::new(),
            stack_directory_allow_remote: false,
        };
        drop(listeners);
        let config = root.path().join("config");
        fs::create_dir(&config).unwrap();
        fs::write(config.join("config.toml"), format!("[caddy]\nadminAddress = {:?}\nbindHost = '127.0.0.1'\nhttp = true\nhttpPort = {}\nhttpsPort = {}\n", settings.admin_address, settings.http_port, settings.https_port)).unwrap();
        let runtime = Self {
            root,
            settings,
            config,
        };
        caddy::start_in_directory(
            &runtime.state().join("caddy"),
            &runtime.settings,
            Mode::Agent,
            &mut Vec::new(),
            true,
        )
        .unwrap();
        drop(allocated);
        runtime
    }

    fn state(&self) -> PathBuf {
        self.root.path().join("state")
    }
    fn command(&self) -> Command {
        let mut command = Command::new(binary());
        command
            .env("AGENT", "1")
            .env("DEVHOST_STATE_DIR", self.state())
            .env("DEVHOST_CONFIG_DIR", &self.config)
            .env_remove("DEVHOST_MANIFEST");
        command
    }

    fn start_stack(&self, name: &str, detach: bool) -> (PathBuf, Option<Process>) {
        let project = self.root.path().join(name);
        fs::create_dir_all(project.join("nested/deep")).unwrap();
        fs::write(project.join("devhost.toml"), format!("name = {name:?}\n[services.worker]\ncommand = ['sh', '-c', 'printf \"%s\\n\" \"$STACK_TEST_TOKEN\" >> launches; exec sleep 300']\nhealth.process = true\n")).unwrap();
        let mut command = self.command();
        command
            .current_dir(&project)
            .args(["start", "--local"])
            .env("STACK_TEST_TOKEN", format!("token-{name}"));
        let process = if detach {
            let output = command.arg("--detach").output().unwrap();
            assert!(output.status.success(), "{:?}", output);
            None
        } else {
            let log = OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(project.join("original.log"))
                .unwrap();
            command
                .stdin(Stdio::null())
                .stdout(log.try_clone().unwrap())
                .stderr(log);
            unsafe {
                command.pre_exec(|| {
                    if libc::setsid() < 0 {
                        Err(std::io::Error::last_os_error())
                    } else {
                        Ok(())
                    }
                });
            }
            Some(Process(command.spawn().unwrap()))
        };
        let deadline = Instant::now() + Duration::from_secs(15);
        while !fs::read_to_string(project.join("launches"))
            .unwrap_or_default()
            .contains(&format!("token-{name}"))
        {
            assert!(
                Instant::now() < deadline,
                "stack did not launch: {}",
                fs::read_to_string(project.join("original.log")).unwrap_or_default()
            );
            thread::sleep(Duration::from_millis(20));
        }
        wait_until(|| {
            read_live_stacks(&self.state().join("caddy"))
                .unwrap()
                .iter()
                .any(|stack| stack.name == name && stack.control_port > 0)
        });
        (project, process)
    }

    fn start_serve(&self) -> Process {
        let directory = self.root.path().join("served files");
        fs::create_dir(&directory).unwrap();
        fs::write(directory.join("index.html"), "preserved serve session").unwrap();
        let log = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(directory.join("serve.log"))
            .unwrap();
        let mut command = self.command();
        command
            .current_dir(&directory)
            .args(["serve", "--domain", "restart-serve.localhost"])
            .stdin(Stdio::null())
            .stdout(log.try_clone().unwrap())
            .stderr(log);
        // SAFETY: setsid is async-signal-safe and establishes fixture ownership.
        unsafe {
            command.pre_exec(|| {
                if libc::setsid() < 0 {
                    Err(std::io::Error::last_os_error())
                } else {
                    Ok(())
                }
            });
        }
        let child = Process(command.spawn().unwrap());
        wait_until(|| {
            read_live_stacks(&self.state().join("caddy"))
                .unwrap()
                .iter()
                .any(|stack| {
                    stack.name == "serve-restart-serve.localhost" && stack.control_port > 0
                })
        });
        child
    }

    fn serve_response(&self) -> Option<String> {
        ureq::get(format!("http://127.0.0.1:{}/", self.settings.http_port))
            .header("Host", "restart-serve.localhost")
            .call()
            .ok()?
            .body_mut()
            .read_to_string()
            .ok()
    }
}

impl Drop for Runtime {
    fn drop(&mut self) {
        let caddy = self.state().join("caddy");
        if let Ok(stacks) = read_live_stacks(&caddy) {
            for stack in &stacks {
                if stack.is_alive() {
                    unsafe {
                        libc::kill(stack.pid, libc::SIGTERM);
                    }
                }
            }
            let deadline = Instant::now() + Duration::from_secs(5);
            while stacks.iter().any(|stack| stack.is_alive()) && Instant::now() < deadline {
                thread::sleep(Duration::from_millis(20));
            }
            for stack in stacks {
                if stack.is_alive() {
                    unsafe {
                        libc::kill(-stack.pid, libc::SIGKILL);
                    }
                }
            }
        }
        let _ = caddy::stop_in_directory(&caddy, &self.settings, Mode::Agent, &mut Vec::new());
    }
}

#[test]
fn restart_preserves_foreground_and_detached_launches_and_isolates_projects() {
    let runtime = Runtime::start();
    let (project, _foreground) = runtime.start_stack("foreground", false);
    let (other, _) = runtime.start_stack("detached", true);
    let caddy = runtime.state().join("caddy");
    let original = read_live_stacks(&caddy).unwrap();
    let foreground = original
        .iter()
        .find(|stack| stack.name == "foreground")
        .unwrap();
    let detached = original
        .iter()
        .find(|stack| stack.name == "detached")
        .unwrap();
    let output = runtime
        .command()
        .current_dir(project.join("nested/deep"))
        .args(["stack", "restart"])
        .output()
        .unwrap();
    assert!(output.status.success(), "{:?}", output);
    assert!(String::from_utf8_lossy(&output.stdout).contains("services may still be starting"));
    wait_until(|| {
        fs::read_to_string(project.join("launches"))
            .unwrap()
            .lines()
            .count()
            == 2
    });
    assert_eq!(
        fs::read_to_string(project.join("launches")).unwrap(),
        "token-foreground\ntoken-foreground\n"
    );
    assert!(!procid::is_process_alive(foreground.pid));
    assert!(detached.is_alive());
    assert_eq!(
        fs::read_to_string(other.join("launches"))
            .unwrap()
            .lines()
            .count(),
        1
    );
    let output = runtime
        .command()
        .current_dir(&other)
        .args(["stack", "restart", "-m", "devhost.toml"])
        .output()
        .unwrap();
    assert!(output.status.success(), "{:?}", output);
    wait_until(|| {
        fs::read_to_string(other.join("launches"))
            .unwrap()
            .lines()
            .count()
            == 2
    });
    let replacements = read_live_stacks(&caddy).unwrap();
    let replacement = replacements
        .iter()
        .find(|stack| stack.name == "detached")
        .unwrap();
    assert_ne!(replacement.pid, detached.pid);
    assert!(replacement.log_path.contains("/restart-"));
    let mut system = sysinfo::System::new();
    let pid = sysinfo::Pid::from_u32(replacement.pid as u32);
    system.refresh_processes_specifics(
        sysinfo::ProcessesToUpdate::Some(&[pid]),
        true,
        sysinfo::ProcessRefreshKind::nothing()
            .without_tasks()
            .with_environ(sysinfo::UpdateKind::Always),
    );
    let environment = system.process(pid).unwrap().environ();
    assert!(!environment.iter().any(|entry| {
        entry
            .as_encoded_bytes()
            .starts_with(b"DEVHOST_INTERNAL_DETACHED_LOG=")
    }));
    assert!(environment.iter().any(|entry| {
        entry
            .as_encoded_bytes()
            .starts_with(b"DEVHOST_INTERNAL_STACK_LOG=")
    }));
    assert_eq!(
        fs::metadata(runtime.state().join("restart.lock"))
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o600
    );
    for entry in fs::read_dir(runtime.state())
        .unwrap()
        .flatten()
        .filter(|entry| {
            entry
                .file_name()
                .as_encoded_bytes()
                .starts_with(b"restart-")
        })
    {
        assert_eq!(
            entry.metadata().unwrap().permissions().mode() & 0o777,
            0o700
        );
        for file in fs::read_dir(entry.path()).unwrap().flatten() {
            assert_eq!(file.metadata().unwrap().permissions().mode() & 0o777, 0o600);
            assert!(
                !fs::read_to_string(file.path())
                    .unwrap()
                    .contains("STACK_TEST_TOKEN=")
            );
        }
    }
}

#[test]
fn restart_all_resolves_current_project_instead_of_global_state() {
    // The owner explicitly changed this contract; Go's older global --all is
    // intentionally excluded from differential comparison for this case.
    if std::env::var_os("DEVHOST_STACK_TEST_BINARY").is_some() {
        return;
    }
    let runtime = Runtime::start();
    let (project, _one) = runtime.start_stack("one", false);
    let (_other, _two) = runtime.start_stack("two", false);
    let before = read_live_stacks(&runtime.state().join("caddy")).unwrap();
    let other = before.iter().find(|stack| stack.name == "two").unwrap();
    let output = runtime
        .command()
        .current_dir(project.join("nested"))
        .args(["stack", "restart", "--all"])
        .output()
        .unwrap();
    assert!(output.status.success(), "{:?}", output);
    assert!(other.is_alive());
    let output = runtime
        .command()
        .current_dir(runtime.root.path())
        .args(["stack", "restart", "--all"])
        .output()
        .unwrap();
    assert!(!output.status.success());
    assert!(other.is_alive());
}

#[test]
fn global_restart_works_outside_a_project_and_preserves_serve_sessions() {
    let runtime = Runtime::start();
    let (one, _first) = runtime.start_stack("one", false);
    let (two, _second) = runtime.start_stack("two", false);
    let _serve = runtime.start_serve();
    wait_until(|| runtime.serve_response().as_deref() == Some("preserved serve session"));
    let caddy = runtime.state().join("caddy");
    let before = read_live_stacks(&caddy).unwrap();
    assert_eq!(before.len(), 3);
    let args = if std::env::var_os("DEVHOST_STACK_TEST_BINARY").is_some() {
        vec!["stack", "restart", "--all"]
    } else {
        vec!["restart-all"]
    };
    let output = runtime
        .command()
        .current_dir(runtime.root.path())
        .args(args)
        .output()
        .unwrap();
    assert!(output.status.success(), "{:?}", output);
    wait_until(|| {
        [&one, &two].iter().all(|project| {
            fs::read_to_string(project.join("launches"))
                .unwrap_or_default()
                .lines()
                .count()
                == 2
        })
    });
    wait_until(|| runtime.serve_response().as_deref() == Some("preserved serve session"));
    let after = read_live_stacks(&caddy).unwrap();
    assert_eq!(after.len(), 3);
    for stack in &before {
        assert!(!stack.is_alive());
        let replacement = after
            .iter()
            .find(|replacement| replacement.name == stack.name)
            .unwrap();
        assert_ne!(replacement.pid, stack.pid);
        assert!(replacement.control_port > 0);
    }
}
