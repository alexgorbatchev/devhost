use std::path::{Path, PathBuf};

use crate::{Failure, paths::clean};

mod diagnostics;
mod includes;
mod validation;

const NAME: &str = "devhost.toml";

pub(crate) fn service_names(
    cwd: &Path,
    explicit: Option<&Path>,
    startable_only: bool,
) -> Result<Vec<String>, Failure> {
    let path = resolve(cwd, explicit)?;
    let manifest = includes::read(&path)?;
    validation::service_names(&path, &manifest, startable_only).map_err(Into::into)
}

fn resolve(cwd: &Path, explicit: Option<&Path>) -> Result<PathBuf, Failure> {
    if let Some(path) = explicit {
        if !path
            .as_os_str()
            .as_encoded_bytes()
            .ends_with(NAME.as_bytes())
        {
            return Err(format!(
                "--manifest must point to a file named {NAME}, received: {}",
                path.display()
            )
            .into());
        }

        // Match filepath.Clean before opening the path, including paths that
        // traverse a nonexistent parent or a symlink followed by "..".
        return Ok(clean(&cwd.join(path)));
    }

    for directory in cwd.ancestors() {
        let candidate = directory.join(NAME);
        if candidate.exists() {
            return Ok(candidate);
        }
        if directory.join(".git").exists() {
            break;
        }
    }
    Err(Failure {
        message: format!("Could not find {NAME} from {} upward.", cwd.display()),
        summary: None,
        hint: Some("Run devhost from your project folder, or pass --manifest <path>."),
    })
}
