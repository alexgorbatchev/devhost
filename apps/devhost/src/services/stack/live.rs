//! Read models owned independently of the stack's serialized mutation loop.
use std::{collections::VecDeque, sync::RwLock};

use serde::{Deserialize, Serialize};

use super::*;

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StackSnapshot {
    pub name: String,
    pub starting: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub manifest_files: Vec<String>,
    pub services: Vec<ServiceInfo>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ServiceInfo {
    pub name: String,
    pub state: String,
    #[serde(skip)]
    pub(crate) restarting: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub primary: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub since: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub urls: Vec<String>,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub last_output: String,
}

#[derive(Clone)]
enum Phase {
    Starting,
    Restarting,
    Running,
    Failed(String),
}

#[derive(Clone)]
struct Process {
    exit: Arc<(Mutex<Option<i32>>, Condvar)>,
    exited_at: Arc<Mutex<String>>,
}

#[derive(Clone)]
struct ServiceState {
    phase: Phase,
    since: String,
    process: Option<Process>,
}

#[derive(Default, Clone)]
struct View {
    manifest: Option<ResolvedManifest>,
    starting: bool,
    services: BTreeMap<String, ServiceState>,
    repositories: Vec<crate::devtools::WorktreeRepository>,
    caddy_dir: PathBuf,
    control_port: u16,
    dev_source: Option<crate::devtools::dev_source::DevSourceCheckout>,
    config_path: Option<PathBuf>,
    config_inputs: Vec<PathBuf>,
    configuration: BTreeMap<String, serde_json::Value>,
}

pub(crate) struct Events {
    pub logs: tokio::sync::broadcast::Sender<LogEntry>,
    pub health: tokio::sync::watch::Sender<Option<String>>,
    pub health_lock: tokio::sync::Mutex<()>,
    pub stopping: tokio::sync::watch::Sender<bool>,
    pub cursor: tokio::sync::broadcast::Sender<String>,
    pub config_save: tokio::sync::Mutex<()>,
    pub resources: tokio::sync::watch::Sender<crate::devtools::resources::Reading>,
    pub resource_signal: Arc<crate::devtools::resources::Signal>,
}

impl Default for Events {
    fn default() -> Self {
        Self {
            logs: tokio::sync::broadcast::channel(512).0,
            health: tokio::sync::watch::channel(None).0,
            health_lock: tokio::sync::Mutex::new(()),
            stopping: tokio::sync::watch::channel(false).0,
            cursor: tokio::sync::broadcast::channel(64).0,
            config_save: tokio::sync::Mutex::new(()),
            resources: tokio::sync::watch::channel(crate::devtools::resources::Reading::default())
                .0,
            resource_signal: Arc::new(crate::devtools::resources::Signal::default()),
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LogEntry {
    pub id: u64,
    pub line: String,
    pub service_name: String,
    pub stream: String,
}

/// Short locks protect publication only. Health/network I/O uses a detached copy.
#[derive(Clone, Default)]
pub(crate) struct LiveState {
    view: Arc<RwLock<View>>,
    logs: Arc<Mutex<(u64, VecDeque<LogEntry>)>>,
    pub events: Arc<Events>,
}

impl LiveState {
    pub fn set_config_path(&self, path: Option<PathBuf>) {
        self.view.write().expect("live view").config_path = path;
    }

    pub fn set_config_inputs(&self, inputs: Vec<PathBuf>) {
        self.view.write().expect("live view").config_inputs = inputs;
    }

    pub fn caddy_dir(&self) -> PathBuf {
        self.view.read().expect("live view").caddy_dir.clone()
    }

    pub fn config_files(&self) -> Vec<(PathBuf, &'static str)> {
        let view = self.view.read().expect("live view");
        let mut files = Vec::new();
        if let Some(configuration) = view
            .manifest
            .as_ref()
            .and_then(|manifest| manifest.configuration.as_ref())
        {
            files.push((configuration.manifest_path.clone(), "manifest"));
            let inputs = if view.config_inputs.is_empty() {
                &configuration.inputs.files
            } else {
                &view.config_inputs
            };
            for path in inputs {
                if !files.iter().any(|(listed, _)| listed == path) {
                    files.push((path.clone(), "include"));
                }
            }
        }
        if let Some(path) = &view.config_path {
            files.push((path.clone(), "config"));
        }
        files
    }

    pub fn configuration(&self) -> Vec<serde_json::Value> {
        self.view
            .read()
            .expect("live view")
            .configuration
            .values()
            .cloned()
            .collect()
    }

    pub fn configuration_reloaded(&self, source: &str, error: &str) {
        let mut view = self.view.write().expect("live view");
        let previous = view
            .configuration
            .get(source)
            .and_then(|value| value["reloads"].as_u64())
            .unwrap_or(0);
        let mut value = serde_json::json!({"source":source, "reloads":previous + 1});
        if !error.is_empty() {
            value["error"] = serde_json::json!(error);
        }
        view.configuration.insert(source.to_owned(), value);
    }
    pub fn configure(
        &self,
        caddy_dir: &Path,
        dev_source: Option<crate::devtools::dev_source::DevSourceCheckout>,
    ) {
        let mut view = self.view.write().expect("live view");
        view.caddy_dir = caddy_dir.to_owned();
        view.dev_source = dev_source;
    }

    pub fn set_control_port(&self, port: u16) {
        self.view.write().expect("live view").control_port = port;
    }

    pub fn manifest(&self) -> Option<ResolvedManifest> {
        self.view.read().expect("live view").manifest.clone()
    }

    pub fn dev_source(&self) -> Option<crate::devtools::dev_source::DevSourceCheckout> {
        self.view.read().expect("live view").dev_source.clone()
    }

    pub fn owns_document_url(&self, port: u16, href: &str) -> Result<bool, String> {
        let view = self.view.read().expect("live view").clone();
        let Some(manifest) = view.manifest else {
            return Ok(false);
        };
        crate::caddy::devtools_origin::allows_devtools_url(
            &view.caddy_dir,
            &crate::caddy::devtools_origin::DevtoolsRouteOwner {
                manifest_path: manifest.manifest_path.display().to_string(),
                control_port: port,
                owner_pid: None,
            },
            href,
        )
    }

    pub fn control_port(&self) -> u16 {
        self.view.read().expect("live view").control_port
    }

    pub fn repositories_snapshot(&self) -> Vec<crate::devtools::WorktreeRepository> {
        self.view.read().expect("live view").repositories.clone()
    }

    pub fn recovery(&self, name: &str) -> crate::devtools::RecoveryState {
        let view = self.view.read().expect("live view").clone();
        let mut result = crate::devtools::RecoveryState {
            stack: view
                .manifest
                .as_ref()
                .map(|manifest| manifest.name.clone())
                .unwrap_or_default(),
            service: name.to_owned(),
            phase: "unavailable".to_owned(),
            title: format!("{name} is unavailable"),
            repositories: view.repositories.clone(),
            logs: self
                .logs()
                .into_iter()
                .filter(|entry| entry.service_name == name)
                .map(|entry| entry.line)
                .collect(),
            ..Default::default()
        };
        let Some(service) = view
            .manifest
            .as_ref()
            .and_then(|manifest| manifest.services.get(name))
        else {
            result.message = "This service is no longer configured.".to_owned();
            return result;
        };
        result.address = service
            .port
            .map(|port| format_proxy_address(&service.bind_host, port))
            .unwrap_or_default();
        let state = view.services.get(name);
        let starting = state
            .is_some_and(|state| matches!(state.phase, Phase::Starting | Phase::Restarting))
            || view.repositories.iter().any(|repo| {
                repo.switching && repo.service_names.iter().any(|member| member == name)
            });
        result.can_restart = !view.starting && is_managed_service(service) && !starting;
        let exit = state
            .and_then(|state| state.process.as_ref())
            .and_then(|process| *process.exit.0.lock().expect("exit state"));
        if starting {
            result.phase = "starting".to_owned();
            result.title = format!("Starting {name}");
            result.message = "Waiting for the service to pass its health check. This page will reload when it is ready.".to_owned();
        } else if let Some(Phase::Failed(error)) = state.map(|state| &state.phase) {
            result.title = format!("{name} could not start");
            result.message = error.clone();
        } else if let Some(code) = exit {
            result.title = format!("{name} exited");
            result.message = format!(
                "The process exited with code {code}. View its logs below and restart it when you are ready."
            );
        } else if (!is_managed_service(service)
            || uses_daemon_lifecycle(service)
            || state.is_some_and(|state| state.process.is_some()))
            && bounded_health(service)
        {
            result.phase = "ready".to_owned();
            result.title = format!("{name} is ready");
        } else {
            result.message = "The service is not responding. View its logs below and restart it when you are ready.".to_owned();
        }
        result
    }
    pub fn initialize(&self, manifest: &ResolvedManifest) {
        self.update_manifest(manifest);
        self.view.write().expect("live view").starting = true;
    }

    pub fn update_manifest(&self, manifest: &ResolvedManifest) {
        let mut view = self.view.write().expect("live view");
        view.services
            .retain(|name, _| manifest.services.contains_key(name));
        for name in manifest.services.keys() {
            view.services
                .entry(name.clone())
                .or_insert_with(|| ServiceState {
                    phase: Phase::Starting,
                    since: now(),
                    process: None,
                });
        }
        view.manifest = Some(manifest.clone());
        drop(view);
        self.events.resource_signal.notify();
    }

    pub fn finish_startup(&self) {
        self.view.write().expect("live view").starting = false;
    }

    pub fn starting(&self, name: &str, restarting: bool) {
        self.set_phase(
            name,
            if restarting {
                Phase::Restarting
            } else {
                Phase::Starting
            },
        );
    }

    pub fn ready(&self, name: &str) {
        // Keep launch time for ready services, matching the runtime process.
        if let Some(service) = self.view.write().expect("live view").services.get_mut(name) {
            service.phase = Phase::Running;
        }
    }

    pub fn failed(&self, name: &str, error: &str) {
        if let Some(service) = self.view.write().expect("live view").services.get_mut(name) {
            if matches!(&service.phase, Phase::Failed(previous) if previous == error) {
                return;
            }
            service.phase = Phase::Failed(error.to_owned());
            service.since = now();
        }
    }

    pub fn detach_process(&self, name: &str) {
        if let Some(service) = self.view.write().expect("live view").services.get_mut(name) {
            service.process = None;
        }
    }

    fn set_phase(&self, name: &str, phase: Phase) {
        if let Some(service) = self.view.write().expect("live view").services.get_mut(name) {
            if matches!(phase, Phase::Starting) && matches!(service.phase, Phase::Restarting) {
                return;
            }
            service.phase = phase;
            service.since = now();
            service.process = None;
        }
    }

    pub(super) fn process(&self, started: &StartedService) {
        if let Some(service) = self
            .view
            .write()
            .expect("live view")
            .services
            .get_mut(&started.service.name)
        {
            service.process = Some(Process {
                exit: started.exit_state.clone(),
                exited_at: started.exited_at.clone(),
            });
            service.since = started.started_at.clone();
        }
    }

    pub fn repositories(&self, repositories: Vec<crate::devtools::WorktreeRepository>) {
        self.view.write().expect("live view").repositories = repositories;
    }

    pub fn record_log(&self, name: &str, stream: &str, line: &str) {
        let mut logs = self.logs.lock().expect("service logs");
        logs.0 += 1;
        let id = logs.0;
        let entry = LogEntry {
            id,
            line: format!("[{name}] {line}"),
            service_name: name.to_owned(),
            stream: stream.to_owned(),
        };
        logs.1.push_back(entry.clone());
        let _ = self.events.logs.send(entry);
        while logs.1.len() > 512 {
            logs.1.pop_front();
        }
    }

    pub fn logs(&self) -> Vec<LogEntry> {
        self.logs
            .lock()
            .expect("service logs")
            .1
            .iter()
            .cloned()
            .collect()
    }

    pub fn subscribe_logs(&self) -> (Vec<LogEntry>, tokio::sync::broadcast::Receiver<LogEntry>) {
        let logs = self.logs.lock().expect("service logs");
        let receiver = self.events.logs.subscribe();
        (logs.1.iter().cloned().collect(), receiver)
    }

    fn last_output(&self, name: &str, fallback: &str) -> String {
        for entry in self
            .logs()
            .iter()
            .rev()
            .filter(|entry| entry.service_name == name)
        {
            let clean = strip_ansi(&entry.line);
            let clean = clean
                .strip_prefix(&format!("[{name}]"))
                .unwrap_or(&clean)
                .trim();
            if !clean.is_empty() {
                return clean.to_owned();
            }
        }
        strip_ansi(fallback).trim().to_owned()
    }

    pub fn snapshot(&self) -> Result<StackSnapshot, String> {
        let view = self.view.read().expect("live view").clone();
        let manifest = view
            .manifest
            .as_ref()
            .ok_or("Stack info is not available.")?;
        let mut result = StackSnapshot {
            name: manifest.name.clone(),
            starting: view.starting,
            manifest_files: crate::services::stack_info::ordered_manifest_files(
                &manifest.manifest_path,
                &stack_manifest_files(manifest.configuration.as_ref()),
            ),
            services: Vec::new(),
        };
        thread::scope(|scope| {
            let probes: Vec<_> = ordered_manifest_service_names(manifest)
                .into_iter()
                .map(|name| {
                    let service = &manifest.services[&name];
                    let state = view.services.get(&name);
                    let switching = view
                        .repositories
                        .iter()
                        .any(|repo| repo.switching && repo.service_names.contains(&name));
                    scope.spawn(move || {
                        let mut info = ServiceInfo {
                            name: name.clone(),
                            restarting: state
                                .is_some_and(|state| matches!(state.phase, Phase::Restarting)),
                            primary: name == manifest.primary_service,
                            port: service.port,
                            urls: read_service_urls(service, manifest.caddy.https_port),
                            since: state.map(|state| state.since.clone()).unwrap_or_default(),
                            ..Default::default()
                        };
                        let exit = state
                            .and_then(|state| state.process.as_ref())
                            .and_then(|process| *process.exit.0.lock().expect("exit state"));
                        info.state = if switching {
                            "starting"
                        } else {
                            match state.map(|state| &state.phase) {
                                Some(Phase::Starting | Phase::Restarting) => "starting",
                                phase => {
                                    if let Some(code) = exit {
                                        info.exit_code = Some(code);
                                        if let Some(process) =
                                            state.and_then(|state| state.process.as_ref())
                                        {
                                            let exited_at = process
                                                .exited_at
                                                .lock()
                                                .expect("exit time")
                                                .clone();
                                            if !exited_at.is_empty() {
                                                info.since = exited_at;
                                            }
                                        }
                                        info.last_output = self.last_output(&name, "");
                                        "exited"
                                    } else if let Some(Phase::Failed(error)) = phase {
                                        info.last_output = self.last_output(&name, error);
                                        "failed"
                                    } else if (!is_managed_service(service)
                                        || uses_daemon_lifecycle(service)
                                        || state.is_some_and(|state| state.process.is_some()))
                                        && bounded_health(service)
                                    {
                                        "ready"
                                    } else {
                                        "unhealthy"
                                    }
                                }
                            }
                        }
                        .to_owned();
                        info
                    })
                })
                .collect();
            for probe in probes {
                result.services.push(probe.join().expect("snapshot probe"));
            }
        });
        for name in stopped_service_names(manifest) {
            result.services.push(ServiceInfo {
                primary: name == manifest.primary_service,
                port: manifest.stopped[&name].port,
                name,
                state: "not-started".to_owned(),
                ..Default::default()
            });
        }
        Ok(result)
    }
}

fn bounded_health(service: &ResolvedService) -> bool {
    let mut health = service.health.clone();
    health.interval_ms = 1000;
    super::super::health::check_service_health(&health)
}

pub(crate) fn now() -> String {
    let raw = crate::caddy::routes::utc_timestamp();
    crate::services::stack_info::normalize_timestamp(&raw)
}

pub(crate) fn strip_ansi(value: &str) -> String {
    struct Text(String);
    impl anstyle_parse::Perform for Text {
        fn print(&mut self, character: char) {
            self.0.push(character);
        }
        fn execute(&mut self, byte: u8) {
            if matches!(byte, b'\t' | b'\n' | b'\r') {
                self.0.push(char::from(byte));
            }
        }
    }
    let mut text = Text(String::new());
    let mut parser: anstyle_parse::Parser = Default::default();
    for byte in value.bytes() {
        parser.advance(&mut text, byte);
    }
    text.0
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest(root: &Path) -> ResolvedManifest {
        fs::write(root.join("devhost.toml"), "name='live'\n[services.web]\ncommand=['sleep','30']\nhealth.process=true\n[services.optional]\ncommand=['sleep','30']\nhealth.process=true\n").unwrap();
        let config = crate::manifest::read_manifest(root, None).unwrap();
        super::super::super::resolve::resolve_service_ports(
            &config,
            &super::super::super::resolve::PortResolutionOptions {
                requested: vec!["web".to_owned()],
                ..Default::default()
            },
        )
        .unwrap()
    }

    #[test]
    fn snapshot_tracks_startup_restart_failure_and_unexpected_exit() {
        let root = tempfile::tempdir().unwrap();
        let manifest = manifest(root.path());
        let live = LiveState::default();
        assert!(live.snapshot().is_err());
        live.initialize(&manifest);
        let snapshot = live.snapshot().unwrap();
        assert!(snapshot.starting);
        assert_eq!(snapshot.services[0].state, "starting");
        assert!(snapshot.services[0].primary);
        assert_eq!(snapshot.services[1].state, "not-started");
        live.starting("web", true);
        let restarting = live.snapshot().unwrap();
        assert_eq!(restarting.services[0].state, "starting");
        assert!(restarting.services[0].restarting);
        live.starting("web", false);
        let starting = live.snapshot().unwrap();
        assert_eq!(starting.services[0].state, "starting");
        assert!(starting.services[0].restarting);
        assert!(
            !serde_json::to_value(&starting).unwrap()["services"][0]
                .as_object()
                .unwrap()
                .contains_key("restarting")
        );
        live.ready("web");
        assert_eq!(live.snapshot().unwrap().services[0].state, "unhealthy");
        live.failed("web", "health failed");
        let failed = live.snapshot().unwrap();
        assert_eq!(failed.services[0].state, "failed");
        assert_eq!(failed.services[0].last_output, "health failed");
        live.failed("web", "health failed");
        assert_eq!(live.snapshot().unwrap(), failed);
        live.record_log("web", "stderr", "\x1b[31mactual error\x1b[0m");
        live.record_log("web", "stdout", "   ");
        live.record_log("other", "stdout", "unrelated");
        live.view
            .write()
            .unwrap()
            .services
            .get_mut("web")
            .unwrap()
            .process = Some(Process {
            exit: Arc::new((Mutex::new(Some(42)), Condvar::new())),
            exited_at: Arc::new(Mutex::new("2026-11-23T00:00:00Z".to_owned())),
        });
        live.finish_startup();
        let snapshot = live.snapshot().unwrap();
        assert!(!snapshot.starting);
        assert_eq!(snapshot.services[0].state, "exited");
        assert_eq!(snapshot.services[0].exit_code, Some(42));
        assert_eq!(snapshot.services[0].since, "2026-11-23T00:00:00Z");
        assert_eq!(snapshot.services[0].last_output, "actual error");
        live.detach_process("web");
        assert_eq!(live.snapshot().unwrap().services[0].state, "failed");
    }

    #[test]
    fn log_retention_keeps_order_stream_and_printable_unicode() {
        let live = LiveState::default();
        for index in 0..520 {
            live.record_log("web", "stderr", &format!("line {index}"));
        }
        let logs = live.logs();
        assert_eq!(logs.len(), 512);
        assert_eq!(logs[0].id, 9);
        assert_eq!(logs[511].line, "[web] line 519");
        assert_eq!(logs[511].stream, "stderr");
        assert_eq!(
            strip_ansi("\x1b]0;title\x07\x1b[31mλ 🦀\x1b[0m\t\n"),
            "λ 🦀\t\n"
        );
    }

    #[test]
    fn recovery_reports_current_lifecycle_logs_and_repository_switches() {
        let root = tempfile::tempdir().unwrap();
        let mut manifest = manifest(root.path());
        let live = LiveState::default();
        assert!(!live.owns_document_url(1234, "http://localhost").unwrap());
        assert!(
            live.recovery("web")
                .message
                .contains("no longer configured")
        );
        live.initialize(&manifest);
        live.record_log("web", "stderr", "startup error");
        live.record_log("other", "stdout", "unrelated");
        let starting = live.recovery("web");
        assert_eq!(starting.phase, "starting");
        assert!(!starting.can_restart);
        assert_eq!(starting.logs, ["[web] startup error"]);
        live.finish_startup();
        live.failed("web", "cannot start");
        let failed = live.recovery("web");
        assert_eq!(failed.title, "web could not start");
        assert_eq!(failed.message, "cannot start");
        assert!(failed.can_restart);
        live.ready("web");
        assert!(live.recovery("web").message.contains("not responding"));
        live.view
            .write()
            .unwrap()
            .services
            .get_mut("web")
            .unwrap()
            .process = Some(Process {
            exit: Arc::new((Mutex::new(Some(42)), Condvar::new())),
            exited_at: Arc::new(Mutex::new(now())),
        });
        assert!(live.recovery("web").message.contains("code 42"));
        live.view
            .write()
            .unwrap()
            .services
            .get_mut("web")
            .unwrap()
            .process
            .as_ref()
            .unwrap()
            .exit
            .0
            .lock()
            .unwrap()
            .take();
        assert_eq!(live.recovery("web").phase, "ready");
        live.repositories(vec![crate::devtools::WorktreeRepository {
            switching: true,
            service_names: vec!["web".to_owned()],
            ..Default::default()
        }]);
        let switching = live.recovery("web");
        assert_eq!(switching.phase, "starting");
        assert!(!switching.can_restart);
        live.repositories(Vec::new());
        let include = root.path().join("extra.toml");
        fs::write(&include, "").unwrap();
        live.set_config_inputs(vec![include.clone(), include.clone()]);
        assert_eq!(
            live.config_files(),
            [
                (manifest.manifest_path.clone(), "manifest"),
                (include, "include")
            ]
        );
        manifest.services.remove("web");
        live.update_manifest(&manifest);
        assert!(
            live.recovery("web")
                .message
                .contains("no longer configured")
        );
    }

    #[test]
    fn health_io_does_not_hold_the_publication_lock() {
        use std::net::TcpListener;
        let root = tempfile::tempdir().unwrap();
        let mut manifest = manifest(root.path());
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let service = manifest.services.get_mut("web").unwrap();
        service.command.clear();
        service.managed = false;
        service.health.kind = crate::services::resolve::HealthKind::Http;
        service.health.url = Some(format!(
            "http://127.0.0.1:{}/",
            listener.local_addr().unwrap().port()
        ));
        service.health.interval_ms = 30_000;
        let live = LiveState::default();
        live.initialize(&manifest);
        live.ready("web");
        let probe = live.clone();
        let started = std::time::Instant::now();
        let worker = thread::spawn(move || probe.snapshot().unwrap());
        let (_connection, _) = listener.accept().unwrap();
        live.starting("web", true);
        assert!(started.elapsed() < Duration::from_millis(500));
        let restarting = live.snapshot().unwrap();
        assert_eq!(restarting.services[0].state, "starting");
        assert!(restarting.services[0].restarting);
        assert_eq!(worker.join().unwrap().services[0].state, "unhealthy");
        assert!(started.elapsed() < Duration::from_secs(2));
    }
}
