mod activity;
mod journal;
mod panel;
mod process;
mod session;
#[cfg(test)]
mod tests;
pub(super) mod transport;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::BTreeMap,
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tokio_util::{sync::CancellationToken, task::TaskTracker};

pub(super) const LIMIT: usize = 8 * 1024 * 1024;
pub(super) const CLAUDE: &str = "claude-code";
pub(super) const CODEX: &str = "codex";
pub(super) const CALL_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Info {
    pub id: String,
    pub harness: String,
    pub project_root_path: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub native_session_id: String,
    pub status: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub error: String,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Start {
    #[serde(default)]
    pub harness: String,
    #[serde(default, rename = "pageURL")]
    pub page_url: String,
    #[serde(default)]
    pub target: String,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub resume_id: String,
}

#[derive(Default, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Command {
    #[serde(rename = "type", default)]
    pub kind: String,
    #[serde(default)]
    pub command_id: String,
    #[serde(default)]
    pub text: String,
    pub model: Option<String>,
    #[serde(default)]
    pub images: Vec<Image>,
    #[serde(default)]
    pub request_id: Value,
    #[serde(default)]
    pub result: Value,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Image {
    #[serde(rename = "dataURL")]
    pub data_url: String,
}

pub(crate) struct Store {
    sessions: Mutex<BTreeMap<String, Arc<session::Session>>>,
    pub(super) cancel: CancellationToken,
    pub(super) tasks: TaskTracker,
    // Overrides are per store, so protocol fixtures never mutate process-global PATH.
    executables: BTreeMap<String, PathBuf>,
}

impl Default for Store {
    fn default() -> Self {
        Self {
            sessions: Mutex::default(),
            cancel: CancellationToken::new(),
            tasks: TaskTracker::new(),
            executables: BTreeMap::new(),
        }
    }
}

impl Store {
    pub(super) fn begin(&self) -> Result<tokio_util::task::task_tracker::TaskTrackerToken, String> {
        let _sessions = self.sessions.lock().expect("chat sessions");
        if self.cancel.is_cancelled() {
            return Err("chat server is stopping".into());
        }
        Ok(self.tasks.token())
    }
    pub(crate) async fn shutdown(&self) {
        let sessions: Vec<_> = {
            let sessions = self.sessions.lock().expect("chat sessions");
            self.cancel.cancel();
            self.tasks.close();
            sessions.values().cloned().collect()
        };
        for session in &sessions {
            session.close(true).await;
        }
        self.tasks.wait().await;
        for session in sessions {
            session.state.lock().expect("chat state").journal.take();
        }
    }
}

pub(super) fn request_key(id: &Value) -> Result<String, String> {
    if id.is_string() || id.is_number() {
        Ok(id.to_string())
    } else {
        Err("native request ID must be a string or number".into())
    }
}

pub(super) fn random_id(uuid: bool) -> Result<String, String> {
    let mut bytes = [0; 16];
    getrandom::fill(&mut bytes).map_err(|error| format!("create chat ID: {error}"))?;
    if uuid {
        bytes[6] = (bytes[6] & 15) | 64;
        bytes[8] = (bytes[8] & 63) | 128;
    }
    let mut text = String::new();
    for (i, byte) in bytes.iter().enumerate() {
        if uuid && [4, 6, 8, 10].contains(&i) {
            text.push('-');
        }
        use std::fmt::Write;
        write!(text, "{byte:02x}").expect("write String");
    }
    Ok(text)
}

fn message_id(id: &str) -> Result<String, String> {
    if id.len() == 36
        && id.bytes().enumerate().all(|(i, b)| {
            if [8, 13, 18, 23].contains(&i) {
                b == b'-'
            } else {
                b.is_ascii_digit() || (b'a'..=b'f').contains(&b)
            }
        })
    {
        Ok(id.into())
    } else {
        random_id(true)
    }
}
