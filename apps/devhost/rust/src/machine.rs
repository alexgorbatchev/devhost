use std::{
    env, fs,
    io::{self, Write},
    path::PathBuf,
};

use crate::paths::clean;

const ROOT_CERTIFICATE: &str = "caddy/storage/pki/authorities/local/root.crt";

pub(crate) fn directory(variable: &str) -> Option<PathBuf> {
    let value = env::var(variable).ok()?;
    let value = value.trim();
    (!value.is_empty()).then(|| PathBuf::from(value))
}

pub(crate) fn home_directory() -> Option<PathBuf> {
    directory("HOME").or_else(|| {
        if cfg!(windows) {
            directory("USERPROFILE")
        } else {
            None
        }
    })
}

pub(crate) fn state_directory() -> Result<PathBuf, String> {
    directory("DEVHOST_STATE_DIR")
        .or_else(|| directory("XDG_STATE_HOME").map(|root| root.join("devhost")))
        .or_else(|| home_directory().map(|home| home.join(".local/state/devhost")))
        .ok_or_else(|| {
            "Could not determine the devhost state directory. Set DEVHOST_STATE_DIR or HOME."
                .to_owned()
        })
}

pub fn print_root_certificate(stdout: &mut impl Write) -> Result<(), String> {
    let path = clean(&state_directory()?.join(ROOT_CERTIFICATE));
    let certificate = fs::read(&path).map_err(|error| match error.kind() {
        io::ErrorKind::NotFound => format!(
            "Managed Caddy root certificate not found at {}. Run 'devhost caddy start' first.",
            path.display()
        ),
        _ => format!("read {}: {error}", path.display()),
    })?;
    stdout
        .write_all(&certificate)
        .and_then(|()| stdout.flush())
        .map_err(|error| format!("write managed caddy root certificate: {error}"))
}
