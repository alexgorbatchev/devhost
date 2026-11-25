use super::*;

fn occupant(runtime: &Runtime, linked: &Path) -> Process {
    let manifest = fs::read_to_string(linked.join("devhost.toml"))
        .unwrap()
        .replace("worktree-contract.localhost", "occupied-contract.localhost")
        .replace(
            "worktree-extra-contract.localhost",
            "occupied-extra-contract.localhost",
        );
    let mut parsed: toml::Value = toml::from_str(&manifest).unwrap();
    parsed["name"] = toml::Value::String("occupied-contract".into());
    fs::write(
        linked.join("devhost.toml"),
        toml::to_string(&parsed).unwrap(),
    )
    .unwrap();
    let process = lifecycle::launch(runtime, linked, &[]);
    lifecycle::ready(&origin(runtime, "occupied-contract"));
    process
}

#[test]
fn occupied_checkout_requires_a_matching_owner_before_stopping_the_competing_stack() {
    let runtime = Runtime::start();
    let (project, linked, mut process) = saved::repository(&runtime, "owner-contract");
    let origin = origin(&runtime, "owner-contract");
    let mut occupant = occupant(&runtime, &linked);
    let refreshed = body(&mut get(&origin, "worktrees"));
    assert!(refreshed["services"].is_array(), "{refreshed}");
    let repository = refreshed["repositories"][0].clone();
    let checkout = repository["worktrees"]
        .as_array()
        .unwrap()
        .iter()
        .find(|entry| entry["path"] == linked.to_str().unwrap())
        .unwrap();
    let live_before = read_live_stacks(&runtime.state().join("caddy")).unwrap();
    let occupied_stack = live_before
        .iter()
        .find(|s| s.name == "occupied-contract")
        .unwrap();
    let primary_stack = live_before
        .iter()
        .find(|s| s.name == "owner-contract")
        .unwrap();
    assert_eq!(occupied_stack.pid, primary_stack.pid);
    assert_ne!(occupied_stack.stack_id, primary_stack.stack_id);
    assert_eq!(checkout["available"], false);
    assert_eq!(checkout["owners"].as_array().unwrap().len(), 1);
    assert_eq!(checkout["owners"][0]["pid"], occupied_stack.pid);
    assert!(!checkout["owners"][0]["urls"].as_array().unwrap().is_empty());
    let owner = checkout["owners"][0]["id"].clone();
    for (id, path, stop_id) in [
        (repository["id"].clone(), linked.clone(), json!("")),
        (json!("unknown"), linked.clone(), owner.clone()),
        (repository["id"].clone(), project.clone(), owner.clone()),
        (
            repository["id"].clone(),
            linked.clone(),
            json!("stale-owner"),
        ),
    ] {
        assert_eq!(
            post(
                &origin,
                "worktrees",
                json!({"repositoryId":id,"path":path,"stopOwnerId":stop_id})
            )
            .status(),
            500
        );
        assert!(occupant.0.try_wait().unwrap().is_none());
        assert_eq!(content(&runtime).as_deref(), Some("main checkout"));
        assert_eq!(
            content_at(&runtime, "occupied-contract.localhost").as_deref(),
            Some("feature checkout")
        );
    }
    let mut response = post(
        &origin,
        "worktrees",
        json!({"repositoryId":repository["id"],"path":linked,"stopOwnerId":owner}),
    );
    assert_eq!(response.status(), 200, "{}", body(&mut response));
    wait_until(|| occupant.0.try_wait().unwrap().is_some());
    assert_eq!(content(&runtime).as_deref(), Some("main checkout"));
    assert_ne!(
        content_at(&runtime, "occupied-contract.localhost").as_deref(),
        Some("feature checkout")
    );
    assert_eq!(
        post(
            &origin,
            "worktrees",
            json!({"repositoryId":repository["id"],"path":linked})
        )
        .status(),
        200
    );
    wait_until(|| {
        content_at(&runtime, "occupied-contract.localhost").as_deref() == Some("feature checkout")
    });
    assert_ne!(content(&runtime).as_deref(), Some("main checkout"));
    let stacks = read_live_stacks(&runtime.state().join("caddy")).unwrap();
    assert_eq!(stacks.len(), 1);
    assert_eq!(stacks[0].pid, primary_stack.pid);
    assert_eq!(stacks[0].stack_id, primary_stack.stack_id);
    assert_eq!(
        stacks[0].manifest_path,
        project.join("devhost.toml").to_str().unwrap()
    );
    lifecycle::stop(&runtime, &project, &mut process);
    git(
        &project,
        &["worktree", "remove", "--force", linked.to_str().unwrap()],
    );
}

#[test]
fn stop_worktrees_stops_the_matching_family_and_preserves_an_independent_repository() {
    let runtime = Runtime::start();
    let (project, linked, mut process) = saved::repository(&runtime, "family-contract");
    let mut occupant = occupant(&runtime, &linked);
    let (other, foreign) = runtime.start_stack("other-repository", false);
    let mut foreign = foreign.unwrap();
    git(&other, &["init", "-b", "main"]);
    lifecycle::ready(&origin(&runtime, "other-repository"));
    let output = runtime
        .command()
        .current_dir(&project)
        .args(["stop", "--worktrees"])
        .output()
        .unwrap();
    assert!(output.status.success(), "{output:?}");
    wait_until(|| {
        process.0.try_wait().unwrap().is_some() && occupant.0.try_wait().unwrap().is_some()
    });
    assert!(foreign.0.try_wait().unwrap().is_none());
    let stacks = read_live_stacks(&runtime.state().join("caddy")).unwrap();
    assert_eq!(stacks.len(), 1);
    assert_eq!(stacks[0].name, "other-repository");
    assert!(stacks[0].is_alive());
    let invalid = runtime.root.path().join("no-repository");
    fs::create_dir(&invalid).unwrap();
    fs::write(
        invalid.join("devhost.toml"),
        "name='no-repository'\n[services.worker]\ncommand=['sleep','300']\nhealth.process=true\n",
    )
    .unwrap();
    let output = runtime
        .command()
        .current_dir(&invalid)
        .args(["stop", "--worktrees"])
        .output()
        .unwrap();
    assert!(!output.status.success(), "{output:?}");
    assert!(foreign.0.try_wait().unwrap().is_none());
    lifecycle::stop(&runtime, &other, &mut foreign);
    git(
        &project,
        &["worktree", "remove", "--force", linked.to_str().unwrap()],
    );
}
