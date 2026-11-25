use std::{
    collections::BTreeMap,
    io::{self, BufRead, Write},
    path::PathBuf,
};

use cli_command_kit::Mode;
use serde::{Deserialize, Serialize, de::DeserializeOwned};

use crate::{
    Failure,
    caddy::stacks::{ManifestOverlapError, StackOwner},
};

const MAX_FRAME_BYTES: usize = 16 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OutputMode {
    Human,
    Agent,
}

impl From<Mode> for OutputMode {
    fn from(mode: Mode) -> Self {
        match mode {
            Mode::Human => Self::Human,
            Mode::Agent => Self::Agent,
        }
    }
}

impl From<OutputMode> for Mode {
    fn from(mode: OutputMode) -> Self {
        match mode {
            OutputMode::Human => Self::Human,
            OutputMode::Agent => Self::Agent,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OutputStream {
    Stdout,
    Stderr,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum LaunchKind {
    Manifest {
        manifest_path: PathBuf,
        requested: Vec<String>,
        debug_caddy: bool,
        local: bool,
        remote: bool,
        idle_timeout_ms: Option<u64>,
    },
    Serve {
        directory: PathBuf,
        domain: String,
        port: Option<u16>,
    },
    ServeCommand {
        command: Vec<String>,
        session_name: String,
        startup_timeout_ms: u64,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredLaunchSpec {
    pub kind: LaunchKind,
    pub cwd: PathBuf,
    pub environment: BTreeMap<String, String>,
    pub mode: OutputMode,
    pub detached: bool,
    #[serde(default)]
    pub log_path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportedStack {
    pub stack_id: String,
    pub name: String,
    pub manifest_path: String,
    pub remote: bool,
    pub spec: StoredLaunchSpec,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FailureWire {
    pub message: String,
    #[serde(default)]
    pub summary: Option<String>,
    #[serde(default)]
    pub hint: Option<String>,
}

impl From<Failure> for FailureWire {
    fn from(failure: Failure) -> Self {
        Self {
            message: failure.message,
            summary: failure.summary,
            hint: failure.hint,
        }
    }
}

impl From<FailureWire> for Failure {
    fn from(wire: FailureWire) -> Self {
        Self {
            message: wire.message,
            summary: wire.summary,
            hint: wire.hint,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlapWire {
    pub manifest_path: String,
    pub owner_manifest_path: String,
    pub owner_pid: i32,
    pub stack_name: String,
}

impl From<ManifestOverlapError> for OverlapWire {
    fn from(overlap: ManifestOverlapError) -> Self {
        Self {
            manifest_path: overlap.manifest_path,
            owner_manifest_path: overlap.owner.manifest_path,
            owner_pid: overlap.owner.pid,
            stack_name: overlap.stack_name,
        }
    }
}

impl From<OverlapWire> for ManifestOverlapError {
    fn from(wire: OverlapWire) -> Self {
        Self {
            manifest_path: wire.manifest_path,
            owner: StackOwner {
                manifest_path: wire.owner_manifest_path,
                pid: wire.owner_pid,
            },
            stack_name: wire.stack_name,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase")]
pub enum Request {
    Hello,
    Start {
        spec: StoredLaunchSpec,
        wait_for_ready: bool,
        attach_output: bool,
    },
    StartReplaced {
        spec: StoredLaunchSpec,
        output_log_path: PathBuf,
        record_log: bool,
    },
    CancelStack {
        stack_id: String,
        signal: i32,
    },
    StopStack {
        stack_id: String,
        signal: i32,
        grace_ms: u64,
    },
    RestartStack {
        stack_id: String,
        output_log_path: PathBuf,
        record_log: bool,
    },
    ExportSpecs,
    Drain {
        preserve_stack_ids: Vec<String>,
        stop_timeout_ms: u64,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "event", rename_all = "camelCase")]
pub enum ServerEvent {
    Hello {
        protocol_version: u32,
        pid: i32,
        version: String,
        exe_path: String,
        exe_identity: String,
        draining: bool,
    },
    Started {
        stack_id: String,
        pid: i32,
    },
    Output {
        stream: OutputStream,
        data: String,
    },
    Ready {
        stack_id: String,
        pid: i32,
        name: String,
        urls: Vec<String>,
        log_path: String,
        remote: bool,
    },
    Finished {
        exit_code: i32,
        #[serde(default)]
        failure: Option<FailureWire>,
        #[serde(default)]
        overlap: Option<OverlapWire>,
        #[serde(default)]
        daemon_exiting: bool,
    },
    Stopped {
        already_stopped: bool,
        daemon_exiting: bool,
    },
    Restarted {
        stack_id: String,
        pid: i32,
        name: String,
    },
    Specs {
        pid: i32,
        exe_identity: String,
        stacks: Vec<ExportedStack>,
    },
    Drained {
        stopped: Vec<String>,
        errors: Vec<String>,
        remaining: usize,
        daemon_exiting: bool,
    },
    Ok,
    Error {
        message: String,
        #[serde(default)]
        draining: bool,
    },
}

pub fn write_frame<W: Write, T: Serialize>(writer: &mut W, value: &T) -> io::Result<()> {
    let mut bytes = serde_json::to_vec(value).map_err(io::Error::other)?;
    bytes.push(b'\n');
    writer.write_all(&bytes)?;
    writer.flush()
}

pub fn read_frame<R: BufRead, T: DeserializeOwned>(reader: &mut R) -> io::Result<Option<T>> {
    let mut line = Vec::new();
    let mut total = 0usize;
    loop {
        let buf = match reader.fill_buf() {
            Ok(buf) => buf,
            Err(error) if error.kind() == io::ErrorKind::Interrupted && !line.is_empty() => {
                continue;
            }
            Err(error) => return Err(error),
        };
        if buf.is_empty() {
            if line.is_empty() {
                return Ok(None);
            }
            break;
        }
        if let Some(pos) = buf.iter().position(|&b| b == b'\n') {
            total += pos;
            if total > MAX_FRAME_BYTES {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "daemon RPC frame exceeded maximum size",
                ));
            }
            line.extend_from_slice(&buf[..pos]);
            reader.consume(pos + 1);
            break;
        }
        total += buf.len();
        if total > MAX_FRAME_BYTES {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "daemon RPC frame exceeded maximum size",
            ));
        }
        line.extend_from_slice(buf);
        let len = buf.len();
        reader.consume(len);
    }
    if line.is_empty() {
        return Ok(None);
    }
    let parsed = serde_json::from_slice(&line).map_err(io::Error::other)?;
    Ok(Some(parsed))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frames_round_trip_and_handle_eof() {
        let mut wire = Vec::new();
        write_frame(&mut wire, &Request::Hello).unwrap();
        let req: Option<Request> = read_frame(&mut wire.as_slice()).unwrap();
        assert!(matches!(req, Some(Request::Hello)));

        let eof: Option<Request> = read_frame(&mut &b""[..]).unwrap();
        assert!(eof.is_none());
    }
}
