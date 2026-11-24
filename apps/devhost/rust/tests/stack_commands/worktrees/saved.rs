use super::*;

pub(super) fn repository(runtime: &Runtime, name: &str) -> (PathBuf, PathBuf, Process) {
    let (project, process) = runtime.start_stack(name, false);
    let origin = origin(runtime, name);
    lifecycle::ready(&origin);
    fs::create_dir(project.join("public")).unwrap();
    fs::write(project.join("public/note.txt"), "main checkout").unwrap();
    fs::create_dir(project.join("extra")).unwrap();
    fs::write(project.join("extra/note.txt"), "main extra").unwrap();
    let manifest = format!(
        "name={name:?}\n[services.files]\nserve='public'\nhost='worktree-contract.localhost'\n[services.extra]\nserve='extra'\nhost='worktree-extra-contract.localhost'\ndependsOn=['files']\n"
    );
    fs::write(project.join("devhost.toml"), &manifest).unwrap();
    git(&project, &["init", "-b", "main"]);
    git(&project, &["add", "devhost.toml", "public", "extra"]);
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
    let linked = runtime.root.path().join("linked selection");
    git(
        &project,
        &["worktree", "add", "-b", "feature", linked.to_str().unwrap()],
    );
    fs::write(linked.join("public/note.txt"), "feature checkout").unwrap();
    fs::write(linked.join("extra/note.txt"), "feature extra").unwrap();
    fs::write(
        project.join("devhost.toml"),
        format!("{manifest}\n# discover Git\n"),
    )
    .unwrap();
    wait_until(|| content(runtime).as_deref() == Some("main checkout"));
    wait_until(|| {
        let mut response = get(&origin, "worktrees");
        response.status() == 200
            && body(&mut response)["repositories"][0]["serviceNames"] == json!(["files", "extra"])
    });
    (project, linked, process.unwrap())
}

#[test]
fn invalid_saved_selection_rejects_start_and_missing_checkout_recovers_without_partial_start() {
    let runtime = Runtime::start();
    let name = "saved-contract";
    let (project, linked, mut process) = repository(&runtime, name);
    let origin = origin(&runtime, name);
    let repository = body(&mut get(&origin, "worktrees"))["repositories"][0].clone();
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
    lifecycle::stop(&runtime, &project, &mut process);
    let selections: Vec<_> = fs::read_dir(runtime.state().join("worktrees"))
        .unwrap()
        .map(|entry| entry.unwrap().path().join("active.json"))
        .filter(|path| path.exists())
        .collect();
    assert_eq!(selections.len(), 1);
    let selection = &selections[0];
    let original = fs::read(selection).unwrap();
    for invalid in [
        "{".to_owned(),
        json!({"repositoryId":repository["id"],"path":"relative"}).to_string(),
        json!({"repositoryId":"","path":linked}).to_string(),
    ] {
        fs::write(selection, &invalid).unwrap();
        let output = runtime
            .command()
            .current_dir(&project)
            .args(["start", "--local", "--detach"])
            .output()
            .unwrap();
        assert!(!output.status.success(), "{output:?}");
        assert!(
            String::from_utf8_lossy(&output.stderr).contains("invalid saved worktree"),
            "{output:?}"
        );
        assert_eq!(fs::read_to_string(selection).unwrap(), invalid);
        assert!(
            read_live_stack_owners(&runtime.state().join("caddy"))
                .unwrap()
                .is_empty()
        );
        assert_ne!(content(&runtime).as_deref(), Some("feature checkout"));
    }
    fs::write(selection, &original).unwrap();
    git(
        &project,
        &["worktree", "remove", "--force", linked.to_str().unwrap()],
    );
    let mut restored = lifecycle::launch(&runtime, &project, &[]);
    let origin = control::origin(&runtime, name);
    let mut stopped = Value::Null;
    wait_until(|| {
        let mut response = get(&origin, "worktrees");
        if response.status() != 200 {
            return false;
        }
        stopped = body(&mut response)["repositories"][0].clone();
        stopped["runningPath"] == ""
            && stopped["error"]
                .as_str()
                .is_some_and(|error| !error.is_empty())
    });
    assert_eq!(stopped["selectedPath"], linked.to_str().unwrap());
    assert_eq!(stopped["configuredPath"], project.to_str().unwrap());
    assert_ne!(content(&runtime).as_deref(), Some("main checkout"));
    assert_ne!(
        content_at(&runtime, "worktree-extra-contract.localhost").as_deref(),
        Some("main extra")
    );
    assert_eq!(fs::read(selection).unwrap(), original);
    assert_eq!(
        post(
            &origin,
            "worktrees",
            json!({"repositoryId":repository["id"],"path":project})
        )
        .status(),
        200
    );
    wait_until(|| content(&runtime).as_deref() == Some("main checkout"));
    assert_eq!(
        content_at(&runtime, "worktree-extra-contract.localhost").as_deref(),
        Some("main extra")
    );
    let recovered = body(&mut get(&origin, "worktrees"))["repositories"][0].clone();
    assert_eq!(recovered["runningPath"], project.to_str().unwrap());
    assert_eq!(recovered["selectedPath"], project.to_str().unwrap());
    let saved: Value = serde_json::from_slice(&fs::read(selection).unwrap()).unwrap();
    assert_eq!(saved["repositoryId"], repository["id"]);
    assert_eq!(saved["path"], project.to_str().unwrap());
    lifecycle::stop(&runtime, &project, &mut restored);
}
