use std::{
    collections::BTreeSet,
    fmt::Write as _,
    path::Path,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use cli_command_kit::Mode;
use unicode_width::UnicodeWidthStr;

pub use super::stack::live::{ServiceInfo, StackSnapshot};
use crate::{
    Failure,
    caddy::stacks::{LiveStack, read_live_stacks},
    cliout,
    paths::{clean, manifest_identity},
};

pub struct StackInfo {
    pub stack: LiveStack,
    pub snapshot: StackSnapshot,
    pub ready: bool,
    pub run_state: &'static str,
}

pub fn read_stack_info(caddy_dir: &Path, manifest: &Path) -> Result<StackInfo, Failure> {
    let manifest = clean(manifest);
    let stacks = read_live_stacks(caddy_dir)
        .map_err(|error| Failure::from(format!("read running stacks: {error}")))?;
    let identity = manifest_identity(&manifest);
    let matched = stacks
        .iter()
        .find(|stack| manifest_identity(Path::new(&stack.manifest_path)) == identity)
        .or_else(|| {
            stacks.iter().find(|stack| {
                stack
                    .manifest_files
                    .iter()
                    .any(|file| manifest_identity(Path::new(file)) == identity)
            })
        });
    let Some(stack) = matched else {
        return Err(Failure { message: format!("no running stack found for manifest: {}", manifest.display()), summary: None,
            hint: Some(if stacks.is_empty() { "Run \"devhost start\" to start this stack." } else { "Other stacks are running. Run \"devhost stack list\" to print their PIDs and manifests." }.to_owned()) });
    };
    read_live_stack_info(stack)
}

pub(crate) fn read_live_stack_info(stack: &LiveStack) -> Result<StackInfo, Failure> {
    let mut stack = stack.clone();
    stack.started_at = normalize_timestamp(&stack.started_at);
    stack.manifest_files =
        ordered_manifest_files(Path::new(&stack.manifest_path), &stack.manifest_files);
    let mut snapshot = if stack.control_port == 0 {
        StackSnapshot {
            name: stack.name.clone(),
            starting: true,
            ..Default::default()
        }
    } else {
        read_snapshot(stack.control_port).map_err(|error| {
            Failure::from(format!(
                "read live state from stack {} (PID {}): {error}",
                stack.name, stack.pid
            ))
        })?
    };
    if !snapshot.name.is_empty() {
        stack.name = snapshot.name.clone();
    }
    if !snapshot.manifest_files.is_empty() {
        stack.manifest_files =
            ordered_manifest_files(Path::new(&stack.manifest_path), &snapshot.manifest_files);
    }
    snapshot.name = stack.name.clone();
    let (mut ready, mut run_state) = summarize(&snapshot.services);
    if snapshot.starting && ready {
        ready = false;
        run_state = "starting";
    }
    Ok(StackInfo {
        stack,
        snapshot,
        ready,
        run_state,
    })
}

pub(crate) fn read_snapshot(port: u16) -> Result<StackSnapshot, String> {
    let agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(2)))
        .proxy(None)
        .max_redirects(0)
        .max_redirects_will_error(false)
        .http_status_as_error(false)
        .build()
        .new_agent();
    let mut response = agent
        .get(format!("http://127.0.0.1:{port}/__devhost__/stack-info"))
        .call()
        .map_err(|error| error.to_string())?;
    if response.status() != http::StatusCode::OK {
        return Err(format!("control server returned {}", response.status()));
    }
    let data = response
        .body_mut()
        .with_config()
        .limit(4 * 1024 * 1024)
        .read_to_string()
        .map_err(|error| error.to_string())?;
    serde_json::from_str(&data).map_err(|error| error.to_string())
}

pub(crate) fn summarize(services: &[ServiceInfo]) -> (bool, &'static str) {
    if services.iter().any(|service| {
        !matches!(
            service.state.as_str(),
            "ready" | "not-started" | "starting" | "restarting"
        )
    }) {
        return (false, "degraded");
    }
    if services
        .iter()
        .any(|service| matches!(service.state.as_str(), "starting" | "restarting"))
    {
        return (false, "starting");
    }
    (true, "running")
}

pub(crate) fn ordered_manifest_files(root: &Path, files: &[String]) -> Vec<String> {
    let mut seen = BTreeSet::new();
    let mut result = Vec::new();
    if !root.as_os_str().is_empty() {
        let root = clean(root);
        seen.insert(manifest_identity(&root));
        result.push(root.display().to_string());
    }
    let mut extras = Vec::new();
    for path in files.iter().filter(|path| !path.is_empty()) {
        let path = clean(Path::new(path));
        if seen.insert(manifest_identity(&path)) {
            extras.push(path.display().to_string());
        }
    }
    extras.sort();
    result.extend(extras);
    result
}

pub(crate) fn normalize_timestamp(raw: &str) -> String {
    raw.parse::<jiff::Timestamp>()
        .ok()
        .and_then(|timestamp| jiff::Timestamp::from_second(timestamp.as_second()).ok())
        .map(|timestamp| timestamp.to_string())
        .unwrap_or_else(|| raw.to_owned())
}

pub fn format_stack_info(info: &StackInfo, mode: Mode, now: SystemTime) -> String {
    if mode == Mode::Agent {
        format_agent(info)
    } else {
        format_human(info, now)
    }
}

fn format_agent(info: &StackInfo) -> String {
    let stack = &info.stack;
    let mode = if stack.log_path.is_empty() {
        "foreground"
    } else {
        "detached"
    };
    let mut fields = vec![
        format!("name={}", agent_value(&stack.name)),
        format!("pid={}", stack.pid),
        format!("mode={mode}"),
        format!("ready={}", info.ready),
    ];
    if stack.remote {
        fields.push("remote=true".to_owned());
    }
    if !stack.manifest_path.is_empty() {
        fields.push(format!("manifest={}", agent_value(&stack.manifest_path)));
    }
    if !stack.manifest_files.is_empty() {
        fields.push(format!(
            "manifestFiles={}",
            agent_value(&stack.manifest_files.join(","))
        ));
    }
    if stack.control_port != 0 {
        fields.push(format!("controlPort={}", stack.control_port));
    }
    if !stack.log_path.is_empty() {
        fields.push(format!("log={}", agent_value(&stack.log_path)));
    }
    if !stack.started_at.is_empty() {
        fields.push(format!("createdAt={}", stack.started_at));
    }
    let mut out = format!("devhost: stack {}\n", fields.join(" "));
    for service in &info.snapshot.services {
        let mut fields = vec![
            format!("name={}", agent_value(&service.name)),
            format!("state={}", service.state),
        ];
        if service.primary {
            fields.push("primary=true".to_owned());
        }
        if let Some(code) = service.exit_code {
            fields.push(format!("exitCode={code}"));
        }
        if !service.since.is_empty() {
            fields.push(format!("since={}", service.since));
        }
        if let Some(port) = service.port {
            fields.push(format!("port={port}"));
        }
        if !service.urls.is_empty() {
            fields.push(format!("url={}", agent_value(&service.urls.join(","))));
        }
        if !service.last_output.is_empty() {
            fields.push(format!("last={}", quote(&service.last_output)));
        }
        let _ = writeln!(out, "devhost: service {}", fields.join(" "));
    }
    out
}

fn format_human(info: &StackInfo, now: SystemTime) -> String {
    let stack = &info.stack;
    let mode = if stack.log_path.is_empty() {
        "foreground"
    } else {
        "detached"
    };
    let mut header = vec![
        stack.name.clone(),
        info.run_state.to_owned(),
        format!("PID {}", stack.pid),
        mode.to_owned(),
    ];
    if let Ok(created) = stack.started_at.parse::<jiff::Timestamp>() {
        let seconds = now
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()
            .saturating_sub(created.as_second().max(0) as u64);
        header.push(format!("up {}", uptime(seconds)));
    }
    let mut out = format!("{}\n", header.join(" · "));
    let rows: Vec<_> = info
        .snapshot
        .services
        .iter()
        .map(|service| {
            let name = format!(
                "{}{}",
                service.name,
                if service.primary { " (primary)" } else { "" }
            );
            let state = match service.state.as_str() {
                "exited" => service
                    .exit_code
                    .map(|code| format!("exited {code}"))
                    .unwrap_or_else(|| "exited".to_owned()),
                "not-started" => "not started".to_owned(),
                other => other.to_owned(),
            };
            (service, name, state)
        })
        .collect();
    let name_width = rows
        .iter()
        .map(|(_, name, _)| name.width())
        .max()
        .unwrap_or_default();
    let state_width = rows
        .iter()
        .map(|(_, _, state)| state.width())
        .max()
        .unwrap_or_default();
    for (service, name, state) in rows {
        let urls = if service.urls.is_empty() {
            "(no route)".to_owned()
        } else {
            service.urls.join(", ")
        };
        let _ = writeln!(
            out,
            "{name}{}{state}{}{urls}",
            " ".repeat(name_width - name.width() + 2),
            " ".repeat(state_width - state.width() + 2)
        );
        if !service.last_output.is_empty() {
            let _ = writeln!(out, "  └ {}", service.last_output);
        }
    }
    if !stack.log_path.is_empty() {
        let _ = writeln!(out, "Log: {}", cliout::display_path(&stack.log_path));
    }
    out
}

fn uptime(seconds: u64) -> String {
    match seconds {
        0..60 => format!("{seconds}s"),
        60..3600 => format!("{}m", seconds / 60),
        3600..86400 => {
            let (hours, minutes) = (seconds / 3600, seconds % 3600 / 60);
            if minutes == 0 {
                format!("{hours}h")
            } else {
                format!("{hours}h {minutes}m")
            }
        }
        _ => {
            let (days, hours) = (seconds / 86400, seconds % 86400 / 3600);
            if hours == 0 {
                format!("{days}d")
            } else {
                format!("{days}d {hours}h")
            }
        }
    }
}

fn agent_value(value: &str) -> String {
    if value.is_empty()
        || value.chars().any(|character| {
            character.is_whitespace()
                || matches!(character, '"' | '\\' | '=')
                || character.is_control()
        })
    {
        quote(value)
    } else {
        value.to_owned()
    }
}

fn quote(value: &str) -> String {
    // Go's diagnostic quoting keeps printable Unicode but escapes controls.
    let mut quoted = String::from("\"");
    for character in value.chars() {
        match character {
            '"' => quoted.push_str("\\\""),
            '\\' => quoted.push_str("\\\\"),
            '\n' => quoted.push_str("\\n"),
            '\r' => quoted.push_str("\\r"),
            '\t' => quoted.push_str("\\t"),
            '\u{7}' => quoted.push_str("\\a"),
            '\u{8}' => quoted.push_str("\\b"),
            '\u{b}' => quoted.push_str("\\v"),
            '\u{c}' => quoted.push_str("\\f"),
            character if character.is_control() => {
                let code = u32::from(character);
                if code <= 0x7f {
                    let _ = write!(quoted, "\\x{code:02x}");
                } else {
                    let _ = write!(quoted, "\\u{code:04x}");
                }
            }
            character => quoted.push(character),
        }
    }
    quoted.push('"');
    quoted
}
