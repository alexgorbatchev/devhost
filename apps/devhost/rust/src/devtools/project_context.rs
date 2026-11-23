use std::path::PathBuf;

use axum::{body::Body, http::Request};

use crate::services::control::RuntimeHandle;

pub(super) fn query_root(
    handle: &RuntimeHandle,
    request: &Request<Body>,
) -> Result<PathBuf, String> {
    let query: std::collections::HashMap<_, _> =
        url::form_urlencoded::parse(request.uri().query().unwrap_or_default().as_bytes())
            .into_owned()
            .collect();
    let target = query
        .get("chatTarget")
        .map(String::as_str)
        .unwrap_or_default();
    match target {
        "devhost" => handle
            .live
            .dev_source()
            .map(|source| source.root_path().to_owned())
            .ok_or_else(|| "This devhost has no devhost source checkout to chat in.".to_owned()),
        "project" => project_root(
            handle,
            query.get("pageURL").map(String::as_str).unwrap_or_default(),
        ),
        _ => Err(format!("unknown chat target {target:?}")),
    }
}

fn project_root(handle: &RuntimeHandle, page_url: &str) -> Result<PathBuf, String> {
    let manifest = handle.live.manifest().ok_or("Project is not available.")?;
    let config = super::configuration::injected_config(handle);
    let url = url::Url::parse(page_url).ok();
    let service = config
        .routed_services
        .iter()
        .filter_map(|route| {
            let url = url.as_ref()?;
            if !route.host.eq_ignore_ascii_case(url.host_str()?) {
                return None;
            }
            let path = &route.path;
            let weight = if matches!(path.as_str(), "" | "/" | "/*") {
                -1
            } else if let Some(prefix) = path.strip_suffix("/*") {
                if !url.path().starts_with(&format!("{prefix}/")) {
                    return None;
                }
                prefix.len() as i64 * 10
            } else {
                if path != url.path() {
                    return None;
                }
                path.len() as i64 * 10 + 1
            };
            Some((weight, &route.service_name))
        })
        .max_by(|(aw, an), (bw, bn)| aw.cmp(bw).then_with(|| bn.cmp(an)))
        .map(|(_, name)| name.as_str())
        .unwrap_or(&manifest.primary_service);
    for repository in handle.live.repositories_snapshot() {
        if !repository.service_names.iter().any(|name| name == service) {
            continue;
        }
        if repository.switching || !repository.error.is_empty() {
            return Err(format!(
                "Repository {} is switching or stopped; recover its selected worktree before launching tools.",
                repository.name
            ));
        }
        let selected = PathBuf::from(repository.selected_path);
        return Ok(manifest
            .manifest_directory
            .strip_prefix(&repository.configured_path)
            .map(|relative| crate::paths::clean(&selected.join(relative)))
            .unwrap_or(selected));
    }
    Ok(manifest.manifest_directory)
}
