use std::path::{Path, PathBuf};

use toml::{Table, Value};

use crate::{Failure, paths::clean};

mod diagnostics;
mod includes;

const NAME: &str = "devhost.toml";

pub(crate) fn service_names(
    cwd: &Path,
    explicit: Option<&Path>,
    startable_only: bool,
) -> Result<Vec<String>, Failure> {
    let path = resolve(cwd, explicit)?;
    let manifest = includes::read(&path)?;
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
        if !valid_name(name) {
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
    validate_groups(manifest, services)?;
    names.sort_unstable();
    Ok(names)
}

fn valid_name(name: &str) -> bool {
    let mut characters = name.bytes();
    characters
        .next()
        .is_some_and(|byte| byte.is_ascii_lowercase())
        && characters.all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
}

fn validate_groups(manifest: &Table, services: &Table) -> Result<(), String> {
    let Some(groups) = manifest.get("groups") else {
        return Ok(());
    };
    let groups = groups
        .as_table()
        .ok_or("Manifest schema is invalid:\ngroups must be an object.")?;
    let mut schema = Vec::new();
    let mut invalid = Vec::new();
    for (name, members) in groups {
        let key = format!("groups.{name}");
        if !valid_name(name) {
            invalid.push(format!("{key} has an invalid name."));
        }
        if services.contains_key(name) {
            invalid.push(format!("{key} conflicts with a service name."));
        }
        match members.as_array() {
            None => schema.push(format!("{key} must be a string array.")),
            Some(items) if items.is_empty() => {
                schema.push(format!("{key} must contain at least one string."));
            }
            Some(items) => {
                if items
                    .iter()
                    .any(|item| item.as_str().is_none_or(|name| name.trim().is_empty()))
                {
                    schema.push(format!("{key} must contain only non-empty strings."));
                    continue;
                }
                for member in items.iter().filter_map(Value::as_str) {
                    if !services.contains_key(member) {
                        invalid.push(format!("{key} references an unknown service: {member}"));
                    }
                }
            }
        }
    }
    if !schema.is_empty() {
        return Err(format!(
            "Manifest schema is invalid:\n{}",
            schema.join("\n")
        ));
    }
    if !invalid.is_empty() {
        return Err(format!(
            "Manifest validation failed:\n{}",
            invalid.join("\n")
        ));
    }
    Ok(())
}
