use std::{
    fs,
    io::Write,
    os::unix::fs::DirBuilderExt,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Selection {
    pub repository_id: String,
    pub path: PathBuf,
}

pub(super) fn file(manifest: &Path, state: &Path) -> PathBuf {
    state
        .join("worktrees")
        .join(super::key(manifest))
        .join("active.json")
}

pub(super) fn read(path: &Path) -> Result<Option<Selection>, String> {
    let data = match fs::read(path) {
        Ok(data) => data,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("read saved worktree: {error}")),
    };
    let saved: Selection = serde_json::from_slice(&data)
        .map_err(|_| format!("invalid saved worktree in {}", path.display()))?;
    if !saved.path.is_absolute() || saved.repository_id.is_empty() {
        return Err(format!("invalid saved worktree in {}", path.display()));
    }
    Ok(Some(saved))
}

pub(super) fn write(path: &Path, selection: Option<&Selection>) -> Result<(), String> {
    let Some(selection) = selection else {
        return match fs::remove_file(path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error.to_string()),
        };
    };
    let parent = path
        .parent()
        .ok_or("worktree state requires a parent directory")?;
    fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(parent)
        .map_err(|error| format!("create worktree state: {error}"))?;
    let mut file = tempfile::NamedTempFile::with_prefix_in(".selection-", parent)
        .map_err(|error| error.to_string())?;
    file.write_all(&serde_json::to_vec(selection).map_err(|error| error.to_string())?)
        .map_err(|error| error.to_string())?;
    file.as_file()
        .sync_all()
        .map_err(|error| error.to_string())?;
    file.persist(path)
        .map_err(|error| format!("save worktree selection: {error}"))?;
    Ok(())
}
