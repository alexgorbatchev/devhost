use std::{
    collections::{BTreeMap, BTreeSet},
    io::Write,
    path::{Path, PathBuf},
    time::Duration,
};

use cli_command_kit::Mode;
use toml::{Table, Value};
use url::Url;

use super::types::{
    DevtoolsChatConfig, DevtoolsConfig, DevtoolsResourceConfig, DevtoolsResourcesConfig,
    HealthConfig, Manifest, PortConfig, RawManifest, ServiceLifecycleConfig, ValidatedService,
    WorktreesConfig, parse_go_duration, resolve_watch_path,
};
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
const DEVTOOLS_KEYS: &[&str] = &[
    "annotations",
    "chat",
    "configEditor",
    "editor",
    "externalToolbars",
    "idleTimeout",
    "minimap",
    "resources",
    "status",
    "shortcuts",
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
const HEALTH_KEYS: &[&str] = &["http", "interval", "process", "retries", "tcp", "timeout"];
const COMPONENT_EDITORS: &[&str] = &["cursor", "vscode", "vscode-insiders", "webstorm"];
const SERVICE_BIND_HOSTS: &[&str] = &["127.0.0.1", "0.0.0.0", "::1", "::"];
const DEVTOOLS_STATUS_POSITIONS: &[&str] = &["top-right", "bottom-right"];
const MIN_RESOURCE_POLL_INTERVAL: Duration = Duration::from_millis(250);
const TOGGLE_KEYS: &[&str] = &["enabled"];
const CHAT_KEYS: &[&str] = &["enabled", "prompt"];
const EDITOR_KEYS: &[&str] = &["enabled", "ide"];
const RESOURCES_KEYS: &[&str] = &["cpu", "disk", "enabled", "memory", "pollInterval"];
const RESOURCE_KEYS: &[&str] = &["enabled", "pollInterval"];
const STATUS_KEYS: &[&str] = &["enabled", "position"];
const SHORTCUT_KEYS: &[&str] = &["restartServices"];
const LIFECYCLE_KEYS: &[&str] = &["mode", "start", "status", "stop"];
const LIFECYCLE_MODES: &[&str] = &["foreground", "daemon"];

pub(crate) fn editor_schema() -> serde_json::Value {
    serde_json::json!({"tables":{
        "":ROOT_KEYS.iter().filter(|key| **key != "caddy").collect::<Vec<_>>(),
        "worktrees":TOGGLE_KEYS, "devtools":DEVTOOLS_KEYS,
        "devtools.annotations":TOGGLE_KEYS, "devtools.chat":CHAT_KEYS,
        "devtools.configEditor":TOGGLE_KEYS, "devtools.editor":EDITOR_KEYS,
        "devtools.externalToolbars":TOGGLE_KEYS, "devtools.minimap":TOGGLE_KEYS,
        "devtools.resources":RESOURCES_KEYS,
        "devtools.resources.*":RESOURCE_KEYS, "devtools.status":STATUS_KEYS,
        "devtools.shortcuts":SHORTCUT_KEYS, "services.*":SERVICE_KEYS,
        "services.*.health":HEALTH_KEYS, "services.*.lifecycle":LIFECYCLE_KEYS
    },"values":{
        "devtools.editor.ide":COMPONENT_EDITORS,"devtools.status.position":DEVTOOLS_STATUS_POSITIONS,
        "services.*.bindHost":SERVICE_BIND_HOSTS,"services.*.lifecycle.mode":LIFECYCLE_MODES
    }})
}

pub(crate) fn issue_key_path(issue: &str) -> String {
    let key = issue.split(' ').next().unwrap_or_default();
    let root = key.split('.').next().unwrap_or_default();
    if root != "manifest" && !ROOT_KEYS.contains(&root) {
        return String::new();
    }
    if !root.starts_with(|character: char| character.is_ascii_alphabetic())
        || !root
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
        || !key.split('.').skip(1).all(|segment| {
            !segment.is_empty()
                && segment
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'*'))
        })
    {
        return String::new();
    }
    let key = if key == "manifest" { "" } else { key };
    if let Some((_, unknown)) = issue.rsplit_once(" Unrecognized key: \"")
        && let Some(unknown) = unknown
            .strip_suffix('"')
            .filter(|unknown| !unknown.is_empty() && !unknown.contains('"'))
    {
        return if key.is_empty() {
            unknown.to_owned()
        } else {
            format!("{key}.{unknown}")
        };
    }
    key.to_owned()
}

pub(super) fn validate(path: &Path, raw: RawManifest) -> Result<Manifest, String> {
    let manifest = &raw.table;
    let mut issues = Issues::default();
    if manifest.contains_key("caddy") {
        issues.schema.push("caddy moved to the devhost config file: set the shared Caddy listeners in the [caddy] table of config.toml in the devhost config directory, and remove [caddy] from the manifest.".into());
    }
    reject_unknown(manifest, "manifest", ROOT_KEYS, &mut issues.schema);
    let name = match manifest.get("name").and_then(Value::as_str) {
        Some(value) if !value.trim().is_empty() => value.to_owned(),
        _ => {
            issues
                .schema
                .push("name Expected a non-empty string.".into());
            String::new()
        }
    };
    let kill_zombies = read_bool(
        manifest,
        "killZombies",
        "killZombies",
        true,
        &mut issues.schema,
    );
    let devtools = validate_devtools(manifest.get("devtools"), &mut issues.schema);
    let worktrees = validate_worktrees(manifest.get("worktrees"), &mut issues.schema);
    let directory = path.parent().unwrap_or(Path::new("."));
    let mut validated_services = BTreeMap::new();
    let mut primary_services = Vec::new();
    let mut routed_paths_by_host: BTreeMap<String, Vec<String>> = BTreeMap::new();
    let mut fixed_bind_ports: BTreeSet<String> = BTreeSet::new();

    match manifest.get("services") {
        None => issues.schema.push("services must be an object.".into()),
        Some(Value::Table(services)) => {
            if services.is_empty() {
                issues
                    .validation
                    .push("services must contain at least one service.".into());
            }
            for (service_name, raw_service) in services {
                let key = format!("services.{service_name}");
                let Some(service) = raw_service.as_table() else {
                    issues.schema.push(format!("{key} must be a table."));
                    continue;
                };
                if !valid_name(service_name) {
                    issues
                        .validation
                        .push(format!("{key} has an invalid name."));
                    continue;
                }
                let (validated, is_primary) = validate_service(
                    service_name,
                    service,
                    &key,
                    directory,
                    services,
                    &mut routed_paths_by_host,
                    &mut fixed_bind_ports,
                    &mut issues,
                );
                validated_services.insert(service_name.clone(), validated);
                if is_primary {
                    primary_services.push(service_name.clone());
                }
            }
        }
        Some(_) => issues.schema.push("services must be a table.".into()),
    }

    let primary_service = if primary_services.len() > 1 {
        issues.validation.push(format!(
            "Multiple primary services defined: {}",
            primary_services.join(", ")
        ));
        String::new()
    } else if primary_services.len() == 1 {
        primary_services.remove(0)
    } else {
        fallback_primary(&raw.service_order, &validated_services)
    };

    let groups = validate_groups(manifest, &validated_services, &mut issues);
    issues.finish()?;

    Ok(Manifest {
        inputs: raw.inputs,
        devtools,
        worktrees,
        manifest_directory: directory.to_path_buf(),
        manifest_path: path.to_path_buf(),
        name,
        primary_service,
        service_order: raw.service_order,
        services: validated_services,
        groups,
        kill_zombies,
    })
}

fn fallback_primary(order: &[String], services: &BTreeMap<String, ValidatedService>) -> String {
    for name in order {
        if services.contains_key(name) {
            return name.clone();
        }
    }
    services.keys().next().cloned().unwrap_or_default()
}

fn validate_worktrees(raw: Option<&Value>, schema: &mut Vec<String>) -> WorktreesConfig {
    let mut cfg = WorktreesConfig::default();
    let Some(value) = raw else {
        return cfg;
    };
    let Some(table) = value.as_table() else {
        schema.push("worktrees must be a table.".into());
        return cfg;
    };
    reject_unknown(table, "worktrees", TOGGLE_KEYS, schema);
    cfg.enabled = read_bool(table, "enabled", "worktrees.enabled", true, schema);
    cfg
}

fn validate_devtools(raw: Option<&Value>, schema: &mut Vec<String>) -> DevtoolsConfig {
    let mut result = DevtoolsConfig::default();
    let Some(value) = raw else {
        return result;
    };
    let Some(table) = value.as_table() else {
        schema.push("devtools must be a table.".into());
        return result;
    };
    reject_unknown(table, "devtools", DEVTOOLS_KEYS, schema);

    result.chat = validate_devtools_chat(table.get("chat"), schema);
    read_devtools_toggle(
        table,
        "annotations",
        &mut result.annotations_enabled,
        schema,
    );
    result.resources = validate_devtools_resources(table.get("resources"), schema);

    if let Some(raw_editor) = table.get("editor") {
        if let Some(editor) = raw_editor.as_table() {
            reject_unknown(editor, "devtools.editor", EDITOR_KEYS, schema);
            result.editor.enabled =
                read_bool(editor, "enabled", "devtools.editor.enabled", true, schema);
            if let Some(ide) = read_optional_string(editor, "ide", "devtools.editor.ide", schema) {
                if COMPONENT_EDITORS.contains(&ide.as_str()) {
                    result.editor.ide = ide;
                } else {
                    schema.push(format!(
                        "devtools.editor.ide must be one of {}.",
                        format_choices(COMPONENT_EDITORS)
                    ));
                }
            }
        } else {
            schema.push("devtools.editor must be a table.".into());
        }
    }

    read_devtools_toggle(
        table,
        "configEditor",
        &mut result.config_editor_enabled,
        schema,
    );
    read_devtools_toggle(
        table,
        "externalToolbars",
        &mut result.external_toolbars_enabled,
        schema,
    );
    read_devtools_toggle(table, "minimap", &mut result.minimap_enabled, schema);

    if let Some(raw_status) = table.get("status") {
        if let Some(status) = raw_status.as_table() {
            reject_unknown(status, "devtools.status", STATUS_KEYS, schema);
            result.status.enabled =
                read_bool(status, "enabled", "devtools.status.enabled", true, schema);
            if let Some(pos) =
                read_optional_string(status, "position", "devtools.status.position", schema)
            {
                if DEVTOOLS_STATUS_POSITIONS.contains(&pos.as_str()) {
                    result.status.position = pos;
                } else {
                    schema.push(format!(
                        "devtools.status.position must be {}.",
                        format_choices(DEVTOOLS_STATUS_POSITIONS)
                    ));
                }
            }
        } else {
            schema.push("devtools.status must be a table.".into());
        }
    }

    if let Some(raw_shortcuts) = table.get("shortcuts") {
        if let Some(shortcuts) = raw_shortcuts.as_table() {
            reject_unknown(shortcuts, "devtools.shortcuts", SHORTCUT_KEYS, schema);
            if let Some(restart) = read_optional_string(
                shortcuts,
                "restartServices",
                "devtools.shortcuts.restartServices",
                schema,
            ) {
                if is_valid_shortcut(&restart) {
                    result.restart_shortcut = restart;
                } else {
                    result.restart_shortcut = "alt+ctrl+r".to_owned();
                }
            }
        } else {
            schema.push("devtools.shortcuts must be a table.".into());
        }
    }

    if let Some(idle) = read_optional_string(table, "idleTimeout", "devtools.idleTimeout", schema) {
        match parse_go_duration(&idle) {
            Ok(_) => result.idle_timeout = idle,
            Err(error) => schema.push(format!(
                "devtools.idleTimeout must be a valid duration: {error}"
            )),
        }
    }

    result
}

fn validate_devtools_chat(raw: Option<&Value>, schema: &mut Vec<String>) -> DevtoolsChatConfig {
    let mut result = DevtoolsChatConfig::default();
    let Some(value) = raw else {
        return result;
    };
    let Some(table) = value.as_table() else {
        schema.push("devtools.chat must be a table.".into());
        return result;
    };
    reject_unknown(table, "devtools.chat", CHAT_KEYS, schema);
    result.enabled = read_bool(table, "enabled", "devtools.chat.enabled", true, schema);
    if let Some(prompt) = read_optional_string(table, "prompt", "devtools.chat.prompt", schema) {
        result.prompt = prompt;
    }
    result
}

fn validate_devtools_resources(
    raw: Option<&Value>,
    schema: &mut Vec<String>,
) -> DevtoolsResourcesConfig {
    let mut result = DevtoolsResourcesConfig::default();
    let Some(value) = raw else {
        return result;
    };
    let path = "devtools.resources";
    let Some(table) = value.as_table() else {
        schema.push(format!("{path} must be a table."));
        return result;
    };
    reject_unknown(table, path, RESOURCES_KEYS, schema);
    result.enabled = read_bool(table, "enabled", "devtools.resources.enabled", true, schema);
    if let Some(interval) = read_poll_interval(table, path, schema) {
        result.cpu.poll_interval = interval;
        result.memory.poll_interval = interval;
        result.disk.poll_interval = interval;
    }
    for (key, target) in [
        ("cpu", &mut result.cpu),
        ("memory", &mut result.memory),
        ("disk", &mut result.disk),
    ] {
        validate_resource_readout(table.get(key), &format!("{path}.{key}"), target, schema);
    }
    result
}

fn validate_resource_readout(
    raw: Option<&Value>,
    path: &str,
    target: &mut DevtoolsResourceConfig,
    schema: &mut Vec<String>,
) {
    let Some(value) = raw else {
        return;
    };
    let Some(table) = value.as_table() else {
        schema.push(format!("{path} must be a table."));
        return;
    };
    reject_unknown(table, path, RESOURCE_KEYS, schema);
    target.enabled = read_bool(table, "enabled", &format!("{path}.enabled"), true, schema);
    if let Some(interval) = read_poll_interval(table, path, schema) {
        target.poll_interval = interval;
    }
}

fn read_poll_interval(table: &Table, path: &str, schema: &mut Vec<String>) -> Option<Duration> {
    let raw = table.get("pollInterval")?;
    let key_path = format!("{path}.pollInterval");
    let Some(text) = raw.as_str() else {
        schema.push(format!(
            "{key_path} must be a duration string such as \"2s\"."
        ));
        return None;
    };
    match parse_go_duration(text) {
        Ok(duration) if duration >= MIN_RESOURCE_POLL_INTERVAL => Some(duration),
        Ok(_) => {
            schema.push(format!("{key_path} must be at least 250ms."));
            None
        }
        Err(error) => {
            schema.push(format!("{key_path} must be a valid duration: {error}"));
            None
        }
    }
}

fn read_devtools_toggle(table: &Table, key: &str, target: &mut bool, schema: &mut Vec<String>) {
    let Some(raw) = table.get(key) else {
        return;
    };
    let path = format!("devtools.{key}");
    let Some(sub) = raw.as_table() else {
        schema.push(format!("{path} must be a table."));
        return;
    };
    reject_unknown(sub, &path, TOGGLE_KEYS, schema);
    if sub.contains_key("enabled") {
        *target = read_bool(sub, "enabled", &format!("{path}.enabled"), *target, schema);
    }
}

#[allow(clippy::too_many_arguments)]
fn validate_service(
    service_name: &str,
    service: &Table,
    key: &str,
    directory: &Path,
    services: &Table,
    routed_paths_by_host: &mut BTreeMap<String, Vec<String>>,
    fixed_bind_ports: &mut BTreeSet<String>,
    issues: &mut Issues,
) -> (ValidatedService, bool) {
    reject_unknown(service, key, SERVICE_KEYS, &mut issues.schema);
    let managed = read_bool(
        service,
        "managed",
        &format!("{key}.managed"),
        true,
        &mut issues.schema,
    );
    let lifecycle = validate_lifecycle(service, key, issues);
    let daemon = lifecycle.mode == "daemon";

    let mut serve = String::new();
    let mut serves_files = false;
    if let Some(raw_serve) = service.get("serve") {
        if let Some(path) = raw_serve.as_str().filter(|path| !path.trim().is_empty()) {
            serves_files = true;
            serve = resolve_constrained_path(
                &format!("{key}.serve"),
                path,
                directory,
                &mut issues.validation,
            )
            .to_string_lossy()
            .into_owned();
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

    let command = if let Some(cmd_val) = service.get("command") {
        let parsed = read_command(cmd_val, &format!("{key}.command"), &mut issues.schema);
        if parsed.is_some() && !managed {
            issues
                .validation
                .push(format!("{key} must omit command when managed = false."));
        }
        if parsed.is_some() && daemon {
            issues.validation.push(format!(
                "{key} must omit command when lifecycle.mode = \"daemon\"."
            ));
        }
        parsed.unwrap_or_default()
    } else if managed && !daemon && !serves_files {
        issues.schema.push(format!(
            "{key}.command must be a non-empty string or string array."
        ));
        Vec::new()
    } else {
        Vec::new()
    };

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

    let bind_host = match read_optional_string(
        service,
        "bindHost",
        &format!("{key}.bindHost"),
        &mut issues.schema,
    ) {
        Some(host) => {
            if !SERVICE_BIND_HOSTS.contains(&host.as_str()) {
                issues.schema.push(format!(
                    "{key}.bindHost must be one of {}.",
                    format_choices(SERVICE_BIND_HOSTS)
                ));
            }
            host
        }
        None => "127.0.0.1".to_owned(),
    };

    let raw_cwd = read_optional_string(service, "cwd", &format!("{key}.cwd"), &mut issues.schema)
        .unwrap_or_else(|| ".".to_owned());
    let mut resolved_cwd = resolve_constrained_path(
        &format!("{key}.cwd"),
        &raw_cwd,
        directory,
        &mut issues.validation,
    );
    if serves_files {
        resolved_cwd = PathBuf::from(&serve);
    }

    let mut watch = Vec::new();
    if let Some(raw_watch) = service.get("watch")
        && let Some(values) =
            read_string_array(raw_watch, &format!("{key}.watch"), &mut issues.schema)
    {
        for item in values {
            let resolved = resolve_watch_path(&resolved_cwd, item);
            if !is_within_directory(directory, &resolved)
                && !is_within_directory(&resolved_cwd, &resolved)
            {
                write_warning(&format!(
                    "services.{service_name}.watch path {item:?} resolves outside the manifest directory {:?} and the service cwd {:?}",
                    directory.display().to_string(),
                    resolved_cwd.display().to_string()
                ));
            }
            watch.push(item.to_owned());
        }
    }

    let mut depends_on = Vec::new();
    if let Some(raw_deps) = service.get("dependsOn")
        && let Some(dependencies) =
            read_string_array(raw_deps, &format!("{key}.dependsOn"), &mut issues.schema)
    {
        for dependency in dependencies {
            if !services.contains_key(dependency) {
                issues.validation.push(format!(
                    "{key}.dependsOn references an unknown service: {dependency}"
                ));
            }
            depends_on.push(dependency.to_owned());
        }
    }

    let env = read_string_map(service, "env", &format!("{key}.env"), &mut issues.schema);

    let mut port = read_service_port(service, key, &mut issues.schema);
    if serves_files && port.is_none() {
        port = Some(PortConfig {
            auto: true,
            number: 0,
        });
    }
    let has_inject_port = service.contains_key("injectPort");
    let inject_port = read_bool(
        service,
        "injectPort",
        &format!("{key}.injectPort"),
        managed && !serves_files,
        &mut issues.schema,
    );
    if !managed && has_inject_port {
        issues
            .validation
            .push(format!("{key} must omit injectPort when managed = false."));
    }

    let hosts_opt = read_service_hosts(service, key, &mut issues.schema);
    let has_host = hosts_opt.is_some();
    let proxy_local_origin = read_bool(
        service,
        "proxyLocalOrigin",
        &format!("{key}.proxyLocalOrigin"),
        false,
        &mut issues.schema,
    );
    if proxy_local_origin && !has_host {
        issues
            .validation
            .push(format!("{key}.proxyLocalOrigin requires host."));
    }
    let mut hosts = Vec::new();
    if let Some(raw_hosts) = hosts_opt {
        let mut seen = BTreeSet::new();
        for host in raw_hosts {
            if !is_valid_host(&host) && !is_valid_host_label(&host) {
                issues.validation.push(format!(
                    "{key}.host must be a valid hostname, received: {host}"
                ));
            }
            let lowered = host.to_ascii_lowercase();
            if !seen.insert(lowered.clone()) {
                issues
                    .validation
                    .push(format!("{key}.host contains duplicate hostname: {lowered}"));
            }
            hosts.push(lowered);
        }
    }

    let mut normalized_path = None;
    if has_host {
        let raw_path = if let Some(path_val) = service.get("path") {
            match path_val.as_str().filter(|v| !v.trim().is_empty()) {
                Some(v) => v.to_owned(),
                None => {
                    issues
                        .schema
                        .push(format!("{key}.path Expected a non-empty string."));
                    "/".to_owned()
                }
            }
        } else {
            "/".to_owned()
        };
        if let Some(validated_path) =
            validate_route_path(service_name, &raw_path, &mut issues.validation)
        {
            for host in &hosts {
                let existing = routed_paths_by_host.entry(host.clone()).or_default();
                if let Some(conflict) = read_conflicting_route_path(existing, &validated_path) {
                    issues.validation.push(format!(
                        "{key}.path overlaps another routed service on host {host}: {conflict}"
                    ));
                }
                existing.push(validated_path.clone());
            }
            normalized_path = Some(validated_path);
        }
        if port.is_none() {
            issues
                .validation
                .push(format!("{key}.host requires {key}.port."));
        }
    }

    let health = read_optional_health(service, key, &mut issues.schema);
    if let Some(ref h) = health {
        if h.process && has_host {
            issues.validation.push(format!(
                "{key} must not use health.process on a routed service."
            ));
        }
        if serves_files && h.process {
            issues.validation.push(format!(
                "{key} must not use health.process when serve is configured."
            ));
        }
        if h.process && !managed {
            issues.validation.push(format!(
                "{key} must not use health.process when managed = false."
            ));
        }
        if h.process && daemon {
            issues.validation.push(format!(
                "{key} must not use health.process when lifecycle.mode = \"daemon\"."
            ));
        }
        if h.tcp.is_none() && h.http.is_none() && !h.process && port.is_none() {
            issues.validation.push(format!(
                "{key}.health must define a probe or a service port."
            ));
        }
    }

    if let Some(p) = port {
        if p.auto && !managed {
            issues.validation.push(format!(
                "{key} must not use port = \"auto\" when managed = false."
            ));
        }
        if p.auto && daemon {
            issues.validation.push(format!(
                "{key} must not use port = \"auto\" when lifecycle.mode = \"daemon\"."
            ));
        }
    }
    if port.is_none() && health.is_none() {
        issues
            .validation
            .push(format!("{key} must define either port or health."));
    }

    if let Some(ref h) = health
        && let Some(ref raw_url) = h.http
    {
        if raw_url.starts_with('/') && !raw_url.starts_with("//") {
            if port.is_none() {
                issues
                    .validation
                    .push(format!("{key}.health.http shorthand requires {key}.port."));
            }
            if Url::parse(&format!("http://127.0.0.1{raw_url}")).is_err() {
                issues.validation.push(format!(
                    "{key}.health.http must be a valid URL path: {raw_url}"
                ));
            }
        } else if !raw_url.contains("{{")
            && let Err(error) = validate_health_http_url(service_name, raw_url)
        {
            issues.validation.push(error);
        }
    }

    if let Some(p) = port
        && !p.auto
    {
        let scope = match bind_host.as_str() {
            "127.0.0.1" | "0.0.0.0" => "ipv4",
            "::1" | "::" => "ipv6",
            other => other,
        };
        let claim_key = format!("{scope}:{}", p.number);
        if !fixed_bind_ports.insert(claim_key) {
            issues.validation.push(format!(
                "{key} duplicates fixed bind port {bind_host}:{}.",
                p.number
            ));
        }
    }

    (
        ValidatedService {
            always_start,
            proxy_local_origin,
            bind_host,
            command,
            serve,
            cwd: resolved_cwd,
            depends_on,
            env,
            health,
            hosts,
            inject_port,
            lifecycle,
            managed,
            name: service_name.to_owned(),
            path: normalized_path,
            port,
            watch,
        },
        primary,
    )
}

fn validate_lifecycle(service: &Table, key: &str, issues: &mut Issues) -> ServiceLifecycleConfig {
    let mut config = ServiceLifecycleConfig::default();
    let path = format!("{key}.lifecycle");
    let Some(lifecycle) = service.get("lifecycle") else {
        return config;
    };
    let Some(lifecycle) = lifecycle.as_table() else {
        issues.schema.push(format!("{path} must be a table."));
        return config;
    };
    reject_unknown(lifecycle, &path, LIFECYCLE_KEYS, &mut issues.schema);
    if let Some(mode) = lifecycle.get("mode") {
        match mode.as_str() {
            Some(mode) if LIFECYCLE_MODES.contains(&mode) => config.mode = mode.to_owned(),
            _ => issues
                .schema
                .push(format!("{path}.mode must be one of foreground or daemon.")),
        }
    }
    let daemon = config.mode == "daemon";
    for (action, target) in [
        ("start", &mut config.start),
        ("status", &mut config.status),
        ("stop", &mut config.stop),
    ] {
        if let Some(command) = lifecycle.get(action)
            && let Some(parts) =
                read_lifecycle_command(command, &format!("{path}.{action}"), &mut issues.schema)
        {
            *target = parts;
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
    config
}

fn read_lifecycle_command(
    command: &Value,
    key: &str,
    schema: &mut Vec<String>,
) -> Option<Vec<String>> {
    if let Some(command) = command.as_str() {
        let parts: Vec<String> = command.split_whitespace().map(str::to_owned).collect();
        if !parts.is_empty() {
            return Some(parts);
        }
        schema.push(format!("{key} Expected a non-empty string."));
        return None;
    }
    if let Some(arguments) = command.as_array()
        && !arguments.is_empty()
        && arguments.iter().all(|argument| {
            argument
                .as_str()
                .is_some_and(|value| !value.trim().is_empty())
        })
    {
        return Some(
            arguments
                .iter()
                .filter_map(|v| v.as_str().map(str::to_owned))
                .collect(),
        );
    }
    schema.push(format!("{key} must be a non-empty string or string array."));
    None
}

fn read_service_port(service: &Table, key: &str, schema: &mut Vec<String>) -> Option<PortConfig> {
    let value = service.get("port")?;
    if let Some(text) = value.as_str() {
        if text == "auto" {
            return Some(PortConfig {
                auto: true,
                number: 0,
            });
        }
        schema.push(format!(
            "{key}.port must be an integer between 1 and 65535 or \"auto\"."
        ));
        return None;
    }
    if let Some(number) = value
        .as_integer()
        .and_then(|n| u16::try_from(n).ok())
        .filter(|&n| n != 0)
    {
        return Some(PortConfig {
            auto: false,
            number,
        });
    }
    schema.push(format!(
        "{key}.port must be an integer between 1 and 65535 or \"auto\"."
    ));
    None
}

fn read_optional_health(
    service: &Table,
    key: &str,
    schema: &mut Vec<String>,
) -> Option<HealthConfig> {
    let raw = service.get("health")?;
    let health_path = format!("{key}.health");
    let Some(table) = raw.as_table() else {
        schema.push(format!("{health_path} must be a table."));
        return None;
    };
    reject_unknown(table, &health_path, HEALTH_KEYS, schema);
    let mut result = HealthConfig::default();
    let mut kinds = 0;

    if let Some(tcp) = table.get("tcp") {
        if let Some(port) = tcp
            .as_integer()
            .and_then(|n| u16::try_from(n).ok())
            .filter(|&n| n != 0)
        {
            result.tcp = Some(port);
            kinds += 1;
        } else {
            schema.push(format!(
                "{health_path}.tcp must be an integer between 1 and 65535."
            ));
        }
    }
    if let Some(http) = table.get("http") {
        if let Some(url) = http.as_str() {
            result.http = Some(url.to_owned());
            kinds += 1;
        } else {
            schema.push(format!("{health_path}.http must be a string."));
        }
    }
    if let Some(process) = table.get("process") {
        if process.as_bool() == Some(true) {
            result.process = true;
            kinds += 1;
        } else {
            schema.push(format!("{health_path}.process must be true."));
        }
    }
    for (timed_key, minimum) in [("interval", 1i64), ("timeout", 1), ("retries", 0)] {
        if let Some(val) = table.get(timed_key) {
            if let Some(num) = val.as_integer().filter(|&n| n >= minimum) {
                let u = num as u64;
                match timed_key {
                    "interval" => result.interval = Some(u),
                    "timeout" => result.timeout = Some(u),
                    _ => result.retries = Some(u),
                }
            } else {
                schema.push(format!(
                    "{health_path}.{timed_key} must be an integer >= {minimum}."
                ));
            }
        }
    }
    if kinds > 1 {
        schema.push(format!(
            "{health_path} must define at most one of tcp, http, or process."
        ));
        return None;
    }
    Some(result)
}

fn validate_groups(
    manifest: &Table,
    services: &BTreeMap<String, ValidatedService>,
    issues: &mut Issues,
) -> BTreeMap<String, Vec<String>> {
    let mut groups_map = BTreeMap::new();
    let Some(groups) = manifest.get("groups") else {
        return groups_map;
    };
    let Some(groups) = groups.as_table() else {
        issues.schema.push("groups must be a table.".into());
        return groups_map;
    };
    for (name, members) in groups {
        let key = format!("groups.{name}");
        if !valid_name(name) {
            issues
                .validation
                .push(format!("{key} has an invalid name."));
        }
        if services.contains_key(name) {
            issues
                .validation
                .push(format!("{key} conflicts with a service name."));
        }
        if let Some(members) = read_string_array(members, &key, &mut issues.schema) {
            for member in &members {
                if !services.contains_key(*member) {
                    issues
                        .validation
                        .push(format!("{key} references an unknown service: {member}"));
                }
            }
            groups_map.insert(
                name.clone(),
                members.into_iter().map(str::to_owned).collect(),
            );
        }
    }
    groups_map
}

fn read_service_hosts(service: &Table, key: &str, schema: &mut Vec<String>) -> Option<Vec<String>> {
    let raw = service.get("host")?;
    if let Some(single) = raw.as_str() {
        return Some(vec![single.to_owned()]);
    }
    read_string_array(raw, &format!("{key}.host"), schema)
        .map(|items| items.into_iter().map(str::to_owned).collect())
}

fn read_string_map(
    table: &Table,
    setting: &str,
    path: &str,
    schema: &mut Vec<String>,
) -> BTreeMap<String, String> {
    let mut out = BTreeMap::new();
    let Some(raw) = table.get(setting) else {
        return out;
    };
    let Some(map) = raw.as_table() else {
        schema.push(format!("{path} must be a string map."));
        return out;
    };
    for (k, v) in map {
        let Some(s) = v.as_str() else {
            schema.push(format!("{path}.{k} must be a string."));
            return BTreeMap::new();
        };
        out.insert(k.clone(), s.to_owned());
    }
    out
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

fn read_optional_string(
    table: &Table,
    setting: &str,
    path: &str,
    schema: &mut Vec<String>,
) -> Option<String> {
    let raw = table.get(setting)?;
    if let Some(text) = raw.as_str() {
        Some(text.to_owned())
    } else {
        schema.push(format!("{path} must be a string."));
        None
    }
}

fn read_command(command: &Value, key: &str, schema: &mut Vec<String>) -> Option<Vec<String>> {
    if let Some(command) = command.as_str() {
        let parts: Vec<String> = command.split_whitespace().map(str::to_owned).collect();
        if parts.is_empty() {
            schema.push(format!("{key} Expected a non-empty string."));
            return None;
        }
        return Some(parts);
    }
    read_string_array(command, key, schema)
        .map(|items| items.into_iter().map(str::to_owned).collect())
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

fn resolve_constrained_path(
    field_path: &str,
    candidate: &str,
    directory: &Path,
    invalid: &mut Vec<String>,
) -> PathBuf {
    let path = Path::new(candidate);
    if path.is_absolute() {
        return clean(path);
    }
    let resolved = clean(&directory.join(path));
    if !is_within_directory(directory, &resolved) {
        invalid.push(format!(
            "{field_path} must stay within {}.",
            directory.display()
        ));
    }
    resolved
}

fn is_within_directory(directory: &Path, target: &Path) -> bool {
    let base = clean(directory);
    let candidate = clean(target);
    candidate == base || candidate.starts_with(&base)
}

fn validate_route_path(
    service_name: &str,
    raw_path: &str,
    validation: &mut Vec<String>,
) -> Option<String> {
    if !raw_path.starts_with('/') {
        validation.push(format!("services.{service_name}.path must start with '/'."));
        return None;
    }
    if raw_path == "/" || raw_path == "/*" {
        return Some("/".to_owned());
    }
    if raw_path.contains('*') {
        let base = raw_path.strip_suffix("/*");
        if base.is_none_or(|b| b.contains('*')) {
            validation.push(format!(
                "services.{service_name}.path must be '/' or a leading-slash path with an optional trailing '/*'."
            ));
            return None;
        }
    }
    Some(raw_path.to_owned())
}

pub fn read_conflicting_route_path<'a>(
    existing_paths: &'a [String],
    candidate: &str,
) -> Option<&'a str> {
    existing_paths
        .iter()
        .find(|existing| route_paths_conflict(existing, candidate))
        .map(String::as_str)
}

fn route_paths_conflict(left: &str, right: &str) -> bool {
    if left == right {
        return true;
    }
    if left == "/" || right == "/" {
        return false;
    }
    let (left_base, left_prefix) = match left.strip_suffix("/*") {
        Some(base) => (base, true),
        None => (left, false),
    };
    let (right_base, right_prefix) = match right.strip_suffix("/*") {
        Some(base) => (base, true),
        None => (right, false),
    };
    match (left_prefix, right_prefix) {
        (true, true) => {
            left_base == right_base
                || left_base.starts_with(&format!("{right_base}/"))
                || right_base.starts_with(&format!("{left_base}/"))
        }
        (false, false) => left_base == right_base,
        (false, true) => left_base.starts_with(&format!("{right_base}/")),
        (true, false) => right_base.starts_with(&format!("{left_base}/")),
    }
}

pub fn validate_health_http_url(service_name: &str, raw_url: &str) -> Result<(), String> {
    let Ok(parsed) = Url::parse(raw_url) else {
        return Err(format!(
            "services.{service_name}.health.http must be an absolute URL, received: {raw_url}"
        ));
    };
    if parsed.host_str().is_none() {
        return Err(format!(
            "services.{service_name}.health.http must be an absolute URL, received: {raw_url}"
        ));
    }
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(format!(
            "services.{service_name}.health.http must use http or https."
        ));
    }
    let host = parsed
        .host_str()
        .unwrap_or_default()
        .trim_matches(['[', ']']);
    if !matches!(host, "127.0.0.1" | "localhost" | "::1") {
        return Err(format!(
            "services.{service_name}.health.http must target 127.0.0.1, localhost, or ::1."
        ));
    }
    Ok(())
}

pub fn is_valid_host(host: &str) -> bool {
    if host.len() > 253 {
        return false;
    }
    if host == "localhost" {
        return true;
    }
    host.contains('.') && host.split('.').all(is_valid_host_label)
}

pub fn is_valid_host_label(label: &str) -> bool {
    !label.is_empty()
        && label.len() <= 63
        && !label.contains('.')
        && label
            .as_bytes()
            .first()
            .is_some_and(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
        && label
            .as_bytes()
            .last()
            .is_some_and(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
        && label
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

fn is_valid_shortcut(shortcut: &str) -> bool {
    !shortcut.is_empty()
        && shortcut.split('+').all(|part| {
            !part.is_empty()
                && part
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
        })
}

fn format_choices(choices: &[&str]) -> String {
    match choices {
        [] => String::new(),
        [only] => (*only).to_owned(),
        [first, second] => format!("{first} or {second}"),
        [head @ .., last] => format!("{}, or {last}", head.join(", ")),
    }
}

fn write_warning(message: &str) {
    let mode = Mode::from_env();
    let (prefix, tag) = match mode {
        Mode::Agent => ("devhost:", "WARN:"),
        Mode::Human => ("devhost |", "[WARN]"),
    };
    let mut stderr = std::io::stderr().lock();
    let _ = writeln!(
        stderr,
        "{prefix} {tag} {}",
        cli_command_kit::display_message(message)
    );
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
