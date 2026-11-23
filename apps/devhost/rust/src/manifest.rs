use std::path::{Path, PathBuf};

use crate::{Failure, paths::clean};

mod diagnostics;
mod includes;
pub mod types;
pub mod validation;

pub use types::{
    DevtoolsConfig, HealthConfig, Inputs, Manifest, PortConfig, ServiceLifecycleConfig,
    ValidatedService, WorktreesConfig, parse_go_duration, resolve_watch_path,
};
pub use validation::{
    is_valid_host, is_valid_host_label, read_conflicting_route_path, validate_health_http_url,
};

const NAME: &str = "devhost.toml";

pub fn read_manifest(cwd: &Path, explicit: Option<&Path>) -> Result<Manifest, Failure> {
    let path = resolve_path(cwd, explicit)?;
    let raw = includes::read(&path)?;
    validation::validate(&path, raw).map_err(Into::into)
}

/// Preserve discovered inputs even when a save is incomplete, so a later edit
/// to a newly included file can recover the accepted running configuration.
pub(crate) fn read_with_inputs(path: &Path) -> (Result<Manifest, Failure>, Inputs) {
    let mut inputs = Inputs::default();
    let result = includes::read_with_inputs(path, &mut inputs)
        .and_then(|raw| validation::validate(path, raw).map_err(Into::into));
    (result, inputs)
}

pub fn service_names(
    cwd: &Path,
    explicit: Option<&Path>,
    startable_only: bool,
) -> Result<Vec<String>, Failure> {
    let manifest = read_manifest(cwd, explicit)?;
    let mut names: Vec<String> = manifest
        .services
        .values()
        .filter(|service| !startable_only || !service.always_start)
        .map(|service| service.name.clone())
        .collect();
    names.sort_unstable();
    Ok(names)
}

pub fn resolve_path(cwd: &Path, explicit: Option<&Path>) -> Result<PathBuf, Failure> {
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
        hint: Some("Run devhost from your project folder, or pass --manifest <path>.".to_owned()),
    })
}
