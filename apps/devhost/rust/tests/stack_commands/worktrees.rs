use super::control::{body, client, get, origin, post};
use super::*;

#[path = "worktrees/owners.rs"]
mod owners;
#[path = "worktrees/recovery.rs"]
mod recovery;
#[path = "worktrees/saved.rs"]
mod saved;
#[path = "worktrees/submodule.rs"]
mod submodule;

fn git(directory: &Path, args: &[&str]) {
    let output = Command::new("git")
        .arg("-C")
        .arg(directory)
        .args(args)
        .env_remove("GIT_DIR")
        .env_remove("GIT_WORK_TREE")
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{args:?}: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

fn content(runtime: &Runtime) -> Option<String> {
    content_at(runtime, "worktree-contract.localhost")
}

fn content_at(runtime: &Runtime, host: &str) -> Option<String> {
    client()
        .get(format!(
            "http://127.0.0.1:{}/note.txt",
            runtime.settings.http_port
        ))
        .header("Host", host)
        .call()
        .ok()?
        .body_mut()
        .read_to_string()
        .ok()
}

#[test]
fn linked_worktree_switch_rollback_restore_and_disable_match() {
    let runtime = Runtime::start();
    let (project, _process) = runtime.start_stack("worktree-contract", false);
    let origin = origin(&runtime, "worktree-contract");
    fs::create_dir(project.join("public")).unwrap();
    fs::write(project.join("public/note.txt"), "main checkout").unwrap();
    let manifest = "name='worktree-contract'\n[services.files]\nserve='public'\nhost='worktree-contract.localhost'\n";
    fs::write(project.join("devhost.toml"), manifest).unwrap();
    git(&project, &["init", "-b", "main"]);
    git(&project, &["add", "devhost.toml", "public"]);
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
    let linked = runtime.root.path().join("linked");
    git(
        &project,
        &["worktree", "add", "-b", "feature", linked.to_str().unwrap()],
    );
    fs::write(linked.join("public/note.txt"), "feature checkout").unwrap();
    // The Git root exists before this reload discovers its checkout group.
    fs::write(
        project.join("devhost.toml"),
        format!("{manifest}\n# discover repository\n"),
    )
    .unwrap();
    wait_until(|| content(&runtime).as_deref() == Some("main checkout"));
    let mut repository = Value::Null;
    wait_until(|| {
        let mut response = get(&origin, "worktrees");
        if response.status() != 200 {
            return false;
        }
        repository = body(&mut response)["repositories"][0].clone();
        repository["serviceNames"] == json!(["files"])
    });
    assert_eq!(repository["configuredPath"], project.to_str().unwrap());
    assert_eq!(repository["defaultBranch"], "");
    for remote in ["origin", "upstream"] {
        let reference = format!("refs/remotes/{remote}/release/stable");
        git(&project, &["update-ref", &reference, "HEAD"]);
        git(
            &project,
            &[
                "symbolic-ref",
                &format!("refs/remotes/{remote}/HEAD"),
                &reference,
            ],
        );
    }
    git(&linked, &["checkout", "--detach"]);
    git(&project, &["worktree", "lock", linked.to_str().unwrap()]);
    let metadata = body(&mut get(&origin, "worktrees"));
    let refreshed = &metadata["repositories"][0];
    assert_eq!(refreshed["defaultBranch"], "release/stable");
    let checkout = refreshed["worktrees"]
        .as_array()
        .unwrap()
        .iter()
        .find(|entry| entry["path"] == linked.to_str().unwrap())
        .unwrap();
    assert_eq!(checkout["detached"], true);
    assert_eq!(checkout["available"], true);
    assert_eq!(checkout["branch"], "");
    assert_eq!(
        post(
            &origin,
            "worktrees",
            json!({"repositoryId":repository["id"],"path":linked})
        )
        .status(),
        200
    );
    wait_until(|| content(&runtime).as_deref() == Some("feature checkout"));
    let snapshot = body(&mut get(&origin, "worktrees"));
    assert_eq!(
        snapshot["repositories"][0]["runningPath"],
        linked.to_str().unwrap()
    );
    git(
        &project,
        &["update-ref", "refs/remotes/upstream/trunk", "HEAD"],
    );
    git(
        &project,
        &[
            "symbolic-ref",
            "refs/remotes/upstream/HEAD",
            "refs/remotes/upstream/trunk",
        ],
    );
    let conflicting = body(&mut get(&origin, "worktrees"));
    assert_eq!(conflicting["repositories"][0]["defaultBranch"], "");
    assert_eq!(
        conflicting["repositories"][0]["runningPath"],
        linked.to_str().unwrap()
    );
    assert_eq!(content(&runtime).as_deref(), Some("feature checkout"));
    let stack = read_live_stacks(&runtime.state().join("caddy"))
        .unwrap()
        .into_iter()
        .find(|stack| stack.name == "worktree-contract")
        .unwrap();
    assert_eq!(
        stack.manifest_path,
        project.join("devhost.toml").to_str().unwrap()
    );
    fs::write(
        project.join("devhost.toml"),
        manifest.replace("serve='public'", "serve='missing-root'"),
    )
    .unwrap();
    assert_eq!(
        post(
            &origin,
            "worktrees",
            json!({"repositoryId":repository["id"],"path":project})
        )
        .status(),
        500
    );
    wait_until(|| content(&runtime).as_deref() == Some("feature checkout"));
    assert_eq!(
        body(&mut get(&origin, "worktrees"))["repositories"][0]["selectedPath"],
        linked.to_str().unwrap()
    );
    fs::write(project.join("devhost.toml"), manifest).unwrap();
    let stopped = runtime
        .command()
        .current_dir(&project)
        .arg("stop")
        .output()
        .unwrap();
    assert!(stopped.status.success(), "{stopped:?}");
    let started = runtime
        .command()
        .current_dir(&project)
        .args(["start", "--local", "--detach"])
        .output()
        .unwrap();
    assert!(started.status.success(), "{started:?}");
    wait_until(|| content(&runtime).as_deref() == Some("feature checkout"));
    let origin = control::origin(&runtime, "worktree-contract");
    let snapshot = body(&mut get(&origin, "worktrees"));
    assert_eq!(
        snapshot["repositories"][0]["configuredPath"],
        project.to_str().unwrap()
    );
    assert_eq!(
        snapshot["repositories"][0]["runningPath"],
        linked.to_str().unwrap()
    );
    fs::write(
        linked.join("devhost.toml"),
        format!("{manifest}\n[worktrees]\nenabled=false\n"),
    )
    .unwrap();
    wait_until(|| content(&runtime).as_deref() == Some("main checkout"));
    let stopped = runtime
        .command()
        .current_dir(&project)
        .args(["stop", "--worktrees"])
        .output()
        .unwrap();
    assert!(stopped.status.success(), "{stopped:?}");
    wait_until(|| !stack.is_alive());
    assert!(
        read_live_stacks(&runtime.state().join("caddy"))
            .unwrap()
            .is_empty()
    );
    git(&project, &["worktree", "unlock", linked.to_str().unwrap()]);
    git(
        &project,
        &["worktree", "remove", "--force", linked.to_str().unwrap()],
    );
}
