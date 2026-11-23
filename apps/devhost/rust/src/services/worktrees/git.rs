use std::path::Path;

use crate::devtools::Worktree;
use crate::services::stop::{discover_git_repository, run_git};

pub(super) fn list(cwd: &Path) -> Result<Vec<Worktree>, String> {
    let output = run_git(cwd, &["worktree", "list", "--porcelain", "-z"])?;
    let mut entries = Vec::new();
    let mut entry = Worktree::default();
    for field in output.split('\0') {
        let (key, value) = field.split_once(' ').unwrap_or((field, ""));
        match key {
            "worktree" => {
                entry = Worktree {
                    path: value.to_owned(),
                    ..Default::default()
                }
            }
            "HEAD" => entry.head = value.to_owned(),
            "branch" => {
                entry.branch = value
                    .strip_prefix("refs/heads/")
                    .unwrap_or(value)
                    .to_owned()
            }
            "detached" => entry.detached = true,
            "bare" => entry.reason = "Bare repositories cannot run services.".to_owned(),
            "" if !entry.path.is_empty() => {
                // A submodule's main entry can name the common directory.
                if Path::new(&entry.path) == cwd
                    && entry.reason.is_empty()
                    && let Ok(repository) = discover_git_repository(cwd)
                    && repository.common_dir == cwd
                {
                    entry.path = super::path_text(&repository.root)?;
                }
                entries.push(std::mem::take(&mut entry));
            }
            _ => {}
        }
    }
    Ok(entries)
}

pub(super) fn default_branch(cwd: &Path) -> Result<String, String> {
    let output = run_git(
        cwd,
        &[
            "for-each-ref",
            "--format=%(refname)%00%(symref)",
            "refs/remotes/",
        ],
    )?;
    let mut branch = "";
    for line in output.lines() {
        let Some((reference, target)) = line.split_once('\0') else {
            continue;
        };
        let Some(remote) = reference.strip_suffix("/HEAD") else {
            continue;
        };
        let Some(candidate) = target.strip_prefix(&format!("{remote}/")) else {
            continue;
        };
        if !branch.is_empty() && branch != candidate {
            return Ok(String::new());
        }
        branch = candidate;
    }
    Ok(branch.to_owned())
}
