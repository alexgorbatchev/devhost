use super::*;
use crate::manifest::{self, Inputs};
use crate::services::{
    control::{RuntimeControl, RuntimeRequest, WorktreeOperation},
    detach::format_go_duration,
    watch::{InputWatch, ServiceWatches},
    worktrees::Worktrees,
};

/// Owns mutation of the accepted stack. Watch callbacks only enqueue events;
/// startup, restart, reload, rollback and shutdown never mutate it concurrently.
pub(super) struct Runtime<'a> {
    pub manifest: &'a mut ResolvedManifest,
    pub options: &'a StartStackOptions,
    pub environment: &'a BTreeMap<String, String>,
    pub launch: &'a LaunchMetadata,
    pub cancel: &'a AtomicBool,
    pub grace_period: Duration,
    pub exit_tx: &'a Sender<ServiceExitResult>,
    pub exit_rx: &'a Receiver<ServiceExitResult>,
    pub started: &'a mut Vec<StartedService>,
    pub daemons: &'a mut Vec<ResolvedService>,
    pub daemon_output: &'a DaemonOutput,
    pub hosts: &'a mut Vec<String>,
    pub ports: &'a mut Vec<(String, u16)>,
    pub routes: &'a mut Vec<ActivateRouteOptions>,
    pub remote_lease: &'a mut Option<crate::remote::Lease>,
    pub progress: &'a mut ShutdownProgress,
    pub control: RuntimeControl,
    pub control_port: u16,
    pub documents: &'a mut documents::Documents,
    pub watches: ServiceWatches,
    pub manifest_watch: Option<InputWatch>,
    pub worktrees: Option<Worktrees>,
    pub blocked: BTreeMap<String, String>,
}

struct AcceptedChange {
    cleanup: Result<(), String>,
}

impl Runtime<'_> {
    pub fn run(mut self, mut shared: MachineConfig) -> Result<i32, StartStackError> {
        let mut discovery = self
            .options
            .command_serve_timeout
            .map(|_| super::command::Discovery::default());
        if let (Some(discovery), Some(timeout)) =
            (&mut discovery, self.options.command_serve_timeout)
            && let Some(code) = self.wait_for_command_routes(discovery, timeout)?
        {
            return Ok(code);
        }
        let mut next_discovery = Instant::now() + Duration::from_millis(500);
        let config_path = self
            .options
            .config_path
            .clone()
            .or_else(|| config::path().ok());
        let mut config_watch = if self.options.serve_session {
            None
        } else {
            config_path
                .as_ref()
                .map(|path| {
                    InputWatch::new(Inputs {
                        files: vec![path.clone()],
                        patterns: Vec::new(),
                    })
                })
                .transpose()?
        };
        if let Some(watch) = &mut config_watch {
            watch.check();
        }
        let log_path = self.options.caddy_dir.join("logs").join(format!(
            "{}_access.log",
            stack_access_log_name(self.manifest)
        ));
        let mut idle = IdleWatch::new(log_path, self.control.activity.clone());
        idle.set(self.idle_timeout(), self.manifest, &self.options.output);
        let mut last_manifest_error = String::new();
        let mut last_config_error = String::new();
        loop {
            while let Ok(result) = self.exit_rx.try_recv() {
                if self.started.iter().any(|started| {
                    started.service.name == result.service_name
                        && Arc::ptr_eq(&started.exit_state, &result.exit_state)
                }) {
                    self.log(&format!(
                        "{} exited with code {}; devhost is waiting for a restart.",
                        result.service_name, result.exit_code
                    ));
                }
            }
            if let Some(sig) = check_termination_signal(
                self.cancel,
                self.options.install_signal_handlers,
                &self.options.output,
                &self.manifest.name,
            ) {
                self.signal(sig);
                return Ok(SIGNAL_EXIT_CODE_BASE + sig);
            }
            if self.cancel.load(Ordering::Relaxed) {
                self.signal(libc::SIGTERM);
                return Ok(0);
            }
            self.watches.poll(&self.manifest.name);
            if let Some(discovery) = &mut discovery
                && Instant::now() >= next_discovery
            {
                self.refresh_command_routes(discovery, true, None)?;
                next_discovery = Instant::now() + Duration::from_millis(500);
            }
            while let Ok(request) = self.control.requests.try_recv() {
                match request {
                    RuntimeRequest::CheckConfig {
                        path,
                        content,
                        result,
                    } => {
                        let outcome = self.check_config(&path, &content);
                        self.publish_live();
                        let _ = result.send(outcome);
                    }
                    RuntimeRequest::Start { names, result } => {
                        let outcome = self.start_services(&names);
                        self.publish_live();
                        let _ = result.send(outcome);
                    }
                    RuntimeRequest::RestartStack { result } => {
                        let outcome = self.restart_stack();
                        self.publish_live();
                        let _ = result.send(outcome);
                    }
                    RuntimeRequest::Restart { names, result } => {
                        let outcome = self.restart(&names);
                        self.publish_live();
                        let _ = result.send(outcome);
                    }
                    RuntimeRequest::Worktrees { operation, result } => {
                        let outcome = self.worktree_operation(operation);
                        self.publish_live();
                        let _ = result.send(outcome);
                    }
                }
                if self.cancel.load(Ordering::Relaxed) {
                    break;
                }
            }
            if let Some(watch) = &mut self.manifest_watch {
                let result = match watch.poll() {
                    Ok(false) => None,
                    Ok(true) => Some(self.reload_disk()),
                    Err(error) => Some(Err(error)),
                };
                if let Some(result) = result {
                    let error = result.err().unwrap_or_default();
                    if !error.is_empty() && error != last_manifest_error {
                        self.log(&format!("configuration reload rejected: {error}"));
                    }
                    last_manifest_error = error;
                    self.control
                        .live
                        .configuration_reloaded("manifest", &last_manifest_error);
                    if let Some(watch) = &self.manifest_watch {
                        self.control
                            .live
                            .set_config_inputs(watch.inputs.files.clone());
                    }
                    self.publish_live();
                    idle.set(self.idle_timeout(), self.manifest, &self.options.output);
                }
            }
            if let (Some(watch), Some(path)) = (&mut config_watch, &config_path) {
                let result = match watch.poll() {
                    Ok(false) => None,
                    Ok(true) => Some(
                        watch
                            .update(Inputs {
                                files: vec![path.clone()],
                                patterns: Vec::new(),
                            })
                            .and_then(|_| self.reload_shared(path, &mut shared)),
                    ),
                    Err(error) => Some(Err(error)),
                };
                if let Some(result) = result {
                    let error = result.err().unwrap_or_default();
                    if !error.is_empty() && error != last_config_error {
                        self.log(&format!("shared Caddy settings rejected: {error}"));
                    }
                    last_config_error = error;
                    self.control
                        .live
                        .configuration_reloaded("config", &last_config_error);
                    self.publish_live();
                }
            }
            if let Some(timeout) = idle.expired() {
                self.log(&format!(
                    "Idle timeout of {} reached. Automatically shutting down the stack...",
                    format_go_duration(timeout)
                ));
                self.signal(libc::SIGTERM);
                return Ok(0);
            }
            thread::sleep(Duration::from_millis(10));
        }
    }

    fn log(&self, message: &str) {
        self.options.output.log_stdout(&self.manifest.name, message);
    }

    fn check_config(&self, path: &Path, content: &str) -> Result<(), String> {
        if self
            .options
            .config_path
            .clone()
            .or_else(|| config::path().ok())
            .as_deref()
            == Some(path)
        {
            let shared = config::parse(path, content)?;
            return self.check_routing_settings(&shared);
        }
        let configuration = self
            .manifest
            .configuration
            .as_ref()
            .ok_or("the stack runs without a manifest")?;
        let next = manifest::read_with_override(&configuration.manifest_path, path, content)
            .map_err(|error| error.message)?;
        super::super::resolve::resolve_service_order(&next)?;
        super::super::resolve::validate_requested_services(&next, &self.manifest.requested)?;
        let candidate = resolve_service_ports(
            &next,
            &PortResolutionOptions {
                requested: self.manifest.requested.clone(),
                preserved: self
                    .manifest
                    .services
                    .iter()
                    .filter_map(|(name, service)| service.port.map(|port| (name.clone(), port)))
                    .collect(),
                domain_suffix: self.manifest.domain_suffix.clone(),
                remote_mode: self.manifest.remote.is_some(),
                remote: self.manifest.remote.clone(),
                ..Default::default()
            },
        )?;
        for service in candidate
            .services
            .values()
            .filter(|service| is_managed_service(service))
        {
            validate_service_working_directory(service)?;
        }
        Ok(())
    }

    pub(super) fn publish_live(&self) {
        self.control.live.update_manifest(self.manifest);
        if let Some(watch) = &self.manifest_watch {
            self.control
                .live
                .set_config_inputs(watch.inputs.files.clone());
        }
        for (name, error) in &self.blocked {
            self.control.live.failed(name, error);
        }
        self.control.live.repositories(
            self.worktrees
                .as_ref()
                .map(Worktrees::snapshot)
                .unwrap_or_default(),
        );
    }

    pub(super) fn signal(&mut self, signal: i32) {
        for started in self.started.iter_mut() {
            self.progress.stopping(&started.service.name);
            started.signal(signal);
        }
    }

    fn idle_timeout(&self) -> Duration {
        self.options
            .idle_timeout
            .filter(|timeout| !timeout.is_zero())
            .or_else(|| manifest::parse_idle_duration(&self.manifest.devtools.idle_timeout).ok())
            .unwrap_or_default()
    }

    fn restart(&mut self, names: &[String]) -> Result<(), String> {
        for name in names {
            let Some(service) = self.manifest.services.get(name) else {
                return Err(if self.manifest.stopped.contains_key(name) {
                    format!("service {name} is not started")
                } else {
                    format!("unknown service: {name}")
                });
            };
            if !is_managed_service(service) {
                return Err(format!(
                    "service {name} is unmanaged and cannot be restarted by devhost"
                ));
            }
        }
        let names: BTreeSet<_> = names.iter().cloned().collect();
        let order = self.order()?;
        for name in order.iter().filter(|name| names.contains(*name)) {
            if let Some(repository) = self
                .worktrees
                .as_ref()
                .map(Worktrees::snapshot)
                .unwrap_or_default()
                .into_iter()
                .find(|repository| {
                    !repository.error.is_empty() && repository.service_names.contains(name)
                })
            {
                let group: Vec<_> = order
                    .iter()
                    .filter(|member| repository.service_names.contains(member))
                    .cloned()
                    .collect();
                return self.recover_worktree(&group);
            }
            self.log(&format!("restarting service: {name}"));
            self.control.live.starting(name, true);
            self.watches.clear_dirty(name);
            self.stop_group(std::slice::from_ref(name))?;
            self.start_group(std::slice::from_ref(name), PortReassignment::Preserve)?;
            if let Err(error) = self.replace_routes() {
                return Err(join_errors(
                    error,
                    self.stop_group(std::slice::from_ref(name)),
                ));
            }
        }
        Ok(())
    }

    fn start_services(&mut self, names: &[String]) -> Result<(), String> {
        for name in names {
            if self.manifest.services.contains_key(name) {
                return Err(format!("service {name} is already started"));
            }
            if !self.manifest.stopped.contains_key(name) {
                return Err(format!("unknown service: {name}"));
            }
        }
        let configuration = self
            .manifest
            .configuration
            .clone()
            .ok_or("starting a service requires an accepted manifest")?;
        let mut requested = self.manifest.requested.clone();
        requested.extend_from_slice(names);
        self.apply(
            configuration,
            self.manifest.domain_suffix.clone(),
            self.manifest.caddy.clone(),
            &format!("started services: {}", names.join(", ")),
            Change::Start(requested),
        )?
        .cleanup
    }

    fn restart_stack(&mut self) -> Result<(), String> {
        let configuration = self
            .manifest
            .configuration
            .clone()
            .ok_or("stack restart requires an accepted manifest")?;
        if let Some((name, reason)) = self.blocked.iter().next() {
            return Err(format!(
                "cannot restart stack: service {name} is stopped: {reason}; select an available worktree first"
            ));
        }
        self.apply(
            configuration,
            self.manifest.domain_suffix.clone(),
            self.manifest.caddy.clone(),
            "stack restarted with new automatic ports",
            Change::RestartStack,
        )?
        .cleanup
    }

    fn recover_worktree(&mut self, names: &[String]) -> Result<(), String> {
        for name in names {
            self.watches.clear_dirty(name);
        }
        let result = self.stop_group(names).and_then(|_| {
            for name in names {
                self.blocked.remove(name);
            }
            self.start_group(names, PortReassignment::Preserve)?;
            self.replace_routes()?;
            self.update_remote()
        });
        let result = result.map_err(|error| join_errors(error, self.stop_group(names)));
        for name in names {
            match &result {
                Ok(()) => {
                    self.blocked.remove(name);
                }
                Err(error) => {
                    self.blocked.insert(name.clone(), error.clone());
                }
            }
        }
        self.worktrees
            .as_mut()
            .expect("repository recovery")
            .finish(&self.blocked);
        result
    }

    fn worktree_operation(
        &mut self,
        operation: WorktreeOperation,
    ) -> Result<Vec<crate::devtools::WorktreeRepository>, String> {
        if self.worktrees.is_none() {
            return Err("Worktrees are disabled.".to_owned());
        }
        match operation {
            WorktreeOperation::Refresh => self.refresh_worktrees()?,
            WorktreeOperation::Switch {
                repository_id,
                path,
            } => self.switch_worktree(&repository_id, &path)?,
            WorktreeOperation::StopOwner {
                repository_id,
                path,
                owner_id,
            } => {
                let owner = self
                    .worktrees
                    .as_mut()
                    .expect("enabled worktrees")
                    .occupant(&repository_id, &path, &owner_id)?;
                if self.cancel.load(Ordering::Relaxed) {
                    return Err("worktree operation canceled".to_owned());
                }
                caddy::stacks::signal_stack_owner(&self.options.caddy_dir, &owner, libc::SIGTERM)?;
                let mut deadline = Instant::now() + SHUTDOWN_GRACE_PERIOD;
                let mut forced = false;
                while owner.is_alive() {
                    if self.cancel.load(Ordering::Relaxed) {
                        return Err("worktree operation canceled".to_owned());
                    }
                    if Instant::now() >= deadline {
                        if forced {
                            return Err("stack did not exit after being force-stopped".to_owned());
                        }
                        caddy::stacks::signal_stack_owner(
                            &self.options.caddy_dir,
                            &owner,
                            libc::SIGKILL,
                        )?;
                        forced = true;
                        deadline = Instant::now() + Duration::from_secs(1);
                    }
                    thread::sleep(Duration::from_millis(100));
                }
                self.worktrees
                    .as_mut()
                    .expect("enabled worktrees")
                    .refresh()?;
            }
        }
        Ok(self
            .worktrees
            .as_ref()
            .map(Worktrees::snapshot)
            .unwrap_or_default())
    }

    /// Reconciles checkout availability with the running groups.
    /// Stops a repository's services only when the checkout they run is gone:
    /// deleted, no longer registered with Git, or part of another repository.
    /// A problem in that checkout's manifest belongs to hot reload, which keeps
    /// the accepted manifest running.
    fn refresh_worktrees(&mut self) -> Result<(), String> {
        let worktrees = self.worktrees.as_mut().expect("enabled worktrees");
        worktrees.refresh()?;
        let repositories = worktrees.snapshot();
        let mut errors = Vec::new();
        for repository in repositories {
            if repository.running_path.is_empty()
                || repository
                    .worktrees
                    .iter()
                    .any(|entry| entry.path == repository.selected_path && entry.available)
            {
                continue;
            }
            let error = format!(
                "Selected checkout {} is unavailable; choose a checkout to recover repository {}.",
                repository.selected_path, repository.name
            );
            let names: Vec<_> = self
                .order()?
                .into_iter()
                .filter(|name| repository.service_names.contains(name))
                .collect();
            for name in &names {
                self.watches.clear_dirty(name);
            }
            let error = match self.stop_group(&names) {
                Ok(()) => error,
                Err(cleanup) => {
                    errors.push(cleanup.clone());
                    format!("{error}\n{cleanup}")
                }
            };
            for name in names {
                self.blocked.insert(name, error.clone());
            }
            self.log(&error);
        }
        self.worktrees
            .as_mut()
            .expect("enabled worktrees")
            .finish(&self.blocked);
        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors.join("\n"))
        }
    }

    fn switch_worktree(&mut self, id: &str, path: &Path) -> Result<(), String> {
        let previous = self
            .worktrees
            .as_ref()
            .ok_or("Worktrees are disabled.")?
            .clone();
        let saved = previous.saved()?;
        let old_path = previous
            .snapshot()
            .into_iter()
            .find(|repository| repository.id == id)
            .map(|repository| repository.selected_path)
            .unwrap_or_default();
        let transition = format!(
            "{} -> {}",
            Path::new(&old_path)
                .file_name()
                .unwrap_or_default()
                .to_string_lossy(),
            path.file_name().unwrap_or_default().to_string_lossy()
        );
        let result = (|| {
            let worktrees = self.worktrees.as_mut().expect("enabled worktrees");
            let configuration = worktrees.prepare(id, path)?;
            worktrees.select(id, path)?;
            self.publish_live();
            self.log(&format!(
                "Switching worktree: {transition}. Restarting stack."
            ));
            self.apply(
                configuration,
                self.manifest.domain_suffix.clone(),
                self.manifest.caddy.clone(),
                &format!("worktree switched: {transition}"),
                Change::Switch,
            )
        })();
        if let Err(error) = result {
            let error = join_errors(error, previous.restore_saved(saved.as_ref()));
            self.worktrees = Some(previous);
            self.worktrees
                .as_mut()
                .expect("restored worktrees")
                .finish(&self.blocked);
            self.log(&format!("Worktree switch failed: {transition}: {error}"));
            return Err(error);
        }
        result.expect("accepted worktree change").cleanup
    }

    fn order(&self) -> Result<Vec<String>, String> {
        match &self.manifest.configuration {
            Some(configuration) => super::super::resolve::resolve_service_order(configuration),
            None => Ok(self.manifest.service_order.clone()),
        }
    }

    fn reload_disk(&mut self) -> Result<(), String> {
        let path = self
            .manifest
            .configuration
            .as_ref()
            .map(|configuration| &configuration.manifest_path)
            .unwrap_or(&self.manifest.manifest_path);
        let (candidate, mut inputs) = manifest::read_with_inputs(path);
        let watch = self
            .manifest_watch
            .as_mut()
            .expect("manifest watcher owns disk reload");
        if candidate.is_err() {
            inputs.files.extend(watch.inputs.files.iter().cloned());
            inputs
                .patterns
                .extend(watch.inputs.patterns.iter().cloned());
            inputs.files.sort();
            inputs.files.dedup();
            inputs.patterns.sort();
            inputs.patterns.dedup();
        }
        watch.update(inputs)?;
        let candidate = candidate.map_err(|error| error.message)?;
        if !candidate.worktrees.enabled
            && let Some(repository) = self
                .worktrees
                .as_ref()
                .map(Worktrees::snapshot)
                .unwrap_or_default()
                .into_iter()
                .find(|repository| repository.selected_path != repository.configured_path)
        {
            return self.switch_worktree(&repository.id, Path::new(&repository.configured_path));
        }
        let names = candidate
            .inputs
            .files
            .iter()
            .map(|path| {
                path.strip_prefix(&self.manifest.manifest_directory)
                    .unwrap_or(path)
                    .display()
                    .to_string()
            })
            .collect::<Vec<_>>()
            .join(", ");
        self.apply(
            candidate,
            self.manifest.domain_suffix.clone(),
            self.manifest.caddy.clone(),
            &format!("configuration reloaded: {names}"),
            Change::Reload,
        )?
        .cleanup
    }

    fn reload_shared(&mut self, path: &Path, shared: &mut MachineConfig) -> Result<(), String> {
        let next = config::read_from(path)?;
        self.check_routing_settings(&next)?;
        self.apply_shared(path, shared, next)
    }

    fn check_routing_settings(&self, next: &MachineConfig) -> Result<(), String> {
        if self.manifest.remote.is_some() && self.manifest.remote != next.remote {
            return Err("remote settings changed while this stack is running; stop all remote stacks, then start them again to apply the new settings".to_owned());
        }
        if self.manifest.remote.is_none()
            && !self.manifest.domain_suffix.is_empty()
            && self.manifest.domain_suffix != next.domain_suffix
        {
            return Err("local domainSuffix changed while this stack is running; stop this stack, then start it again to apply the new suffix".to_owned());
        }
        Ok(())
    }

    fn apply_shared(
        &mut self,
        path: &Path,
        shared: &mut MachineConfig,
        next: MachineConfig,
    ) -> Result<(), String> {
        routes::apply_managed_settings(
            &self.options.caddy_dir,
            &next.caddy,
            self.options.output.mode(),
            &mut self.options.output.caddy_stderr_writer(),
            !self.options.debug_caddy,
        )
        .map_err(|error| format!("apply the devhost config file {}: {error}", path.display()))?;
        let changed = self.manifest.caddy != next.caddy;
        let previous = self.manifest.caddy.clone();
        self.manifest.caddy = next.caddy.clone();
        if let Err(error) = self.update_remote() {
            self.manifest.caddy = previous;
            let restore = routes::apply_managed_settings(
                &self.options.caddy_dir,
                &self.manifest.caddy,
                self.options.output.mode(),
                &mut self.options.output.caddy_stderr_writer(),
                !self.options.debug_caddy,
            );
            return Err(join_errors(error, restore.map(|_| ())));
        }
        *shared = next;
        if !changed {
            return Ok(());
        }
        if self.launch.detached || self.manifest.remote.is_some() {
            caddy::stacks::set_stack_ready(
                &self.options.caddy_dir,
                collect_manifest_service_urls(self.manifest),
            )?;
        }
        self.log(&format!(
            "Applied the shared Caddy settings from {}.",
            path.display()
        ));
        log_service_urls(self.manifest, &self.options.output);
        Ok(())
    }

    fn apply(
        &mut self,
        configuration: Manifest,
        suffix: String,
        settings: config::CaddySettings,
        message: &str,
        change: Change,
    ) -> Result<AcceptedChange, String> {
        if self.cancel.load(Ordering::Relaxed) {
            return Err("configuration reload canceled".to_owned());
        }
        if change == Change::Reload
            && self.manifest.configuration.as_ref() == Some(&configuration)
            && self.manifest.domain_suffix == suffix
            && self.manifest.caddy == settings
        {
            return Ok(AcceptedChange { cleanup: Ok(()) });
        }
        let previous = self.manifest.clone();
        let requested = match &change {
            Change::Start(names) => names.clone(),
            _ => previous.requested.clone(),
        };
        let previous_blocked = self.blocked.clone();
        let previous_inputs = self
            .manifest_watch
            .as_ref()
            .map(|watch| watch.inputs.clone());
        let previous_order = self.order()?;
        super::super::resolve::resolve_service_order(&configuration)?;
        super::super::resolve::validate_requested_services(&configuration, &requested)?;
        let mut preserved = BTreeMap::new();
        for (name, service) in &configuration.services {
            if matches!(change, Change::Switch | Change::RestartStack) {
                break;
            }
            if !service.port.is_some_and(|port| port.auto) {
                continue;
            }
            let Some(old) = previous
                .services
                .get(name)
                .or_else(|| previous.stopped.get(name))
            else {
                continue;
            };
            if old.port_source != "auto" || old.bind_host != service.bind_host {
                continue;
            }
            if let Some(port) = old.port
                && !configuration.services.values().any(|other| {
                    other.bind_host == service.bind_host
                        && other
                            .port
                            .is_some_and(|fixed| !fixed.auto && fixed.number == port)
                })
            {
                preserved.insert(name.clone(), port);
            }
        }
        let mut candidate = resolve_service_ports(
            &configuration,
            &PortResolutionOptions {
                requested,
                preserved,
                domain_suffix: suffix,
                remote_mode: previous.remote.is_some(),
                remote: previous.remote.clone(),
                ..Default::default()
            },
        )?;
        candidate.caddy = settings;
        candidate.manifest_path = previous.manifest_path.clone();
        let state = self
            .options
            .caddy_dir
            .parent()
            .ok_or("Caddy state directory requires a parent")?
            .to_owned();
        let mut next_worktrees = Worktrees::build(&candidate, &state, self.worktrees.as_ref())?;
        for service in candidate
            .services
            .values()
            .filter(|service| is_managed_service(service))
        {
            validate_service_working_directory(service)?;
        }
        let mut affected = affected_services(&previous, &candidate);
        if change == Change::Switch {
            affected.extend(
                previous
                    .services
                    .keys()
                    .chain(candidate.services.keys())
                    .cloned(),
            );
        }
        if change == Change::RestartStack {
            affected.extend(
                candidate
                    .services
                    .iter()
                    .filter(|(_, service)| is_managed_service(service))
                    .map(|(name, _)| name.clone()),
            );
        }
        loop {
            let before = affected.len();
            for worktrees in self.worktrees.iter().chain(next_worktrees.iter()) {
                worktrees.expand_affected(&mut affected, &previous);
            }
            expand_dependents(&previous, &candidate, &mut affected);
            if before == affected.len() {
                break;
            }
        }
        let old_names: Vec<_> = previous_order
            .into_iter()
            .filter(|name| affected.contains(name))
            .collect();
        let old_hosts = self.hosts.clone();
        let old_ports = self.ports.clone();
        let reserve = self.reserve(&configuration, &candidate);
        if let Err(error) = reserve {
            let cleanup = self.release_except(&old_hosts, &old_ports);
            let reservation = self.register(
                previous
                    .configuration
                    .as_ref()
                    .expect("accepted configuration"),
                &previous.name,
            );
            return Err(join_errors(join_errors(error, cleanup), reservation));
        }
        let result = (|| {
            for name in &old_names {
                self.control.live.starting(name, false);
            }
            self.stop_group(&old_names)?;
            *self.manifest = candidate;
            for name in &affected {
                self.blocked.remove(name);
            }
            self.start_reload(&mut affected)?;
            if self.cancel.load(Ordering::Relaxed) {
                return Err("configuration reload canceled".to_owned());
            }
            self.replace_routes()?;
            self.update_remote()?;
            if let Some(watch) = &mut self.manifest_watch {
                watch.update(configuration.inputs.clone())?;
            }
            Ok::<_, String>(())
        })();
        if let Err(error) = result {
            let failed_names: Vec<_> = self
                .order()?
                .into_iter()
                .filter(|name| affected.contains(name))
                .collect();
            let mut error = join_errors(error, self.stop_group(&failed_names));
            *self.manifest = previous;
            self.blocked = previous_blocked;
            if let (Some(watch), Some(inputs)) = (&mut self.manifest_watch, previous_inputs) {
                error = join_errors(error, watch.update(inputs));
            }
            if !self.cancel.load(Ordering::Relaxed) {
                let restore: Vec<_> = self
                    .order()?
                    .into_iter()
                    .filter(|name| affected.contains(name))
                    .collect();
                let restored = self
                    .start_group(&restore, PortReassignment::Preserve)
                    .and_then(|_| self.replace_routes())
                    .and_then(|_| self.update_remote());
                if let Err(failure) = restored {
                    let failure = join_errors(failure, self.stop_group(&restore));
                    for name in restore {
                        self.blocked.insert(name, failure.clone());
                    }
                    error = format!("{error}\nrestore previous services: {failure}");
                }
            }
            error = join_errors(error, self.release_except(&old_hosts, &old_ports));
            error = join_errors(
                error,
                self.register(
                    self.manifest
                        .configuration
                        .as_ref()
                        .expect("accepted configuration"),
                    &self.manifest.name,
                ),
            );
            return Err(error);
        }
        let hosts = collect_claimed_hosts(&self.manifest.services);
        let ports = fixed_ports(self.manifest);
        let newly_enabled = self.worktrees.is_none() && next_worktrees.is_some();
        for name in &affected {
            self.blocked.remove(name);
        }
        if let Some(worktrees) = &mut next_worktrees {
            worktrees.finish(&self.blocked);
        }
        self.worktrees = next_worktrees;
        self.documents.prune(self.manifest);
        // Routing and services accepted this configuration. Cleanup failures
        // must not restore an old selection over the running checkout.
        let mut failures = Vec::new();
        if let Err(error) = self.release_except(&hosts, &ports) {
            failures.push(error);
        }
        if let Err(error) = self.register(&configuration, &self.manifest.name) {
            failures.push(error);
        }
        if newly_enabled && let Err(error) = Worktrees::forget(&self.manifest.manifest_path, &state)
        {
            failures.push(error);
        }
        if (self.launch.detached || self.manifest.remote.is_some())
            && let Err(error) = caddy::stacks::set_stack_ready(
                &self.options.caddy_dir,
                collect_manifest_service_urls(self.manifest),
            )
        {
            failures.push(error);
        }
        self.progress.stack_name = self.manifest.name.clone();
        self.log(message);
        log_service_urls(self.manifest, &self.options.output);
        log_stopped_services(self.manifest, &self.options.output);
        Ok(AcceptedChange {
            cleanup: if failures.is_empty() {
                Ok(())
            } else {
                Err(failures.join("\n"))
            },
        })
    }

    fn register(&self, configuration: &Manifest, name: &str) -> Result<(), String> {
        register_stack(
            &self.options.caddy_dir,
            &RegisterStackOptions {
                remote: self.manifest.remote.is_some(),
                log_path: self.launch.log_path.clone(),
                control_port: self.control_port,
                manifest_files: stack_manifest_files(Some(configuration)),
                manifest_path: self.manifest.manifest_path.display().to_string(),
                stack_name: name.to_owned(),
            },
        )
        .map_err(|error| match error {
            RegisterStackError::Overlap(overlap) => overlap.default_message(),
            RegisterStackError::Other(error) => error,
        })
    }

    fn update_remote(&mut self) -> Result<(), String> {
        if let Some(options) = remote_options(self.manifest, &self.options.caddy_dir)?
            && let Some(lease) = self.remote_lease
        {
            lease
                .update(&options, self.cancel)
                .map_err(|error| error.to_string())?;
        }
        Ok(())
    }

    fn reserve(
        &mut self,
        configuration: &Manifest,
        candidate: &ResolvedManifest,
    ) -> Result<(), String> {
        // Reserve the union before stopping anything: another stack cannot claim
        // accepted inputs while a replacement is being prepared or rolled back.
        let mut reservation = configuration.clone();
        if let Some(previous) = &self.manifest.configuration {
            reservation
                .inputs
                .files
                .extend(previous.inputs.files.iter().cloned());
        }
        self.register(&reservation, &candidate.name)?;
        let path = self.manifest.manifest_path.display().to_string();
        let mut cleanup = ZombieCleanup::default();
        for (host, port) in fixed_ports(candidate) {
            if !self.ports.contains(&(host.clone(), port)) {
                routes::claim_fixed_port_with_options(
                    &self.options.caddy_dir,
                    &host,
                    port,
                    &path,
                    candidate.kill_zombies,
                    Some(&mut cleanup),
                    Some(&self.options.output),
                )?;
                self.ports.push((host, port));
            }
        }
        for host in collect_claimed_hosts(&candidate.services) {
            if !self.hosts.contains(&host) {
                routes::claim_host_with_options(
                    &self.options.caddy_dir,
                    &host,
                    &path,
                    candidate.kill_zombies,
                    Some(&mut cleanup),
                    Some(&self.options.output),
                )?;
                self.hosts.push(host);
            }
        }
        Ok(())
    }

    fn release_except(&mut self, hosts: &[String], ports: &[(String, u16)]) -> Result<(), String> {
        let path = self.manifest.manifest_path.display().to_string();
        let mut errors = Vec::new();
        self.hosts.retain(|host| {
            if hosts.contains(host) {
                return true;
            }
            match routes::release_host_claim(&self.options.caddy_dir, host, &path) {
                Ok(()) => false,
                Err(error) => {
                    errors.push(error);
                    true
                }
            }
        });
        self.ports.retain(|(host, port)| {
            if ports.contains(&(host.clone(), *port)) {
                return true;
            }
            match routes::release_fixed_port_claim(&self.options.caddy_dir, host, *port, &path) {
                Ok(()) => false,
                Err(error) => {
                    errors.push(error);
                    true
                }
            }
        });
        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors.join("\n"))
        }
    }

    fn stop_group(&mut self, names: &[String]) -> Result<(), String> {
        let mut errors = Vec::new();
        for name in names.iter().rev() {
            self.watches.stop(name);
            if let Some(index) = self
                .started
                .iter()
                .position(|started| &started.service.name == name)
            {
                let mut started = self.started.remove(index);
                if let Err(error) = stop_started_service(&mut started, self.grace_period) {
                    errors.push(error);
                    self.started.push(started);
                }
            }
            if let Some(index) = self
                .daemons
                .iter()
                .position(|service| &service.name == name)
            {
                let service = self.daemons.remove(index);
                if let Err(error) = stop_daemon_lifecycle_service(
                    self.manifest,
                    &service,
                    self.environment,
                    &self.options.output,
                    self.daemon_output,
                ) {
                    errors.push(error);
                    self.daemons.push(service);
                }
            }
        }
        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors.join("\n"))
        }
    }

    fn start_reload(&mut self, affected: &mut BTreeSet<String>) -> Result<(), String> {
        for _ in 0..=MAXIMUM_AUTO_PORT_RETRY_COUNT {
            let before = self.manifest.clone();
            let names: Vec<_> = self
                .order()?
                .into_iter()
                .filter(|name| affected.contains(name))
                .collect();
            self.start_group(&names, PortReassignment::Allowed)?;
            let changed = affected_services(&before, self.manifest);
            if changed.is_empty() {
                return Ok(());
            }
            affected.extend(changed);
            let names: Vec<_> = self
                .order()?
                .into_iter()
                .filter(|name| affected.contains(name))
                .collect();
            self.stop_group(&names)?;
        }
        Err("automatic ports did not stabilize during configuration reload".to_owned())
    }

    fn start_group(&mut self, names: &[String], ports: PortReassignment) -> Result<(), String> {
        for name in names {
            if self.blocked.contains_key(name) {
                continue;
            }
            if self.cancel.load(Ordering::Relaxed) {
                return Err("configuration reload canceled".to_owned());
            }
            let Some(service) = self.manifest.services.get(name).cloned() else {
                continue;
            };
            self.control.live.update_manifest(self.manifest);
            self.control.live.starting(name, false);
            self.watches.start(&service, &self.manifest.name)?;
            if !is_managed_service(&service) {
                self.control.live.ready(name);
                continue;
            }
            if uses_daemon_lifecycle(&service) {
                self.daemons.push(service);
                if let Err(error) = start_daemon_lifecycle_service(
                    self.manifest,
                    name,
                    self.environment,
                    &self.options.output,
                    self.cancel,
                    self.daemon_output,
                ) {
                    self.control.live.failed(name, &error);
                    return Err(error);
                }
                self.control.live.ready(name);
            } else {
                match start_service_with_retries(
                    self.manifest,
                    name,
                    self.environment,
                    &self.options.output,
                    self.grace_period,
                    ServiceStartContext {
                        live: Some(&self.control.live),
                        cancel: self.cancel,
                        exit_tx: self.exit_tx,
                        ports,
                    },
                ) {
                    Ok(started) => self.started.push(started),
                    Err(StartServiceError::Canceled) => {
                        return Err("configuration reload canceled".to_owned());
                    }
                    Err(StartServiceError::Failed {
                        message,
                        exited_service,
                    }) => {
                        self.control.live.failed(name, &message);
                        if let Some(started) = exited_service {
                            self.started.push(*started);
                        }
                        return Err(format!("start reloaded service {name}: {message}"));
                    }
                }
            }
        }
        Ok(())
    }

    fn replace_routes(&mut self) -> Result<(), String> {
        let next = self.documents.routes(self.manifest)?;
        routes::replace_routes(
            &self.options.caddy_dir,
            self.routes,
            &next,
            &self.manifest.manifest_path.display().to_string(),
            self.options.output.mode(),
            &mut self.options.output.caddy_stderr_writer(),
            !self.options.debug_caddy,
        )?;
        *self.routes = next;
        Ok(())
    }
}

#[derive(PartialEq)]
enum Change {
    Reload,
    Switch,
    Start(Vec<String>),
    RestartStack,
}

fn fixed_ports(manifest: &ResolvedManifest) -> Vec<(String, u16)> {
    manifest
        .services
        .values()
        .filter(|service| service.port_source == "fixed")
        .filter_map(|service| service.port.map(|port| (service.bind_host.clone(), port)))
        .collect()
}

fn affected_services(previous: &ResolvedManifest, next: &ResolvedManifest) -> BTreeSet<String> {
    let mut affected = BTreeSet::new();
    for (name, old) in &previous.services {
        if next.services.get(name).is_none_or(|service| {
            old != service
                || create_injected_service_environment(previous, old)
                    != create_injected_service_environment(next, service)
        }) {
            affected.insert(name.clone());
        }
    }
    affected.extend(
        next.services
            .keys()
            .filter(|name| !previous.services.contains_key(*name))
            .cloned(),
    );
    expand_dependents(previous, next, &mut affected);
    affected
}

fn expand_dependents(
    previous: &ResolvedManifest,
    next: &ResolvedManifest,
    affected: &mut BTreeSet<String>,
) {
    loop {
        let before = affected.len();
        for manifest in [previous, next] {
            for (name, service) in &manifest.services {
                if service
                    .depends_on
                    .iter()
                    .any(|dependency| affected.contains(dependency))
                {
                    affected.insert(name.clone());
                }
            }
        }
        if before == affected.len() {
            return;
        }
    }
}

fn join_errors(error: String, cleanup: Result<(), String>) -> String {
    match cleanup {
        Ok(()) => error,
        Err(cleanup) => format!("{error}\n{cleanup}"),
    }
}

struct IdleWatch {
    timeout: Duration,
    log_path: PathBuf,
    modified: Option<std::time::SystemTime>,
    activity: crate::services::control::ActivityTracker,
    next_stat: Instant,
    next_check: Instant,
}

impl IdleWatch {
    fn new(log_path: PathBuf, activity: crate::services::control::ActivityTracker) -> Self {
        Self {
            timeout: Duration::ZERO,
            log_path,
            modified: None,
            activity,
            next_stat: Instant::now(),
            next_check: Instant::now(),
        }
    }

    fn set(&mut self, timeout: Duration, manifest: &ResolvedManifest, output: &ServiceOutput) {
        if timeout == self.timeout {
            return;
        }
        self.timeout = timeout;
        if timeout.is_zero() {
            output.log_stdout(&manifest.name, "Idle timeout disabled.");
            return;
        }
        output.log_stdout(
            &manifest.name,
            &format!(
                "Idle timeout enabled: {} (will automatically shut down when inactive)",
                format_go_duration(timeout)
            ),
        );
        if let Some(parent) = self.log_path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let _ = fs::File::create(&self.log_path);
        self.modified = fs::metadata(&self.log_path)
            .ok()
            .and_then(|info| info.modified().ok());
        self.activity.record_activity();
        self.next_stat = Instant::now() + self.interval(2);
        self.next_check = Instant::now() + self.interval(5);
    }

    fn interval(&self, seconds: u64) -> Duration {
        let longest = Duration::from_secs(seconds);
        if self.timeout >= longest {
            longest
        } else {
            (self.timeout / 2).max(Duration::from_millis(10))
        }
    }

    fn expired(&mut self) -> Option<Duration> {
        if self.timeout.is_zero() {
            return None;
        }
        let now = Instant::now();
        if now >= self.next_stat {
            if let Some(modified) = fs::metadata(&self.log_path)
                .ok()
                .and_then(|info| info.modified().ok())
            {
                if self.modified.is_some_and(|old| modified > old) {
                    self.activity.record_activity();
                }
                self.modified = Some(modified);
            }
            self.next_stat = now + self.interval(2);
        }
        if now >= self.next_check {
            self.next_check = now + self.interval(5);
            if self.activity.is_idle(self.timeout) {
                return Some(self.timeout);
            }
        }
        None
    }
}
