use std::path::Path;

use url::Url;

use super::{
    files,
    routes::{RouteRegistration, current_pid, read_host_registrations},
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DevtoolsRouteOwner {
    pub manifest_path: String,
    pub control_port: u16,
    pub owner_pid: Option<i32>,
    pub owner_stack_id: Option<String>,
}

pub fn allows_devtools_url(
    caddy_dir: &Path,
    owner: &DevtoolsRouteOwner,
    text: &str,
) -> Result<bool, String> {
    let Ok(url) = Url::parse(text) else {
        return Ok(false);
    };
    if !url.username().is_empty()
        || url.password().is_some()
        || url.cannot_be_a_base()
        || url.host_str().is_none_or(str::is_empty)
        || !matches!(url.scheme(), "http" | "https")
    {
        return Ok(false);
    }
    let Some(settings) = files::read_applied_settings(caddy_dir)? else {
        return Ok(false);
    };
    let expected_port = if url.scheme() == "http" {
        if !settings.http_enabled {
            return Ok(false);
        }
        if settings.http_port == 0 {
            80
        } else {
            settings.http_port
        }
    } else if settings.https_port == 0 {
        443
    } else {
        settings.https_port
    };
    let actual_port = url
        .port()
        .unwrap_or(if url.scheme() == "http" { 80 } else { 443 });
    if actual_port != expected_port {
        return Ok(false);
    }
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    let registrations = read_host_registrations(caddy_dir, &host)?;
    Ok(owns_devtools_document(&registrations, owner, url.path()))
}

pub(crate) fn owns_devtools_document(
    registrations: &[RouteRegistration],
    owner: &DevtoolsRouteOwner,
    pathname: &str,
) -> bool {
    let pathname = normalize_devtools_request_path(pathname);
    if pathname.starts_with("/__devhost__/") {
        return false;
    }
    let mut root: Option<&RouteRegistration> = None;
    for reg in registrations {
        if reg.path == "/" {
            root = Some(reg);
        }
        if reg.path.contains('%') || reg.path.contains("//") {
            return false;
        }
    }
    let Some(root) = root else {
        return false;
    };
    if !owns_devtools_registration(root, owner) {
        return false;
    }
    for reg in registrations {
        if reg.path == "/" {
            continue;
        }
        let matched = if let Some(prefix) = reg.path.strip_suffix('*') {
            pathname.starts_with(&prefix.to_ascii_lowercase())
        } else {
            pathname.eq_ignore_ascii_case(&reg.path)
        };
        if matched {
            return owns_devtools_registration(reg, owner);
        }
    }
    true
}

fn owns_devtools_registration(reg: &RouteRegistration, owner: &DevtoolsRouteOwner) -> bool {
    let expected_pid = owner.owner_pid.unwrap_or_else(current_pid);
    let matches_stack = match owner.owner_stack_id.as_deref() {
        Some(stack_id) if !stack_id.is_empty() && !reg.owner_stack_id.is_empty() => {
            reg.owner_stack_id == stack_id
        }
        _ => true,
    };
    owner.control_port > 0
        && reg.devtools_control_port == Some(owner.control_port)
        && reg.manifest_path == owner.manifest_path
        && reg.owner_pid == expected_pid
        && matches_stack
}

fn normalize_devtools_request_path(value: &str) -> String {
    let trimmed = value.trim_start_matches('/');
    let mut parts: Vec<&str> = Vec::new();
    for part in trimmed.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            other => parts.push(other),
        }
    }
    let mut cleaned = if parts.is_empty() {
        "/".to_owned()
    } else {
        format!("/{}", parts.join("/"))
    };
    if value.ends_with('/') && cleaned != "/" {
        cleaned.push('/');
    }
    cleaned.to_ascii_lowercase()
}
