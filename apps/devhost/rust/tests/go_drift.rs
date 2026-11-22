use std::{
    fs,
    path::Path,
    process::{Command, Output},
};

use tempfile::{TempDir, tempdir};

fn git(dir: &Path, args: &[&str]) -> String {
    let output = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{args:?}: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout).unwrap().trim().to_owned()
}

fn commit(dir: &Path, path: &str, message: &str) -> String {
    fs::write(dir.join(path), message).unwrap();
    git(dir, &["add", path]);
    git(dir, &["commit", "-m", message]);
    git(dir, &["rev-parse", "HEAD"])
}

fn fixture() -> (TempDir, String) {
    let dir = tempdir().unwrap();
    let root = dir.path();
    git(root, &["init", "-b", "main"]);
    git(root, &["config", "user.name", "Devhost Test"]);
    git(
        root,
        &["config", "user.email", "devhost-test@example.invalid"],
    );
    git(root, &["config", "commit.gpgsign", "false"]);
    git(root, &["config", "tag.gpgsign", "false"]);
    git(root, &["config", "core.hooksPath", ".git/no-hooks"]);
    let sha = commit(root, "baseline.txt", "Reviewed Go baseline");
    git(root, &["tag", "-a", "v0.0.1", "-m", "Published release"]);
    git(root, &["remote", "add", "origin", "."]);
    (dir, sha)
}

fn drift(dir: &Path, baseline: &str, tag: &str) -> Output {
    Command::new(env!("CARGO_BIN_EXE_go-drift"))
        .current_dir(dir)
        .args(["--reviewed-sha", baseline, "--release-tag", tag])
        .output()
        .unwrap()
}

#[test]
fn reports_unchanged_heads_and_peels_annotated_release_tag() {
    let (dir, base) = fixture();
    let output = drift(dir.path(), &base, "v0.0.1");
    assert_eq!(output.status.code(), Some(0));
    let text = String::from_utf8(output.stdout).unwrap();
    assert!(text.contains(&format!("Go release v0.0.1 {base}")));
    assert!(text.contains("Go main matches the reviewed baseline."));
}

#[test]
fn reports_go_only_commits_and_paths_without_moving_baseline() {
    let (dir, base) = fixture();
    let sha = commit(dir.path(), "features.go", "Add a Go-only feature");
    let output = drift(dir.path(), &base, "v0.0.1");
    assert_eq!(output.status.code(), Some(0));
    let text = String::from_utf8(output.stdout).unwrap();
    assert!(text.contains(&format!("Reviewed Go baseline {base}")));
    assert!(text.contains(&format!("{sha} Add a Go-only feature")));
    assert!(text.contains("A\tfeatures.go"));
    assert!(text.contains("Go release matches the reviewed baseline."));
    assert_eq!(git(dir.path(), &["status", "--porcelain"]), "");
}

#[test]
fn flags_divergent_history_and_distinguishes_an_older_release() {
    let (dir, common) = fixture();
    let base = commit(dir.path(), "reviewed.go", "Previous main history");
    git(dir.path(), &["checkout", "--detach", &common]);
    let rewritten = commit(dir.path(), "rewritten.go", "Replacement main history");
    git(dir.path(), &["branch", "-f", "main", &rewritten]);
    let output = drift(dir.path(), &base, "v0.0.1");
    assert_eq!(output.status.code(), Some(2));
    let text = String::from_utf8(output.stdout).unwrap();
    assert!(text.contains("Go main diverged"));
    assert!(text.contains("Go release is behind the reviewed baseline by 1."));
}

#[test]
fn reports_bad_baseline_and_missing_release() {
    let (dir, base) = fixture();
    for (baseline, tag, expected) in [
        ("main", "v0.0.1", "must be a full Git SHA"),
        (&base, "v0.0.9", "origin has no tag"),
        (&"a".repeat(40), "v0.0.1", "git fetch origin main --tags"),
    ] {
        let output = drift(dir.path(), baseline, tag);
        assert_eq!(output.status.code(), Some(1));
        assert!(String::from_utf8(output.stderr).unwrap().contains(expected));
    }
}

#[test]
fn reports_an_origin_without_main() {
    let (dir, base) = fixture();
    git(dir.path(), &["branch", "-m", "renamed"]);
    let output = drift(dir.path(), &base, "v0.0.1");
    assert_eq!(output.status.code(), Some(1));
    assert!(
        String::from_utf8(output.stderr)
            .unwrap()
            .contains("origin has no main branch")
    );
}
