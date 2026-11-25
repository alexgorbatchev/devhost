use super::control::{body, client, get, origin, post};
use super::*;

fn command(runtime: &Runtime, executable: &Path) -> Command {
    let mut command = Command::new(executable);
    command
        .current_dir(runtime.root.path())
        .env("AGENT", "1")
        .env("DEVHOST_STATE_DIR", runtime.state())
        .env("DEVHOST_CONFIG_DIR", &runtime.config)
        .env_remove("DEVHOST_MANIFEST");
    command
}

fn success(command: &mut Command) {
    let output = command.output().unwrap();
    assert!(output.status.success(), "{command:?}: {output:?}");
}

struct RestoreFile(PathBuf, Vec<u8>);
impl Drop for RestoreFile {
    fn drop(&mut self) {
        fs::write(&self.0, &self.1).unwrap();
    }
}

#[test]
#[ignore = "requires immutable Go and optimized Rust candidates; run by the comparison gate"]
fn partial_upgrade_retains_healthy_stack_and_recovers_through_go() {
    let go = PathBuf::from(std::env::var_os("DEVHOST_UPGRADE_GO_BINARY").unwrap());
    let rust = PathBuf::from(std::env::var_os("DEVHOST_UPGRADE_RUST_BINARY").unwrap());
    let runtime = Runtime::start();
    for (name, executable) in [("partial-go", &go), ("partial-rust", &rust)] {
        let project = runtime.root.path().join(name);
        fs::create_dir_all(project.join("public")).unwrap();
        fs::write(project.join("public/note.txt"), name).unwrap();
        fs::write(
            project.join("devhost.toml"),
            format!("name={name:?}\n[services.files]\nserve='public'\nhost='{name}.localhost'\n"),
        )
        .unwrap();
        success(
            command(&runtime, executable)
                .current_dir(&project)
                .args(["start", "--local", "--detach"]),
        );
        wait_ready(&runtime, name);
    }
    let caddy = runtime.state().join("caddy");
    let receipt = fs::read(caddy.join("runtime.json")).unwrap();
    let config = fs::read(runtime.config.join("config.toml")).unwrap();
    let ca = fs::read(caddy.join("storage/pki/authorities/local/root.key")).unwrap();
    let broken = runtime.root.path().join("partial-go/devhost.toml");
    fs::write(&broken, "invalid=[").unwrap();
    let output = command(&runtime, &rust).arg("restart").output().unwrap();
    assert_eq!(output.status.code(), Some(1), "{output:?}");
    wait_ready(&runtime, "partial-rust");
    let live = read_live_stacks(&caddy).unwrap();
    assert_eq!(live.len(), 1, "{live:?}");
    assert_eq!(live[0].name, "partial-rust");
    assert_executable(live[0].pid, &rust);
    fs::write(
        &broken,
        "name='partial-go'\n[services.files]\nserve='public'\nhost='partial-go.localhost'\n",
    )
    .unwrap();
    success(
        command(&runtime, &go)
            .current_dir(broken.parent().unwrap())
            .args(["start", "--local", "--detach"]),
    );
    let before_crash = read_live_stacks(&caddy).unwrap();
    let survivor = before_crash
        .iter()
        .find(|stack| stack.name == "partial-go")
        .unwrap();
    let crashed = before_crash
        .iter()
        .find(|stack| stack.name == "partial-rust")
        .unwrap();
    assert!(crashed.is_alive());
    assert_executable(crashed.pid, &rust);
    // This PID belongs to the isolated stack and its start identity was checked above.
    assert_eq!(unsafe { libc::kill(crashed.pid, libc::SIGKILL) }, 0);
    wait_until(|| !crashed.is_alive());
    success(
        command(&runtime, &go)
            .current_dir(runtime.root.path().join("partial-rust"))
            .args(["start", "--local", "--detach"]),
    );
    wait_ready(&runtime, "partial-rust");
    let recovered = read_live_stacks(&caddy).unwrap();
    assert_eq!(recovered.len(), 2);
    assert!(
        recovered
            .iter()
            .any(|stack| stack.pid == survivor.pid && stack.is_alive())
    );
    success(command(&runtime, &go).arg("restart-all"));
    for name in ["partial-go", "partial-rust"] {
        wait_ready(&runtime, name);
        wait_until(|| content(&runtime, name).as_deref() == Some(name));
    }
    let live = read_live_stacks(&caddy).unwrap();
    assert_eq!(live.len(), 2);
    for stack in live {
        assert_executable(stack.pid, &go);
    }
    assert_eq!(fs::read(caddy.join("runtime.json")).unwrap(), receipt);
    assert_eq!(
        fs::read(runtime.config.join("config.toml")).unwrap(),
        config
    );
    assert_eq!(
        fs::read(caddy.join("storage/pki/authorities/local/root.key")).unwrap(),
        ca
    );
}

fn mixed_runtime_guards(runtime: &Runtime, go: &Path, rust: &Path, unrelated: &Process) {
    let caddy = runtime.state().join("caddy");
    let receipt = caddy.join("runtime.json");
    let original = fs::read(&receipt).unwrap();
    thread::scope(|scope| {
        let starts: Vec<_> = [go, rust]
            .into_iter()
            .map(|executable| {
                scope.spawn(move || {
                    success(command(runtime, executable).args(["caddy", "start"]));
                })
            })
            .collect();
        for start in starts {
            start.join().unwrap();
        }
    });
    assert_eq!(fs::read(&receipt).unwrap(), original);
    {
        let _restore = RestoreFile(receipt.clone(), original.clone());
        let mut future: Value = serde_json::from_slice(&original).unwrap();
        future["restartGeneration"] = json!(2);
        let future = serde_json::to_vec(&future).unwrap();
        fs::write(&receipt, &future).unwrap();
        for executable in [go, rust] {
            for action in ["start", "stop"] {
                let output = command(runtime, executable)
                    .args(["caddy", action])
                    .output()
                    .unwrap();
                assert_eq!(output.status.code(), Some(1), "{output:?}");
                assert!(
                    String::from_utf8_lossy(&output.stderr).contains(
                        "Upgrade this devhost instance before changing shared Caddy configuration"
                    ),
                    "{output:?}"
                );
                assert_eq!(fs::read(&receipt).unwrap(), future);
            }
        }
    }
    let stale_manifest = runtime.root.path().join("stale/devhost.toml");
    fs::create_dir(stale_manifest.parent().unwrap()).unwrap();
    fs::write(&stale_manifest, "name='stale'\n").unwrap();
    record(
        &runtime.state(),
        "stacks/stale.json",
        json!({
            "createdAt":"2026-11-23T00:00:00Z", "manifestPath":stale_manifest,
            "ownerPid":unrelated.0.id(), "ownerStartIdentity":"previous-process", "stackName":"stale"
        }),
    );
    for executable in [go, rust] {
        success(command(runtime, executable).args([
            "stop",
            "--manifest",
            stale_manifest.to_str().unwrap(),
        ]));
        assert!(procid::is_process_alive(unrelated.0.id() as i32));
        assert_eq!(read_live_stacks(&caddy).unwrap().len(), 2);
    }
}

fn git(directory: &Path, args: &[&str]) {
    success(
        Command::new("git")
            .arg("-C")
            .arg(directory)
            .args(args)
            .env_remove("GIT_DIR")
            .env_remove("GIT_WORK_TREE"),
    );
}

fn content(runtime: &Runtime, name: &str) -> Option<String> {
    client()
        .get(format!(
            "http://127.0.0.1:{}/note.txt",
            runtime.settings.http_port
        ))
        .header("Host", format!("{name}.localhost"))
        .call()
        .ok()?
        .body_mut()
        .read_to_string()
        .ok()
}

fn wait_ready(runtime: &Runtime, name: &str) -> String {
    wait_until(|| {
        read_live_stacks(&runtime.state().join("caddy"))
            .unwrap()
            .iter()
            .any(|stack| stack.name == name && stack.control_port > 0)
    });
    let origin = origin(runtime, name);
    wait_until(|| body(&mut get(&origin, "stack-info"))["starting"] == false);
    origin
}

fn assert_executable(pid: i32, executable: &Path) {
    let mut system = sysinfo::System::new();
    let pid = sysinfo::Pid::from_u32(pid as u32);
    system.refresh_processes_specifics(
        sysinfo::ProcessesToUpdate::Some(&[pid]),
        true,
        sysinfo::ProcessRefreshKind::nothing()
            .without_tasks()
            .with_exe(sysinfo::UpdateKind::Always),
    );
    assert_eq!(
        system
            .process(pid)
            .unwrap()
            .exe()
            .unwrap()
            .canonicalize()
            .unwrap(),
        executable.canonicalize().unwrap(),
        "restart selected a different executable"
    );
}

#[test]
#[ignore = "requires immutable Go and optimized Rust candidates; run by the comparison gate"]
fn mixed_go_rust_restart_and_go_rollback_preserve_private_state() {
    let go = PathBuf::from(std::env::var_os("DEVHOST_UPGRADE_GO_BINARY").unwrap());
    let rust = PathBuf::from(std::env::var_os("DEVHOST_UPGRADE_RUST_BINARY").unwrap());
    let runtime = Runtime::start();
    let config_before = fs::read(runtime.config.join("config.toml")).unwrap();
    let mut projects = Vec::new();
    for (name, executable) in [("upgrade-go", &go), ("upgrade-rust", &rust)] {
        let project = runtime.root.path().join(name);
        fs::create_dir_all(project.join("public")).unwrap();
        fs::write(project.join("public/note.txt"), format!("{name} main")).unwrap();
        fs::write(
            project.join("devhost.toml"),
            format!("name={name:?}\nincludes=['services.toml']\n"),
        )
        .unwrap();
        fs::write(
            project.join("services.toml"),
            format!("[services.files]\nserve='public'\nhost='{name}.localhost'\n"),
        )
        .unwrap();
        git(&project, &["init", "-b", "main"]);
        git(
            &project,
            &["add", "devhost.toml", "services.toml", "public"],
        );
        git(
            &project,
            &[
                "-c",
                "user.name=Fixture",
                "-c",
                "user.email=fixture@example.test",
                "commit",
                "-m",
                "fixture",
            ],
        );
        let linked = runtime.root.path().join(format!("{name}-feature"));
        git(
            &project,
            &["worktree", "add", "-b", "feature", linked.to_str().unwrap()],
        );
        fs::write(linked.join("public/note.txt"), format!("{name} feature")).unwrap();
        success(
            command(&runtime, executable)
                .current_dir(&project)
                .args(["start", "--local", "--detach"]),
        );
        let origin = wait_ready(&runtime, name);
        let repository = body(&mut get(&origin, "worktrees"))["repositories"][0].clone();
        assert!(repository["id"].is_string(), "{repository}");
        assert_eq!(
            post(
                &origin,
                "worktrees",
                json!({"repositoryId":repository["id"],"path":linked})
            )
            .status(),
            200
        );
        let panel = json!({"position":{"left":12,"top":34}});
        assert_eq!(
            client()
                .put(format!("{origin}/__devhost__/chat/panel"))
                .header("Origin", &origin)
                .header("Content-Type", "application/json")
                .send(panel.to_string())
                .unwrap()
                .status(),
            204
        );
        wait_until(|| content(&runtime, name).as_deref() == Some(&format!("{name} feature")));
        projects.push((name, project, linked, repository["id"].clone(), panel));
    }
    let caddy = runtime.state().join("caddy");
    let ca = caddy.join("storage/pki/authorities/local");
    wait_until(|| ca.join("root.crt").is_file());
    let trust_before: Vec<_> = [
        "root.crt",
        "root.key",
        "intermediate.crt",
        "intermediate.key",
    ]
    .map(|name| (name, fs::read(ca.join(name)).unwrap()))
    .into();
    let unrelated = sleeper();
    mixed_runtime_guards(&runtime, &go, &rust, &unrelated);
    for (executable, restart_command) in [(&rust, "restart"), (&go, "restart-all")] {
        let before = read_live_stacks(&caddy).unwrap();
        assert_eq!(before.len(), 2);
        success(command(&runtime, executable).arg(restart_command));
        for (name, project, linked, repository, panel) in &projects {
            let origin = wait_ready(&runtime, name);
            wait_until(|| content(&runtime, name).as_deref() == Some(&format!("{name} feature")));
            let saved_panel = body(&mut get(&origin, "chat/panel"));
            for axis in ["left", "top"] {
                assert_eq!(
                    saved_panel["position"][axis].as_f64(),
                    panel["position"][axis].as_f64()
                );
            }
            let worktrees = body(&mut get(&origin, "worktrees"));
            assert_eq!(worktrees["repositories"][0]["id"], *repository);
            assert_eq!(
                worktrees["repositories"][0]["configuredPath"],
                project.to_str().unwrap()
            );
            assert_eq!(
                worktrees["repositories"][0]["runningPath"],
                linked.to_str().unwrap()
            );
        }
        let after = read_live_stacks(&caddy).unwrap();
        assert_eq!(after.len(), 2);
        for stack in &after {
            assert_executable(stack.pid, executable);
            assert!(!before.iter().any(|old| old.pid == stack.pid));
        }
        assert!(before.iter().all(|stack| !stack.is_alive()));
        assert!(procid::is_process_alive(unrelated.0.id() as i32));
        assert_eq!(
            fs::read(runtime.config.join("config.toml")).unwrap(),
            config_before
        );
        for (name, bytes) in &trust_before {
            assert_eq!(
                &fs::read(ca.join(name)).unwrap(),
                bytes,
                "CA material changed: {name}"
            );
        }
        success(command(&runtime, executable).args(["stack", "list"]));
    }
}
