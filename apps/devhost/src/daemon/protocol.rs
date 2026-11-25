use std::{
    collections::BTreeMap,
    io::{self, BufRead, BufReader, Read, Write},
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
    #[serde(default)]
    pub non_unicode_environment: Vec<(Vec<u8>, Vec<u8>)>,
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
        #[serde(default)]
        context_fingerprint: String,
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

/// Stateful newline-delimited JSON reader that retains partial frames across
/// `WouldBlock`, `TimedOut`, and `Interrupted` errors.
pub struct FrameReader<R: Read> {
    reader: BufReader<R>,
    buf: Vec<u8>,
}

impl<R: Read> FrameReader<R> {
    pub fn new(inner: R) -> Self {
        Self {
            reader: BufReader::new(inner),
            buf: Vec::new(),
        }
    }

    pub fn get_ref(&self) -> &R {
        self.reader.get_ref()
    }

    pub fn read_frame<T: DeserializeOwned>(&mut self) -> io::Result<Option<T>> {
        loop {
            let chunk = match self.reader.fill_buf() {
                Ok(buf) => buf,
                Err(error)
                    if error.kind() == io::ErrorKind::Interrupted && !self.buf.is_empty() =>
                {
                    continue;
                }
                Err(error) => return Err(error),
            };
            if chunk.is_empty() {
                if self.buf.is_empty() {
                    return Ok(None);
                }
                break;
            }
            if let Some(pos) = chunk.iter().position(|&b| b == b'\n') {
                if self.buf.len() + pos > MAX_FRAME_BYTES {
                    self.buf.clear();
                    self.reader.consume(pos + 1);
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidData,
                        "daemon RPC frame exceeded maximum size",
                    ));
                }
                self.buf.extend_from_slice(&chunk[..pos]);
                self.reader.consume(pos + 1);
                break;
            }
            let len = chunk.len();
            if self.buf.len() + len > MAX_FRAME_BYTES {
                self.buf.clear();
                self.reader.consume(len);
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "daemon RPC frame exceeded maximum size",
                ));
            }
            self.buf.extend_from_slice(chunk);
            self.reader.consume(len);
        }
        let line = std::mem::take(&mut self.buf);
        if line.is_empty() {
            return Ok(None);
        }
        let parsed = serde_json::from_slice(&line).map_err(io::Error::other)?;
        Ok(Some(parsed))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frames_round_trip_and_handle_eof() {
        let mut wire = Vec::new();
        write_frame(&mut wire, &Request::Hello).unwrap();
        let mut reader = FrameReader::new(wire.as_slice());
        let req: Option<Request> = reader.read_frame().unwrap();
        assert!(matches!(req, Some(Request::Hello)));
        assert!(reader.read_frame::<Request>().unwrap().is_none());
    }

    #[test]
    fn frame_reader_preserves_large_partial_frame_across_timeouts() {
        struct ChunkedReader {
            data: Vec<u8>,
            pos: usize,
            step: usize,
        }
        impl Read for ChunkedReader {
            fn read(&mut self, out: &mut [u8]) -> io::Result<usize> {
                self.step += 1;
                if self.step % 3 == 2 {
                    return Err(io::Error::new(io::ErrorKind::WouldBlock, "paused"));
                }
                if self.step.is_multiple_of(5) {
                    return Err(io::Error::new(io::ErrorKind::Interrupted, "signal"));
                }
                if self.pos >= self.data.len() {
                    return Ok(0);
                }
                let take = (self.data.len() - self.pos).min(out.len()).min(1024);
                out[..take].copy_from_slice(&self.data[self.pos..self.pos + take]);
                self.pos += take;
                Ok(take)
            }
        }

        let payload = "x".repeat(20_000);
        let mut wire = Vec::new();
        write_frame(
            &mut wire,
            &ServerEvent::Output {
                stream: OutputStream::Stdout,
                data: payload.clone(),
            },
        )
        .unwrap();

        let mut reader = FrameReader::new(ChunkedReader {
            data: wire,
            pos: 0,
            step: 0,
        });
        loop {
            match reader.read_frame::<ServerEvent>() {
                Ok(Some(ServerEvent::Output { data, .. })) => {
                    assert_eq!(data, payload);
                    break;
                }
                Err(error)
                    if matches!(
                        error.kind(),
                        io::ErrorKind::WouldBlock | io::ErrorKind::Interrupted
                    ) => {}
                other => panic!("unexpected frame result: {other:?}"),
            }
        }
    }
}
