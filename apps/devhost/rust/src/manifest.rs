use std::{
    fs, io,
    path::{Component, Path, PathBuf},
};

use toml::{Table, Value};

mod diagnostics;

const NAME: &str = "devhost.toml";

pub(crate) struct Failure {
    pub(crate) message: String,
    pub(crate) summary: Option<String>,
    pub(crate) hint: Option<&'static str>,
}

impl From<String> for Failure {
    fn from(message: String) -> Self {
        Self {
            message,
            summary: None,
            hint: None,
        }
    }
}

pub(crate) fn service_names(
    cwd: &Path,
    explicit: Option<&Path>,
    startable_only: bool,
) -> Result<Vec<String>, Failure> {
    let path = resolve(cwd, explicit)?;
    let text = fs::read_to_string(&path).map_err(|error| {
        if error.kind() == io::ErrorKind::NotFound {
            Failure {
                message: format!(
                    "read manifest {}: open {}: no such file or directory",
                    path.display(),
                    path.display()
                ),
                summary: Some(format!("manifest file not found: {}", path.display())),
                hint: Some("Check the path given with --manifest or DEVHOST_MANIFEST."),
            }
        } else {
            format!("read manifest {}: {error}", path.display()).into()
        }
    })?;
    let manifest: Table = text
        .parse()
        .map_err(|error| diagnostics::parse_error(&path, &text, &error))?;

    if manifest.contains_key("includes") {
        return Err("The Rust CLI currently supports single-file manifests."
            .to_owned()
            .into());
    }

    list_services(&manifest, startable_only).map_err(Into::into)
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
        let mut clean = PathBuf::new();
        for component in cwd.join(path).components() {
            match component {
                Component::ParentDir => {
                    clean.pop();
                }
                Component::CurDir => {}
                _ => clean.push(component.as_os_str()),
            }
        }
        return Ok(clean);
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

fn list_services(manifest: &Table, startable_only: bool) -> Result<Vec<String>, String> {
    if !manifest
        .get("name")
        .and_then(Value::as_str)
        .is_some_and(|name| !name.trim().is_empty())
    {
        return Err("Manifest schema is invalid:\nname Expected a non-empty string.".to_owned());
    }

    let Some(services) = manifest.get("services").and_then(Value::as_table) else {
        return Err("Manifest schema is invalid:\nservices must be an object.".to_owned());
    };
    if services.is_empty() {
        return Err(
            "Manifest validation failed:\nservices must contain at least one service.".to_owned(),
        );
    }

    let mut names = Vec::with_capacity(services.len());
    for (name, value) in services {
        let service = value.as_table().ok_or_else(|| {
            format!("Manifest schema is invalid:\nservices.{name} must be an object.")
        })?;
        let mut characters = name.bytes();
        if !characters.next().is_some_and(|c| c.is_ascii_lowercase())
            || !characters.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
        {
            return Err(format!(
                "Manifest validation failed:\nservices.{name} has an invalid name."
            ));
        }
        let always_start = match service.get("alwaysStart") {
            Some(setting) => setting.as_bool().ok_or_else(|| {
                format!(
                    "Manifest schema is invalid:\nservices.{name}.alwaysStart Expected a boolean."
                )
            })?,
            None => false,
        };

        if !startable_only || !always_start {
            names.push(name.clone());
        }
    }
    names.sort_unstable();
    Ok(names)
}
