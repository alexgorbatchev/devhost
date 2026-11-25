use super::{CALL_TIMEOUT, CLAUDE, Store, request_key};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    io::{BufReader, Read, Write},
    os::unix::process::CommandExt,
    path::Path,
    process::{ChildStdin, Command, Stdio},
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
};
use tokio::sync::{oneshot, watch};
use tokio_util::{sync::CancellationToken, task::TaskTracker};

#[derive(Clone, Debug)]
pub(super) enum Failure {
    Native(String),
    Transport(String),
    Timeout,
}
impl std::fmt::Display for Failure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Native(s) | Self::Transport(s) => f.write_str(s),
            Self::Timeout => f.write_str("native acknowledgement timed out"),
        }
    }
}
pub(super) type Reply = Result<Value, Failure>;

pub(super) struct Process {
    pub harness: String,
    pub pid: i32,
    input: Mutex<Option<ChildStdin>>,
    pending: Mutex<HashMap<String, oneshot::Sender<Reply>>>,
    next: AtomicU64,
    pub cancel: CancellationToken,
    done: watch::Sender<Option<String>>,
    tasks: TaskTracker,
}

impl Process {
    pub fn start(
        store: &Store,
        harness: &str,
        root: &Path,
        resume: &str,
        replay: bool,
        receive: impl Fn(Value) + Send + Sync + 'static,
    ) -> Result<Arc<Self>, String> {
        let tracked_reader = store.begin()?;
        let tracked_watcher = store.begin()?;
        let executable = store
            .executables
            .get(harness)
            .cloned()
            .unwrap_or_else(|| if harness == CLAUDE { "claude" } else { "codex" }.into());
        let mut command = Command::new(executable);
        if harness == CLAUDE {
            command
                .args([
                    "-p",
                    "--input-format",
                    "stream-json",
                    "--output-format",
                    "stream-json",
                    "--verbose",
                    "--include-partial-messages",
                    "--permission-prompt-tool=stdio",
                ])
                .env("CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS", "1");
            if replay {
                command.arg("--replay-user-messages");
            }
            if !resume.is_empty() {
                command.args(["--resume", resume]);
            }
        } else {
            command.arg("app-server");
        }
        let mut child = command
            .current_dir(root)
            .process_group(0)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("start {harness}: {e}"))?;
        let pid = child.id() as i32;
        let input = child.stdin.take();
        let output = child.stdout.take().expect("piped chat stdout");
        let mut stderr = child.stderr.take().expect("piped chat stderr");
        let diagnostics = Arc::new(Mutex::new(Vec::<u8>::new()));
        let retained = diagnostics.clone();
        let stderr_worker = std::thread::spawn(move || {
            let mut buffer = [0; 4096];
            while let Ok(n) = stderr.read(&mut buffer) {
                if n == 0 {
                    break;
                }
                let mut bytes = retained.lock().expect("chat diagnostics");
                bytes.extend_from_slice(&buffer[..n]);
                let keep = bytes.len().saturating_sub(16 * 1024);
                bytes.drain(..keep);
            }
        });
        let process = Arc::new(Self {
            harness: harness.into(),
            pid,
            input: Mutex::new(input),
            pending: Mutex::default(),
            next: AtomicU64::new(0),
            cancel: store.cancel.child_token(),
            done: watch::channel(None).0,
            tasks: TaskTracker::new(),
        });
        let retired = Arc::new(Mutex::new(false));
        let worker = process.clone();
        let group = retired.clone();
        process.tasks.spawn_blocking(move || {
            let _tracked = tracked_reader;
            let mut failure = None;
            for frame in
                serde_json::Deserializer::from_reader(BufReader::new(output)).into_iter::<Value>()
            {
                match frame {
                    Ok(frame) => {
                        receive(frame.clone());
                        worker.resolve(frame);
                    }
                    Err(error) => {
                        failure = Some(format!("read {} protocol: {error}", worker.harness));
                        break;
                    }
                }
            }
            // Retire the group while the unreaped leader still reserves its PID.
            {
                let mut retired = group.lock().expect("chat process group");
                crate::services::containment::send_signal_to_group(pid, libc::SIGKILL);
                *retired = true;
            }
            let _ = stderr_worker.join();
            let status = child.wait();
            worker.input.lock().expect("chat input").take();
            let message = failure.unwrap_or_else(|| {
                format!(
                    "{} exited: {:?} ({})",
                    worker.harness,
                    status,
                    String::from_utf8_lossy(&diagnostics.lock().expect("chat diagnostics"))
                )
            });
            worker.done.send_replace(Some(message));
        });
        let watcher = process.clone();
        process.tasks.spawn(async move {
            let _tracked = tracked_watcher;
            let mut done = watcher.done.subscribe();
            tokio::select! {
                _=watcher.cancel.cancelled()=>{},
                _=done.wait_for(|value|value.is_some())=>return,
            }
            {
                let retired = retired.lock().expect("chat process group");
                if !*retired {
                    crate::services::containment::send_signal_to_group(pid, libc::SIGTERM);
                }
            }
            if tokio::time::timeout(
                std::time::Duration::from_secs(2),
                done.wait_for(|value| value.is_some()),
            )
            .await
            .is_err()
            {
                let retired = retired.lock().expect("chat process group");
                if !*retired {
                    crate::services::containment::send_signal_to_group(pid, libc::SIGKILL);
                }
            }
        });
        Ok(process)
    }

    pub async fn write(self: &Arc<Self>, value: Value) -> Result<(), Failure> {
        let process = self.clone();
        tokio::time::timeout(
            CALL_TIMEOUT,
            self.tasks.spawn_blocking(move || {
                let mut input = process.input.lock().expect("chat input");
                let input = input
                    .as_mut()
                    .ok_or_else(|| Failure::Transport("native input is closed".into()))?;
                serde_json::to_writer(&mut *input, &value)
                    .map_err(|e| Failure::Transport(format!("write native protocol: {e}")))?;
                input
                    .write_all(b"\n")
                    .map_err(|e| Failure::Transport(format!("write native protocol: {e}")))
            }),
        )
        .await
        .map_err(|_| Failure::Timeout)?
        .map_err(|e| Failure::Transport(e.to_string()))?
    }

    pub async fn call(self: &Arc<Self>, method: &str, mut params: Value) -> Reply {
        let id = self.next.fetch_add(1, Ordering::Relaxed) + 1;
        let (key, request) = if self.harness == CLAUDE {
            params["subtype"] = json!(method);
            (
                json!(id.to_string()).to_string(),
                json!({"type":"control_request","request_id":id.to_string(),"request":params}),
            )
        } else {
            (
                id.to_string(),
                json!({"id":id,"method":method,"params":params}),
            )
        };
        self.exchange(key, request, false).await
    }

    pub async fn user(self: &Arc<Self>, session: &str, uuid: &str, content: Vec<Value>) -> Reply {
        self.exchange(format!("user:{uuid}"),json!({"type":"user","uuid":uuid,"session_id":session,"message":{"role":"user","content":content},"parent_tool_use_id":null}),true).await
    }

    async fn exchange(self: &Arc<Self>, key: String, request: Value, retain: bool) -> Reply {
        let (sender, receiver) = oneshot::channel();
        self.pending
            .lock()
            .expect("chat pending")
            .insert(key.clone(), sender);
        let outcome = async {
            self.write(request).await?;
            let mut done = self.done.subscribe();
            tokio::select! {
                reply=receiver=>reply.unwrap_or_else(|_|Err(Failure::Transport("native reply closed".into()))),
                status=done.wait_for(|value|value.is_some())=>Err(Failure::Transport(status.ok().and_then(|value|value.clone()).unwrap_or_default())),
            }
        };
        let reply = tokio::time::timeout(CALL_TIMEOUT, outcome)
            .await
            .unwrap_or(Err(Failure::Timeout));
        if !retain || !matches!(reply, Err(Failure::Timeout | Failure::Transport(_))) {
            self.pending.lock().expect("chat pending").remove(&key);
        }
        reply
    }

    fn resolve(&self, frame: Value) {
        let (key, reply) = if self.harness == CLAUDE {
            let kind = frame["type"].as_str().unwrap_or_default();
            if kind == "command_lifecycle" {
                let state = frame["state"].as_str().unwrap_or_default();
                let reply = match state {
                    "queued" => Ok(json!("queued")),
                    "started" | "completed" => Ok(json!("started")),
                    "refused" | "discarded" | "cancelled" => Err(Failure::Native(format!(
                        "Claude did not run the user message: {state}"
                    ))),
                    _ => return,
                };
                (
                    format!(
                        "user:{}",
                        frame["command_uuid"].as_str().unwrap_or_default()
                    ),
                    reply,
                )
            } else if kind == "user" && frame["isReplay"] == true {
                (
                    format!("user:{}", frame["uuid"].as_str().unwrap_or_default()),
                    Ok(json!("started")),
                )
            } else if kind == "result"
                && frame["is_error"] == true
                && frame["user_message_uuid"].is_string()
            {
                (
                    format!(
                        "user:{}",
                        frame["user_message_uuid"].as_str().unwrap_or_default()
                    ),
                    Err(Failure::Native(format!(
                        "Claude rejected the user message: {}",
                        frame["result"]
                    ))),
                )
            } else if kind == "control_response" {
                let response = &frame["response"];
                let key = response["request_id"].to_string();
                let reply = if response["subtype"] == "error" {
                    Err(Failure::Native(format!(
                        "{} request failed: {}",
                        self.harness, response["error"]
                    )))
                } else {
                    Ok(response["response"].clone())
                };
                (key, reply)
            } else {
                return;
            }
        } else {
            if frame["method"].is_string() {
                return;
            }
            let Ok(key) = request_key(&frame["id"]) else {
                return;
            };
            let reply = if frame["error"].is_null() {
                Ok(frame["result"].clone())
            } else {
                Err(Failure::Native(format!(
                    "{} request failed: {}",
                    self.harness, frame["error"]
                )))
            };
            (key, reply)
        };
        if let Some(sender) = self.pending.lock().expect("chat pending").remove(&key) {
            let _ = sender.send(reply);
        }
    }

    pub async fn finished(&self) -> String {
        let mut done = self.done.subscribe();
        let _ = done.wait_for(|value| value.is_some()).await;
        done.borrow().clone().unwrap_or_default()
    }

    pub async fn close(&self) {
        self.cancel.cancel();
        self.finished().await;
        self.tasks.close();
        self.tasks.wait().await;
    }
}

pub(super) async fn initialize(process: &Arc<Process>) -> Reply {
    let params = if process.harness == CLAUDE {
        json!({})
    } else {
        json!({"clientInfo":{"name":"devhost","version":"development"}})
    };
    let result = process.call("initialize", params).await?;
    if process.harness != CLAUDE {
        process.write(json!({"method":"initialized"})).await?;
    }
    Ok(result)
}

pub(super) async fn models(process: &Arc<Process>) -> Result<Vec<Value>, String> {
    let mut rows = Vec::new();
    let mut cursor = String::new();
    let mut seen = std::collections::BTreeSet::new();
    loop {
        let mut params = json!({"includeHidden":false});
        if !cursor.is_empty() {
            params["cursor"] = json!(cursor);
        }
        let page = process
            .call("model/list", params)
            .await
            .map_err(|e| e.to_string())?;
        rows.extend(page["data"].as_array().cloned().unwrap_or_default());
        cursor = page["nextCursor"].as_str().unwrap_or_default().into();
        if cursor.is_empty() {
            return Ok(rows);
        }
        if !seen.insert(cursor.clone()) {
            return Err("Codex returned a repeated model cursor".into());
        }
    }
}
