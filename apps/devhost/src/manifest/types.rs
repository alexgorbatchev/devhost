use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    time::Duration,
};

use toml::Table;

pub const DEFAULT_CHAT_PROMPT: &str = "Implement the user's requested changes and page annotations. Treat follow-up messages as additional work for the current task, preserving earlier requirements unless the user changes them.\n\nWork in a dedicated Git worktree on a new branch, following the repository's instructions. Reuse that worktree for related follow-ups. Preserve unrelated changes and other worktrees. Run the required checks, commit your changes, merge the branch into local main, and verify the merged result. After a successful merge, remove your worktree and delete your branch. Leave remote publishing to an explicit user request. If main is unavailable, checks fail, or a merge cannot be completed safely, retain your worktree and report the exact blocker. Summarize the changes, validation, merge, and cleanup.";

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Inputs {
    pub files: Vec<PathBuf>,
    pub patterns: Vec<String>,
}

pub(super) struct RawManifest {
    pub(super) inputs: Inputs,
    pub(super) service_order: Vec<String>,
    pub(super) table: Table,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Manifest {
    pub inputs: Inputs,
    pub devtools: DevtoolsConfig,
    pub worktrees: WorktreesConfig,
    pub manifest_directory: PathBuf,
    pub manifest_path: PathBuf,
    pub name: String,
    pub primary_service: String,
    pub service_order: Vec<String>,
    pub services: BTreeMap<String, ValidatedService>,
    pub groups: BTreeMap<String, Vec<String>>,
    pub kill_zombies: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorktreesConfig {
    pub enabled: bool,
}

impl Default for WorktreesConfig {
    fn default() -> Self {
        Self { enabled: true }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DevtoolsConfig {
    pub chat: DevtoolsChatConfig,
    pub annotations_enabled: bool,
    pub config_editor_enabled: bool,
    pub editor: DevtoolsEditorConfig,
    pub external_toolbars_enabled: bool,
    pub minimap_enabled: bool,
    pub resources: DevtoolsResourcesConfig,
    pub status: DevtoolsStatusConfig,
    pub restart_shortcut: String,
    pub idle_timeout: String,
}

impl Default for DevtoolsConfig {
    fn default() -> Self {
        Self {
            chat: DevtoolsChatConfig::default(),
            annotations_enabled: true,
            config_editor_enabled: false,
            editor: DevtoolsEditorConfig::default(),
            external_toolbars_enabled: true,
            minimap_enabled: true,
            resources: DevtoolsResourcesConfig::default(),
            status: DevtoolsStatusConfig::default(),
            restart_shortcut: "alt+ctrl+r".to_owned(),
            idle_timeout: String::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DevtoolsChatConfig {
    pub enabled: bool,
    pub prompt: String,
}

impl Default for DevtoolsChatConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            prompt: DEFAULT_CHAT_PROMPT.to_owned(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DevtoolsEditorConfig {
    pub enabled: bool,
    pub ide: String,
}

impl Default for DevtoolsEditorConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            ide: "vscode".to_owned(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DevtoolsResourcesConfig {
    pub enabled: bool,
    pub cpu: DevtoolsResourceConfig,
    pub memory: DevtoolsResourceConfig,
    pub disk: DevtoolsResourceConfig,
}

impl Default for DevtoolsResourcesConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            cpu: DevtoolsResourceConfig {
                enabled: true,
                poll_interval: Duration::from_secs(2),
            },
            memory: DevtoolsResourceConfig {
                enabled: true,
                poll_interval: Duration::from_secs(2),
            },
            disk: DevtoolsResourceConfig {
                enabled: true,
                poll_interval: Duration::from_secs(60),
            },
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DevtoolsResourceConfig {
    pub enabled: bool,
    pub poll_interval: Duration,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DevtoolsStatusConfig {
    pub enabled: bool,
    pub position: String,
}

impl Default for DevtoolsStatusConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            position: "bottom-right".to_owned(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidatedService {
    pub always_start: bool,
    pub proxy_local_origin: bool,
    pub bind_host: String,
    pub command: Vec<String>,
    pub serve: String,
    pub cwd: PathBuf,
    pub depends_on: Vec<String>,
    pub env: BTreeMap<String, String>,
    pub health: Option<HealthConfig>,
    pub hosts: Vec<String>,
    pub inject_port: bool,
    pub lifecycle: ServiceLifecycleConfig,
    pub managed: bool,
    pub name: String,
    pub path: Option<String>,
    pub port: Option<PortConfig>,
    pub watch: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServiceLifecycleConfig {
    pub mode: String,
    pub start: Vec<String>,
    pub status: Vec<String>,
    pub stop: Vec<String>,
}

impl Default for ServiceLifecycleConfig {
    fn default() -> Self {
        Self {
            mode: "foreground".to_owned(),
            start: Vec::new(),
            status: Vec::new(),
            stop: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PortConfig {
    pub auto: bool,
    pub number: u16,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct HealthConfig {
    pub http: Option<String>,
    pub interval: Option<u64>,
    pub process: bool,
    pub retries: Option<u64>,
    pub tcp: Option<u16>,
    pub timeout: Option<u64>,
}

pub fn resolve_watch_path(cwd: &Path, watch: &str) -> PathBuf {
    let candidate = Path::new(watch);
    if candidate.is_absolute() {
        crate::paths::clean(candidate)
    } else {
        crate::paths::clean(&cwd.join(candidate))
    }
}

// Parse Go's time.ParseDuration syntax (e.g., "250ms", "1m30s", "2.5s", "0").
pub fn parse_go_duration(raw: &str) -> Result<Duration, String> {
    let mut s = raw;
    if s.is_empty() {
        return Err(format!("time: invalid duration {raw:?}"));
    }
    let negative = if let Some(rest) = s.strip_prefix('-') {
        s = rest;
        true
    } else if let Some(rest) = s.strip_prefix('+') {
        s = rest;
        false
    } else {
        false
    };
    if s == "0" {
        return Ok(Duration::ZERO);
    }
    if s.is_empty() {
        return Err(format!("time: invalid duration {raw:?}"));
    }
    let mut total_nanos: f64 = 0.0;
    while !s.is_empty() {
        let mut idx = 0;
        let bytes = s.as_bytes();
        let mut has_digits = false;
        while idx < bytes.len() && bytes[idx].is_ascii_digit() {
            idx += 1;
            has_digits = true;
        }
        if idx < bytes.len() && bytes[idx] == b'.' {
            idx += 1;
            while idx < bytes.len() && bytes[idx].is_ascii_digit() {
                idx += 1;
                has_digits = true;
            }
        }
        if !has_digits {
            return Err(format!("time: invalid duration {raw:?}"));
        }
        let value: f64 = s[..idx]
            .parse()
            .map_err(|_| format!("time: invalid duration {raw:?}"))?;
        s = &s[idx..];
        let unit_end = s
            .find(|c: char| c.is_ascii_digit() || c == '.')
            .unwrap_or(s.len());
        let unit = &s[..unit_end];
        if unit.is_empty() {
            return Err(format!("time: missing unit in duration {raw:?}"));
        }
        let mult: f64 = match unit {
            "ns" => 1.0,
            "us" | "µs" | "μs" => 1_000.0,
            "ms" => 1_000_000.0,
            "s" => 1_000_000_000.0,
            "m" => 60_000_000_000.0,
            "h" => 3_600_000_000_000.0,
            _ => return Err(format!("time: unknown unit {unit:?} in duration {raw:?}")),
        };
        total_nanos += value * mult;
        s = &s[unit_end..];
    }
    if negative {
        return Err(format!("time: invalid duration {raw:?}"));
    }
    if !total_nanos.is_finite() || total_nanos < 0.0 || total_nanos > u64::MAX as f64 {
        return Err(format!("time: invalid duration {raw:?}"));
    }
    Ok(Duration::from_nanos(total_nanos.round() as u64))
}

pub fn parse_idle_duration(raw: &str) -> Result<Duration, String> {
    if let Some(magnitude) = raw.strip_prefix('-') {
        parse_go_duration(magnitude).map(|_| Duration::ZERO)
    } else {
        parse_go_duration(raw)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn negative_idle_durations_disable_shutdown_without_relaxing_other_timeouts() {
        for raw in ["-1s", "-1m30s", "-0", "0"] {
            assert_eq!(parse_idle_duration(raw).unwrap(), Duration::ZERO);
        }
        assert_eq!(parse_idle_duration("1s").unwrap(), Duration::from_secs(1));
        for raw in ["-", "-bad", "--1s"] {
            assert!(parse_idle_duration(raw).is_err());
        }
        assert!(parse_go_duration("-1s").is_err());
    }

    #[test]
    fn parses_go_durations_and_rejects_invalid_values() {
        assert_eq!(parse_go_duration("0").unwrap(), Duration::ZERO);
        assert_eq!(
            parse_go_duration("250ms").unwrap(),
            Duration::from_millis(250)
        );
        assert_eq!(parse_go_duration("1m30s").unwrap(), Duration::from_secs(90));
        assert_eq!(
            parse_go_duration("1.5s").unwrap(),
            Duration::from_millis(1500)
        );
        assert_eq!(parse_go_duration("2h").unwrap(), Duration::from_secs(7200));
        assert_eq!(
            parse_go_duration("500us").unwrap(),
            Duration::from_micros(500)
        );
        assert_eq!(parse_go_duration("10ns").unwrap(), Duration::from_nanos(10));
        assert!(parse_go_duration("").is_err());
        assert!(parse_go_duration("5").is_err());
        assert!(parse_go_duration("5d").is_err());
        assert!(parse_go_duration("-1s").is_err());
    }
}
