use std::{
    collections::{BTreeMap, BTreeSet},
    env, fs,
    io::{BufRead, BufReader},
    net::TcpListener,
    os::unix::process::{CommandExt, ExitStatusExt},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        Arc, Condvar, Mutex,
        atomic::{AtomicBool, AtomicI32, Ordering},
        mpsc::{self, Receiver, Sender},
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

use crate::{
    Failure,
    caddy::{
        self,
        files::{create_managed_url, format_site_address, read_applied_settings},
        routes::{
            self, ActivateRouteOptions, ZombieCleanup, format_proxy_address, resolve_proxy_host,
        },
        stacks::{
            ManifestOverlapError, RegisterStackError, RegisterStackOptions,
            cleanup_stale_stack_records, register_stack, unregister_stack,
        },
    },
    cliout::{self, ServiceOutput},
    config::{self, MachineConfig},
    manifest::Manifest,
    services::{
        containment::{
            SERVICE_CONTAINMENT_TOKEN_ENV, ServiceContainment, create_service_containment_token,
            prepare_service_containment, read_listening_process_ids_for_bind_host,
            send_signal_to_group, send_signal_to_pid,
        },
        health::{
            HealthWaitError, read_loopback_bind_host_ambiguity_warning, wait_for_startup_health,
        },
        resolve::{
            HealthKind, PortResolutionOptions, ResolvedManifest, ResolvedService,
            reserve_auto_port, resolve_service_ports,
        },
    },
};

pub const MAXIMUM_AUTO_PORT_RETRY_COUNT: usize = 3;
const MAX_ATTEMPT_OUTPUT_LINES: usize = 50;
const SHUTDOWN_GRACE_PERIOD: Duration = Duration::from_secs(10);
const LATE_LISTENER_MONITOR_DURATION: Duration = Duration::from_secs(2);
const LATE_LISTENER_POLL_INTERVAL: Duration = Duration::from_millis(100);
const SHUTDOWN_POLL_INTERVAL: Duration = Duration::from_millis(10);
const SIGNAL_EXIT_CODE_BASE: i32 = 128;

static RECEIVED_SIGNAL: AtomicI32 = AtomicI32::new(0);

extern "C" fn handle_termination_signal(sig: libc::c_int) {
    let _ = RECEIVED_SIGNAL.compare_exchange(0, sig, Ordering::SeqCst, Ordering::SeqCst);
}

struct SignalGuard {
    previous: Vec<(libc::c_int, libc::sigaction)>,
}

impl SignalGuard {
    fn install() -> Self {
        RECEIVED_SIGNAL.store(0, Ordering::SeqCst);
        let mut previous = Vec::new();
        for sig in [libc::SIGINT, libc::SIGHUP, libc::SIGTERM] {
            unsafe {
                let mut action: libc::sigaction = std::mem::zeroed();
                action.sa_sigaction = handle_termination_signal as *const () as usize;
                libc::sigemptyset(&mut action.sa_mask);
                action.sa_flags = 0;
                let mut old: libc::sigaction = std::mem::zeroed();
                if libc::sigaction(sig, &action, &mut old) == 0 {
                    previous.push((sig, old));
                }
            }
        }
        Self { previous }
    }
}

impl Drop for SignalGuard {
    fn drop(&mut self) {
        for (sig, old) in &self.previous {
            unsafe {
                let _ = libc::sigaction(*sig, old, std::ptr::null_mut());
            }
        }
    }
}

#[derive(Debug, Clone)]
pub enum StartStackError {
    Overlap(ManifestOverlapError),
    Failure(Failure),
}

impl From<Failure> for StartStackError {
    fn from(failure: Failure) -> Self {
        Self::Failure(failure)
    }
}

impl From<String> for StartStackError {
    fn from(message: String) -> Self {
        Self::Failure(message.into())
    }
}

pub struct StartStackOptions {
    pub configuration: Option<Manifest>,
    pub caddy_dir: PathBuf,
    pub config_path: Option<PathBuf>,
    pub environment: BTreeMap<String, String>,
    pub output: ServiceOutput,
    pub debug_caddy: bool,
    pub shutdown_grace_period: Option<Duration>,
    pub idle_timeout: Option<Duration>,
    pub install_signal_handlers: bool,
    pub external_cancel: Option<Arc<AtomicBool>>,
}

#[derive(Default)]
struct AttemptOutputLines {
    lines: Mutex<Vec<String>>,
}

impl AttemptOutputLines {
    fn append(&self, line: String) {
        let mut lines = self.lines.lock().expect("attempt output lock");
        lines.push(line);
        if lines.len() > MAX_ATTEMPT_OUTPUT_LINES {
            let excess = lines.len() - MAX_ATTEMPT_OUTPUT_LINES;
            lines.drain(..excess);
        }
    }

    fn snapshot(&self) -> Vec<String> {
        self.lines.lock().expect("attempt output lock").clone()
    }
}

struct ServiceExitResult {
    service_name: String,
    exit_code: i32,
}

struct StartedService {
    pid: i32,
    service: ResolvedService,
    containment: Option<ServiceContainment>,
    exit_state: Arc<(Mutex<Option<i32>>, Condvar)>,
    waiter: Option<JoinHandle<()>>,
    output_threads: Vec<JoinHandle<()>>,
    shutdown_at: Option<Instant>,
    shutdown_signal: i32,
    last_late_listener_check: Option<Instant>,
}

impl StartedService {
    fn read_exit_code(&self) -> Option<i32> {
        *self.exit_state.0.lock().expect("exit state lock")
    }

    fn note_shutdown_signal(&mut self, sig: i32) {
        if matches!(
            sig,
            libc::SIGINT | libc::SIGHUP | libc::SIGTERM | libc::SIGKILL
        ) {
            if self.shutdown_at.is_none() {
                self.shutdown_at = Some(Instant::now());
            }
            self.shutdown_signal = sig;
        }
    }

    fn signal(&mut self, sig: i32) {
        self.note_shutdown_signal(sig);
        let include_root_group = self.read_exit_code().is_none();
        if let Some(ref containment) = self.containment {
            containment.signal(include_root_group, sig);
        } else if include_root_group {
            send_signal_to_group(self.pid, sig);
        }
    }

    fn is_stopped(&self) -> bool {
        if self.read_exit_code().is_none() {
            return false;
        }
        if let Some(ref containment) = self.containment
            && containment.has_live_descendants()
        {
            return false;
        }
        self.late_listener_monitor_satisfied()
    }

    fn late_listener_monitor_satisfied(&self) -> bool {
        if self.service.port.is_none() {
            return true;
        }
        let Some(started) = self.shutdown_at else {
            return true;
        };
        started.elapsed() >= LATE_LISTENER_MONITOR_DURATION
    }

    fn handle_late_listeners(&mut self) {
        if self.service.port.is_none() || self.read_exit_code().is_none() {
            return;
        }
        if self.shutdown_at.is_none() {
            return;
        }
        let now = Instant::now();
        if let Some(last) = self.last_late_listener_check
            && now.duration_since(last) < LATE_LISTENER_POLL_INTERVAL
        {
            return;
        }
        self.last_late_listener_check = Some(now);
        let self_pid = std::process::id() as i32;
        for pid in self.owned_listener_pids() {
            if pid != self_pid {
                send_signal_to_pid(pid, self.shutdown_signal);
            }
        }
    }

    fn owned_listener_pids(&self) -> Vec<i32> {
        let Some(port) = self.service.port else {
            return Vec::new();
        };
        let mut owned = BTreeSet::new();
        if self.read_exit_code().is_none() {
            owned.insert(self.pid);
        }
        if let Some(ref containment) = self.containment {
            owned.extend(containment.live_descendant_pids());
        }
        read_listening_process_ids_for_bind_host(&self.service.bind_host, port)
            .into_iter()
            .filter(|pid| owned.contains(pid))
            .collect()
    }

    fn wait_and_drain(&mut self) {
        if let Some(handle) = self.waiter.take() {
            let _ = handle.join();
        }
        for handle in self.output_threads.drain(..) {
            let _ = handle.join();
        }
    }

    fn shutdown_failure(&self) -> Option<String> {
        let mut problems = Vec::new();
        if self.read_exit_code().is_none() {
            problems.push(format!("root process is still running (pid {})", self.pid));
        }
        if let Some(ref containment) = self.containment {
            let descendants = containment.live_descendant_pids();
            if !descendants.is_empty() {
                problems.push(format!(
                    "live descendant pids: {}",
                    format_pid_list(&descendants)
                ));
            }
        }
        if let Some(port) = self.service.port {
            let listeners = self.owned_listener_pids();
            if !listeners.is_empty() {
                problems.push(format!(
                    "listener still active on {} (pids: {})",
                    format_listener_address(&self.service.bind_host, port),
                    format_pid_list(&listeners)
                ));
            }
        }
        if problems.is_empty() {
            None
        } else {
            Some(format!(
                "failed to shut down service {} after SIGTERM and SIGKILL: {}",
                self.service.name,
                problems.join("; ")
            ))
        }
    }

    fn close_containment(&mut self) {
        if let Some(mut containment) = self.containment.take() {
            containment.close();
        }
    }
}

struct ShutdownProgress {
    output: ServiceOutput,
    stack_name: String,
    announced: BTreeSet<String>,
}

impl ShutdownProgress {
    fn new(output: ServiceOutput, stack_name: String) -> Self {
        Self {
            output,
            stack_name,
            announced: BTreeSet::new(),
        }
    }

    fn stopping(&mut self, service_name: &str) {
        if self.announced.insert(service_name.to_owned()) {
            self.output.log_stdout(
                &self.stack_name,
                &format!("Stopping service {service_name}..."),
            );
        }
    }

    fn stopped(&self, service_name: &str, err: Option<&str>) {
        if err.is_none() {
            self.output.log_stdout(
                &self.stack_name,
                &format!("Stopped service {service_name}."),
            );
        }
    }
}

pub fn start_stack(
    manifest: &mut ResolvedManifest,
    service_order: &[String],
    options: StartStackOptions,
) -> Result<i32, StartStackError> {
    if service_order.is_empty() {
        return Err("service order is required".to_owned().into());
    }

    let environment = if options.environment.is_empty() {
        read_current_environment()
    } else {
        options.environment.clone()
    };
    let grace_period = options
        .shutdown_grace_period
        .unwrap_or(SHUTDOWN_GRACE_PERIOD);
    let shared: MachineConfig = match options.config_path.as_deref() {
        Some(path) => config::read_from(path)?,
        None => config::read()?,
    };
    let config_path_label = match options.config_path.as_deref() {
        Some(path) => path.display().to_string(),
        None => config::path()
            .map(|p| p.display().to_string())
            .unwrap_or_default(),
    };

    let _signal_guard = options.install_signal_handlers.then(SignalGuard::install);
    let cancel = options
        .external_cancel
        .clone()
        .unwrap_or_else(|| Arc::new(AtomicBool::new(false)));

    let mut started_services: Vec<StartedService> = Vec::new();
    let mut started_daemons: Vec<ResolvedService> = Vec::new();
    let mut claimed_hosts: Vec<String> = Vec::new();
    let mut claimed_fixed_ports: Vec<(String, u16)> = Vec::new();
    let mut active_routes: Vec<ActivateRouteOptions> = Vec::new();
    let mut stack_registered = false;
    let mut was_ready = false;
    let mut shutdown_progress =
        ShutdownProgress::new(options.output.clone(), manifest.name.clone());
    let manifest_path_str = manifest.manifest_path.to_string_lossy().into_owned();

    let (exit_tx, exit_rx) = mpsc::channel::<ServiceExitResult>();

    let run_result: Result<i32, StartStackError> = (|| {
        caddy::ensure_managed_caddy_config(&options.caddy_dir, &shared.caddy)?;
        cleanup_stale_stack_records(&options.caddy_dir)?;

        let manifest_files = stack_manifest_files(options.configuration.as_ref());
        if let Err(err) = register_stack(
            &options.caddy_dir,
            &RegisterStackOptions {
                remote: false,
                log_path: String::new(),
                control_port: 0,
                manifest_files,
                manifest_path: manifest_path_str.clone(),
                stack_name: manifest.name.clone(),
            },
        ) {
            return Err(match err {
                RegisterStackError::Overlap(overlap) => StartStackError::Overlap(overlap),
                RegisterStackError::Other(msg) => StartStackError::Failure(msg.into()),
            });
        }
        stack_registered = true;

        routes::cleanup_stale_registrations(&options.caddy_dir)?;
        routes::cleanup_stale_fixed_port_claims(&options.caddy_dir)?;

        let running_settings =
            read_applied_settings(&options.caddy_dir)?.unwrap_or_else(|| shared.caddy.clone());
        caddy::ensure_admin_available(&running_settings.admin_address)?;
        if let Some(warning) = caddy::root_certificate_trust_warning(&options.caddy_dir) {
            options.output.log_stdout(
                &manifest.name,
                &cliout::warning(options.output.mode(), &warning),
            );
        }

        let mut caddy_out = options.output.caddy_stderr_writer();
        caddy::ctx(
            routes::apply_managed_settings(
                &options.caddy_dir,
                &shared.caddy,
                options.output.mode(),
                &mut caddy_out,
                !options.debug_caddy,
            ),
            &format!("apply the devhost config file {config_path_label}"),
        )?;
        manifest.caddy = shared.caddy.clone();

        let mut zombie_cleanup = ZombieCleanup::default();
        for service in manifest.services.values() {
            if service.port_source != "fixed" {
                continue;
            }
            let Some(port) = service.port else {
                continue;
            };
            routes::claim_fixed_port_with_options(
                &options.caddy_dir,
                &service.bind_host,
                port,
                &manifest_path_str,
                manifest.kill_zombies,
                Some(&mut zombie_cleanup),
                Some(&options.output),
            )?;
            claimed_fixed_ports.push((service.bind_host.clone(), port));
        }

        for host in collect_claimed_hosts(&manifest.services) {
            routes::claim_host_with_options(
                &options.caddy_dir,
                &host,
                &manifest_path_str,
                manifest.kill_zombies,
                Some(&mut zombie_cleanup),
                Some(&options.output),
            )?;
            claimed_hosts.push(host);
        }

        let initial_routes = collect_manifest_routes(manifest);
        caddy::ctx(
            routes::replace_routes(
                &options.caddy_dir,
                &[],
                &initial_routes,
                &manifest_path_str,
                options.output.mode(),
                &mut caddy_out,
                !options.debug_caddy,
            ),
            "replace stack routes",
        )?;
        active_routes = initial_routes;

        for service_name in service_order {
            if let Some(sig) = check_termination_signal(
                &cancel,
                options.install_signal_handlers,
                &options.output,
                &manifest.name,
            ) {
                return Ok(SIGNAL_EXIT_CODE_BASE + sig);
            }
            let Some(service) = manifest.services.get(service_name).cloned() else {
                if manifest.stopped.contains_key(service_name) {
                    continue;
                }
                return Err(format!("unknown service: {service_name}").into());
            };

            if is_managed_service(&service) {
                if uses_daemon_lifecycle(&service) {
                    started_daemons.push(service.clone());
                    if let Err(err) = start_daemon_lifecycle_service(
                        manifest,
                        service_name,
                        &environment,
                        &options.output,
                        &cancel,
                    ) {
                        if let Some(sig) = check_termination_signal(
                            &cancel,
                            options.install_signal_handlers,
                            &options.output,
                            &manifest.name,
                        ) {
                            return Ok(SIGNAL_EXIT_CODE_BASE + sig);
                        }
                        options.output.log_stdout(&manifest.name, &err);
                        let _ = stop_daemon_lifecycle_service(
                            manifest,
                            &service,
                            &environment,
                            &options.output,
                        );
                        started_daemons.retain(|s| s.name != service.name);
                    }
                } else {
                    match start_service_with_retries(
                        manifest,
                        service_name,
                        &environment,
                        &options.output,
                        grace_period,
                        &cancel,
                        &exit_tx,
                    ) {
                        Ok(started) => {
                            let updated_routes = collect_manifest_routes(manifest);
                            if updated_routes != active_routes {
                                routes::replace_routes(
                                    &options.caddy_dir,
                                    &active_routes,
                                    &updated_routes,
                                    &manifest_path_str,
                                    options.output.mode(),
                                    &mut caddy_out,
                                    !options.debug_caddy,
                                )
                                .map_err(|err| {
                                    format!("refresh route for service {service_name}: {err}")
                                })?;
                                active_routes = updated_routes;
                            }
                            started_services.push(started);
                        }
                        Err(StartServiceError::Canceled) => {
                            if let Some(sig) = check_termination_signal(
                                &cancel,
                                options.install_signal_handlers,
                                &options.output,
                                &manifest.name,
                            ) {
                                return Ok(SIGNAL_EXIT_CODE_BASE + sig);
                            }
                            return Ok(0);
                        }
                        Err(StartServiceError::Failed {
                            message,
                            exited_service,
                        }) => {
                            options.output.log_stdout(&manifest.name, &message);
                            if let Some(exited) = exited_service {
                                if let Some(code) = exited.read_exit_code() {
                                    let _ = exit_tx.send(ServiceExitResult {
                                        service_name: service_name.clone(),
                                        exit_code: code,
                                    });
                                }
                                started_services.push(*exited);
                            }
                        }
                    }
                }
            }

            if let Some(updated) = manifest.services.get(service_name)
                && !updated.hosts.is_empty()
                && updated.port.is_some()
                && let Some(warning) =
                    read_loopback_bind_host_ambiguity_warning(updated, manifest.caddy.https_port)
            {
                options.output.log_stdout(&manifest.name, &warning);
            }
        }

        log_service_urls(manifest, &options.output);
        log_stopped_services(manifest, &options.output);
        was_ready = true;

        let idle_deadline = options
            .idle_timeout
            .filter(|d| !d.is_zero())
            .map(|d| (d, Instant::now() + d));
        wait_for_stack_shutdown(
            &manifest.name,
            &options.output,
            &cancel,
            options.install_signal_handlers,
            &exit_rx,
            idle_deadline,
            &mut started_services,
            &mut shutdown_progress,
        )
    })();

    // Centralized cleanup in exact Go order.
    let mut cleanup_errors: Vec<String> = Vec::new();
    for started in &started_services {
        shutdown_progress.stopping(&started.service.name);
    }
    if let Err(err) =
        stop_started_services(&mut started_services, grace_period, &mut shutdown_progress)
    {
        cleanup_errors.push(err);
    }
    if let Err(err) =
        stop_daemon_lifecycle_services(manifest, &started_daemons, &environment, &options.output)
    {
        cleanup_errors.push(err);
    }

    for host in &claimed_hosts {
        if let Err(err) = routes::release_host_claim(&options.caddy_dir, host, &manifest_path_str) {
            cleanup_errors.push(err);
        }
    }

    if !active_routes.is_empty() {
        let mut caddy_out = options.output.caddy_stderr_writer();
        if let Err(err) = routes::replace_routes(
            &options.caddy_dir,
            &active_routes,
            &[],
            &manifest_path_str,
            options.output.mode(),
            &mut caddy_out,
            !options.debug_caddy,
        ) {
            cleanup_errors.push(err);
        }
    }

    for (bind_host, port) in &claimed_fixed_ports {
        if let Err(err) = routes::release_fixed_port_claim(
            &options.caddy_dir,
            bind_host,
            *port,
            &manifest_path_str,
        ) {
            cleanup_errors.push(err);
        }
    }

    if stack_registered && let Err(err) = unregister_stack(&options.caddy_dir) {
        cleanup_errors.push(err);
    }

    if cleanup_errors.is_empty()
        && (was_ready || !started_services.is_empty() || !started_daemons.is_empty())
    {
        options.output.log_stdout(&manifest.name, "Stack stopped.");
    }

    match (run_result, cleanup_errors.is_empty()) {
        (Ok(code), true) => Ok(code),
        (Ok(_), false) => Err(cleanup_errors.join("\n").into()),
        (Err(err), true) => Err(err),
        (Err(StartStackError::Overlap(overlap)), false) => Err(format!(
            "{}\ncleanup: {}",
            overlap.default_message(),
            cleanup_errors.join("\n")
        )
        .into()),
        (Err(StartStackError::Failure(mut failure)), false) => {
            failure.message = format!(
                "{}\ncleanup: {}",
                failure.message,
                cleanup_errors.join("\n")
            );
            failure.summary = None;
            Err(StartStackError::Failure(failure))
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn wait_for_stack_shutdown(
    stack_name: &str,
    output: &ServiceOutput,
    cancel: &AtomicBool,
    install_signals: bool,
    exit_rx: &Receiver<ServiceExitResult>,
    idle_deadline: Option<(Duration, Instant)>,
    started_services: &mut [StartedService],
    shutdown_progress: &mut ShutdownProgress,
) -> Result<i32, StartStackError> {
    loop {
        while let Ok(result) = exit_rx.try_recv() {
            output.log_stdout(
                stack_name,
                &format!(
                    "{} exited with code {}; devhost is waiting for a restart.",
                    result.service_name, result.exit_code
                ),
            );
        }
        if let Some(sig) = check_termination_signal(cancel, install_signals, output, stack_name) {
            for started in started_services.iter_mut() {
                shutdown_progress.stopping(&started.service.name);
                started.signal(sig);
            }
            return Ok(SIGNAL_EXIT_CODE_BASE + sig);
        }
        if cancel.load(Ordering::Relaxed) {
            for started in started_services.iter_mut() {
                shutdown_progress.stopping(&started.service.name);
                started.signal(libc::SIGTERM);
            }
            return Ok(0);
        }
        if let Some((timeout, deadline)) = idle_deadline
            && Instant::now() >= deadline
        {
            output.log_stdout(
                stack_name,
                &format!(
                    "Idle timeout of {:?} reached. Automatically shutting down the stack...",
                    timeout
                ),
            );
            for started in started_services.iter_mut() {
                shutdown_progress.stopping(&started.service.name);
                started.signal(libc::SIGTERM);
            }
            return Ok(0);
        }
        thread::sleep(Duration::from_millis(25));
    }
}

fn check_termination_signal(
    cancel: &AtomicBool,
    install_signals: bool,
    output: &ServiceOutput,
    stack_name: &str,
) -> Option<i32> {
    if !install_signals {
        return None;
    }
    let sig = RECEIVED_SIGNAL.swap(0, Ordering::SeqCst);
    if sig != 0 {
        cancel.store(true, Ordering::SeqCst);
        output.log_stdout(
            stack_name,
            &format!(
                "Received {}; shutting down the stack.",
                describe_shutdown_signal(sig)
            ),
        );
        return Some(sig);
    }
    None
}

fn describe_shutdown_signal(sig: i32) -> String {
    let name = match sig {
        libc::SIGINT => "SIGINT (Ctrl-C)",
        libc::SIGHUP => "SIGHUP",
        libc::SIGTERM => "SIGTERM",
        _ => "signal",
    };
    format!("{name} (signal {sig})")
}

enum StartServiceError {
    Canceled,
    Failed {
        message: String,
        exited_service: Option<Box<StartedService>>,
    },
}

fn start_service_with_retries(
    manifest: &mut ResolvedManifest,
    service_name: &str,
    environment: &BTreeMap<String, String>,
    output: &ServiceOutput,
    grace_period: Duration,
    cancel: &AtomicBool,
    exit_tx: &Sender<ServiceExitResult>,
) -> Result<StartedService, StartServiceError> {
    let mut retry_count = 0usize;
    loop {
        if cancel.load(Ordering::Relaxed) {
            return Err(StartServiceError::Canceled);
        }
        let service = match manifest.services.get(service_name).cloned() {
            Some(service) => service,
            None => {
                return Err(StartServiceError::Failed {
                    message: format!("unknown service: {service_name}"),
                    exited_service: None,
                });
            }
        };
        if let Err(err) = validate_assigned_auto_port(&service) {
            if !should_retry_auto_port_startup(&service, Some(&err), &[], retry_count) {
                return Err(StartServiceError::Failed {
                    message: err,
                    exited_service: None,
                });
            }
            retry_count += 1;
            if let Err(e) = reassign_startup_auto_port(manifest, service_name, output) {
                return Err(StartServiceError::Failed {
                    message: e,
                    exited_service: None,
                });
            }
            continue;
        }

        let attempt_output = Arc::new(AttemptOutputLines::default());
        let mut started = match start_service_process(
            manifest,
            &service,
            environment,
            output,
            attempt_output.clone(),
        ) {
            Ok(started) => started,
            Err(err) => {
                return Err(StartServiceError::Failed {
                    message: err,
                    exited_service: None,
                });
            }
        };

        let exit_state = started.exit_state.clone();
        match wait_for_startup_health(&service, &manifest.name, output, cancel, || {
            *exit_state.0.lock().expect("exit lock")
        }) {
            Ok(()) => {
                // Spawn exit watcher that forwards unexpected exits after startup.
                let watch_state = started.exit_state.clone();
                let watch_name = service.name.clone();
                let tx = exit_tx.clone();
                thread::spawn(move || {
                    let (lock, cvar) = &*watch_state;
                    let mut guard = lock.lock().expect("exit watch lock");
                    while guard.is_none() {
                        guard = cvar.wait(guard).expect("exit watch wait");
                    }
                    if let Some(code) = *guard {
                        let _ = tx.send(ServiceExitResult {
                            service_name: watch_name,
                            exit_code: code,
                        });
                    }
                });
                return Ok(started);
            }
            Err(HealthWaitError::Canceled) => {
                let _ = stop_started_service(&mut started, grace_period);
                return Err(StartServiceError::Canceled);
            }
            Err(HealthWaitError::Failed(err)) => {
                let exited_before = started.read_exit_code().is_some();
                if !exited_before {
                    output.log_stdout(
                        &manifest.name,
                        &format!(
                            "{err} Stopping service {} because its startup health check failed; sending SIGTERM (signal 15).",
                            service.name
                        ),
                    );
                }
                if let Err(stop_err) = stop_started_service(&mut started, grace_period) {
                    return Err(StartServiceError::Failed {
                        message: format!("{err}\ncleanup: {stop_err}"),
                        exited_service: None,
                    });
                }
                let lines = attempt_output.snapshot();
                if should_retry_auto_port_startup(&service, Some(&err), &lines, retry_count) {
                    retry_count += 1;
                    if let Err(e) = reassign_startup_auto_port(manifest, service_name, output) {
                        return Err(StartServiceError::Failed {
                            message: e,
                            exited_service: None,
                        });
                    }
                    continue;
                }
                return Err(StartServiceError::Failed {
                    message: err,
                    exited_service: exited_before.then(|| Box::new(started)),
                });
            }
        }
    }
}

fn start_service_process(
    manifest: &ResolvedManifest,
    service: &ResolvedService,
    environment: &BTreeMap<String, String>,
    output: &ServiceOutput,
    attempt_output: Arc<AttemptOutputLines>,
) -> Result<StartedService, String> {
    if service.command.is_empty() {
        return Err(format!("service {} command is empty", service.name));
    }
    validate_service_working_directory(service)?;
    prepare_service_containment()?;

    let token = create_service_containment_token();
    let mut cmd = Command::new(&service.command[0]);
    cmd.args(&service.command[1..])
        .current_dir(&service.cwd)
        .env_clear()
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .process_group(0);

    let child_env = create_child_environment(
        environment,
        &service.env,
        &create_injected_service_environment(manifest, service),
        Some((SERVICE_CONTAINMENT_TOKEN_ENV, &token)),
    );
    for (key, value) in child_env {
        cmd.env(key, value);
    }

    let mut child = match cmd.spawn() {
        Ok(child) => child,
        Err(err) => {
            return Err(format!(
                "start service {}: cannot launch executable {:?} in working directory {:?}: {err}",
                service.name,
                service.command[0],
                service.cwd.display()
            ));
        }
    };

    let pid = child.id() as i32;
    let containment = match ServiceContainment::start(pid, token) {
        Ok(c) => c,
        Err(err) => {
            send_signal_to_group(pid, libc::SIGKILL);
            let _ = child.wait();
            return Err(format!("start service {} containment: {err}", service.name));
        }
    };

    let stdout_pipe = child.stdout.take();
    let stderr_pipe = child.stderr.take();
    let mut output_threads = Vec::new();
    if let Some(pipe) = stdout_pipe {
        let out = output.clone();
        let name = service.name.clone();
        let attempt = attempt_output.clone();
        output_threads.push(thread::spawn(move || {
            pipe_reader_lines(pipe, &name, &out, false, &attempt);
        }));
    }
    if let Some(pipe) = stderr_pipe {
        let out = output.clone();
        let name = service.name.clone();
        let attempt = attempt_output;
        output_threads.push(thread::spawn(move || {
            pipe_reader_lines(pipe, &name, &out, true, &attempt);
        }));
    }

    let exit_state = Arc::new((Mutex::new(None), Condvar::new()));
    let waiter_state = exit_state.clone();
    let waiter = thread::spawn(move || {
        let code = wait_child_exit_code(&mut child);
        let (lock, cvar) = &*waiter_state;
        *lock.lock().expect("exit state lock") = Some(code);
        cvar.notify_all();
    });

    Ok(StartedService {
        pid,
        service: service.clone(),
        containment: Some(containment),
        exit_state,
        waiter: Some(waiter),
        output_threads,
        shutdown_at: None,
        shutdown_signal: 0,
        last_late_listener_check: None,
    })
}

fn pipe_reader_lines<R: std::io::Read>(
    reader: R,
    service_name: &str,
    output: &ServiceOutput,
    is_stderr: bool,
    attempt_output: &AttemptOutputLines,
) {
    let mut buf_reader = BufReader::new(reader);
    let mut line = String::new();
    loop {
        line.clear();
        match buf_reader.read_line(&mut line) {
            Ok(0) => break,
            Ok(_) => {
                let text = line.trim_end_matches(&['\r', '\n'][..]);
                attempt_output.append(format!("[{service_name}] {text}"));
                if is_stderr {
                    output.write_child_stderr(service_name, text);
                } else {
                    output.write_child_stdout(service_name, text);
                }
            }
            Err(err) => {
                attempt_output.append(format!("[{service_name}] {err}"));
                break;
            }
        }
    }
}

fn wait_child_exit_code(child: &mut Child) -> i32 {
    match child.wait() {
        Ok(status) => {
            if let Some(sig) = status.signal() {
                SIGNAL_EXIT_CODE_BASE + sig
            } else {
                status.code().unwrap_or(1)
            }
        }
        Err(_) => 1,
    }
}

fn stop_started_service(
    started: &mut StartedService,
    grace_period: Duration,
) -> Result<(), String> {
    started.signal(libc::SIGTERM);
    if wait_for_service_shutdown(started, grace_period) {
        started.wait_and_drain();
        started.close_containment();
        return Ok(());
    }
    started.signal(libc::SIGKILL);
    let _ = wait_for_service_shutdown(started, grace_period);
    started.wait_and_drain();
    let failure = started.shutdown_failure();
    started.close_containment();
    match failure {
        Some(err) => Err(err),
        None => Ok(()),
    }
}

fn stop_started_services(
    started_services: &mut [StartedService],
    grace_period: Duration,
    progress: &mut ShutdownProgress,
) -> Result<(), String> {
    let mut errors = Vec::new();
    for started in started_services.iter_mut().rev() {
        started.signal(libc::SIGTERM);
    }
    for started in started_services.iter_mut().rev() {
        if !wait_for_service_shutdown(started, grace_period) {
            started.signal(libc::SIGKILL);
            let _ = wait_for_service_shutdown(started, grace_period);
        }
        started.wait_and_drain();
        let failure = started.shutdown_failure();
        started.close_containment();
        progress.stopped(&started.service.name, failure.as_deref());
        if let Some(err) = failure {
            errors.push(err);
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("\n"))
    }
}

fn wait_for_service_shutdown(started: &mut StartedService, grace_period: Duration) -> bool {
    let deadline = Instant::now() + grace_period;
    loop {
        started.handle_late_listeners();
        if started.is_stopped() {
            return true;
        }
        if Instant::now() >= deadline {
            started.handle_late_listeners();
            return started.is_stopped();
        }
        thread::sleep(SHUTDOWN_POLL_INTERVAL);
    }
}

fn start_daemon_lifecycle_service(
    manifest: &ResolvedManifest,
    service_name: &str,
    environment: &BTreeMap<String, String>,
    output: &ServiceOutput,
    cancel: &AtomicBool,
) -> Result<(), String> {
    let Some(service) = manifest.services.get(service_name) else {
        return Err(format!("unknown service: {service_name}"));
    };
    let running = read_daemon_lifecycle_status(manifest, service, environment, output)?;
    if !running {
        run_service_command(
            manifest,
            service,
            &service.lifecycle.start,
            "daemon start",
            environment,
            output,
        )?;
    }
    match wait_for_startup_health(service, &manifest.name, output, cancel, || None) {
        Ok(()) => Ok(()),
        Err(HealthWaitError::Canceled) => Err("canceled".to_owned()),
        Err(HealthWaitError::Failed(msg)) => Err(msg),
    }
}

fn stop_daemon_lifecycle_service(
    manifest: &ResolvedManifest,
    service: &ResolvedService,
    environment: &BTreeMap<String, String>,
    output: &ServiceOutput,
) -> Result<(), String> {
    if !uses_daemon_lifecycle(service) {
        return Ok(());
    }
    if !service.lifecycle.status.is_empty() {
        let running = read_daemon_lifecycle_status(manifest, service, environment, output)?;
        if !running {
            return Ok(());
        }
    }
    run_service_command(
        manifest,
        service,
        &service.lifecycle.stop,
        "daemon stop",
        environment,
        output,
    )
}

fn stop_daemon_lifecycle_services(
    manifest: &ResolvedManifest,
    daemons: &[ResolvedService],
    environment: &BTreeMap<String, String>,
    output: &ServiceOutput,
) -> Result<(), String> {
    let mut progress = ShutdownProgress::new(output.clone(), manifest.name.clone());
    let mut errors = Vec::new();
    for service in daemons.iter().rev() {
        progress.stopping(&service.name);
        let result = stop_daemon_lifecycle_service(manifest, service, environment, output);
        progress.stopped(&service.name, result.as_ref().err().map(String::as_str));
        if let Err(err) = result {
            errors.push(err);
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("\n"))
    }
}

fn read_daemon_lifecycle_status(
    manifest: &ResolvedManifest,
    service: &ResolvedService,
    environment: &BTreeMap<String, String>,
    output: &ServiceOutput,
) -> Result<bool, String> {
    if service.lifecycle.status.is_empty() {
        return Ok(false);
    }
    run_service_command_status(
        manifest,
        service,
        &service.lifecycle.status,
        "daemon status",
        environment,
        output,
    )
}

fn run_service_command(
    manifest: &ResolvedManifest,
    service: &ResolvedService,
    command_args: &[String],
    command_label: &str,
    environment: &BTreeMap<String, String>,
    output: &ServiceOutput,
) -> Result<(), String> {
    if run_service_command_status(
        manifest,
        service,
        command_args,
        command_label,
        environment,
        output,
    )? {
        Ok(())
    } else {
        Err(format!(
            "wait for service {} {command_label} command: exited with non-zero status",
            service.name
        ))
    }
}

fn run_service_command_status(
    manifest: &ResolvedManifest,
    service: &ResolvedService,
    command_args: &[String],
    command_label: &str,
    environment: &BTreeMap<String, String>,
    output: &ServiceOutput,
) -> Result<bool, String> {
    if command_args.is_empty() {
        return Err(format!(
            "service {} {command_label} command is empty",
            service.name
        ));
    }
    let mut cmd = Command::new(&command_args[0]);
    cmd.args(&command_args[1..])
        .current_dir(&service.cwd)
        .env_clear()
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .process_group(0);
    for (key, value) in create_child_environment(
        environment,
        &service.env,
        &create_injected_service_environment(manifest, service),
        None,
    ) {
        cmd.env(key, value);
    }
    let mut child = caddy::ctx(
        cmd.spawn(),
        &format!("start service {} {command_label} command", service.name),
    )?;
    let attempt = Arc::new(AttemptOutputLines::default());
    let mut threads = Vec::new();
    if let Some(pipe) = child.stdout.take() {
        let out = output.clone();
        let name = service.name.clone();
        let att = attempt.clone();
        threads.push(thread::spawn(move || {
            pipe_reader_lines(pipe, &name, &out, false, &att);
        }));
    }
    if let Some(pipe) = child.stderr.take() {
        let out = output.clone();
        let name = service.name.clone();
        threads.push(thread::spawn(move || {
            pipe_reader_lines(pipe, &name, &out, true, &attempt);
        }));
    }
    let status = caddy::ctx(
        child.wait(),
        &format!("wait for service {} {command_label} command", service.name),
    )?;
    for handle in threads {
        let _ = handle.join();
    }
    Ok(status.success())
}

pub fn validate_assigned_auto_port(service: &ResolvedService) -> Result<(), String> {
    if service.port_source != "auto" {
        return Ok(());
    }
    let Some(port) = service.port else {
        return Ok(());
    };
    let addr = format_proxy_address(&service.bind_host, port);
    caddy::ctx(
        TcpListener::bind(&addr).map(|_| ()),
        &format!(
            "service {} could not bind its assigned port {port}; use Restart Stack to recover",
            service.name
        ),
    )
}

pub fn should_retry_auto_port_startup(
    service: &ResolvedService,
    startup_error: Option<&str>,
    output_lines: &[String],
    retry_count: usize,
) -> bool {
    if service.port_source != "auto" || retry_count >= MAXIMUM_AUTO_PORT_RETRY_COUNT {
        return false;
    }
    let mut combined = startup_error.unwrap_or_default().to_ascii_lowercase();
    for line in output_lines {
        combined.push('\n');
        combined.push_str(&line.to_ascii_lowercase());
    }
    combined.contains("eaddrinuse") || combined.contains("address already in use")
}

pub fn reassign_auto_port(
    manifest: &ResolvedManifest,
    service_name: &str,
) -> Result<(ResolvedService, ResolvedManifest), String> {
    let Some(mut service) = manifest.services.get(service_name).cloned() else {
        return Err(format!("Unknown service: {service_name}"));
    };
    let mut excluded = BTreeSet::new();
    for other in manifest.services.values() {
        if other.bind_host == service.bind_host
            && let Some(port) = other.port
        {
            excluded.insert(port);
        }
    }
    let next_port = reserve_auto_port(&service.bind_host, &excluded)?;
    if service.health.kind == HealthKind::Tcp && !service.health.fixed_tcp_port {
        service.health.port = Some(next_port);
    }
    service.port = Some(next_port);

    let mut next_manifest = manifest.clone();
    next_manifest
        .services
        .insert(service_name.to_owned(), service.clone());

    if let Some(ref config_manifest) = manifest.configuration {
        let mut preserved = BTreeMap::new();
        for (name, svc) in &next_manifest.services {
            if svc.port_source == "auto"
                && let Some(port) = svc.port
            {
                preserved.insert(name.clone(), port);
            }
        }
        for (name, svc) in &next_manifest.stopped {
            if svc.port_source == "auto"
                && let Some(port) = svc.port
            {
                preserved.insert(name.clone(), port);
            }
        }
        let mut resolved = resolve_service_ports(
            config_manifest,
            &PortResolutionOptions {
                requested: manifest.requested.clone(),
                preserved,
                excluded: BTreeMap::new(),
                domain_suffix: manifest.domain_suffix.clone(),
                remote_mode: false,
            },
        )?;
        resolved.caddy = manifest.caddy.clone();
        resolved.manifest_path = manifest.manifest_path.clone();
        resolved.name = manifest.name.clone();
        resolved.service_order = manifest.service_order.clone();
        for (name, selected) in &manifest.services {
            if let Some(next_svc) = resolved.services.get_mut(name) {
                next_svc.cwd = selected.cwd.clone();
                next_svc.serve = selected.serve.clone();
            }
        }
        let updated = resolved.services[service_name].clone();
        return Ok((updated, resolved));
    }

    Ok((service, next_manifest))
}

fn reassign_startup_auto_port(
    manifest: &mut ResolvedManifest,
    service_name: &str,
    output: &ServiceOutput,
) -> Result<(), String> {
    output.log_stdout(
        &manifest.name,
        &format!("retrying {service_name} with a new auto port after a bind collision."),
    );
    let (_, next) = reassign_auto_port(manifest, service_name)?;
    *manifest = next;
    Ok(())
}

pub fn validate_service_working_directory(service: &ResolvedService) -> Result<(), String> {
    if !service.serve.is_empty() {
        let meta = match fs::metadata(&service.serve) {
            Ok(meta) => meta,
            Err(err) => {
                return Err(format!(
                    "start service {}: cannot access serve directory {:?}: {err}",
                    service.name, service.serve
                ));
            }
        };
        if !meta.is_dir() {
            return Err(format!(
                "start service {}: serve path {:?} is not a directory",
                service.name, service.serve
            ));
        }
        return Ok(());
    }
    if service.cwd.as_os_str().is_empty() {
        return Ok(());
    }
    let meta = match fs::metadata(&service.cwd) {
        Ok(meta) => meta,
        Err(err) => {
            return Err(format!(
                "start service {}: cannot access working directory {:?} (services.{}.cwd); check the configured cwd path: {err}",
                service.name,
                service.cwd.display(),
                service.name
            ));
        }
    };
    if !meta.is_dir() {
        return Err(format!(
            "start service {}: working directory {:?} (services.{}.cwd) is not a directory; set cwd to a directory",
            service.name,
            service.cwd.display(),
            service.name
        ));
    }
    Ok(())
}

pub fn create_injected_service_environment(
    manifest: &ResolvedManifest,
    service: &ResolvedService,
) -> BTreeMap<String, String> {
    let mut env_map = BTreeMap::new();
    env_map.insert("DEVHOST_BIND_HOST".to_owned(), service.bind_host.clone());
    env_map.insert(
        "DEVHOST_MANIFEST_PATH".to_owned(),
        manifest.manifest_path.to_string_lossy().into_owned(),
    );
    env_map.insert("DEVHOST_SERVICE_NAME".to_owned(), service.name.clone());

    if let Some(port) = service.port
        && service.inject_port
    {
        env_map.insert("PORT".to_owned(), port.to_string());
    }
    if let Some(first_host) = service.hosts.first() {
        env_map.insert("DEVHOST_HOST".to_owned(), first_host.clone());
    }
    if let Some(ref path) = service.path {
        env_map.insert("DEVHOST_PATH".to_owned(), path.clone());
    }
    for group in [&manifest.services, &manifest.stopped] {
        for other in group.values() {
            if let Some(port) = other.port {
                env_map.insert(
                    format!("DEVHOST_PORT_{}", to_env_safe_name(&other.name)),
                    port.to_string(),
                );
            }
        }
    }
    env_map
}

fn to_env_safe_name(name: &str) -> String {
    name.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'0'..=b'9' => b as char,
            b'a'..=b'z' => (b - b'a' + b'A') as char,
            _ => '_',
        })
        .collect()
}

fn create_child_environment(
    base: &BTreeMap<String, String>,
    service_env: &BTreeMap<String, String>,
    injected: &BTreeMap<String, String>,
    extra: Option<(&str, &str)>,
) -> BTreeMap<String, String> {
    let mut merged = base.clone();
    for (k, v) in service_env {
        merged.insert(k.clone(), v.clone());
    }
    for (k, v) in injected {
        merged.insert(k.clone(), v.clone());
    }
    if let Some((k, v)) = extra {
        merged.insert(k.to_owned(), v.to_owned());
    }
    merged
}

pub fn log_service_urls(manifest: &ResolvedManifest, output: &ServiceOutput) {
    let https_port = if manifest.caddy.https_port == 0 {
        443
    } else {
        manifest.caddy.https_port
    };
    for service_name in ordered_manifest_service_names(manifest) {
        let Some(service) = manifest.services.get(&service_name) else {
            continue;
        };
        let display_name = if service.name == manifest.primary_service {
            format!("{} (primary)", service.name)
        } else {
            service.name.clone()
        };
        for url in read_service_urls(service, https_port) {
            output.log_stdout(&manifest.name, &format!("{display_name}: {url}"));
        }
    }
}

pub fn log_stopped_services(manifest: &ResolvedManifest, output: &ServiceOutput) {
    let stopped = stopped_service_names(manifest);
    if !stopped.is_empty() {
        output.log_stdout(
            &manifest.name,
            &format!("not started: {}", stopped.join(", ")),
        );
    }
}

fn ordered_manifest_service_names(manifest: &ResolvedManifest) -> Vec<String> {
    let mut ordered = Vec::new();
    let mut seen = BTreeSet::new();
    for name in &manifest.service_order {
        if manifest.services.contains_key(name) && seen.insert(name.clone()) {
            ordered.push(name.clone());
        }
    }
    for name in manifest.services.keys() {
        if seen.insert(name.clone()) {
            ordered.push(name.clone());
        }
    }
    ordered
}

fn stopped_service_names(manifest: &ResolvedManifest) -> Vec<String> {
    let mut ordered = Vec::new();
    let mut seen = BTreeSet::new();
    for name in &manifest.service_order {
        if manifest.stopped.contains_key(name) && seen.insert(name.clone()) {
            ordered.push(name.clone());
        }
    }
    for name in manifest.stopped.keys() {
        if seen.insert(name.clone()) {
            ordered.push(name.clone());
        }
    }
    ordered
}

fn read_service_urls(service: &ResolvedService, https_port: u16) -> Vec<String> {
    if !service.hosts.is_empty()
        && let Some(ref raw_path) = service.path
    {
        let path = normalize_managed_service_url_path(raw_path);
        return service
            .hosts
            .iter()
            .map(|host| {
                if path == "/" {
                    format_site_address("https", https_port, host)
                } else {
                    create_managed_url("https", host, https_port, &path)
                }
            })
            .collect();
    }
    let Some(port) = service.port else {
        return Vec::new();
    };
    let Ok(proxy_host) = resolve_proxy_host(&service.bind_host) else {
        return Vec::new();
    };
    vec![format!("http://{}", format_proxy_address(proxy_host, port))]
}

fn normalize_managed_service_url_path(path: &str) -> String {
    if path == "/" || path == "/*" {
        return "/".to_owned();
    }
    if let Some(trimmed) = path.strip_suffix('*')
        && trimmed.ends_with('/')
    {
        return trimmed.to_owned();
    }
    path.to_owned()
}

fn collect_claimed_hosts(services: &BTreeMap<String, ResolvedService>) -> Vec<String> {
    let mut set = BTreeSet::new();
    for service in services.values() {
        for host in &service.hosts {
            set.insert(host.clone());
        }
    }
    set.into_iter().collect()
}

fn collect_manifest_routes(manifest: &ResolvedManifest) -> Vec<ActivateRouteOptions> {
    let access_log_name = stack_access_log_name(manifest);
    let mut list = Vec::new();
    for name in ordered_manifest_service_names(manifest) {
        let Some(service) = manifest.services.get(&name) else {
            continue;
        };
        let Some(port) = service.port else {
            continue;
        };
        if service.hosts.is_empty() {
            continue;
        }
        let path = service.path.clone().unwrap_or_else(|| "/".to_owned());
        for host in &service.hosts {
            list.push(ActivateRouteOptions {
                proxy_local_origin: service.proxy_local_origin,
                app_bind_host: service.bind_host.clone(),
                app_port: port,
                devtools_control_port: None,
                document_injection_port: None,
                host: host.clone(),
                path: path.clone(),
                service_name: service.name.clone(),
                access_log_name: access_log_name.clone(),
            });
        }
    }
    list
}

fn stack_access_log_name(manifest: &ResolvedManifest) -> String {
    if manifest.manifest_path.as_os_str().is_empty() {
        return manifest.name.clone();
    }
    // Lightweight deterministic key matching the 12-hex-char prefix format.
    let key = fnv1a_hex(manifest.manifest_path.to_string_lossy().as_bytes());
    format!("stack-{}", &key[..12])
}

fn fnv1a_hex(bytes: &[u8]) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for &b in bytes {
        hash ^= u64::from(b);
        hash = hash.wrapping_mul(0x0100_0000_01b3);
    }
    format!("{hash:016x}")
}

fn stack_manifest_files(configuration: Option<&Manifest>) -> Vec<String> {
    let Some(cfg) = configuration else {
        return Vec::new();
    };
    let mut files: Vec<String> = cfg
        .inputs
        .files
        .iter()
        .map(|p| p.to_string_lossy().into_owned())
        .collect();
    files.push(cfg.manifest_path.to_string_lossy().into_owned());
    files
}

fn is_managed_service(service: &ResolvedService) -> bool {
    service.managed || !service.command.is_empty() || !service.serve.is_empty()
}

fn uses_daemon_lifecycle(service: &ResolvedService) -> bool {
    service.lifecycle.mode == "daemon"
}

fn read_current_environment() -> BTreeMap<String, String> {
    env::vars().collect()
}

fn format_pid_list(pids: &[i32]) -> String {
    pids.iter()
        .map(ToString::to_string)
        .collect::<Vec<_>>()
        .join(", ")
}

fn format_listener_address(bind_host: &str, port: u16) -> String {
    if bind_host.is_empty() {
        format!("port {port}")
    } else {
        format_proxy_address(bind_host, port)
    }
}

pub fn format_overlap_for_cwd(
    overlap: &ManifestOverlapError,
    cwd: &Path,
    env_manifest: Option<&Path>,
) -> String {
    let default_target = match env_manifest {
        Some(path) if path.is_absolute() => Some(path.to_path_buf()),
        Some(path) => Some(cwd.join(path)),
        None => crate::manifest::resolve_path(cwd, None).ok(),
    };
    if let Some(target) = default_target
        && same_file(&target, Path::new(&overlap.owner.manifest_path))
    {
        return overlap.message("devhost stop");
    }
    overlap.default_message()
}

fn same_file(left: &Path, right: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        match (fs::metadata(left), fs::metadata(right)) {
            (Ok(a), Ok(b)) => a.dev() == b.dev() && a.ino() == b.ino(),
            _ => false,
        }
    }
    #[cfg(not(unix))]
    {
        fs::canonicalize(left).ok() == fs::canonicalize(right).ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::manifest::read_manifest;

    #[test]
    fn injects_env_retries_auto_ports_and_validates_working_dirs() {
        let fixture = tempfile::tempdir().unwrap();
        let root = fixture.path();
        fs::write(
            root.join("devhost.toml"),
            r#"
name = "demo"

[services.api-v1]
command = ["echo", "{{services.api-v1.port}}"]
port = "auto"
host = "api"
path = "/v1/*"

[services.worker]
command = ["echo", "hi"]
[services.worker.health]
process = true
"#,
        )
        .unwrap();

        let manifest = read_manifest(root, None).unwrap();
        let resolved = resolve_service_ports(
            &manifest,
            &PortResolutionOptions {
                requested: vec!["api-v1".to_owned()],
                ..PortResolutionOptions::default()
            },
        )
        .unwrap();

        let api = &resolved.services["api-v1"];
        let injected = create_injected_service_environment(&resolved, api);
        assert_eq!(injected["DEVHOST_SERVICE_NAME"], "api-v1");
        assert_eq!(injected["DEVHOST_HOST"], "api.localhost");
        assert_eq!(injected["DEVHOST_PATH"], "/v1/*");
        assert_eq!(injected["PORT"], api.port.unwrap().to_string());
        assert_eq!(
            injected["DEVHOST_PORT_API_V1"],
            api.port.unwrap().to_string()
        );
        assert!(should_retry_auto_port_startup(
            api,
            Some("listen tcp: bind: address already in use"),
            &[],
            0
        ));
        assert!(!should_retry_auto_port_startup(
            api,
            Some("bind: address already in use"),
            &[],
            MAXIMUM_AUTO_PORT_RETRY_COUNT
        ));

        let old_port = api.port.unwrap();
        let (reassigned, next_manifest) = reassign_auto_port(&resolved, "api-v1").unwrap();
        assert_ne!(reassigned.port.unwrap(), old_port);
        assert_eq!(
            next_manifest.services["api-v1"].command,
            vec!["echo", &reassigned.port.unwrap().to_string()]
        );

        let mut bad_cwd = api.clone();
        bad_cwd.cwd = root.join("missing");
        assert!(
            validate_service_working_directory(&bad_cwd)
                .unwrap_err()
                .contains("cannot access working directory")
        );
        let file_path = root.join("devhost.toml");
        bad_cwd.cwd = file_path.clone();
        assert!(
            validate_service_working_directory(&bad_cwd)
                .unwrap_err()
                .contains("is not a directory")
        );
        bad_cwd.serve = file_path.to_string_lossy().into_owned();
        assert!(
            validate_service_working_directory(&bad_cwd)
                .unwrap_err()
                .contains("serve path")
        );

        let overlap = ManifestOverlapError {
            manifest_path: file_path.to_string_lossy().into_owned(),
            owner: crate::caddy::stacks::StackOwner {
                manifest_path: file_path.to_string_lossy().into_owned(),
                pid: 42,
            },
            stack_name: "demo".to_owned(),
        };
        assert!(
            format_overlap_for_cwd(&overlap, root, None)
                .contains("stop that stack with devhost stop before starting this one")
        );
        assert!(
            format_overlap_for_cwd(&overlap, root, Some(&root.join("other/devhost.toml")))
                .contains("devhost stop --manifest")
        );
        assert_eq!(
            describe_shutdown_signal(libc::SIGINT),
            "SIGINT (Ctrl-C) (signal 2)"
        );
        assert_eq!(describe_shutdown_signal(libc::SIGHUP), "SIGHUP (signal 1)");
        assert_eq!(
            describe_shutdown_signal(libc::SIGTERM),
            "SIGTERM (signal 15)"
        );

        // Exercise early-exit failure in start_service_with_retries, SIGKILL escalation, and daemon error paths.
        let out_buf: Arc<Mutex<Vec<u8>>> = Arc::default();
        let err_buf: Arc<Mutex<Vec<u8>>> = Arc::default();
        #[derive(Clone)]
        struct Capture(Arc<Mutex<Vec<u8>>>);
        impl std::io::Write for Capture {
            fn write(&mut self, b: &[u8]) -> std::io::Result<usize> {
                self.0.lock().unwrap().extend_from_slice(b);
                Ok(b.len())
            }
            fn flush(&mut self) -> std::io::Result<()> {
                Ok(())
            }
        }
        let output = ServiceOutput::new(
            cli_command_kit::Mode::Human,
            Box::new(Capture(out_buf.clone())),
            Box::new(Capture(err_buf.clone())),
            &["demo", "crasher", "stubborn", "bad-daemon"],
        );
        let cancel = AtomicBool::new(false);
        let (tx, _rx) = mpsc::channel();
        let mut crash_manifest = resolved.clone();
        let crash_port = TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
        let crash_svc = ResolvedService {
            proxy_local_origin: false,
            bind_host: "127.0.0.1".to_owned(),
            command: vec![
                "sh".to_owned(),
                "-c".to_owned(),
                "echo boom >&2; exit 7".to_owned(),
            ],
            serve: String::new(),
            cwd: root.to_path_buf(),
            depends_on: Vec::new(),
            env: BTreeMap::new(),
            health: crate::services::resolve::ResolvedHealthConfig {
                fixed_tcp_port: false,
                host: Some("127.0.0.1".to_owned()),
                interval_ms: 20,
                kind: HealthKind::Tcp,
                port: Some(crash_port),
                retries: 0,
                timeout_ms: 1000,
                url: None,
            },
            hosts: vec!["crash.localhost".to_owned()],
            inject_port: false,
            lifecycle: Default::default(),
            managed: true,
            name: "crasher".to_owned(),
            path: Some("/".to_owned()),
            port: Some(crash_port),
            port_source: "fixed".to_owned(),
            watch: Vec::new(),
        };
        crash_manifest
            .services
            .insert("crasher".to_owned(), crash_svc.clone());
        let err = match start_service_with_retries(
            &mut crash_manifest,
            "crasher",
            &BTreeMap::new(),
            &output,
            Duration::from_millis(200),
            &cancel,
            &tx,
        ) {
            Err(StartServiceError::Failed { message, .. }) => message,
            _ => panic!("expected early-exit failure"),
        };
        assert!(err.contains("exited before passing its health check with code 7"));

        // Exercise SIGKILL escalation on stubborn process.
        let mut stubborn_svc = crash_svc.clone();
        stubborn_svc.name = "stubborn".to_owned();
        stubborn_svc.command = vec![
            "sh".to_owned(),
            "-c".to_owned(),
            "trap '' TERM; exec sleep 30".to_owned(),
        ];
        stubborn_svc.port = None;
        stubborn_svc.health.kind = HealthKind::Process;
        stubborn_svc.health.port = None;
        crash_manifest
            .services
            .insert("stubborn".to_owned(), stubborn_svc.clone());
        let mut started = start_service_process(
            &crash_manifest,
            &stubborn_svc,
            &BTreeMap::new(),
            &output,
            Arc::new(AttemptOutputLines::default()),
        )
        .unwrap();
        std::thread::sleep(Duration::from_millis(50));
        stop_started_service(&mut started, Duration::from_millis(100)).unwrap();

        // Exercise daemon start/stop failure & URL formatting for subpath and direct bind host.
        let mut bad_daemon = stubborn_svc;
        bad_daemon.name = "bad-daemon".to_owned();
        bad_daemon.lifecycle = crate::manifest::ServiceLifecycleConfig {
            mode: "daemon".to_owned(),
            start: vec!["sh".to_owned(), "-c".to_owned(), "exit 3".to_owned()],
            status: vec!["sh".to_owned(), "-c".to_owned(), "exit 1".to_owned()],
            stop: vec!["sh".to_owned(), "-c".to_owned(), "exit 4".to_owned()],
        };
        crash_manifest
            .services
            .insert("bad-daemon".to_owned(), bad_daemon.clone());
        assert!(
            start_daemon_lifecycle_service(
                &crash_manifest,
                "bad-daemon",
                &BTreeMap::new(),
                &output,
                &cancel,
            )
            .unwrap_err()
            .contains("daemon start command")
        );
        bad_daemon.lifecycle.status = vec!["sh".to_owned(), "-c".to_owned(), "exit 0".to_owned()];
        assert!(
            stop_daemon_lifecycle_services(
                &crash_manifest,
                &[bad_daemon],
                &BTreeMap::new(),
                &output,
            )
            .unwrap_err()
            .contains("daemon stop command")
        );
        log_service_urls(&crash_manifest, &output);
        log_stopped_services(&crash_manifest, &output);

        // Exercise empty daemon command error and shutdown_failure reporting.
        assert!(
            run_service_command(
                &crash_manifest,
                &crash_svc,
                &[],
                "daemon start",
                &BTreeMap::new(),
                &output,
            )
            .unwrap_err()
            .contains("command is empty")
        );
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let listen_port = listener.local_addr().unwrap().port();
        let mut fake_svc = crash_svc.clone();
        fake_svc.port = Some(listen_port);
        let mut fake_started = StartedService {
            pid: std::process::id() as i32,
            service: fake_svc,
            containment: None,
            exit_state: Arc::new((Mutex::new(None), Condvar::new())),
            waiter: None,
            output_threads: Vec::new(),
            shutdown_at: Some(Instant::now()),
            shutdown_signal: libc::SIGTERM,
            last_late_listener_check: None,
        };
        let failure_msg = fake_started.shutdown_failure().unwrap();
        assert!(failure_msg.contains("root process is still running"));
        assert!(failure_msg.contains("listener still active"));
        fake_started.handle_late_listeners();
        drop(listener);
    }
}
