//! One sampler belongs to a supervisor, independently of attached browsers.
use crate::services::control::RuntimeHandle;
use axum::{
    body::Body,
    extract::{
        State,
        ws::{CloseFrame, Message, WebSocketUpgrade},
    },
    http::{Request, StatusCode},
    response::{IntoResponse, Response},
};
use futures_util::StreamExt;
use serde_json::{Value, json};
use std::{
    sync::{
        Arc, Condvar, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};
use sysinfo::{MemoryRefreshKind, System};

#[derive(Clone, Default, PartialEq, Eq)]
pub(crate) struct Reading {
    pub enabled: bool,
    pub message: String,
}

#[derive(Default)]
pub(crate) struct Signal {
    revision: Mutex<u64>,
    wake: Condvar,
}

impl Signal {
    pub fn notify(&self) {
        *self.revision.lock().expect("sampler revision") += 1;
        self.wake.notify_all();
    }
}

pub(super) struct Sampler {
    stopped: Arc<AtomicBool>,
    signal: Arc<Signal>,
    worker: Option<JoinHandle<()>>,
}

fn intervals(handle: &RuntimeHandle) -> [Duration; 3] {
    let Some(manifest) = handle.live.manifest() else {
        return [Duration::ZERO; 3];
    };
    let config = manifest.devtools.resources;
    [&config.cpu, &config.memory, &config.disk].map(|readout| {
        if config.enabled && readout.enabled {
            readout.poll_interval
        } else {
            Duration::ZERO
        }
    })
}

impl Sampler {
    pub fn start(handle: RuntimeHandle) -> Result<Self, String> {
        let stopped = Arc::new(AtomicBool::new(false));
        let signal = handle.live.events.resource_signal.clone();
        let worker_stop = stopped.clone();
        let worker_signal = signal.clone();
        let worker = thread::Builder::new()
            .name("devhost-resources".to_owned())
            .spawn(move || sample(&handle, &worker_stop, &worker_signal))
            .map_err(|error| error.to_string())?;
        Ok(Self {
            stopped,
            signal,
            worker: Some(worker),
        })
    }
}

fn sample(handle: &RuntimeHandle, stopped: &AtomicBool, signal: &Signal) {
    let mut selected = [Duration::ZERO; 3];
    let mut system = None;
    let mut next = [Instant::now(); 3];
    let mut values = [None, None, None];
    let mut failing = [false; 3];
    while !stopped.load(Ordering::Acquire) {
        // Read the revision first so a reload cannot be lost between the
        // configuration read and the condition-variable wait.
        let revision = *signal.revision.lock().expect("sampler revision");
        let current = intervals(handle);
        if current != selected {
            selected = current;
            values = [None, None, None];
            next = [Instant::now(); 3];
            failing = [false; 3];
            system = selected
                .iter()
                .any(|interval| !interval.is_zero())
                .then(System::new);
        }
        for index in 0..3 {
            if selected[index].is_zero() || Instant::now() < next[index] {
                continue;
            }
            next[index] = Instant::now() + selected[index];
            let result = read(index, system.as_mut().expect("enabled sampler"));
            if let Err(error) = &result
                && !failing[index]
            {
                let text = format!(
                    "Could not read {} usage: {error}",
                    ["cpu", "memory", "disk"][index]
                );
                if let Some(output) = handle.live.output() {
                    let label = handle
                        .live
                        .manifest()
                        .map(|m| m.name)
                        .unwrap_or_else(|| "devhost".to_owned());
                    let warning = crate::cliout::warning(output.mode(), &text);
                    output.log_stderr(&label, &warning);
                } else {
                    use std::io::Write;
                    let warning = crate::cliout::warning(cli_command_kit::Mode::from_env(), &text);
                    let _ = writeln!(std::io::stderr(), "{warning}");
                }
            }
            failing[index] = result.is_err();
            values[index] = result.ok();
        }
        let mut message = json!({});
        for (name, value) in ["cpu", "memory", "disk"].into_iter().zip(&values) {
            if let Some(value) = value {
                message[name] = value.clone();
            }
        }
        let reading = Reading {
            enabled: selected.iter().any(|interval| !interval.is_zero()),
            message: message.to_string(),
        };
        handle.live.events.resources.send_if_modified(|stored| {
            if *stored == reading {
                false
            } else {
                *stored = reading;
                true
            }
        });
        let delay = selected
            .iter()
            .zip(&next)
            .filter(|(interval, _)| !interval.is_zero())
            .map(|(_, next)| next.saturating_duration_since(Instant::now()))
            .min()
            .unwrap_or(Duration::from_secs(3600));
        let lock = signal.revision.lock().expect("sampler revision");
        if *lock == revision && !stopped.load(Ordering::Acquire) {
            let _ = signal.wake.wait_timeout(lock, delay).expect("sampler wait");
        }
    }
}

fn read(index: usize, system: &mut System) -> Result<Value, String> {
    match index {
        0 => {
            system.refresh_cpu_usage();
            if system.cpus().is_empty() {
                Err("CPU times are unavailable".to_owned())
            } else {
                Ok(json!({"percent":system.global_cpu_usage(),"cores":system.cpus().len()}))
            }
        }
        1 => {
            system.refresh_memory_specifics(MemoryRefreshKind::nothing().with_ram());
            space(system.used_memory(), system.total_memory())
        }
        _ => super::resource_disk::read(),
    }
}

impl Drop for Sampler {
    fn drop(&mut self) {
        self.stopped.store(true, Ordering::Release);
        self.signal.notify();
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

pub(super) fn space(used: u64, total: u64) -> Result<Value, String> {
    if total == 0 {
        return Err("filesystems or memory report no space".to_owned());
    }
    Ok(json!({"percent":used as f64 / total as f64 * 100.0,"usedBytes":used,"totalBytes":total}))
}

pub(super) async fn serve(
    State(handle): State<RuntimeHandle>,
    upgrade: WebSocketUpgrade,
    request: Request<Body>,
) -> Response {
    if let Err(error) = super::streams::websocket_guard(&handle, &request) {
        return super::server::diagnostic(StatusCode::FORBIDDEN, error);
    }
    if intervals(&handle).iter().all(Duration::is_zero) {
        return super::server::diagnostic(StatusCode::NOT_FOUND, "404 page not found");
    }
    upgrade.on_upgrade(move |mut socket| async move {
        let _activity = handle.activity.connection();
        let mut messages = handle.live.events.resources.subscribe();
        let mut stopping = handle.live.events.stopping.subscribe();
        if *stopping.borrow() { super::streams::closing(&mut socket).await; return; }
        // The route may be attached before the first host reading arrives.
        let initial = messages.borrow_and_update().message.clone();
        if !super::streams::send(&mut socket,Message::Text(if initial.is_empty() {"{}".into()} else {initial.into()})).await { return; }
        loop {
            tokio::select! {
                _ = stopping.changed() => { super::streams::closing(&mut socket).await; return; },
                incoming = socket.next() => if matches!(incoming,None|Some(Err(_))|Some(Ok(Message::Close(_)))) {return;},
                changed = messages.changed() => {
                    if changed.is_err() {return;}
                    let reading = messages.borrow_and_update().clone();
                    if !reading.enabled {
                        let _ = tokio::time::timeout(Duration::from_secs(1),socket.send(Message::Close(Some(CloseFrame {code:1000,reason:"resource readouts are turned off".into()})))).await; return;
                    }
                    if !super::streams::send(&mut socket,Message::Text(reading.message.into())).await {return;}
                }
            }
        }
    }).into_response()
}
