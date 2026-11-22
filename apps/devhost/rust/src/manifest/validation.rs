use std::{collections::BTreeSet, path::Path};

use toml::{Table, Value};

use crate::paths::clean;

#[derive(Default)]
struct Issues {
    schema: Vec<String>,
    validation: Vec<String>,
}

impl Issues {
    fn finish(self) -> Result<(), String> {
        if !self.schema.is_empty() {
            return Err(format!(
                "Manifest schema is invalid:\n{}",
                self.schema.join("\n")
            ));
        }
        if !self.validation.is_empty() {
            return Err(format!(
                "Manifest validation failed:\n{}",
                self.validation.join("\n")
            ));
        }
        Ok(())
    }
}

const ROOT_KEYS: &[&str] = &[
    "caddy",
    "devtools",
    "worktrees",
    "name",
    "services",
    "groups",
    "includes",
    "killZombies",
];
const SERVICE_KEYS: &[&str] = &[
    "alwaysStart",
    "bindHost",
    "command",
    "cwd",
    "dependsOn",
    "env",
    "health",
    "host",
    "injectPort",
    "lifecycle",
    "managed",
    "path",
    "port",
    "primary",
    "proxyLocalOrigin",
    "serve",
    "watch",
];

pub(super) fn service_names(
    path: &Path,
    manifest: &Table,
    startable_only: bool,
) -> Result<Vec<String>, String> {
    let mut issues = Issues::default();
    if manifest.contains_key("caddy") {
        issues.schema.push("caddy moved to the devhost config file: set the shared Caddy listeners in the [caddy] table of config.toml in the devhost config directory, and remove [caddy] from the manifest.".into());
    }
    reject_unknown(manifest, "manifest", ROOT_KEYS, &mut issues.schema);
    if !manifest.get("name").is_some_and(nonempty_string) {
        issues
            .schema
            .push("name Expected a non-empty string.".into());
    }
    read_bool(
        manifest,
        "killZombies",
        "killZombies",
        true,
        &mut issues.schema,
    );
    let directory = path.parent().unwrap_or(Path::new("."));
    let mut names = Vec::new();
    let mut valid = BTreeSet::new();
    let mut primary = Vec::new();
    match manifest.get("services") {
        None => issues.schema.push("services must be an object.".into()),
        Some(Value::Table(services)) => {
            if services.is_empty() {
                issues
                    .validation
                    .push("services must contain at least one service.".into());
            }
            for (name, raw) in services {
                let key = format!("services.{name}");
                let Some(service) = raw.as_table() else {
                    issues.schema.push(format!("{key} must be a table."));
                    continue;
                };
                if !valid_name(name) {
                    issues
                        .validation
                        .push(format!("{key} has an invalid name."));
                    continue;
                }
                let (always_start, is_primary) =
                    validate_service(service, &key, directory, services, &mut issues);
                valid.insert(name.as_str());
                if is_primary {
                    primary.push(name.as_str());
                }
                if !startable_only || !always_start {
                    names.push(name.clone());
                }
            }
        }
        Some(_) => issues.schema.push("services must be a table.".into()),
    }
    if primary.len() > 1 {
        issues.validation.push(format!(
            "Multiple primary services defined: {}",
            primary.join(", ")
        ));
    }
    validate_groups(manifest, &valid, &mut issues);
    issues.finish()?;
    names.sort_unstable();
    Ok(names)
}

fn validate_service(
    service: &Table,
    key: &str,
    directory: &Path,
    services: &Table,
    issues: &mut Issues,
) -> (bool, bool) {
    reject_unknown(service, key, SERVICE_KEYS, &mut issues.schema);
    let managed = read_bool(
        service,
        "managed",
        &format!("{key}.managed"),
        true,
        &mut issues.schema,
    );
    let daemon = validate_lifecycle(service, key, issues);
    let serves_files = service.get("serve").is_some_and(nonempty_string);
    if let Some(serve) = service.get("serve") {
        if let Some(path) = serve.as_str().filter(|path| !path.trim().is_empty()) {
            check_path(
                directory,
                path,
                &format!("{key}.serve"),
                &mut issues.validation,
            );
            for setting in [
                "command",
                "cwd",
                "lifecycle",
                "env",
                "injectPort",
                "proxyLocalOrigin",
                "watch",
            ] {
                if service.contains_key(setting) {
                    issues.validation.push(format!(
                        "{key} must omit {setting} when serve is configured."
                    ));
                }
            }
            if !managed {
                issues
                    .validation
                    .push(format!("{key}.serve requires managed = true."));
            }
        } else {
            issues
                .schema
                .push(format!("{key}.serve Expected a non-empty string."));
        }
    }
    if let Some(command) = service.get("command") {
        let valid_command =
            validate_command(command, &format!("{key}.command"), &mut issues.schema);
        if valid_command && !managed {
            issues
                .validation
                .push(format!("{key} must omit command when managed = false."));
        }
        if valid_command && daemon {
            issues.validation.push(format!(
                "{key} must omit command when lifecycle.mode = \"daemon\"."
            ));
        }
    } else if managed && !daemon && !serves_files {
        issues.schema.push(format!(
            "{key}.command must be a non-empty string or string array."
        ));
    }
    if daemon && !managed {
        issues.validation.push(format!(
            "{key}.lifecycle.mode=\"daemon\" requires managed = true."
        ));
    }
    let primary = read_bool(
        service,
        "primary",
        &format!("{key}.primary"),
        false,
        &mut issues.schema,
    );
    let always_start = read_bool(
        service,
        "alwaysStart",
        &format!("{key}.alwaysStart"),
        false,
        &mut issues.schema,
    );
    if let Some(cwd) = service.get("cwd") {
        if let Some(path) = cwd.as_str() {
            check_path(
                directory,
                path,
                &format!("{key}.cwd"),
                &mut issues.validation,
            );
        } else {
            issues.schema.push(format!("{key}.cwd must be a string."));
        }
    }
    if let Some(watch) = service.get("watch") {
        read_string_array(watch, &format!("{key}.watch"), &mut issues.schema);
    }
    if let Some(depends_on) = service.get("dependsOn")
        && let Some(dependencies) =
            read_string_array(depends_on, &format!("{key}.dependsOn"), &mut issues.schema)
    {
        for dependency in dependencies {
            if !services.contains_key(dependency) {
                issues.validation.push(format!(
                    "{key}.dependsOn references an unknown service: {dependency}"
                ));
            }
        }
    }
    validate_port(service, key, serves_files, managed, daemon, issues);
    (always_start, primary)
}

fn validate_lifecycle(service: &Table, key: &str, issues: &mut Issues) -> bool {
    let path = format!("{key}.lifecycle");
    let Some(lifecycle) = service.get("lifecycle") else {
        return false;
    };
    let Some(lifecycle) = lifecycle.as_table() else {
        issues.schema.push(format!("{path} must be a table."));
        return false;
    };
    reject_unknown(
        lifecycle,
        &path,
        &["mode", "start", "status", "stop"],
        &mut issues.schema,
    );
    let daemon = match lifecycle.get("mode") {
        Some(mode) if mode.as_str() == Some("daemon") => true,
        None => false,
        Some(mode) => {
            if mode.as_str() != Some("foreground") {
                issues
                    .schema
                    .push(format!("{path}.mode must be one of foreground or daemon."));
            }
            false
        }
    };
    for action in ["start", "status", "stop"] {
        let command = lifecycle.get(action);
        if command.is_some_and(|command| {
            validate_lifecycle_command(command, &format!("{path}.{action}"), &mut issues.schema)
        }) {
            if !daemon {
                issues.validation.push(format!(
                    "{path}.{action} is only supported when lifecycle.mode = \"daemon\"."
                ));
            }
        } else if daemon && action != "status" {
            issues.validation.push(format!(
                "{path}.{action} is required when lifecycle.mode = \"daemon\"."
            ));
        }
    }
    daemon
}

fn validate_lifecycle_command(command: &Value, key: &str, schema: &mut Vec<String>) -> bool {
    if let Some(command) = command.as_str() {
        if !command.trim().is_empty() {
            return true;
        }
        schema.push(format!("{key} Expected a non-empty string."));
        return false;
    }
    if command.as_array().is_some_and(|arguments| {
        !arguments.is_empty()
            && arguments.iter().all(|argument| {
                argument
                    .as_str()
                    .is_some_and(|value| !value.trim().is_empty())
            })
    }) {
        return true;
    }
    schema.push(format!("{key} must be a non-empty string or string array."));
    false
}

fn validate_port(
    service: &Table,
    key: &str,
    serves_files: bool,
    managed: bool,
    daemon: bool,
    issues: &mut Issues,
) {
    let auto = match service.get("port") {
        Some(value) if value.as_str() == Some("auto") => true,
        Some(value) => {
            if !value
                .as_integer()
                .is_some_and(|number| (1..=65535).contains(&number))
            {
                issues.schema.push(format!(
                    "{key}.port must be an integer between 1 and 65535 or \"auto\"."
                ));
            }
            false
        }
        None if serves_files => true,
        None => {
            if !service.contains_key("health") {
                issues
                    .validation
                    .push(format!("{key} must define either port or health."));
            }
            false
        }
    };
    if auto && !managed {
        issues.validation.push(format!(
            "{key} must not use port = \"auto\" when managed = false."
        ));
    }
    if auto && daemon {
        issues.validation.push(format!(
            "{key} must not use port = \"auto\" when lifecycle.mode = \"daemon\"."
        ));
    }
}

fn validate_groups(manifest: &Table, services: &BTreeSet<&str>, issues: &mut Issues) {
    let Some(groups) = manifest.get("groups") else {
        return;
    };
    let Some(groups) = groups.as_table() else {
        issues.schema.push("groups must be a table.".into());
        return;
    };
    for (name, members) in groups {
        let key = format!("groups.{name}");
        if !valid_name(name) {
            issues
                .validation
                .push(format!("{key} has an invalid name."));
        }
        if services.contains(name.as_str()) {
            issues
                .validation
                .push(format!("{key} conflicts with a service name."));
        }
        if let Some(members) = read_string_array(members, &key, &mut issues.schema) {
            for member in members {
                if !services.contains(member) {
                    issues
                        .validation
                        .push(format!("{key} references an unknown service: {member}"));
                }
            }
        }
    }
}

fn reject_unknown(value: &Table, path: &str, allowed: &[&str], schema: &mut Vec<String>) {
    for key in value.keys().filter(|key| !allowed.contains(&key.as_str())) {
        schema.push(format!("{path} Unrecognized key: \"{key}\""));
    }
}

fn read_bool(
    value: &Table,
    setting: &str,
    path: &str,
    default: bool,
    schema: &mut Vec<String>,
) -> bool {
    match value.get(setting) {
        Some(Value::Boolean(value)) => *value,
        Some(_) => {
            schema.push(format!("{path} must be a boolean."));
            default
        }
        None => default,
    }
}

fn validate_command(command: &Value, key: &str, schema: &mut Vec<String>) -> bool {
    if let Some(command) = command.as_str() {
        if command.trim().is_empty() {
            schema.push(format!("{key} Expected a non-empty string."));
            return false;
        }
        return true;
    }
    read_string_array(command, key, schema).is_some()
}

fn read_string_array<'a>(
    value: &'a Value,
    key: &str,
    schema: &mut Vec<String>,
) -> Option<Vec<&'a str>> {
    let Some(items) = value.as_array() else {
        schema.push(format!("{key} must be a string array."));
        return None;
    };
    if items.is_empty() {
        schema.push(format!("{key} must contain at least one string."));
        return None;
    }
    if !items.iter().all(nonempty_string) {
        schema.push(format!("{key} must contain only non-empty strings."));
        return None;
    }
    Some(items.iter().filter_map(Value::as_str).collect())
}

fn check_path(directory: &Path, path: &str, key: &str, invalid: &mut Vec<String>) {
    let path = Path::new(path);
    if !path.is_absolute() && !clean(&directory.join(path)).starts_with(directory) {
        invalid.push(format!("{key} must stay within {}.", directory.display()));
    }
}

fn nonempty_string(value: &Value) -> bool {
    value.as_str().is_some_and(|value| !value.trim().is_empty())
}

fn valid_name(name: &str) -> bool {
    let mut characters = name.bytes();
    characters
        .next()
        .is_some_and(|byte| byte.is_ascii_lowercase())
        && characters.all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
}
