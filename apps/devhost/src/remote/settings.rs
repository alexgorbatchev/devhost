use std::{
    fs::File,
    io::{self, Read},
    net::SocketAddr,
    path::PathBuf,
};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    #[serde(rename = "serverURL")]
    pub server_url: String,
    pub credential_file: PathBuf,
    pub fingerprint: String,
    pub remote_port: u16,
    pub domain_suffix: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Backend {
    pub scheme: String,
    pub address: String,
    #[serde(default, skip_serializing_if = "empty_path")]
    pub root_certificate_path: PathBuf,
}

fn empty_path(path: &std::path::Path) -> bool {
    path.as_os_str().is_empty()
}

pub struct Options {
    pub state_directory: PathBuf,
    pub manifest_path: PathBuf,
    pub settings: Settings,
    pub hosts: Vec<String>,
    pub backend: Backend,
}

pub(super) fn read_credentials(path: &std::path::Path) -> io::Result<String> {
    let file = File::open(path)
        .map_err(|e| io::Error::new(e.kind(), format!("open remote credential file: {e}")))?;
    let info = file.metadata()?;
    #[cfg(unix)]
    let private = {
        use std::os::unix::fs::PermissionsExt;
        info.permissions().mode() & 0o077 == 0
    };
    #[cfg(not(unix))]
    let private = false;
    if !info.is_file() || !private {
        return Err(io::Error::other(
            "remote credential file must be a regular file readable only by its owner (mode 0600)",
        ));
    }
    if info.len() > 4096 {
        return Err(io::Error::other(
            "remote credential file is larger than 4096 bytes",
        ));
    }
    let mut bytes = Vec::new();
    file.take(4097).read_to_end(&mut bytes)?;
    if bytes.len() > 4096 {
        return Err(io::Error::other(
            "remote credential file is larger than 4096 bytes",
        ));
    }
    let auth = String::from_utf8(bytes).map_err(|_| {
        io::Error::other("remote credential file must contain one username:password line")
    })?;
    let auth = auth.trim();
    if auth.contains(['\r', '\n', '\0'])
        || !auth
            .split_once(':')
            .is_some_and(|(user, password)| !user.is_empty() && !password.is_empty())
    {
        return Err(io::Error::other(
            "remote credential file must contain one username:password line",
        ));
    }
    Ok(auth.to_owned())
}

impl Options {
    pub(super) fn validate(&self) -> io::Result<()> {
        if self.state_directory.as_os_str().is_empty() || self.manifest_path.as_os_str().is_empty()
        {
            return Err(io::Error::other(
                "remote previews require a state directory and manifest path",
            ));
        }
        if self.settings.server_url.is_empty()
            || self.settings.fingerprint.is_empty()
            || self.settings.remote_port == 0
        {
            return Err(io::Error::other(
                "remote previews require a server URL, pinned fingerprint, and reverse port",
            ));
        }
        if self.hosts.is_empty() {
            return Err(io::Error::other(
                "remote previews require at least one routed hostname",
            ));
        }
        for host in &self.hosts {
            if host.is_empty()
                || host.contains(['/', ':', ' ', '\t', '\r', '\n'])
                || host.to_lowercase() != *host
            {
                return Err(io::Error::other(format!(
                    "invalid remote preview hostname {host:?}"
                )));
            }
        }
        if !matches!(self.backend.scheme.as_str(), "http" | "https") {
            return Err(io::Error::other(
                "remote preview backend must use HTTP or HTTPS",
            ));
        }
        if !self
            .backend
            .address
            .parse::<SocketAddr>()
            .is_ok_and(|a| a.ip().is_loopback())
        {
            return Err(io::Error::other(
                "remote preview backend must be a loopback IP address and port",
            ));
        }
        if self.backend.scheme == "https"
            && self.backend.root_certificate_path.as_os_str().is_empty()
        {
            return Err(io::Error::other(
                "remote HTTPS preview backend requires the Caddy root certificate",
            ));
        }
        read_credentials(&self.settings.credential_file).map(|_| ())
    }
}
