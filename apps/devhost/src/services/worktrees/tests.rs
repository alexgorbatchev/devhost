use super::*;
use crate::services::{
    resolve::{PortResolutionOptions, resolve_service_ports},
    stop::run_git,
};
use std::{os::unix::fs::symlink, process::Command};

struct Fixture {
    directory: tempfile::TempDir,
    root: PathBuf,
    linked: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("main");
        let linked = directory.path().join("feature");
        fs::create_dir_all(root.join("web")).unwrap();
        fs::create_dir_all(root.join("api")).unwrap();
        fs::write(root.join("web/keep"), "fixture").unwrap();
        fs::write(root.join("api/keep"), "fixture").unwrap();
        fs::write(root.join("devhost.toml"), "name = 'worktrees'\n[services.api]\ncwd = 'api'\ncommand = ['sleep', '300']\nhealth.process = true\n[services.web]\ncwd = 'web'\ncommand = ['sleep', '300']\nhealth.process = true\n").unwrap();
        git(&root, &["init", "-b", "main"]);
        git(&root, &["add", "."]);
        git(
            &root,
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
        git(
            &root,
            &["worktree", "add", "-b", "feature", linked.to_str().unwrap()],
        );
        Self {
            directory,
            root,
            linked,
        }
    }
    fn state(&self) -> PathBuf {
        self.directory.path().join("state")
    }
    fn resolved(&self, root: &Path) -> ResolvedManifest {
        let configuration = manifest::read_with_inputs_env(&root.join("devhost.toml"), None)
            .0
            .unwrap();
        resolve_service_ports(&configuration, &PortResolutionOptions::default()).unwrap()
    }
    fn worktrees(&self) -> Worktrees {
        Worktrees::build(
            &self.resolved(&self.root),
            &self.state(),
            None,
            "",
            &BTreeMap::new(),
        )
        .unwrap()
        .unwrap()
    }
}

fn git(root: &Path, args: &[&str]) {
    let output = Command::new("git")
        .arg("-C")
        .arg(root)
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

#[test]
fn discovery_selection_and_recovery_preserve_repository_identity_and_target_membership() {
    let fixture = Fixture::new();
    let mut worktrees = fixture.worktrees();
    let repo = worktrees.snapshot().remove(0);
    assert_eq!(repo.service_names, ["api", "web"]);
    assert_eq!(repo.worktrees.len(), 2);
    assert!(
        repo.worktrees
            .iter()
            .all(|entry| entry.available && entry.directories.len() == 2)
    );
    assert!(
        worktrees
            .prepare("missing", &fixture.linked)
            .unwrap_err()
            .contains("unknown repository")
    );
    assert!(
        worktrees
            .prepare(&repo.id, fixture.directory.path())
            .is_err()
    );
    fs::write(fixture.linked.join("devhost.toml"), "name = 'target'\n[services.worker]\ncwd = 'api'\ncommand = ['sleep', '300']\nhealth.process = true\n").unwrap();
    let configuration = worktrees.prepare(&repo.id, &fixture.linked).unwrap();
    let saved = worktrees.saved().unwrap();
    assert!(saved.is_none());
    worktrees.select(&repo.id, &fixture.linked).unwrap();
    assert_eq!(worktrees.saved().unwrap().unwrap().path, fixture.linked);
    assert!(worktrees.snapshot()[0].switching);
    let mut restored = fixture.worktrees();
    let (target, blocked) = restored.restore();
    assert!(blocked.is_empty());
    assert_eq!(target.unwrap(), configuration);
    let mut resolved = fixture.resolved(&fixture.linked);
    resolved.manifest_path = fixture.root.join("devhost.toml");
    let mut live = Worktrees::build(
        &resolved,
        &fixture.state(),
        Some(&restored),
        "",
        &BTreeMap::new(),
    )
    .unwrap()
    .unwrap();
    live.finish(&BTreeMap::new());
    let selected = live.snapshot().remove(0);
    assert_eq!(selected.id, repo.id);
    assert_eq!(selected.configured_path, repo.configured_path);
    assert_eq!(selected.selected_path, fixture.linked.to_str().unwrap());
    assert_eq!(selected.running_path, selected.selected_path);
    assert_eq!(selected.service_names, ["worker"]);
    fs::remove_dir_all(&fixture.linked).unwrap();
    restored.refresh().unwrap();
    let blocked = restored.restore().1;
    assert_eq!(blocked.len(), 2);
    restored.finish(&blocked);
    assert!(restored.snapshot()[0].running_path.is_empty());
    restored.restore_saved(saved.as_ref()).unwrap();
    assert!(restored.saved().unwrap().is_none());
    Worktrees::forget(&fixture.root.join("devhost.toml"), &fixture.state()).unwrap();
}

#[test]
fn defaults_use_only_agreeing_remote_heads_and_support_locked_detached_checkouts() {
    let fixture = Fixture::new();
    let mut worktrees = fixture.worktrees();
    assert!(worktrees.snapshot()[0].default_branch.is_empty());
    for (remote, branch) in [("origin", "release/stable"), ("upstream", "release/stable")] {
        let reference = format!("refs/remotes/{remote}/{branch}");
        git(&fixture.root, &["update-ref", &reference, "HEAD"]);
        git(
            &fixture.root,
            &[
                "symbolic-ref",
                &format!("refs/remotes/{remote}/HEAD"),
                &reference,
            ],
        );
    }
    git(&fixture.linked, &["checkout", "--detach"]);
    git(
        &fixture.root,
        &["worktree", "lock", fixture.linked.to_str().unwrap()],
    );
    worktrees.refresh().unwrap();
    let repo = worktrees.snapshot().remove(0);
    assert_eq!(repo.default_branch, "release/stable");
    let linked = repo
        .worktrees
        .iter()
        .find(|entry| entry.path == fixture.linked.to_str().unwrap())
        .unwrap();
    assert!(linked.detached && linked.available && linked.branch.is_empty());
    git(
        &fixture.root,
        &["update-ref", "refs/remotes/upstream/trunk", "HEAD"],
    );
    git(
        &fixture.root,
        &[
            "symbolic-ref",
            "refs/remotes/upstream/HEAD",
            "refs/remotes/upstream/trunk",
        ],
    );
    worktrees.refresh().unwrap();
    assert!(worktrees.snapshot()[0].default_branch.is_empty());
}

#[test]
fn grouping_rejects_mixed_checkouts_external_services_and_escaping_directories() {
    let fixture = Fixture::new();
    let mut resolved = fixture.resolved(&fixture.root);
    resolved.services.get_mut("web").unwrap().cwd = fixture.linked.join("web");
    assert!(
        Worktrees::build(&resolved, &fixture.state(), None, "", &BTreeMap::new())
            .err()
            .unwrap()
            .contains("different checkouts")
    );
    resolved.services.get_mut("web").unwrap().cwd = fixture.root.join("web");
    resolved.services.get_mut("web").unwrap().command.clear();
    resolved.services.get_mut("web").unwrap().managed = false;
    let mut blocked = Worktrees::build(&resolved, &fixture.state(), None, "", &BTreeMap::new())
        .unwrap()
        .unwrap();
    let repo = blocked.snapshot().remove(0);
    assert!(
        blocked
            .prepare(&repo.id, &fixture.linked)
            .unwrap_err()
            .contains("external")
    );
    let mut worktrees = fixture.worktrees();
    fs::remove_dir_all(fixture.linked.join("web")).unwrap();
    symlink(fixture.root.join("web"), fixture.linked.join("web")).unwrap();
    assert!(
        worktrees
            .prepare(&repo.id, &fixture.linked)
            .unwrap_err()
            .contains("escapes checkout")
    );
    let mut affected = BTreeSet::from(["api".to_owned()]);
    worktrees.expand_affected(&mut affected, &fixture.resolved(&fixture.root));
    assert!(affected.contains("web"));
    let mut previous = fixture.resolved(&fixture.root);
    previous.services.remove("web");
    let mut joining = BTreeSet::from(["web".to_owned()]);
    worktrees.expand_affected(&mut joining, &previous);
    assert_eq!(joining, BTreeSet::from(["web".to_owned()]));
    resolved.worktrees.enabled = false;
    assert!(
        Worktrees::build(&resolved, &fixture.state(), None, "", &BTreeMap::new())
            .unwrap()
            .is_none()
    );
}

#[test]
fn malformed_selection_is_rejected_and_atomic_selection_is_private() {
    use std::os::unix::fs::PermissionsExt;
    let fixture = Fixture::new();
    let path = selection::file(&fixture.root.join("devhost.toml"), &fixture.state());
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    for data in [
        "{",
        r#"{"repositoryId":"repo","path":"relative"}"#,
        r#"{"repositoryId":"","path":"/tmp"}"#,
    ] {
        fs::write(&path, data).unwrap();
        assert!(
            Worktrees::build(
                &fixture.resolved(&fixture.root),
                &fixture.state(),
                None,
                "",
                &BTreeMap::new()
            )
            .is_err()
        );
    }
    fs::remove_file(&path).unwrap();
    let mut worktrees = fixture.worktrees();
    let id = worktrees.snapshot()[0].id.clone();
    worktrees.select(&id, &fixture.linked).unwrap();
    assert_eq!(
        fs::metadata(path).unwrap().permissions().mode() & 0o777,
        0o600
    );
}

#[test]
fn selection_io_failures_preserve_the_live_selection_and_remove_atomic_scratch() {
    let fixture = Fixture::new();
    let mut worktrees = fixture.worktrees();
    let before = worktrees.snapshot().remove(0);
    let path = worktrees.selection_file.clone();
    let parent = path.parent().unwrap();
    fs::create_dir_all(&path).unwrap();
    assert!(
        worktrees
            .saved()
            .unwrap_err()
            .contains("read saved worktree")
    );
    assert!(
        worktrees
            .select(&before.id, &fixture.linked)
            .unwrap_err()
            .contains("save worktree selection")
    );
    assert_eq!(worktrees.snapshot()[0].selected_path, before.selected_path);
    assert!(!worktrees.snapshot()[0].switching);
    assert_eq!(fs::read_dir(parent).unwrap().count(), 1);
    assert!(worktrees.restore_saved(None).is_err());
    fs::remove_dir(&path).unwrap();
    fs::remove_dir(parent).unwrap();
    fs::write(parent, "blocks state directory creation").unwrap();
    assert!(
        worktrees
            .select(&before.id, &fixture.linked)
            .unwrap_err()
            .contains("create worktree state")
    );
    assert_eq!(worktrees.snapshot()[0].selected_path, before.selected_path);
    assert!(!worktrees.snapshot()[0].switching);
}

#[test]
fn git_queries_handle_output_larger_than_a_pipe_buffer() {
    let fixture = Fixture::new();
    let output = run_git(
        &fixture.root,
        &["-c", "alias.large=!yes fixture | head -c 131072", "large"],
    )
    .unwrap();
    assert_eq!(output.len(), 131071);
}

#[test]
fn submodules_and_bare_repositories_keep_checkout_identity() {
    let fixture = Fixture::new();
    let parent = fixture.directory.path().join("super");
    fs::create_dir(&parent).unwrap();
    git(&parent, &["init", "-b", "main"]);
    git(
        &parent,
        &[
            "-c",
            "protocol.file.allow=always",
            "submodule",
            "add",
            fixture.root.to_str().unwrap(),
            "packages/shop",
        ],
    );
    let root = parent.join("packages/shop");
    let linked = fixture.directory.path().join("linked shop");
    git(
        &root,
        &[
            "worktree",
            "add",
            "-b",
            "feature/submodule",
            linked.to_str().unwrap(),
        ],
    );
    let mut worktrees = Worktrees::build(
        &fixture.resolved(&root),
        &fixture.state(),
        None,
        "",
        &BTreeMap::new(),
    )
    .unwrap()
    .unwrap();
    let repo = worktrees.snapshot().remove(0);
    assert_eq!(repo.worktrees.len(), 2);
    for path in [&root, &linked] {
        worktrees.prepare(&repo.id, path).unwrap();
    }
    let bare = fixture.directory.path().join("bare.git");
    git(
        fixture.directory.path(),
        &[
            "clone",
            "--bare",
            fixture.root.to_str().unwrap(),
            bare.to_str().unwrap(),
        ],
    );
    let entries = git::list(&bare).unwrap();
    assert_eq!(entries.len(), 1);
    assert!(!entries[0].available && entries[0].reason.contains("Bare"));
}

#[test]
fn external_owning_manifest_remains_available_and_local_manifest_takes_precedence() {
    let fixture = Fixture::new();
    let external = fixture.directory.path().join("devhost.toml");
    let body = fs::read_to_string(fixture.root.join("devhost.toml"))
        .unwrap()
        .replace(
            "cwd = 'api'",
            &format!("cwd = '{}'", fixture.root.join("api").display()),
        )
        .replace(
            "cwd = 'web'",
            &format!("cwd = '{}'", fixture.root.join("web").display()),
        );
    fs::write(&external, body).unwrap();
    fs::remove_file(fixture.root.join("devhost.toml")).unwrap();
    let configuration = manifest::read_with_inputs_env(&external, None).0.unwrap();
    let resolved =
        resolve_service_ports(&configuration, &PortResolutionOptions::default()).unwrap();
    let mut worktrees = Worktrees::build(&resolved, &fixture.state(), None, "", &BTreeMap::new())
        .unwrap()
        .unwrap();
    let id = worktrees.snapshot()[0].id.clone();
    assert_eq!(
        worktrees.prepare(&id, &fixture.root).unwrap().manifest_path,
        external
    );
    let target = worktrees.prepare(&id, &fixture.linked).unwrap();
    let mut next = resolve_service_ports(&target, &PortResolutionOptions::default()).unwrap();
    next.manifest_path = external.clone();
    let mut selected = Worktrees::build(
        &next,
        &fixture.state(),
        Some(&worktrees),
        "",
        &BTreeMap::new(),
    )
    .unwrap()
    .unwrap();
    assert_eq!(
        selected.prepare(&id, &fixture.root).unwrap().manifest_path,
        external
    );
    fs::write(fixture.root.join("devhost.toml"), "name = 'local'\n[services.web]\ncwd = 'web'\ncommand = ['sleep', '300']\nhealth.process = true\n").unwrap();
    assert_eq!(selected.prepare(&id, &fixture.root).unwrap().name, "local");
}

#[test]
fn missing_configured_linked_checkout_keeps_the_previous_repository_identity() {
    let fixture = Fixture::new();
    let configured = fixture.resolved(&fixture.linked);
    let worktrees = Worktrees::build(&configured, &fixture.state(), None, "", &BTreeMap::new())
        .unwrap()
        .unwrap();
    let id = worktrees.snapshot()[0].id.clone();
    fs::remove_dir_all(&fixture.linked).unwrap();
    let missing = Worktrees::build(
        &configured,
        &fixture.state(),
        Some(&worktrees),
        "",
        &BTreeMap::new(),
    )
    .unwrap()
    .unwrap();
    assert_eq!(missing.snapshot()[0].id, id);
}

#[test]
fn refresh_judges_running_checkout_only_by_repository_membership() {
    let fixture = Fixture::new();
    let mut worktrees = fixture.worktrees();
    worktrees.finish(&BTreeMap::new());
    fs::write(
        fixture.root.join("devhost.toml"),
        "[services.api]\ncommand = [",
    )
    .unwrap();
    fs::remove_dir_all(fixture.root.join("web")).unwrap();
    fs::write(
        fixture.linked.join("devhost.toml"),
        "[services.api]\ncommand = [",
    )
    .unwrap();
    worktrees.refresh().unwrap();
    let repo = worktrees.snapshot().remove(0);
    let running = repo
        .worktrees
        .iter()
        .find(|entry| entry.path == fixture.root.to_str().unwrap())
        .unwrap();
    assert!(
        running.available && running.reason.is_empty(),
        "{running:?}"
    );
    let inactive = repo
        .worktrees
        .iter()
        .find(|entry| entry.path == fixture.linked.to_str().unwrap())
        .unwrap();
    assert!(
        !inactive.available && !inactive.reason.is_empty(),
        "{inactive:?}"
    );
}
