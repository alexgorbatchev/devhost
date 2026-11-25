use std::{
    fs, io,
    net::IpAddr,
    path::{Path, PathBuf},
};

use base64::{Engine, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};
use toml::{Table, Value};
use url::Url;

use crate::{machine, paths::clean};

#[derive(Debug, Clone, PartialEq, Eq, Default, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub(crate) struct AppliedCaddySettings {
    pub(crate) admin_address: String,
    pub(crate) bind_host: String,
    pub(crate) http_enabled: bool,
    pub(crate) http_port: u16,
    pub(crate) https_port: u16,
    pub(crate) stack_directory_host: String,
    pub(crate) stack_directory_allow_remote: bool,
}

impl From<AppliedCaddySettings> for CaddySettings {
    fn from(value: AppliedCaddySettings) -> Self {
        Self {
            admin_address: value.admin_address,
            bind_host: value.bind_host,
            http_enabled: value.http_enabled,
            http_port: value.http_port,
            https_port: value.https_port,
            stack_directory_host: value.stack_directory_host,
            stack_directory_allow_remote: value.stack_directory_allow_remote,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct CaddySettings {
    pub admin_address: String,
    pub bind_host: String,
    pub http_enabled: bool,
    pub http_port: u16,
    pub https_port: u16,
    pub stack_directory_host: String,
    pub stack_directory_allow_remote: bool,
}

impl CaddySettings {
    pub fn stack_directory_hostname(&self) -> &str {
        if self.stack_directory_host.is_empty() {
            "devhost.localhost"
        } else {
            &self.stack_directory_host
        }
    }
}

impl Default for CaddySettings {
    fn default() -> Self {
        Self {
            admin_address: "127.0.0.1:20197".to_owned(),
            bind_host: "0.0.0.0".to_owned(),
            http_enabled: false,
            http_port: 80,
            https_port: 443,
            stack_directory_host: String::new(),
            stack_directory_allow_remote: false,
        }
    }
}

pub struct MachineConfig {
    pub domain_suffix: String,
    pub caddy: CaddySettings,
    pub remote: Option<crate::remote::Settings>,
}

const ROOT_KEYS: &[&str] = &["domainSuffix", "caddy", "remote"];
const CADDY_KEYS: &[&str] = &[
    "adminAddress",
    "bindHost",
    "http",
    "httpPort",
    "httpsPort",
    "stackDirectoryHost",
    "stackDirectoryAllowRemote",
];
const REMOTE_KEYS: &[&str] = &[
    "serverURL",
    "credentialFile",
    "fingerprint",
    "remotePort",
    "domainSuffix",
];
const BIND_HOSTS: &[&str] = &["127.0.0.1", "0.0.0.0", "::1", "::"];

pub(crate) fn editor_schema() -> serde_json::Value {
    serde_json::json!({"tables":{
        "":ROOT_KEYS, "caddy":CADDY_KEYS, "remote":REMOTE_KEYS
    },"values":{"caddy.bindHost":BIND_HOSTS}})
}

pub(crate) fn issue_key_path(issue: &str) -> String {
    if let Some(quoted) = issue.strip_prefix("Unrecognized key: ") {
        return serde_json::from_str(quoted).unwrap_or_default();
    }
    issue
        .split_whitespace()
        .next()
        .filter(|key| key.starts_with("caddy."))
        .unwrap_or_default()
        .to_owned()
}

pub fn path() -> Result<PathBuf, String> {
    machine::directory("DEVHOST_CONFIG_DIR")
        .or_else(|| machine::directory("XDG_CONFIG_HOME").map(|root| root.join("devhost")))
        .or_else(|| machine::home_directory().map(|home| home.join(".config/devhost")))
        .map(|directory| clean(&directory.join("config.toml")))
        .ok_or_else(|| {
            "could not determine the devhost config directory; set DEVHOST_CONFIG_DIR, XDG_CONFIG_HOME, or HOME".to_owned()
        })
}

pub fn read() -> Result<MachineConfig, String> {
    let config_path = path()?;
    read_from(&config_path)
}

pub fn read_from(path: &Path) -> Result<MachineConfig, String> {
    let contents = match fs::read_to_string(path) {
        Ok(contents) => contents,
        Err(error) if error.kind() == io::ErrorKind::NotFound => String::new(),
        Err(error) => return Err(format!("read devhost config {}: {error}", path.display())),
    };
    parse(path, &contents)
}

pub(crate) fn parse(path: &Path, contents: &str) -> Result<MachineConfig, String> {
    let root: Table = match contents.parse() {
        Ok(root) => root,
        Err(error) => return Err(format!("read devhost config {}: {error}", path.display())),
    };
    let mut issues = Vec::new();
    unknown_keys(&root, "", ROOT_KEYS, &mut issues);
    if let Some(caddy) = root.get("caddy").and_then(Value::as_table) {
        unknown_keys(caddy, "caddy.", CADDY_KEYS, &mut issues);
    }
    if let Some(remote) = root.get("remote").and_then(Value::as_table) {
        unknown_keys(remote, "remote.", REMOTE_KEYS, &mut issues);
    }
    issues.sort();
    let mut domain_suffix = ".localhost".to_owned();
    if let Some(suffix) = root.get("domainSuffix") {
        if let Some(text) = suffix.as_str().filter(|s| valid_suffix(s)) {
            domain_suffix = text.trim().to_ascii_lowercase();
        } else {
            issues.push(
                "domainSuffix must be a hostname suffix beginning with a dot or hyphen.".to_owned(),
            );
        }
    }
    let mut caddy = CaddySettings::default();
    if let Some(value) = root.get("caddy") {
        if let Some(table) = value.as_table() {
            apply_caddy(table, &mut caddy, &mut issues);
        } else {
            issues.push("caddy must be a table.".to_owned());
        }
    }
    if let Some(value) = root.get("remote") {
        if let Some(table) = value.as_table() {
            validate_remote(table, &mut issues);
        } else {
            issues.push("remote must be a table.".to_owned());
        }
    }
    if issues.is_empty() {
        Ok(MachineConfig {
            domain_suffix,
            caddy,
            remote: root.get("remote").and_then(Value::as_table).map(|table| {
                crate::remote::Settings {
                    server_url: string(table.get("serverURL")).to_owned(),
                    credential_file: {
                        let credential = PathBuf::from(string(table.get("credentialFile")));
                        if credential.is_absolute() {
                            credential
                        } else {
                            clean(
                                &path
                                    .parent()
                                    .unwrap_or_else(|| Path::new("."))
                                    .join(credential),
                            )
                        }
                    },
                    fingerprint: string(table.get("fingerprint")).to_owned(),
                    remote_port: table
                        .get("remotePort")
                        .and_then(port_number)
                        .expect("validated remote port"),
                    domain_suffix: string(table.get("domainSuffix")).to_ascii_lowercase(),
                }
            }),
        })
    } else {
        Err(format!(
            "devhost config {} is invalid:\n{}",
            path.display(),
            issues.join("\n"),
        ))
    }
}

fn unknown_keys(table: &Table, prefix: &str, keys: &[&str], issues: &mut Vec<String>) {
    for (key, value) in table {
        if keys.contains(&key.as_str()) {
            continue;
        }
        let key = format!("{prefix}{key}");
        if key == "remote.localSuffix" {
            issues.push("remote.localSuffix was removed; use single DNS labels such as host = \"web\" in manifests and top-level domainSuffix for local routing.".to_owned());
        } else {
            issues.push(format!("Unrecognized key: {key:?}"));
        }
        if let Some(children) = value.as_table() {
            unknown_keys(children, &format!("{key}."), &[], issues);
        }
    }
}

fn apply_caddy(table: &Table, settings: &mut CaddySettings, issues: &mut Vec<String>) {
    if let Some(value) = table.get("stackDirectoryAllowRemote") {
        if let Some(enabled) = value.as_bool() {
            settings.stack_directory_allow_remote = enabled;
        } else {
            issues.push("caddy.stackDirectoryAllowRemote must be a boolean.".to_owned());
        }
    }
    if let Some(value) = table.get("stackDirectoryHost") {
        let host = string(Some(value)).to_ascii_lowercase();
        if valid_host(&host) {
            settings.stack_directory_host = host;
        } else {
            issues.push(
                "caddy.stackDirectoryHost must be a hostname without a scheme, port, or path."
                    .to_owned(),
            );
        }
    }
    if let Some(value) = table.get("adminAddress") {
        let address = string(Some(value));
        if address.is_empty() {
            issues.push("caddy.adminAddress must be a non-empty string.".to_owned());
        } else {
            settings.admin_address = address.to_owned();
        }
    }
    if let Some(value) = table.get("bindHost") {
        match value.as_str() {
            Some(host) if BIND_HOSTS.contains(&host) => {
                settings.bind_host = host.to_owned();
            }
            _ => issues
                .push("caddy.bindHost must be one of 127.0.0.1, 0.0.0.0, ::1, or ::.".to_owned()),
        }
    }
    if let Some(value) = table.get("http") {
        if let Some(enabled) = value.as_bool() {
            settings.http_enabled = enabled;
        } else {
            issues.push("caddy.http must be a boolean.".to_owned());
        }
    }
    for (name, target) in [
        ("httpPort", &mut settings.http_port),
        ("httpsPort", &mut settings.https_port),
    ] {
        if let Some(value) = table.get(name) {
            if let Some(port) = port_number(value) {
                *target = port;
            } else {
                issues.push(format!(
                    "caddy.{name} must be an integer between 1 and 65535."
                ));
            }
        }
    }
}

fn validate_remote(table: &Table, issues: &mut Vec<String>) {
    if !valid_relay_url(string(table.get("serverURL"))) {
        issues.push("remote.serverURL must be an HTTPS relay URL without credentials, a query, or a fragment; HTTP is supported only on loopback.".to_owned());
    }
    if string(table.get("credentialFile")).is_empty() {
        issues.push(
            "remote.credentialFile must name a private file containing username:password."
                .to_owned(),
        );
    }
    let fingerprint: String = string(table.get("fingerprint"))
        .chars()
        .filter(|character| !matches!(character, '\r' | '\n'))
        .collect();
    if !STANDARD
        .decode(fingerprint)
        .is_ok_and(|bytes| bytes.len() == 32)
    {
        issues.push(
            "remote.fingerprint must be the relay's complete base64 SHA-256 fingerprint."
                .to_owned(),
        );
    }
    if table.get("remotePort").and_then(port_number).is_none() {
        issues.push("remote.remotePort must be an integer between 1 and 65535.".to_owned());
    }
    if !valid_suffix(string(table.get("domainSuffix"))) {
        issues.push(
            "remote.domainSuffix must be a hostname suffix beginning with a dot or hyphen."
                .to_owned(),
        );
    }
}

fn string(value: Option<&Value>) -> &str {
    value.and_then(Value::as_str).unwrap_or_default().trim()
}

fn port_number(value: &Value) -> Option<u16> {
    u16::try_from(value.as_integer()?)
        .ok()
        .filter(|&port| port != 0)
}

fn valid_suffix(suffix: &str) -> bool {
    let suffix = suffix.trim().to_ascii_lowercase();
    suffix.starts_with(['.', '-']) && valid_host(&format!("preview{suffix}"))
}

fn valid_host(host: &str) -> bool {
    host == "localhost"
        || (host.len() <= 253
            && host.contains('.')
            && host.split('.').all(|label| {
                label.len() <= 63
                    && label
                        .as_bytes()
                        .first()
                        .is_some_and(u8::is_ascii_alphanumeric)
                    && label
                        .as_bytes()
                        .last()
                        .is_some_and(u8::is_ascii_alphanumeric)
                    && label
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
            }))
}

fn valid_relay_url(value: &str) -> bool {
    let Some((_, authority)) = value.split_once("://") else {
        return false;
    };
    let authority = authority.split('/').next().unwrap_or_default();
    if authority.is_empty() || authority.contains(['@', '\\']) {
        return false;
    }
    let Ok(url) = Url::parse(value) else {
        return false;
    };
    if url.host().is_none()
        || url.query().is_some()
        || url.fragment().is_some_and(|fragment| !fragment.is_empty())
        || url.port() == Some(0)
    {
        return false;
    }
    match url.scheme() {
        "https" => true,
        "http" => url.host_str().is_some_and(|host| {
            host == "localhost"
                || host
                    .trim_matches(['[', ']'])
                    .parse::<IpAddr>()
                    .is_ok_and(|address| address.is_loopback())
        }),
        _ => false,
    }
}
