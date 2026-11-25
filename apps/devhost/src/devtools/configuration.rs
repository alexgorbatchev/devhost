use std::collections::BTreeSet;

use super::{InjectedConfig, RoutedServiceIdentity};
use crate::services::{control::RuntimeHandle, resolve::ResolvedManifest};

pub(crate) fn injected_config(handle: &RuntimeHandle) -> InjectedConfig {
    let Some(manifest) = handle.live.manifest() else {
        return InjectedConfig::default();
    };
    let features = &manifest.devtools;
    let mut routes = Vec::new();
    for service in manifest.services.values() {
        let mut dependencies = BTreeSet::new();
        let mut pending = service.depends_on.clone();
        while let Some(name) = pending.pop() {
            if dependencies.insert(name.clone())
                && let Some(dependency) = manifest.services.get(&name)
            {
                pending.extend(dependency.depends_on.iter().cloned());
            }
        }
        for host in &service.hosts {
            routes.push(RoutedServiceIdentity {
                host: host.clone(),
                path: service.path.clone().unwrap_or_else(|| "/".to_owned()),
                service_name: service.name.clone(),
                dependencies: dependencies.iter().cloned().collect(),
            });
        }
    }
    routes.sort_by(|a, b| {
        (&a.host, &a.path, &a.service_name).cmp(&(&b.host, &b.path, &b.service_name))
    });
    InjectedConfig {
        component_editor: features.editor.ide.clone(),
        chat_enabled: features.chat.enabled,
        config_editor_enabled: features.config_editor_enabled,
        home_directory_path: handle
            .live
            .environment()
            .get("HOME")
            .cloned()
            .or_else(|| std::env::var("HOME").ok())
            .unwrap_or_default(),
        position: features.status.position.clone(),
        project_root_path: manifest.manifest_directory.display().to_string(),
        devhost_source_root_path: handle
            .live
            .dev_source()
            .map(|source| source.root_path().display().to_string())
            .unwrap_or_default(),
        control_origin: format!("http://127.0.0.1:{}", handle.live.control_port()),
        stack_name: manifest.name.clone(),
        editor_enabled: features.editor.enabled,
        external_toolbars_enabled: features.external_toolbars_enabled,
        minimap_enabled: features.minimap_enabled,
        status_enabled: features.status.enabled,
        resources_enabled: features.resources.enabled
            && (features.resources.cpu.enabled
                || features.resources.memory.enabled
                || features.resources.disk.enabled),
        annotation_enabled: features.annotations_enabled,
        routed_services: routes,
        restart_services_shortcut: features.restart_shortcut.clone(),
        primary_service: manifest.primary_service,
    }
}

pub(crate) fn injects(manifest: &ResolvedManifest, name: &str) -> bool {
    let Some(service) = manifest.services.get(name) else {
        return false;
    };
    let features = &manifest.devtools;
    (features.chat.enabled
        || features.annotations_enabled
        || features.config_editor_enabled
        || features.editor.enabled
        || features.external_toolbars_enabled
        || features.minimap_enabled
        || features.status.enabled)
        && service
            .path
            .as_deref()
            .is_none_or(|path| matches!(path, "/" | "/*"))
}
