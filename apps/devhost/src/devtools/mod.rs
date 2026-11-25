mod agent_activity;
pub(crate) mod agents;
#[cfg(test)]
mod agents_tests;
pub mod assets;
pub(crate) mod chat;
mod config_files;
#[cfg(test)]
mod control_tests;
pub mod dev_source;
mod directory;
pub mod document_injection;
pub mod page_preview;
mod project_context;
pub mod recovery;
pub mod request_guard;
mod resource_disk;
pub(crate) mod resources;
pub mod server;
mod streams;

use serde::{Deserialize, Serialize};

pub const CONTROL_PATH_PREFIX: &str = "/__devhost__";
pub const INJECTED_SCRIPT_PATH: &str = "/__devhost__/inject.js";
pub const INJECTED_CONFIG_PATH: &str = "/__devhost__/config.json";
pub const DEVTOOLS_ASSETS_PATH: &str = "/__devhost__/assets/";
pub const PAGE_PREVIEW_PATH: &str = "/__devhost__/pages/";
pub const REDUX_MONITOR_PATH: &str = "/__devhost__/redux";
pub const REDUX_REGISTRATION_SCRIPT_PATH: &str = "/__devhost__/redux.js";
pub const REDUX_MONITOR_SCRIPT_PATH: &str = "/__devhost__/redux-monitor.js";
pub const REDUX_MONITOR_STYLESHEET_PATH: &str = "/__devhost__/redux-monitor.css";
pub const RECOVERY_HEADER: &str = "X-Devhost-Recovery";
pub const CACHE_CONTROL_NO_STORE: &str = "no-store";
pub const CACHE_CONTROL_IMMUTABLE: &str = "public, max-age=31536000, immutable";

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeDirectory {
    pub name: String,
    pub cwd: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeOwner {
    pub id: String,
    pub name: String,
    pub pid: i32,
    pub manifest_path: String,
    #[serde(default)]
    pub urls: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Worktree {
    pub path: String,
    #[serde(default)]
    pub branch: String,
    #[serde(default)]
    pub head: String,
    #[serde(default)]
    pub detached: bool,
    pub available: bool,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub reason: String,
    #[serde(default)]
    pub directories: Vec<WorktreeDirectory>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub owners: Vec<WorktreeOwner>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeRepository {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub default_branch: String,
    #[serde(default)]
    pub configured_path: String,
    pub selected_path: String,
    #[serde(default)]
    pub running_path: String,
    #[serde(default)]
    pub service_names: Vec<String>,
    #[serde(default)]
    pub worktrees: Vec<Worktree>,
    #[serde(default)]
    pub switching: bool,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub error: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub blocked_reason: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryState {
    #[serde(default)]
    pub stack: String,
    #[serde(default)]
    pub service: String,
    #[serde(default)]
    pub phase: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub message: String,
    #[serde(default)]
    pub address: String,
    #[serde(default)]
    pub can_restart: bool,
    #[serde(default)]
    pub logs: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub repositories: Vec<WorktreeRepository>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutedServiceIdentity {
    pub host: String,
    pub path: String,
    pub service_name: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub dependencies: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct FeatureToggles {
    pub chat_enabled: bool,
    pub annotation_enabled: bool,
    pub config_editor_enabled: bool,
    pub editor_enabled: bool,
    pub external_toolbars_enabled: bool,
    pub minimap_enabled: bool,
    pub status_enabled: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InjectedConfig {
    pub component_editor: String,
    pub chat_enabled: bool,
    pub config_editor_enabled: bool,
    pub home_directory_path: String,
    pub position: String,
    pub project_root_path: String,
    pub devhost_source_root_path: String,
    pub control_origin: String,
    pub stack_name: String,
    pub editor_enabled: bool,
    pub external_toolbars_enabled: bool,
    pub minimap_enabled: bool,
    pub status_enabled: bool,
    pub resources_enabled: bool,
    pub annotation_enabled: bool,
    pub routed_services: Vec<RoutedServiceIdentity>,
    pub restart_services_shortcut: String,
    pub primary_service: String,
}
pub(crate) mod configuration;
