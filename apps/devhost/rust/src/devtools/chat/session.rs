use super::{
    CLAUDE, CODEX, Command, Info, LIMIT, Start, Store,
    activity::Activity,
    journal::Journal,
    message_id,
    process::{self, Failure, Process},
    random_id, request_key,
};
use crate::services::{
    control::{ActivityGuard, ActivityTracker, RuntimeHandle},
    stack::live::LiveState,
};
use base64::{Engine, engine::general_purpose::STANDARD};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    io::Cursor,
    path::Path,
    sync::{Arc, Mutex, OnceLock},
};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

pub(super) struct Client {
    pub sender: mpsc::Sender<Value>,
    pub cancel: CancellationToken,
}
pub(super) struct State {
    pub info: Info,
    pub journal: Option<Journal>,
    pub pending: BTreeMap<String, Value>,
    pub clients: BTreeMap<String, Client>,
    pub active: bool,
    pub turn: String,
    model: String,
    configured_model: String,
    capabilities: Vec<String>,
    state_events: bool,
    activity_guard: Option<ActivityGuard>,
    pub activity: Activity,
}

pub(super) struct Session {
    pub state: Mutex<State>,
    process: OnceLock<Arc<Process>>,
    operation: tokio::sync::Mutex<()>,
    tracker: ActivityTracker,
    live: LiveState,
    agents: Arc<crate::devtools::agents::Agents>,
    pub closed: CancellationToken,
    pub stopping: CancellationToken,
}

impl Store {
    pub(super) async fn start(
        self: &Arc<Self>,
        handle: &RuntimeHandle,
        request: Start,
        root: &Path,
    ) -> Result<Arc<Session>, String> {
        let _tracked = self.begin()?;
        let session = Arc::new(Session {
            state: Mutex::new(State {
                info: Info {
                    id: random_id(false)?,
                    harness: request.harness.clone(),
                    project_root_path: root.display().to_string(),
                    native_session_id: request.resume_id.clone(),
                    status: "starting".into(),
                    error: String::new(),
                },
                journal: Some(Journal::new()?),
                pending: BTreeMap::new(),
                clients: BTreeMap::new(),
                active: false,
                turn: String::new(),
                model: request.model.clone(),
                configured_model: String::new(),
                capabilities: Vec::new(),
                state_events: false,
                activity_guard: Some(handle.activity.chat_turn()),
                activity: Activity::default(),
            }),
            process: OnceLock::new(),
            operation: tokio::sync::Mutex::new(()),
            tracker: handle.activity.clone(),
            live: handle.live.clone(),
            agents: handle.agents.clone(),
            closed: CancellationToken::new(),
            stopping: self.cancel.clone(),
        });
        let weak = Arc::downgrade(&session);
        let process = Process::start(
            self,
            &request.harness,
            root,
            &request.resume_id,
            true,
            move |frame| {
                if let Some(session) = weak.upgrade() {
                    session.receive(frame);
                }
            },
        )?;
        session
            .process
            .set(process.clone())
            .unwrap_or_else(|_| panic!("chat process assigned once"));
        // Cancellation at any startup await must also retire its native process.
        let startup = process.cancel.clone().drop_guard();
        let initialized = async {
            process::initialize(&process)
                .await
                .map_err(|e| e.to_string())?;
            if request.harness == CODEX {
                let config = process
                    .call("config/read", json!({"cwd":root,"includeLayers":false}))
                    .await
                    .map_err(|e| e.to_string())?;
                let mut configured = config["config"]["model"]
                    .as_str()
                    .unwrap_or_default()
                    .to_owned();
                if configured.is_empty() {
                    configured = process::models(&process)
                        .await?
                        .iter()
                        .find(|row| row["isDefault"] == true)
                        .and_then(|row| row["model"].as_str())
                        .unwrap_or_default()
                        .into();
                }
                if configured.is_empty() {
                    return Err("Codex returned no configured or catalog default model".into());
                }
                session.state.lock().expect("chat state").configured_model = configured;
                let mut params = json!({"cwd":root});
                if !request.model.is_empty() {
                    params["model"] = json!(request.model);
                }
                let method = if request.resume_id.is_empty() {
                    "thread/start"
                } else {
                    params["threadId"] = json!(request.resume_id);
                    "thread/resume"
                };
                let result = process
                    .call(method, params)
                    .await
                    .map_err(|e| e.to_string())?;
                let native = result["thread"]["id"]
                    .as_str()
                    .filter(|id| !id.is_empty())
                    .ok_or("Codex returned no thread ID")?;
                session
                    .state
                    .lock()
                    .expect("chat state")
                    .info
                    .native_session_id = native.into();
            }
            let mut state = session.state.lock().expect("chat state");
            if let Some(error) = state.journal.as_ref().and_then(|j| j.error.clone()) {
                return Err(error);
            }
            if self.cancel.is_cancelled() {
                return Err("chat server is stopping".into());
            }
            if state.info.status == "starting" {
                state.info.status = "idle".into();
            }
            session.sync_activity(&mut state);
            session.log(&state, &format!("session started pid={}", process.pid));
            Ok(())
        }
        .await;
        if let Err(error) = initialized {
            process.close().await;
            return Err(error);
        }
        let info = session.info();
        let retired = {
            let mut sessions = self.sessions.lock().expect("chat sessions");
            if self.cancel.is_cancelled() {
                return Err("chat server is stopping".into());
            }
            let ids: Vec<_> = sessions
                .iter()
                .filter_map(|(id, old)| {
                    let old = old.info();
                    (old.status == "closed"
                        && old.harness == info.harness
                        && old.project_root_path == info.project_root_path
                        && !request.resume_id.is_empty()
                        && old.native_session_id == request.resume_id)
                        .then(|| id.clone())
                })
                .collect();
            let retired: Vec<_> = ids
                .into_iter()
                .filter_map(|id| sessions.remove(&id))
                .collect();
            sessions.insert(info.id.clone(), session.clone());
            retired
        };
        for old in retired {
            old.close(false).await;
            old.state.lock().expect("chat state").journal.take();
        }
        startup.disarm();
        session.update_owned(&info);
        let monitored = session.clone();
        self.tasks.spawn(async move {
            let mut interval=tokio::time::interval(std::time::Duration::from_secs(30));
            loop {
                tokio::select! {
                    error=process.finished()=>{
                        let mut state=monitored.state.lock().expect("chat state");
                        if state.info.status!="closed" {
                            state.info.status="error".into();
                            if state.info.error.is_empty(){state.info.error=error;}
                            state.active=false;
                            monitored.sync_activity(&mut state);
                            state.publish_state();
                            monitored.log(&state,"process failed");
                        }
                        break;
                    },
                    _=interval.tick()=>{
                        let mut state=monitored.state.lock().expect("chat state");
                        let status=state.info.status.clone();
                        if let Some(message)=state.activity.heartbeat(&status) {monitored.log(&state,&message);}
                    }
                }
            }
            process.close().await;
        });
        Ok(session)
    }

    pub(super) fn find(&self, id: &str, root: &Path) -> Option<Arc<Session>> {
        self.sessions
            .lock()
            .expect("chat sessions")
            .get(id)
            .filter(|s| s.info().project_root_path == root.to_string_lossy())
            .cloned()
    }
    pub(super) fn list(&self, root: &Path) -> Vec<Info> {
        self.sessions
            .lock()
            .expect("chat sessions")
            .values()
            .map(|s| s.info())
            .filter(|i| i.project_root_path == root.to_string_lossy())
            .collect()
    }
    pub(super) fn can_resume(&self, native: &str, harness: &str, root: &Path) -> bool {
        native.is_empty()
            || !self
                .sessions
                .lock()
                .expect("chat sessions")
                .values()
                .any(|s| {
                    let i = s.info();
                    i.native_session_id == native
                        && i.harness == harness
                        && i.project_root_path != root.to_string_lossy()
                })
    }
}

impl State {
    pub fn publish(&mut self, message: Value) {
        self.clients.retain(|_, client| {
            if client.sender.try_send(message.clone()).is_ok() {
                true
            } else {
                client.cancel.cancel();
                false
            }
        });
    }
    pub fn publish_state(&mut self) {
        self.publish(json!({"type":"state","sessionId":self.info.id,"session":self.info,"pendingRequestIds":self.pending.values().collect::<Vec<_>>()}));
    }
    pub fn snapshot(&mut self) -> Result<Value, String> {
        let events = self
            .journal
            .as_mut()
            .ok_or("Chat replay is closed")?
            .events()?;
        Ok(
            json!({"type":"snapshot","sessionId":self.info.id,"session":self.info,"pendingRequestIds":self.pending.values().collect::<Vec<_>>(),"events":events}),
        )
    }
}

impl Session {
    pub fn info(&self) -> Info {
        self.state.lock().expect("chat state").info.clone()
    }
    fn log(&self, state: &State, message: &str) {
        let mut line = format!(
            "chat session={:?} harness={:?} {message}",
            state.info.id, state.info.harness
        );
        if line.len() > 2048 {
            let mut end = 2048;
            while !line.is_char_boundary(end) {
                end -= 1;
            }
            line.truncate(end);
            line.push('…');
        }
        self.live.record_log("chat", "stdout", &line);
    }
    fn sync_activity(&self, state: &mut State) {
        if matches!(
            state.info.status.as_str(),
            "starting" | "running" | "requires_action"
        ) {
            if state.activity_guard.is_none() {
                state.activity_guard = Some(self.tracker.chat_turn());
            }
        } else {
            state.activity_guard = None;
        }
    }
    fn sync_requests(&self, state: &mut State, outcome: &str) {
        for message in state.activity.reconcile_requests(&state.pending, outcome) {
            self.log(state, &message);
        }
    }
    fn update_owned(&self, info: &Info) {
        if !info.native_session_id.is_empty() {
            let mut ids = self.agents.owned.lock().expect("owned agents");
            if info.status == "closed" {
                ids.remove(&info.native_session_id);
            } else {
                ids.insert(info.native_session_id.clone());
            }
        }
    }
    fn receive(&self, frame: Value) {
        let mut state = self.state.lock().expect("chat state");
        let Some(journal) = state.journal.as_mut() else {
            return;
        };
        let sequence = match journal.append(&frame) {
            Ok(n) => n,
            Err(error) => {
                state.info.status = "error".into();
                state.info.error = error;
                self.sync_activity(&mut state);
                state.publish_state();
                if let Some(p) = self.process.get() {
                    p.cancel.cancel();
                }
                return;
            }
        };
        if let Some(id) = frame["session_id"].as_str().filter(|s| !s.is_empty())
            && state.info.native_session_id != id
        {
            let mut ids = self.agents.owned.lock().expect("owned agents");
            ids.remove(&state.info.native_session_id);
            state.info.native_session_id = id.into();
        }
        if state.info.status == "closed" {
            return;
        }
        if frame["method"].is_string()
            && let Ok(key) = request_key(&frame["id"])
        {
            state.pending.insert(key, frame["id"].clone());
        }
        if frame["type"] == "control_request"
            && let Some(id) = frame["request_id"].as_str()
        {
            state.pending.insert(json!(id).to_string(), json!(id));
        }
        if frame["type"] == "control_cancel_request" {
            state.pending.remove(&frame["request_id"].to_string());
        }
        if frame["method"] == "serverRequest/resolved"
            && let Ok(key) = request_key(&frame["params"]["requestId"])
        {
            state.pending.remove(&key);
        }
        if frame["type"] == "control_response" {
            for key in [
                "pending_permission_requests",
                "pending_user_dialog_requests",
            ] {
                if let Some(requests) = frame["response"][key].as_array() {
                    for request in requests {
                        if let Some(id) = request["request_id"].as_str() {
                            state.pending.insert(json!(id).to_string(), json!(id));
                        }
                    }
                }
            }
        }
        if frame["type"] == "system" && frame["subtype"] == "init" {
            state.capabilities = frame["capabilities"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|v| v.as_str().map(str::to_owned))
                .collect();
        }
        if frame["method"] == "turn/started" {
            state.turn = frame["params"]["turn"]["id"]
                .as_str()
                .unwrap_or_default()
                .into();
            state.info.status = "running".into();
            state.info.error.clear();
            state.active = true;
        }
        if frame["method"] == "turn/completed" || (frame["type"] == "result" && !state.state_events)
        {
            state.info.status = "idle".into();
            state.turn.clear();
            state.active = false;
        }
        if frame["type"] == "system"
            && frame["subtype"] == "session_state_changed"
            && let Some(status) = frame["state"]
                .as_str()
                .filter(|s| matches!(*s, "idle" | "running" | "requires_action"))
        {
            state.state_events = true;
            state.active = status != "idle";
            if status != "idle" || state.info.status != "error" {
                state.info.status = status.into();
            }
        }
        if !state.pending.is_empty() && state.info.status != "error" {
            state.info.status = "requires_action".into();
        }
        if frame["method"] == "turn/completed" && frame["params"]["turn"]["status"] == "failed" {
            state.info.status = "error".into();
            state.info.error = frame["params"]["turn"]["error"]["message"]
                .as_str()
                .filter(|s| !s.is_empty())
                .unwrap_or("Native Codex turn failed")
                .into();
        }
        if frame["type"] == "result" && frame["is_error"] == true {
            state.info.status = "error".into();
            state.info.error = frame["result"]
                .as_str()
                .unwrap_or("Native Claude turn failed")
                .into();
        }
        let harness = state.info.harness.clone();
        for message in state.activity.frame(&harness, &frame) {
            self.log(&state, &message);
        }
        self.sync_requests(
            &mut state,
            if frame["type"] == "control_cancel_request" {
                "canceled"
            } else {
                "resolved"
            },
        );
        self.sync_activity(&mut state);
        self.update_owned(&state.info);
        let id = state.info.id.clone();
        state.publish(json!({"type":"event","sessionId":id,"sequence":sequence,"payload":frame}));
        state.publish_state();
    }

    pub async fn close(&self, stopping: bool) {
        {
            let mut state = self.state.lock().expect("chat state");
            if state.info.status != "closed" {
                self.log(&state, "session closed");
            }
            state.info.status = "closed".into();
            state.pending.clear();
            self.sync_requests(&mut state, "closed");
            if let Some(message) = state.activity.finish("interrupted") {
                self.log(&state, &message);
            }
            state.active = false;
            state.activity_guard = None;
            self.update_owned(&state.info);
            if stopping {
                self.stopping.cancel();
            }
            self.closed.cancel();
        }
        if let Some(process) = self.process.get() {
            process.close().await;
        }
    }

    pub async fn send(&self, command: Command) -> Result<String, String> {
        let images = validate_images(&command.images)?;
        if command.text.is_empty() && images.is_empty() {
            return Err("message is empty".into());
        }
        let uuid = message_id(&command.command_id)?;
        let _operation = self.operation.lock().await;
        let (info, model, was_active, turn) = {
            let mut state = self.state.lock().expect("chat state");
            if matches!(state.info.status.as_str(), "closed" | "starting") {
                return Err(format!("chat session is {}", state.info.status));
            }
            if let Some(model) = command.model {
                state.model = model;
            }
            let model = if state.model.is_empty() && state.info.harness == CODEX {
                state.configured_model.clone()
            } else {
                state.model.clone()
            };
            let previous = (state.info.clone(), model, state.active, state.turn.clone());
            state.activity.dispatch();
            if state.pending.is_empty() {
                state.info.status = "running".into();
            }
            state.info.error.clear();
            state.active = true;
            self.sync_activity(&mut state);
            state.publish_state();
            self.log(
                &state,
                &format!(
                    "message dispatching command={:?} attachments={}",
                    command.command_id,
                    images.len()
                ),
            );
            previous
        };
        let process = self.process.get().expect("initialized chat process");
        let mut content = Vec::new();
        if !command.text.is_empty() {
            content.push(json!({"type":"text","text":command.text}));
        }
        let result = if info.harness == CODEX {
            for (url, _, _) in images {
                content.push(json!({"type":"image","url":url}));
            }
            let mut params = json!({"threadId":info.native_session_id,"input":content,"clientUserMessageId":uuid});
            let mut result = if turn.is_empty() {
                params["model"] = json!(model);
                process.call("turn/start", params.clone()).await
            } else {
                params["expectedTurnId"] = json!(turn);
                process.call("turn/steer", params.clone()).await
            };
            if matches!(result, Err(Failure::Native(_))) && !turn.is_empty() {
                let completed = {
                    let state = self.state.lock().expect("chat state");
                    !state.active
                        && state.turn.is_empty()
                        && matches!(state.info.status.as_str(), "idle" | "error")
                };
                if completed {
                    params
                        .as_object_mut()
                        .expect("turn params")
                        .remove("expectedTurnId");
                    params["model"] = json!(model);
                    result = process.call("turn/start", params).await;
                }
            }
            match result {
                Ok(_) => Ok("queued".into()),
                Err(Failure::Timeout) => Ok("unconfirmed".into()),
                Err(e) => Err(e.to_string()),
            }
        } else {
            for (_, media, data) in images {
                content.push(json!({"type":"image","source":{"type":"base64","media_type":media,"data":data}}));
            }
            let set = if !was_active {
                process
                    .call(
                        "set_model",
                        json!({"model":if model.is_empty(){Value::Null}else{json!(model)}}),
                    )
                    .await
                    .map(|_| ())
            } else {
                Ok(())
            };
            match set {
                Err(e) => Err(e.to_string()),
                Ok(()) => match process.user(&info.native_session_id, &uuid, content).await {
                    Ok(v) => Ok(v.as_str().unwrap_or("started").into()),
                    Err(Failure::Timeout | Failure::Transport(_)) => Ok("unconfirmed".into()),
                    Err(e) => Err(e.to_string()),
                },
            }
        };
        if result.is_err() && !was_active {
            let mut state = self.state.lock().expect("chat state");
            if state.info.status == "running" {
                state.info.status = "idle".into();
            }
            state.active = false;
            self.sync_activity(&mut state);
            state.publish_state();
        }
        result
    }

    pub async fn execute(&self, command: Command) -> Result<(), String> {
        let process = self.process.get().expect("initialized chat process");
        if command.kind == "respond" {
            let key = request_key(&command.request_id)?;
            let value = {
                let mut state = self.state.lock().expect("chat state");
                if state.info.harness == CLAUDE && !command.request_id.is_string() {
                    return Err("Claude request ID must be a string".into());
                }
                let native = state
                    .pending
                    .remove(&key)
                    .ok_or("native request is not pending")?;
                self.sync_requests(&mut state, "response received");
                if state.pending.is_empty() && state.info.status != "error" {
                    state.info.status = if state.active { "running" } else { "idle" }.into();
                }
                self.sync_activity(&mut state);
                state.publish_state();
                if state.info.harness == CODEX {
                    json!({"id":native,"result":command.result})
                } else {
                    json!({"type":"control_response","response":{"subtype":"success","request_id":native,"response":command.result}})
                }
            };
            return process.write(value).await.map_err(|e| e.to_string());
        }
        if command.kind == "interrupt" {
            let (harness, native, turn, cancel_queued) = {
                let mut state = self.state.lock().expect("chat state");
                state.activity.interrupt();
                (
                    state.info.harness.clone(),
                    state.info.native_session_id.clone(),
                    state.turn.clone(),
                    state
                        .capabilities
                        .iter()
                        .any(|v| v == "interrupt_cancel_queued_v1"),
                )
            };
            let (method, params) = if harness == CLAUDE {
                (
                    "interrupt",
                    if cancel_queued {
                        json!({"cancel_queued":true})
                    } else {
                        json!({})
                    },
                )
            } else {
                if turn.is_empty() {
                    return Err("no native turn is running".into());
                }
                ("turn/interrupt", json!({"threadId":native,"turnId":turn}))
            };
            return process
                .call(method, params)
                .await
                .map(|_| ())
                .map_err(|e| e.to_string());
        }
        Err("unknown chat command".into())
    }
}

fn validate_images(images: &[super::Image]) -> Result<Vec<(String, String, String)>, String> {
    let mut total = 0;
    let mut result = Vec::new();
    for image in images {
        total += image.data_url.len();
        if total > LIMIT {
            return Err("image payload exceeds 8 MiB".into());
        }
        let (header, data) = image
            .data_url
            .split_once(',')
            .ok_or("image must be a PNG or JPEG base64 data URL")?;
        let (media, format) = match header {
            "data:image/png;base64" => ("image/png", image::ImageFormat::Png),
            "data:image/jpeg;base64" => ("image/jpeg", image::ImageFormat::Jpeg),
            _ => return Err("image must be a PNG or JPEG base64 data URL".into()),
        };
        let decoded = STANDARD
            .decode(data)
            .map_err(|e| format!("decode image: {e}"))?;
        let actual = image::guess_format(&decoded).map_err(|e| format!("read image: {e}"))?;
        if actual != format {
            return Err("image type does not match its data URL".into());
        }
        let (width, height) = image::ImageReader::with_format(Cursor::new(decoded), actual)
            .into_dimensions()
            .map_err(|e| format!("read image: {e}"))?;
        if width == 0 || height == 0 {
            return Err("image type does not match its data URL".into());
        }
        result.push((image.data_url.clone(), media.into(), data.into()));
    }
    Ok(result)
}

#[cfg(test)]
mod behavior_tests {
    use super::*;
    use crate::devtools::chat::tests::Fixture;

    #[test]
    fn authoritative_claude_state_restores_approvals_and_keeps_failed_turns_visible() {
        let fixture = Fixture::new("restore");
        let info = fixture.start(CLAUDE, "");
        let session = fixture
            .handle
            .chat
            .find(info["id"].as_str().unwrap(), fixture.root.path())
            .unwrap();
        assert_eq!(session.info().status, "requires_action");
        session.receive(json!({"type":"control_cancel_request","request_id":"restored"}));
        session
            .receive(json!({"type":"system","subtype":"session_state_changed","state":"running"}));
        session.receive(json!({"type":"result","result":"private response"}));
        assert_eq!(session.info().status, "running");
        assert!(!fixture.handle.activity.is_idle(std::time::Duration::ZERO));
        session.receive(json!({"type":"result","is_error":true,"result":"Native rejection"}));
        session.receive(json!({"type":"system","subtype":"session_state_changed","state":"idle"}));
        assert_eq!(session.info().status, "error");
        assert_eq!(session.info().error, "Native rejection");
        assert!(fixture.handle.activity.is_idle(std::time::Duration::ZERO));
        session.receive(json!({"type":"control_response","response":{"pending_user_dialog_requests":[{"request_id":"question"}]}}));
        assert_eq!(session.state.lock().unwrap().pending.len(), 1);
        session.receive(json!({"type":"system","session_id":"claude-native"}));
        assert!(!fixture.handle.chat.can_resume(
            "claude-native",
            CLAUDE,
            &fixture.root.path().join("outside")
        ));
        let mut state = session.state.lock().unwrap();
        state.info.status = "closed".into();
        let n = state.journal.as_ref().unwrap().sequence;
        drop(state);
        session
            .receive(json!({"type":"system","subtype":"session_state_changed","state":"running"}));
        assert_eq!(session.info().status, "closed");
        assert_eq!(
            session
                .state
                .lock()
                .unwrap()
                .journal
                .as_ref()
                .unwrap()
                .sequence,
            n + 1
        );
    }

    #[test]
    fn codex_request_resolution_and_journal_failure_preserve_the_failure() {
        let fixture = Fixture::new("normal");
        let info = fixture.start(CODEX, "");
        let session = fixture
            .handle
            .chat
            .find(info["id"].as_str().unwrap(), fixture.root.path())
            .unwrap();
        session.receive(json!({"id":"request","method":"item/commandExecution/requestApproval"}));
        assert_eq!(session.info().status, "requires_action");
        session
            .receive(json!({"method":"serverRequest/resolved","params":{"requestId":"request"}}));
        assert!(session.state.lock().unwrap().pending.is_empty());
        session.receive(json!({"method":"turn/completed","params":{"turn":{"id":"one","status":"failed","error":{"message":"Native failed"}}}}));
        assert_eq!(session.info().error, "Native failed");
        session.receive(json!({"method":"turn/started","params":{"turn":{"id":"two"}}}));
        assert_eq!(session.info().status, "running");
        assert!(session.info().error.is_empty());
        let (sender, _receiver) = mpsc::channel(1);
        let cancel = CancellationToken::new();
        let mut state = session.state.lock().unwrap();
        state.clients.insert(
            "slow".into(),
            Client {
                sender,
                cancel: cancel.clone(),
            },
        );
        state.publish_state();
        state.publish_state();
        assert!(cancel.is_cancelled());
        state.journal.as_mut().unwrap().error = Some("disk is full".into());
        drop(state);
        session
            .receive(json!({"method":"turn/completed","params":{"turn":{"status":"completed"}}}));
        assert_eq!(session.info().status, "error");
        assert_eq!(session.info().error, "disk is full");
    }

    #[test]
    fn image_validation_accepts_native_png_and_jpeg_and_rejects_mismatched_or_oversized_input() {
        let mut png = Vec::new();
        image::ImageEncoder::write_image(
            image::codecs::png::PngEncoder::new(&mut png),
            &[1, 2, 3],
            1,
            1,
            image::ExtendedColorType::Rgb8,
        )
        .unwrap();
        let mut jpeg = Vec::new();
        image::codecs::jpeg::JpegEncoder::new(&mut jpeg)
            .encode(&[1, 2, 3], 1, 1, image::ExtendedColorType::Rgb8)
            .unwrap();
        for (media, bytes) in [("png", png), ("jpeg", jpeg)] {
            let url = format!("data:image/{media};base64,{}", STANDARD.encode(bytes));
            assert_eq!(
                validate_images(&[super::super::Image { data_url: url }])
                    .unwrap()
                    .len(),
                1
            );
        }
        for url in [
            "wrong".into(),
            "data:image/gif;base64,abc".into(),
            "data:image/png;base64,AA==".into(),
            format!("data:image/png;base64,{}", "A".repeat(LIMIT)),
        ] {
            assert!(validate_images(&[super::super::Image { data_url: url }]).is_err());
        }
    }
}
