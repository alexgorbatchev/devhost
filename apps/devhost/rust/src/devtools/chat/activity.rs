use super::CLAUDE;
use serde_json::Value;
use std::{
    collections::BTreeMap,
    time::{Duration, Instant},
};

#[derive(Default)]
pub(super) struct Activity {
    started: Option<Instant>,
    last: Option<Instant>,
    heartbeat: Option<Instant>,
    tools: BTreeMap<String, (String, String, Instant)>,
    requests: BTreeMap<String, (String, Instant)>,
    interrupted: bool,
    native_model: String,
    turn_seen: bool,
}

impl Activity {
    pub fn reconcile_requests(
        &mut self,
        pending: &BTreeMap<String, Value>,
        outcome: &str,
    ) -> Vec<String> {
        let mut logs = Vec::new();
        self.requests.retain(|id, (kind, start)| {
            if pending.contains_key(id) {
                true
            } else {
                logs.push(format!(
                    "request {outcome} request={id} kind={kind:?} waited={:?}",
                    start.elapsed()
                ));
                false
            }
        });
        for id in pending.keys() {
            self.requests
                .entry(id.clone())
                .or_insert_with(|| ("native request".into(), Instant::now()));
        }
        logs
    }
    pub fn finish(&mut self, outcome: &str) -> Option<String> {
        let start = self.started.take()?;
        self.tools.clear();
        self.turn_seen = false;
        self.interrupted = false;
        Some(format!("turn {outcome} duration={:?}", start.elapsed()))
    }
    pub fn dispatch(&mut self) {
        if self.started.is_none() {
            let now = Instant::now();
            self.started = Some(now);
            self.last = Some(now);
            self.heartbeat = Some(now);
            self.interrupted = false;
        }
    }
    pub fn interrupt(&mut self) {
        self.interrupted = true;
    }
    pub fn heartbeat(&mut self, status: &str) -> Option<String> {
        if matches!(status, "closed" | "error")
            || self.started.is_none()
            || self
                .last
                .is_none_or(|t| t.elapsed() < Duration::from_secs(30))
            || self
                .heartbeat
                .is_some_and(|t| t.elapsed() < Duration::from_secs(30))
        {
            return None;
        }
        self.heartbeat = Some(Instant::now());
        Some(format!(
            "still working state={status} elapsed={:?} tools={} pending={}",
            self.started.expect("active turn").elapsed(),
            self.tools
                .values()
                .map(|t| t.0.as_str())
                .collect::<Vec<_>>()
                .join(","),
            self.requests.len()
        ))
    }
    pub fn frame(&mut self, harness: &str, frame: &Value) -> Vec<String> {
        let now = Instant::now();
        self.last = Some(now);
        let mut logs = Vec::new();
        let kind = frame["type"].as_str().unwrap_or_default();
        let method = frame["method"].as_str().unwrap_or_default();
        if method == "turn/started"
            || (harness == CLAUDE
                && frame["parent_tool_use_id"].is_null()
                && (kind == "assistant"
                    || (kind == "stream_event" && frame["event"]["type"] == "message_start")))
        {
            if self.started.is_none() {
                self.dispatch();
            }
            if !self.turn_seen {
                logs.push(format!(
                    "turn started turn={:?}",
                    frame["params"]["turn"]["id"].as_str().unwrap_or_default()
                ));
                self.turn_seen = true;
            }
        }
        if harness == CLAUDE
            && kind == "assistant"
            && frame["parent_tool_use_id"].is_null()
            && let Some(model) = frame["message"]["model"].as_str().filter(|m| !m.is_empty())
            && model != self.native_model
        {
            self.native_model = model.into();
            logs.push(format!("native model={model:?}"));
        }
        if method == "turn/completed"
            || (harness == CLAUDE && kind == "result" && frame["parent_tool_use_id"].is_null())
        {
            let outcome = if frame["is_error"] == true {
                "failed"
            } else if self.interrupted {
                "interrupted"
            } else {
                frame["params"]["turn"]["status"]
                    .as_str()
                    .unwrap_or("completed")
            };
            logs.push(format!(
                "turn {outcome} duration={:?}",
                self.started.map(|t| t.elapsed())
            ));
            self.started = None;
            self.turn_seen = false;
            self.tools.clear();
            self.interrupted = false;
            for (field, label) in [
                ("usage", "usage"),
                ("total_cost_usd", "cost"),
                ("duration_ms", "native duration"),
            ] {
                if let Some(value) = frame.get(field) {
                    // Only documented numeric usage fields may reach logs.
                    if value.is_number() {
                        logs.push(format!("{label} {value}"));
                    } else if field == "usage" {
                        let metrics: BTreeMap<_, _> = value
                            .as_object()
                            .into_iter()
                            .flatten()
                            .filter(|(key, value)| {
                                value.is_number()
                                    && matches!(
                                        key.as_str(),
                                        "input_tokens"
                                            | "output_tokens"
                                            | "cache_read_input_tokens"
                                            | "cache_creation_input_tokens"
                                    )
                            })
                            .collect();
                        logs.push(format!(
                            "usage {}",
                            serde_json::to_string(&metrics).expect("numeric usage")
                        ));
                    }
                }
            }
        }
        if method == "thread/tokenUsage/updated" {
            let metrics: BTreeMap<_, _> = frame["params"]["tokenUsage"]["last"]
                .as_object()
                .into_iter()
                .flatten()
                .filter(|(key, value)| {
                    value.is_number()
                        && matches!(
                            key.as_str(),
                            "inputTokens"
                                | "cachedInputTokens"
                                | "outputTokens"
                                | "reasoningOutputTokens"
                                | "totalTokens"
                        )
                })
                .collect();
            logs.push(format!(
                "usage {}",
                serde_json::to_string(&metrics).expect("numeric usage")
            ));
        }
        if method == "error" {
            logs.push(format!(
                "native error retry={}",
                frame["params"]["willRetry"] == true
            ));
        }
        if frame.get("id").is_some() && !method.is_empty() {
            let id = frame["id"].to_string();
            self.requests
                .entry(id.clone())
                .or_insert((method.into(), now));
            logs.push(format!("waiting for user request={id} kind={method:?}"));
        }
        if kind == "control_request" {
            let id = frame["request_id"].to_string();
            let subtype = frame["request"]["subtype"]
                .as_str()
                .unwrap_or("control_request");
            self.requests
                .entry(id.clone())
                .or_insert((subtype.into(), now));
            logs.push(format!("waiting for user request={id} kind={subtype:?}"));
        }
        let resolved = if kind == "control_cancel_request" {
            Some(frame["request_id"].to_string())
        } else if method == "serverRequest/resolved" {
            Some(frame["params"]["requestId"].to_string())
        } else {
            None
        };
        if let Some(id) = resolved
            && let Some((kind, start)) = self.requests.remove(&id)
        {
            logs.push(format!(
                "request resolved request={id} kind={kind:?} waited={:?}",
                start.elapsed()
            ));
        }
        if matches!(method, "item/started" | "item/completed") {
            let item = &frame["params"]["item"];
            if matches!(
                item["type"].as_str(),
                Some(
                    "commandExecution"
                        | "fileChange"
                        | "mcpToolCall"
                        | "dynamicToolCall"
                        | "collabToolCall"
                        | "webSearch"
                        | "imageView"
                )
            ) {
                let id = item["id"].as_str().unwrap_or_default();
                let name = item["type"].as_str().unwrap_or_default();
                let path = item["path"]
                    .as_str()
                    .or_else(|| item["cwd"].as_str())
                    .unwrap_or_default();
                if method == "item/started" {
                    self.start_tool(id, name, path, now, &mut logs);
                } else {
                    if !self.tools.contains_key(id) {
                        self.start_tool(id, name, path, now, &mut logs);
                    }
                    self.finish_tool(
                        id,
                        item["status"].as_str().unwrap_or("completed"),
                        &mut logs,
                    );
                }
            }
        }
        let mut blocks = Vec::new();
        if kind == "stream_event" && frame["event"]["type"] == "content_block_start" {
            blocks.push(&frame["event"]["content_block"]);
        }
        if matches!(kind, "assistant" | "user")
            && let Some(content) = frame["message"]["content"].as_array()
        {
            blocks.extend(content);
        }
        for block in blocks {
            if block["type"] == "tool_use" {
                self.start_tool(
                    block["id"].as_str().unwrap_or_default(),
                    block["name"].as_str().unwrap_or_default(),
                    block["input"]["file_path"].as_str().unwrap_or_default(),
                    now,
                    &mut logs,
                );
            }
            if block["type"] == "tool_result" {
                self.finish_tool(
                    block["tool_use_id"].as_str().unwrap_or_default(),
                    if block["is_error"] == true {
                        "failed"
                    } else {
                        "completed"
                    },
                    &mut logs,
                );
            }
        }
        logs
    }
    fn start_tool(
        &mut self,
        id: &str,
        name: &str,
        path: &str,
        now: Instant,
        logs: &mut Vec<String>,
    ) {
        if id.is_empty() || name.is_empty() {
            return;
        }
        if let Some(tool) = self.tools.get_mut(id) {
            if !path.is_empty() {
                tool.1 = path.into();
            }
            return;
        }
        self.tools
            .insert(id.into(), (name.into(), path.into(), now));
        logs.push(format!(
            "tool started item={id:?} tool={name:?} path={path:?}"
        ));
    }
    fn finish_tool(&mut self, id: &str, outcome: &str, logs: &mut Vec<String>) {
        if let Some((name, path, start)) = self.tools.remove(id) {
            logs.push(format!(
                "tool {outcome} item={id:?} tool={name:?} path={path:?} duration={:?}",
                start.elapsed()
            ));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn logs_tool_lifecycle_and_numeric_usage_without_native_contents() {
        let mut activity = Activity::default();
        activity.dispatch();
        let mut logs = Vec::new();
        for frame in [
            json!({"method":"turn/started","params":{"turn":{"id":"turn"}}}),
            json!({"method":"item/started","params":{"item":{"id":"tool","type":"commandExecution","cwd":"/project","command":"secret shell command"}}}),
            json!({"method":"item/completed","params":{"item":{"id":"tool","type":"commandExecution","status":"completed","output":"secret output"}}}),
            json!({"method":"thread/tokenUsage/updated","params":{"tokenUsage":{"last":{"inputTokens":10,"outputTokens":2,"private":"secret usage"}}}}),
            json!({"method":"error","params":{"willRetry":true,"error":"secret error"}}),
            json!({"method":"turn/completed","params":{"turn":{"id":"turn","status":"completed"}}}),
        ] {
            logs.extend(activity.frame(super::super::CODEX, &frame));
        }
        assert!(logs.iter().any(|s| s.contains("tool completed")));
        assert!(logs.iter().any(|s| s.contains("inputTokens")));
        assert!(!logs.join(" ").contains("secret"));
        let mut logs = Vec::new();
        for frame in [
            json!({"type":"assistant","message":{"model":"sonnet","content":[{"type":"tool_use","id":"read","name":"Read","input":{"file_path":"/project/file","private":"secret arguments"}}]}}),
            json!({"type":"stream_event","event":{"type":"content_block_start","content_block":{"type":"tool_use","id":"read","name":"Read","input":{"file_path":"/project/updated"}}}}),
            json!({"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"read","is_error":true,"content":"secret tool response"}]}}),
            json!({"type":"result","usage":{"input_tokens":12,"output_tokens":4,"private":"secret prompt"},"total_cost_usd":0.01,"duration_ms":10,"result":"secret result"}),
        ] {
            logs.extend(activity.frame(CLAUDE, &frame));
        }
        assert_eq!(
            logs.iter()
                .filter(|s| s.starts_with("turn started"))
                .count(),
            1
        );
        assert!(logs.iter().any(|s| s.contains("tool failed")));
        assert!(!logs.join(" ").contains("secret"));
    }
    #[test]
    fn heartbeat_reports_quiet_work_and_request_resolution() {
        let mut activity = Activity::default();
        assert!(activity.heartbeat("idle").is_none());
        activity.dispatch();
        let old = Instant::now() - Duration::from_secs(60);
        activity.last = Some(old);
        activity.heartbeat = Some(old);
        activity.frame(CLAUDE,&json!({"type":"control_request","request_id":"approve","request":{"subtype":"can_use_tool"}}));
        activity.last = Some(old);
        assert!(
            activity
                .heartbeat("requires_action")
                .unwrap()
                .contains("pending=1")
        );
        assert!(activity.heartbeat("requires_action").is_none());
        assert!(
            activity.reconcile_requests(&BTreeMap::new(), "response received")[0]
                .contains("response received")
        );
        activity.interrupt();
        assert!(
            activity
                .finish("interrupted")
                .unwrap()
                .contains("interrupted")
        );
        assert!(activity.finish("interrupted").is_none());
    }
}
