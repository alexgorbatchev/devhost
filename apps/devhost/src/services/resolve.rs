use std::{
    collections::{BTreeMap, BTreeSet},
    net::TcpListener,
    path::PathBuf,
};

use url::Url;

use crate::{
    caddy::ctx,
    config::CaddySettings,
    manifest::{
        DevtoolsConfig, Manifest, ServiceLifecycleConfig, ValidatedService, WorktreesConfig,
        is_valid_host, is_valid_host_label, read_conflicting_route_path, validate_health_http_url,
    },
};

const DEFAULT_HEALTH_INTERVAL_MS: u64 = 200;
const DEFAULT_HEALTH_RETRIES: u64 = 0;
const DEFAULT_HEALTH_TIMEOUT_MS: u64 = 30_000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HealthKind {
    Process,
    Tcp,
    Http,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedHealthConfig {
    pub fixed_tcp_port: bool,
    pub host: Option<String>,
    pub interval_ms: u64,
    pub kind: HealthKind,
    pub port: Option<u16>,
    pub retries: u64,
    pub timeout_ms: u64,
    pub url: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedService {
    pub proxy_local_origin: bool,
    pub bind_host: String,
    pub command: Vec<String>,
    pub serve: String,
    pub cwd: PathBuf,
    pub depends_on: Vec<String>,
    pub env: BTreeMap<String, String>,
    pub health: ResolvedHealthConfig,
    pub hosts: Vec<String>,
    pub inject_port: bool,
    pub lifecycle: ServiceLifecycleConfig,
    pub managed: bool,
    pub name: String,
    pub path: Option<String>,
    pub port: Option<u16>,
    pub port_source: String,
    pub watch: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedManifest {
    pub remote: Option<crate::remote::Settings>,
    pub configuration: Option<Manifest>,
    pub requested: Vec<String>,
    pub caddy: CaddySettings,
    pub domain_suffix: String,
    pub devtools: DevtoolsConfig,
    pub worktrees: WorktreesConfig,
    pub manifest_directory: PathBuf,
    pub manifest_path: PathBuf,
    pub name: String,
    pub primary_service: String,
    pub service_order: Vec<String>,
    pub services: BTreeMap<String, ResolvedService>,
    pub stopped: BTreeMap<String, ResolvedService>,
    pub kill_zombies: bool,
}

#[derive(Debug, Default, Clone)]
pub struct PortResolutionOptions {
    pub remote: Option<crate::remote::Settings>,
    pub requested: Vec<String>,
    pub preserved: BTreeMap<String, u16>,
    pub excluded: BTreeMap<String, BTreeSet<u16>>,
    pub domain_suffix: String,
    pub remote_mode: bool,
}

pub fn validate_requested_services(
    manifest: &Manifest,
    requested: &[String],
) -> Result<(), String> {
    let mut unknown = Vec::new();
    for name in requested {
        if !manifest.services.contains_key(name) && !manifest.groups.contains_key(name) {
            unknown.push(format!("{name:?}"));
        }
    }
    if unknown.is_empty() {
        return Ok(());
    }
    let mut defined: Vec<&str> = manifest
        .services
        .keys()
        .chain(manifest.groups.keys())
        .map(String::as_str)
        .collect();
    defined.sort_unstable();
    let subject = match (!manifest.groups.is_empty(), unknown.len() > 1) {
        (false, false) => "unknown service",
        (false, true) => "unknown services",
        (true, false) => "unknown service or group",
        (true, true) => "unknown services or groups",
    };
    Err(format!(
        "{subject}: {}; the manifest defines: {}",
        unknown.join(", "),
        defined.join(", ")
    ))
}

pub fn resolve_service_order(manifest: &Manifest) -> Result<Vec<String>, String> {
    let mut visiting = BTreeSet::new();
    let mut visited = BTreeSet::new();
    let mut ordered = Vec::new();
    for name in ordered_service_names(manifest) {
        visit_service(
            &name,
            &manifest.services,
            &mut visiting,
            &mut visited,
            &mut ordered,
            &mut Vec::new(),
        )?;
    }
    Ok(ordered)
}

fn visit_service(
    name: &str,
    services: &BTreeMap<String, ValidatedService>,
    visiting: &mut BTreeSet<String>,
    visited: &mut BTreeSet<String>,
    ordered: &mut Vec<String>,
    ancestry: &mut Vec<String>,
) -> Result<(), String> {
    if visited.contains(name) {
        return Ok(());
    }
    if visiting.contains(name) {
        let mut cycle = ancestry.clone();
        cycle.push(name.to_owned());
        return Err(format!("Dependency cycle detected: {}", cycle.join(" -> ")));
    }
    visiting.insert(name.to_owned());
    ancestry.push(name.to_owned());
    if let Some(service) = services.get(name) {
        for dep in &service.depends_on {
            visit_service(dep, services, visiting, visited, ordered, ancestry)?;
        }
    }
    ancestry.pop();
    visiting.remove(name);
    visited.insert(name.to_owned());
    ordered.push(name.to_owned());
    Ok(())
}

fn ordered_service_names(manifest: &Manifest) -> Vec<String> {
    if manifest.service_order.is_empty() {
        return manifest.services.keys().cloned().collect();
    }
    let mut names = Vec::new();
    let mut seen = BTreeSet::new();
    for name in &manifest.service_order {
        if manifest.services.contains_key(name) && seen.insert(name.clone()) {
            names.push(name.clone());
        }
    }
    for name in manifest.services.keys() {
        if seen.insert(name.clone()) {
            names.push(name.clone());
        }
    }
    names
}

pub fn started_service_names(manifest: &Manifest, requested: &[String]) -> BTreeSet<String> {
    let mut started = BTreeSet::new();
    if requested.is_empty() {
        started.extend(manifest.services.keys().cloned());
        return started;
    }
    let mut pending = Vec::new();
    for name in requested {
        if let Some(members) = manifest.groups.get(name) {
            pending.extend(members.iter().cloned());
        } else {
            pending.push(name.clone());
        }
    }
    for (name, service) in &manifest.services {
        if service.always_start {
            pending.push(name.clone());
        }
    }
    while let Some(name) = pending.pop() {
        if let Some(service) = manifest.services.get(&name)
            && started.insert(name)
        {
            pending.extend(service.depends_on.iter().cloned());
        }
    }
    started
}

pub fn resolve_service_ports(
    manifest: &Manifest,
    options: &PortResolutionOptions,
) -> Result<ResolvedManifest, String> {
    let suffix = if options.domain_suffix.is_empty() {
        ".localhost"
    } else {
        options.domain_suffix.as_str()
    };
    let expanded_services = resolve_manifest_hosts(manifest, suffix, options.remote_mode)?;

    let mut excluded_by_host: BTreeMap<String, BTreeSet<u16>> = BTreeMap::new();
    for service in expanded_services.values() {
        if let Some(port) = service.port
            && !port.auto
        {
            excluded_by_host
                .entry(service.bind_host.clone())
                .or_default()
                .insert(port.number);
        }
    }
    for (host, ports) in &options.excluded {
        excluded_by_host
            .entry(host.clone())
            .or_default()
            .extend(ports.iter().copied());
    }
    for (name, &port) in &options.preserved {
        if let Some(service) = expanded_services.get(name) {
            excluded_by_host
                .entry(service.bind_host.clone())
                .or_default()
                .insert(port);
        }
    }

    let mut resolved_services: BTreeMap<String, ResolvedService> = BTreeMap::new();
    for (name, service) in &expanded_services {
        let excluded = excluded_by_host
            .entry(service.bind_host.clone())
            .or_default();
        let (resolved_port, port_source) = match service.port {
            Some(p) if p.auto => {
                let port = match options.preserved.get(name) {
                    Some(&port) => port,
                    None => reserve_auto_port(&service.bind_host, excluded)?,
                };
                excluded.insert(port);
                (Some(port), "auto")
            }
            Some(p) => (Some(p.number), "fixed"),
            None => (None, "none"),
        };

        if let Some(port) = resolved_port
            && resolved_services
                .values()
                .any(|other| other.bind_host == service.bind_host && other.port == Some(port))
        {
            return Err(format!(
                "Resolved runtime bind port is duplicated: {}:{port}",
                service.bind_host
            ));
        }

        let managed = service.managed
            || !service.command.is_empty()
            || !service.serve.is_empty()
            || service.lifecycle.mode == "daemon";

        resolved_services.insert(
            name.clone(),
            ResolvedService {
                proxy_local_origin: service.proxy_local_origin,
                bind_host: service.bind_host.clone(),
                command: service.command.clone(),
                serve: service.serve.clone(),
                cwd: service.cwd.clone(),
                depends_on: service.depends_on.clone(),
                env: service.env.clone(),
                health: ResolvedHealthConfig {
                    fixed_tcp_port: false,
                    host: None,
                    interval_ms: DEFAULT_HEALTH_INTERVAL_MS,
                    kind: HealthKind::Process,
                    port: None,
                    retries: DEFAULT_HEALTH_RETRIES,
                    timeout_ms: DEFAULT_HEALTH_TIMEOUT_MS,
                    url: None,
                },
                hosts: service.hosts.clone(),
                inject_port: service.inject_port,
                lifecycle: service.lifecycle.clone(),
                managed,
                name: service.name.clone(),
                path: service.path.clone(),
                port: resolved_port,
                port_source: port_source.to_owned(),
                watch: service.watch.clone(),
            },
        );
    }

    let snapshot = resolved_services.clone();
    for (name, service) in &mut resolved_services {
        let raw_service = &expanded_services[name];
        service.health = resolve_health_config(raw_service, service.port, &snapshot)?;
        let mut interpolated_env = BTreeMap::new();
        for (k, v) in &service.env {
            let val = ctx(
                interpolate_service_templates(v, &snapshot),
                &format!("service {name:?}: interpolate env {k:?}"),
            )?;
            interpolated_env.insert(k.clone(), val);
        }
        service.env = interpolated_env;

        let mut interpolated_cmd = Vec::with_capacity(service.command.len());
        for part in &service.command {
            let val = ctx(
                interpolate_service_templates(part, &snapshot),
                &format!("service {name:?}: interpolate command arg {part:?}"),
            )?;
            interpolated_cmd.push(val);
        }
        service.command = interpolated_cmd;
    }

    let started = started_service_names(manifest, &options.requested);
    let mut active = BTreeMap::new();
    let mut stopped = BTreeMap::new();
    for (name, service) in resolved_services {
        if started.contains(&name) {
            active.insert(name, service);
        } else {
            stopped.insert(name, service);
        }
    }

    if options.remote_mode && !active.values().any(|s| !s.hosts.is_empty()) {
        return Err(
            "remote previews require at least one selected service with a routed hostname"
                .to_owned(),
        );
    }

    Ok(ResolvedManifest {
        remote: options.remote.clone(),
        configuration: Some(manifest.clone()),
        requested: options.requested.clone(),
        caddy: CaddySettings::default(),
        domain_suffix: suffix.to_owned(),
        devtools: manifest.devtools.clone(),
        worktrees: manifest.worktrees.clone(),
        manifest_directory: manifest.manifest_directory.clone(),
        manifest_path: manifest.manifest_path.clone(),
        name: manifest.name.clone(),
        primary_service: manifest.primary_service.clone(),
        service_order: manifest.service_order.clone(),
        services: active,
        stopped,
        kill_zombies: manifest.kill_zombies,
    })
}

fn resolve_manifest_hosts(
    manifest: &Manifest,
    suffix: &str,
    remote_mode: bool,
) -> Result<BTreeMap<String, ValidatedService>, String> {
    let mut services = manifest.services.clone();
    let mut paths_by_host: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for (name, service) in &mut services {
        for host in &mut service.hosts {
            if remote_mode && !is_valid_host_label(host) {
                return Err(format!(
                    "service {name} hostname {host:?} must be a single DNS label for remote previews; use host = \"web\" and let remote.domainSuffix supply the domain"
                ));
            }
            if !host.contains('.') {
                host.push_str(suffix);
            }
            if !is_valid_host(host) {
                return Err(format!(
                    "service {name} resolved hostname {host:?} is invalid"
                ));
            }
            if let Some(ref path) = service.path {
                let existing = paths_by_host.entry(host.clone()).or_default();
                if let Some(conflict) = read_conflicting_route_path(existing, path) {
                    return Err(format!(
                        "service {name} path {path} overlaps another routed service on host {host}: {conflict}"
                    ));
                }
                existing.push(path.clone());
            }
        }
    }
    Ok(services)
}

pub(crate) fn reserve_auto_port(bind_host: &str, excluded: &BTreeSet<u16>) -> Result<u16, String> {
    for _ in 0..32 {
        let addr = if bind_host.contains(':') {
            format!("[{bind_host}]:0")
        } else {
            format!("{bind_host}:0")
        };
        let port_label = format!("reserve auto port for {bind_host}");
        let listener = ctx(TcpListener::bind(&addr), &port_label)?;
        let port = ctx(listener.local_addr(), &port_label)?.port();
        crate::sockets::shutdown_listener(&listener);
        drop(listener);
        if !excluded.contains(&port) {
            return Ok(port);
        }
    }
    Err(format!(
        "reserve auto port for {bind_host}: exhausted retry limit"
    ))
}

fn resolve_health_config(
    service: &ValidatedService,
    resolved_port: Option<u16>,
    services: &BTreeMap<String, ResolvedService>,
) -> Result<ResolvedHealthConfig, String> {
    let mut base = ResolvedHealthConfig {
        fixed_tcp_port: false,
        host: None,
        interval_ms: DEFAULT_HEALTH_INTERVAL_MS,
        kind: HealthKind::Tcp,
        port: None,
        retries: DEFAULT_HEALTH_RETRIES,
        timeout_ms: DEFAULT_HEALTH_TIMEOUT_MS,
        url: None,
    };
    if let Some(ref health) = service.health {
        base.interval_ms = health.interval.unwrap_or(DEFAULT_HEALTH_INTERVAL_MS);
        base.retries = health.retries.unwrap_or(DEFAULT_HEALTH_RETRIES);
        base.timeout_ms = health.timeout.unwrap_or(DEFAULT_HEALTH_TIMEOUT_MS);
        if let Some(tcp) = health.tcp {
            base.fixed_tcp_port = true;
            base.kind = HealthKind::Tcp;
            base.host = Some(service.bind_host.clone());
            base.port = Some(tcp);
            return Ok(base);
        }
        if let Some(ref raw_url) = health.http {
            let url = resolve_health_url(&service.name, raw_url, services)?;
            base.kind = HealthKind::Http;
            base.url = Some(url);
            return Ok(base);
        }
        if health.process {
            base.kind = HealthKind::Process;
            return Ok(base);
        }
    }
    let Some(port) = resolved_port else {
        return Err(format!(
            "Service {} is missing an effective health check.",
            service.name
        ));
    };
    base.kind = HealthKind::Tcp;
    base.host = Some(service.bind_host.clone());
    base.port = Some(port);
    Ok(base)
}

fn resolve_health_url(
    name: &str,
    raw: &str,
    services: &BTreeMap<String, ResolvedService>,
) -> Result<String, String> {
    let mut resolved = ctx(
        interpolate_service_templates(raw, services),
        &format!("services.{name}.health.http"),
    )?;
    if resolved.contains("{{") || resolved.contains("}}") {
        return Err(format!(
            "services.{name}.health.http contains an unresolved URL template: {resolved}"
        ));
    }
    if resolved.starts_with('/') && !resolved.starts_with("//") {
        let base = build_service_url(&services[name])?;
        let joined = ctx(
            base.join(&resolved),
            &format!("services.{name}.health.http must be a valid URL path"),
        )?;
        resolved = joined.to_string();
    }
    validate_health_http_url(name, &resolved)?;
    Ok(resolved)
}

pub fn build_service_url(service: &ResolvedService) -> Result<Url, String> {
    let Some(port) = service.port else {
        return Err(format!("service {:?} does not have a port", service.name));
    };
    let host = match service.bind_host.as_str() {
        "127.0.0.1" | "0.0.0.0" => "127.0.0.1",
        "::1" | "::" => "[::1]",
        other => return Err(format!("Unsupported bind host: {other}")),
    };
    ctx(
        Url::parse(&format!("http://{host}:{port}")),
        &format!("build service url for {}", service.name),
    )
}

pub fn interpolate_service_templates(
    value: &str,
    services: &BTreeMap<String, ResolvedService>,
) -> Result<String, String> {
    let mut out = String::with_capacity(value.len());
    let mut rest = value;
    while let Some(start) = rest.find("{{") {
        out.push_str(&rest[..start]);
        let after_open = &rest[start + 2..];
        let Some(end) = after_open.find("}}") else {
            out.push_str(&rest[start..]);
            return Ok(out);
        };
        let raw_token = &rest[start..start + 2 + end + 2];
        let expr = after_open[..end].trim();
        if expr.starts_with("services.") {
            let parts: Vec<&str> = expr.split('.').collect();
            if parts.len() != 3 {
                return Err(format!(
                    "invalid template expression {raw_token:?} (expected services.<name>.<property>)"
                ));
            }
            let target_name = parts[1];
            let property = parts[2];
            let Some(target) = services.get(target_name) else {
                return Err(format!(
                    "referenced service {target_name:?} in template {raw_token:?} does not exist"
                ));
            };
            match property {
                "port" => {
                    let Some(port) = target.port else {
                        return Err(format!(
                            "referenced service {target_name:?} in template {raw_token:?} does not have a port"
                        ));
                    };
                    out.push_str(&port.to_string());
                }
                "host" => {
                    if let Some(first) = target.hosts.first() {
                        out.push_str(first);
                    } else {
                        out.push_str(&target.bind_host);
                    }
                }
                "bindHost" => out.push_str(&target.bind_host),
                "url" => {
                    let url = ctx(
                        build_service_url(target),
                        &format!("referenced service {target_name:?} in template {raw_token:?}"),
                    )?;
                    out.push_str(url.as_str().trim_end_matches('/'));
                }
                _ => {
                    return Err(format!(
                        "unknown property {property:?} on service {target_name:?} in template {raw_token:?}"
                    ));
                }
            }
        } else {
            out.push_str(raw_token);
        }
        rest = &after_open[end + 2..];
    }
    out.push_str(rest);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;
    use crate::manifest::read_manifest;

    #[test]
    fn resolves_order_selection_ports_hosts_health_and_templates() {
        let fixture = tempfile::tempdir().unwrap();
        let root = fixture.path();
        fs::write(
            root.join("devhost.toml"),
            r#"
name = "demo"

[groups]
core = ["api"]

[services.db]
command = ["db"]
port = "auto"
alwaysStart = true
[services.db.health]
tcp = 5432
interval = 100
timeout = 5000
retries = 3

[services.api]
command = ["api", "--db", "{{services.db.url}}", "--port", "{{services.api.port}}"]
port = "auto"
host = ["api", "api-alt.localhost"]
path = "/v1/*"
dependsOn = ["db"]
[services.api.env]
DB_HOST = "{{services.db.host}}"
DB_BIND = "{{services.db.bindHost}}"
API_HOST = "{{services.api.host}}"
[services.api.health]
http = "/healthz"

[services.worker]
command = ["worker"]
[services.worker.health]
process = true
"#,
        )
        .unwrap();

        let manifest = read_manifest(root, None).unwrap();
        assert_eq!(manifest.primary_service, "db");
        assert_eq!(
            resolve_service_order(&manifest).unwrap(),
            vec!["db", "api", "worker"]
        );
        validate_requested_services(&manifest, &["core".to_owned()]).unwrap();
        assert!(
            validate_requested_services(&manifest, &["nope".to_owned()])
                .unwrap_err()
                .contains("unknown service or group")
        );

        let resolved = resolve_service_ports(
            &manifest,
            &PortResolutionOptions {
                requested: vec!["core".to_owned()],
                domain_suffix: ".dev.test".to_owned(),
                ..PortResolutionOptions::default()
            },
        )
        .unwrap();
        assert!(resolved.services.contains_key("db"));
        assert!(resolved.services.contains_key("api"));
        assert!(resolved.stopped.contains_key("worker"));
        let api = &resolved.services["api"];
        assert_eq!(api.hosts, vec!["api.dev.test", "api-alt.localhost"]);
        let db_port = resolved.services["db"].port.unwrap();
        let api_port = api.port.unwrap();
        assert_eq!(
            api.command,
            vec![
                "api",
                "--db",
                &format!("http://127.0.0.1:{db_port}"),
                "--port",
                &api_port.to_string()
            ]
        );
        assert_eq!(api.env["DB_HOST"], "127.0.0.1");
        assert_eq!(api.env["DB_BIND"], "127.0.0.1");
        assert_eq!(api.env["API_HOST"], "api.dev.test");
        assert_eq!(
            api.health.url.as_deref(),
            Some(format!("http://127.0.0.1:{api_port}/healthz").as_str())
        );

        // Remote mode rejects dotted hostnames.
        let remote_err = resolve_service_ports(
            &manifest,
            &PortResolutionOptions {
                requested: vec!["core".to_owned()],
                domain_suffix: ".preview.example".to_owned(),
                remote_mode: true,
                ..PortResolutionOptions::default()
            },
        )
        .unwrap_err();
        assert!(remote_err.contains("must be a single DNS label"));
    }

    #[test]
    fn detects_dependency_cycles_and_template_errors() {
        let fixture = tempfile::tempdir().unwrap();
        let root = fixture.path();
        fs::write(
            root.join("devhost.toml"),
            r#"
name = "cycle"
[services.a]
command = ["a"]
port = 3100
dependsOn = ["b"]
[services.b]
command = ["b"]
port = 3101
dependsOn = ["a"]
"#,
        )
        .unwrap();
        let manifest = read_manifest(root, None).unwrap();
        assert_eq!(
            resolve_service_order(&manifest).unwrap_err(),
            "Dependency cycle detected: a -> b -> a"
        );

        let empty = BTreeMap::new();
        assert!(
            interpolate_service_templates("{{services.x.port}}", &empty)
                .unwrap_err()
                .contains("does not exist")
        );
        assert!(
            interpolate_service_templates("{{services.x}}", &empty)
                .unwrap_err()
                .contains("invalid template expression")
        );
    }
}
