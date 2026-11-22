use std::{
    collections::BTreeMap,
    fmt::Write as _,
    fs, io,
    path::{Path, PathBuf},
};

use serde::Deserialize;

use super::path_ctx;
use crate::{
    config::CaddySettings,
    procid,
    statuspage::{self, RouteLink},
};

pub(super) fn prepare_directories(directory: &Path) -> Result<(), String> {
    for name in [
        "",
        "routes",
        "routes/.host-claims",
        "port-claims",
        "routes/.registrations",
        "stacks",
        "storage",
        "route-not-found",
    ] {
        let path = if name.is_empty() {
            directory.to_path_buf()
        } else {
            directory.join(name)
        };
        path_ctx(
            fs::create_dir_all(&path),
            "create managed caddy directory",
            &path,
        )?;
    }
    Ok(())
}

pub(super) fn write_config(directory: &Path, settings: &CaddySettings) -> Result<(), String> {
    sync_not_found_site(directory, settings)?;
    write_caddyfile(directory, settings)
}

pub(super) fn write_caddyfile(directory: &Path, settings: &CaddySettings) -> Result<(), String> {
    let caddyfile = render_caddyfile(directory, settings)?;
    let path = directory.join("Caddyfile");
    path_ctx(
        fs::write(&path, caddyfile),
        "write managed caddyfile",
        &path,
    )
}

fn sync_not_found_site(directory: &Path, settings: &CaddySettings) -> Result<(), String> {
    let routes_dir = directory.join("routes");
    let links = read_active_route_links(&routes_dir, settings.https_port)?;
    let not_found_dir = directory.join("route-not-found");
    path_ctx(
        fs::create_dir_all(&not_found_dir),
        "create managed caddy not-found directory",
        &not_found_dir,
    )?;

    let page_path = not_found_dir.join("index.html");
    let page = statuspage::not_found_page(links, "/devhost-route-not-found.css")?;
    path_ctx(
        fs::write(&page_path, page),
        "write managed caddy not-found page",
        &page_path,
    )?;

    let css_path = not_found_dir.join("devhost-route-not-found.css");
    path_ctx(
        fs::write(&css_path, statuspage::PAGE_CSS),
        "write managed caddy not-found stylesheet",
        &css_path,
    )?;

    sync_stack_directory_site(directory, settings, &not_found_dir)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HostClaimRecord {
    owner_pid: Option<i32>,
    #[serde(default)]
    owner_start_identity: String,
    created_at: Option<String>,
    host: Option<String>,
    manifest_path: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StackRecord {
    #[serde(default)]
    control_port: i32,
    created_at: Option<String>,
    manifest_path: Option<String>,
    owner_pid: Option<i32>,
    #[serde(default)]
    owner_start_identity: String,
    stack_name: Option<String>,
}

struct LiveStackSummary {
    name: String,
    manifest_path: String,
    pid: i32,
    control_port: i32,
}

fn sync_stack_directory_site(
    directory: &Path,
    settings: &CaddySettings,
    not_found_dir: &Path,
) -> Result<(), String> {
    assert_stack_directory_host_available(directory, settings.stack_directory_hostname())?;
    let stacks = read_live_stacks(directory)?;
    let document = statuspage::stack_directory(Vec::new(), "")?;
    write_private(&not_found_dir.join("stacks.html"), document.as_bytes())?;
    write_stack_directory_site(directory, settings, &stacks, not_found_dir)
}

fn assert_stack_directory_host_available(directory: &Path, host: &str) -> Result<(), String> {
    let claim_path = directory
        .join("routes/.host-claims")
        .join(format!("{}.json", encode_path_segment(host)));
    match fs::read(&claim_path) {
        Ok(bytes) => {
            let claim: HostClaimRecord = path_ctx(
                serde_json::from_slice(&bytes),
                "parse host claim",
                &claim_path,
            )?;
            let Some(owner_pid) = claim.owner_pid.filter(|_| {
                claim.created_at.is_some() && claim.host.is_some() && claim.manifest_path.is_some()
            }) else {
                return Err("Managed host claim is malformed.".to_owned());
            };
            let current_pid = std::process::id() as i32;
            let stale = owner_pid != current_pid
                && !procid::is_record_owner_alive(owner_pid, &claim.owner_start_identity);
            if !stale {
                return Err(format!(
                    "stack directory hostname {host} is already claimed by PID {owner_pid}"
                ));
            }
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return path_ctx(Err(error), "read host claim", &claim_path),
    }

    let registrations_dir = directory.join("routes/.registrations");
    for path in json_files(
        &registrations_dir,
        "read managed caddy registrations directory",
    )? {
        let bytes = path_ctx(fs::read(&path), "read managed route registration", &path)?;
        let raw: serde_json::Value = path_ctx(
            serde_json::from_slice(&bytes),
            "parse managed route registration",
            &path,
        )?;
        let Some(record_host) = raw.get("host").and_then(serde_json::Value::as_str) else {
            continue;
        };
        if !record_host.eq_ignore_ascii_case(host) {
            continue;
        }
        let Some(owner_pid) = raw
            .get("ownerPid")
            .and_then(serde_json::Value::as_i64)
            .and_then(|pid| i32::try_from(pid).ok())
        else {
            return Err("Managed route registration is malformed.".to_owned());
        };
        let identity = raw
            .get("ownerStartIdentity")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default();
        if procid::is_record_owner_alive(owner_pid, identity) {
            return Err(format!(
                "stack directory hostname {host} is already routed by PID {owner_pid}"
            ));
        }
    }
    Ok(())
}

fn read_live_stacks(directory: &Path) -> Result<Vec<LiveStackSummary>, String> {
    let stacks_dir = directory.join("stacks");
    if !stacks_dir.exists() {
        return Ok(Vec::new());
    }
    let mut stacks = Vec::new();
    for path in json_files(&stacks_dir, "read stack directory")? {
        let bytes = match fs::read(&path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
            Err(error) => return path_ctx(Err(error), "read stack", &path),
        };
        let file_name = path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default();
        let record: StackRecord = match serde_json::from_slice(&bytes) {
            Ok(record) => record,
            Err(error) => return Err(format!("read stack {file_name}: {error}")),
        };
        let (Some(name), Some(manifest_path), Some(pid), Some(_)) = (
            record.stack_name,
            record.manifest_path,
            record.owner_pid,
            record.created_at,
        ) else {
            return Err(format!(
                "read stack {file_name}: Stack record is malformed."
            ));
        };
        if procid::is_record_owner_alive(pid, &record.owner_start_identity) {
            stacks.push(LiveStackSummary {
                name,
                manifest_path,
                pid,
                control_port: record.control_port,
            });
        }
    }
    stacks.sort_by(|left, right| {
        left.name
            .cmp(&right.name)
            .then_with(|| left.manifest_path.cmp(&right.manifest_path))
            .then_with(|| left.pid.cmp(&right.pid))
    });
    Ok(stacks)
}

fn json_files(directory: &Path, context: &str) -> Result<Vec<PathBuf>, String> {
    let entries = path_ctx(fs::read_dir(directory), context, directory)?;
    let mut files = Vec::new();
    for entry in entries {
        let entry = path_ctx(entry, context, directory)?;
        let path = entry.path();
        if !path.is_dir() && path.extension().and_then(|ext| ext.to_str()) == Some("json") {
            files.push(path);
        }
    }
    Ok(files)
}

fn write_stack_directory_site(
    directory: &Path,
    settings: &CaddySettings,
    stacks: &[LiveStackSummary],
    not_found_dir: &Path,
) -> Result<(), String> {
    let mut lines = vec![
        "    route {".to_owned(),
        "    header Cache-Control no-store".to_owned(),
        "    header Referrer-Policy no-referrer".to_owned(),
    ];
    if !settings.stack_directory_allow_remote {
        lines.push("    @remote not remote_ip 127.0.0.0/8 ::1".to_owned());
        lines.push(
            r#"    respond @remote "The stack directory is available on this machine only." 403"#
                .to_owned(),
        );
    }
    lines.push("    @unsafe not method GET HEAD".to_owned());
    lines.push(r#"    header @unsafe Allow "GET, HEAD""#.to_owned());
    lines.push(r#"    respond @unsafe "Method not allowed" 405"#.to_owned());
    lines.push("    @other not path /".to_owned());
    lines.push(r#"    respond @other "Not found" 404"#.to_owned());

    let upstreams: Vec<String> = stacks
        .iter()
        .filter(|stack| stack.control_port > 0 && stack.control_port <= 65535)
        .map(|stack| format!("127.0.0.1:{}", stack.control_port))
        .collect();
    if !upstreams.is_empty() {
        lines.push(format!("    reverse_proxy {} {{", upstreams.join(" ")));
        lines.push("        rewrite /__devhost__/stacks?{query}".to_owned());
        lines.push("        lb_policy first".to_owned());
        lines.push("        lb_try_duration 2s".to_owned());
        lines.push("        fail_duration 5s".to_owned());
        lines.push("        transport http {".to_owned());
        lines.push("            dial_timeout 500ms".to_owned());
        lines.push("        }".to_owned());
        lines.push("    }".to_owned());
    } else {
        lines.push(format!("    root * {}", quote(not_found_dir)));
        lines.push("    rewrite * /stacks.html".to_owned());
        lines.push("    file_server".to_owned());
    }
    lines.push("    }".to_owned());
    lines.push("    handle_errors {".to_owned());
    lines.push(r#"        respond "Stack directory unavailable. Start or restart a devhost stack, then refresh this page." 503"#.to_owned());
    lines.push("    }".to_owned());
    lines.push("}".to_owned());
    lines.push(String::new());

    let body = lines.join("\n");
    let host = settings.stack_directory_hostname();
    let mut document = format!(
        "{} {{\n    tls internal\n{body}",
        format_site_address("https", settings.https_port, host)
    );
    if settings.http_enabled {
        document.push_str(&format!(
            "{} {{\n{body}",
            format_site_address("http", settings.http_port, host)
        ));
    }
    write_private(
        &directory.join("stack-directory.caddy"),
        document.as_bytes(),
    )
}

fn read_active_route_links(routes_dir: &Path, https_port: u16) -> Result<Vec<RouteLink>, String> {
    let registrations_dir = routes_dir.join(".registrations");
    let mut by_host: BTreeMap<String, (String, String)> = BTreeMap::new();
    for path in json_files(
        &registrations_dir,
        "read managed caddy registrations directory",
    )? {
        let bytes = path_ctx(fs::read(&path), "read managed route registration", &path)?;
        let raw: serde_json::Value = path_ctx(
            serde_json::from_slice(&bytes),
            "parse managed route registration",
            &path,
        )?;
        let Some(host) = raw.get("host").and_then(serde_json::Value::as_str) else {
            return path_ctx(
                Err("Managed route registration is malformed."),
                "parse managed route registration",
                &path,
            );
        };
        let route_path = normalize_route_path(
            raw.get("path")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("/"),
        );
        let file_name = path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default();
        if !route_file_path(host, &file_name, routes_dir).exists() {
            continue;
        }
        let url = create_managed_url("https", host, https_port, &route_path);
        match by_host.get(host) {
            Some((existing_path, _)) if existing_path.as_str() <= route_path.as_str() => {}
            _ => {
                by_host.insert(host.to_owned(), (route_path, url));
            }
        }
    }
    Ok(by_host
        .into_iter()
        .map(|(host, (_, url))| RouteLink { host, url })
        .collect())
}

fn route_file_path(host: &str, registration_name: &str, routes_dir: &Path) -> PathBuf {
    let host_route = routes_dir.join(format!("{}.caddy", encode_path_segment(host)));
    if host_route.exists() {
        return host_route;
    }
    let stem = registration_name
        .strip_suffix(".json")
        .unwrap_or(registration_name);
    routes_dir.join(format!("{stem}.caddy"))
}

fn normalize_route_path(path: &str) -> String {
    let trimmed = path.trim();
    if trimmed.is_empty() || trimmed == "/" {
        return "/".to_owned();
    }
    let with_slash = if trimmed.starts_with('/') {
        trimmed.to_owned()
    } else {
        format!("/{trimmed}")
    };
    let trimmed_end = with_slash.trim_end_matches('/');
    if trimmed_end.is_empty() {
        "/".to_owned()
    } else {
        trimmed_end.to_owned()
    }
}

pub(super) fn encode_path_segment(value: &str) -> String {
    value.replace(':', "_")
}

pub(super) fn format_site_address(protocol: &str, port: u16, host: &str) -> String {
    let default_port = if protocol == "http" { 80 } else { 443 };
    if port == default_port {
        format!("{protocol}://{host}")
    } else {
        format!("{protocol}://{host}:{port}")
    }
}

fn create_managed_url(protocol: &str, host: &str, port: u16, path: &str) -> String {
    let default_port = if protocol == "http" { 80 } else { 443 };
    let authority = if port == default_port {
        host.to_owned()
    } else if host.contains(':') && !host.starts_with('[') {
        format!("[{host}]:{port}")
    } else {
        format!("{host}:{port}")
    };
    format!("{protocol}://{authority}{path}")
}

fn write_private(path: &Path, content: &[u8]) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::{io::Write, os::unix::fs::OpenOptionsExt};
        let mut file = path_ctx(
            fs::OpenOptions::new()
                .write(true)
                .create(true)
                .truncate(true)
                .mode(0o600)
                .open(path),
            "write",
            path,
        )?;
        path_ctx(file.write_all(content), "write", path)
    }
    #[cfg(not(unix))]
    {
        path_ctx(fs::write(path, content), "write", path)
    }
}

fn render_caddyfile(directory: &Path, settings: &CaddySettings) -> Result<String, String> {
    let admin = if settings.admin_address.trim().is_empty() {
        "127.0.0.1:20197"
    } else {
        settings.admin_address.trim()
    };
    let bind = match settings.bind_host.as_str() {
        "127.0.0.1" if cfg!(target_os = "macos") => "",
        "127.0.0.1" => "    default_bind 127.0.0.1 [::1]\n",
        "" | "0.0.0.0" => "    default_bind 0.0.0.0 [::]\n",
        "::1" => "    default_bind [::1]\n",
        "::" => "    default_bind [::]\n",
        host => return Err(format!("Unsupported managed Caddy bind host: {host}")),
    };
    let log = quote(&directory.join("caddy.runtime.log"));
    let storage = quote(&directory.join("storage"));
    let routes = quote(&directory.join("routes").join("*.caddy"));
    let directory_snippet = quote(&directory.join("stack-directory.caddy"));
    let mut contents = format!(
        "{{\n    admin {admin}\n    auto_https disable_redirects\n{bind}    skip_install_trust\n    log {{\n        output file {log}\n    }}\n    persist_config off\n    storage file_system {storage}\n}}\n\nimport {routes}\n\nimport {directory_snippet}\n"
    );
    let http_port = if settings.http_port == 0 {
        80
    } else {
        settings.http_port
    };
    let https_port = if settings.https_port == 0 {
        443
    } else {
        settings.https_port
    };
    if settings.http_enabled {
        append_fallback(&mut contents, directory, "http", http_port);
    }
    append_fallback(&mut contents, directory, "https", https_port);
    Ok(contents)
}

fn quote(path: &Path) -> String {
    serde_json::to_string(path.to_string_lossy().as_ref()).expect("serialize Caddyfile path")
}

fn append_fallback(document: &mut String, directory: &Path, protocol: &str, port: u16) {
    let address = format_site_address(protocol, port, "");
    let root = quote(&directory.join("route-not-found"));
    let tls = if protocol == "https" {
        "    tls internal {\n        on_demand\n    }\n\n"
    } else {
        ""
    };
    writeln!(
        document,
        "\n{address} {{\n{tls}    root * {root}\n\n    @devhost_route_not_found_asset file {{path}}\n    handle @devhost_route_not_found_asset {{\n        file_server\n    }}\n\n    handle {{\n        error 404\n    }}\n\n    handle_errors 404 {{\n        rewrite /index.html\n        file_server\n    }}\n}}"
    )
    .expect("append to Caddyfile");
}
