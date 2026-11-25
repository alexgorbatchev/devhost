use super::*;

#[test]
fn submodule_switch_preserves_identity_and_external_manifest_fallback() {
    let runtime = Runtime::start();
    let (project, process) = runtime.start_stack("submodule-contract", false);
    let mut process = process.unwrap();
    let origin = origin(&runtime, "submodule-contract");
    lifecycle::ready(&origin);
    let source = runtime.root.path().join("source shop");
    fs::create_dir_all(source.join("public")).unwrap();
    fs::write(source.join("public/note.txt"), "submodule checkout").unwrap();
    let local_manifest = "name='submodule-contract'\n[services.files]\nserve='public'\nhost='worktree-contract.localhost'\n";
    fs::write(source.join("devhost.toml"), local_manifest).unwrap();
    git(&source, &["init", "-b", "main"]);
    git(&source, &["add", "."]);
    git(
        &source,
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
    git(&project, &["init", "-b", "main"]);
    git(
        &project,
        &[
            "-c",
            "protocol.file.allow=always",
            "submodule",
            "add",
            source.to_str().unwrap(),
            "packages/shop",
        ],
    );
    let module = project.join("packages/shop");
    let linked = runtime.root.path().join("linked shop");
    git(
        &module,
        &[
            "worktree",
            "add",
            "-b",
            "feature/submodule",
            linked.to_str().unwrap(),
        ],
    );
    fs::write(linked.join("public/note.txt"), "linked submodule").unwrap();
    fs::remove_file(module.join("devhost.toml")).unwrap();
    fs::write(
        project.join("devhost.toml"),
        local_manifest.replace("serve='public'", "serve='packages/shop/public'"),
    )
    .unwrap();
    wait_until(|| content(&runtime).as_deref() == Some("submodule checkout"));
    let repository = body(&mut get(&origin, "worktrees"))["repositories"][0].clone();
    assert_eq!(repository["configuredPath"], module.to_str().unwrap());
    assert_eq!(repository["serviceNames"], json!(["files"]));
    assert_eq!(repository["worktrees"].as_array().unwrap().len(), 2);
    for path in [&linked, &module] {
        let mut response = post(
            &origin,
            "worktrees",
            json!({"repositoryId":repository["id"],"path":path}),
        );
        assert_eq!(response.status(), 200, "{}", body(&mut response));
        let expected = if path == &linked {
            "linked submodule"
        } else {
            "submodule checkout"
        };
        wait_until(|| content(&runtime).as_deref() == Some(expected));
        let selected = body(&mut get(&origin, "worktrees"))["repositories"][0].clone();
        assert_eq!(selected["id"], repository["id"]);
        assert_eq!(selected["configuredPath"], module.to_str().unwrap());
        assert_eq!(selected["runningPath"], path.to_str().unwrap());
    }
    // A checkout-local manifest takes precedence over the retained owning file.
    fs::create_dir(module.join("alternate")).unwrap();
    fs::write(module.join("alternate/note.txt"), "local manifest override").unwrap();
    fs::write(
        module.join("devhost.toml"),
        local_manifest.replace("serve='public'", "serve='alternate'"),
    )
    .unwrap();
    assert_eq!(
        post(
            &origin,
            "worktrees",
            json!({"repositoryId":repository["id"],"path":module})
        )
        .status(),
        200
    );
    wait_until(|| content(&runtime).as_deref() == Some("local manifest override"));
    let stacks = read_live_stacks(&runtime.state().join("caddy")).unwrap();
    assert_eq!(stacks.len(), 1);
    assert_eq!(
        stacks[0].manifest_path,
        project.join("devhost.toml").to_str().unwrap()
    );
    lifecycle::stop(&runtime, &project, &mut process);
    git(
        &module,
        &["worktree", "remove", "--force", linked.to_str().unwrap()],
    );
}
