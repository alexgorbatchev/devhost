use super::runtime::Runtime;
use super::*;
use crate::services::containment::read_process_listeners;

#[derive(Default)]
pub(super) struct Discovery {
    alias: Option<u16>,
    qualified: BTreeSet<u16>,
    rejected: BTreeSet<u16>,
}

impl Runtime<'_> {
    pub(super) fn wait_for_command_routes(
        &mut self,
        discovery: &mut Discovery,
        timeout: Duration,
    ) -> Result<Option<i32>, StartStackError> {
        let deadline = Instant::now() + timeout;
        let mut next_discovery = Instant::now();
        loop {
            if let Some(signal) = check_termination_signal(
                self.cancel,
                self.options.install_signal_handlers,
                &self.options.output,
                &self.manifest.name,
            ) {
                self.signal(signal);
                return Ok(Some(SIGNAL_EXIT_CODE_BASE + signal));
            }
            if self.cancel.load(Ordering::Relaxed) {
                return Ok(Some(0));
            }
            if Instant::now() >= next_discovery {
                self.refresh_command_routes(discovery, false, Some(deadline))?;
                if self.manifest.services.len() > 1 {
                    caddy::stacks::set_stack_ready(
                        &self.options.caddy_dir,
                        collect_manifest_service_urls(self.manifest),
                    )?;
                    self.control.live.finish_startup();
                    return Ok(None);
                }
                next_discovery = Instant::now() + Duration::from_millis(500);
            }
            if let Some(code) = self
                .started
                .iter()
                .find(|started| started.service.name == "command")
                .and_then(StartedService::read_exit_code)
            {
                return Err(format!(
                    "command exited with code {code} before opening an HTTP listener"
                )
                .into());
            }
            if Instant::now() >= deadline {
                return Err(format!(
                    "command opened no HTTP listener within {}",
                    super::super::detach::format_go_duration(timeout)
                )
                .into());
            }
            thread::sleep(Duration::from_millis(10));
        }
    }

    pub(super) fn refresh_command_routes(
        &mut self,
        discovery: &mut Discovery,
        ready: bool,
        deadline: Option<Instant>,
    ) -> Result<(), String> {
        let started = self
            .started
            .iter()
            .find(|started| started.service.name == "command")
            .ok_or("command process is unavailable")?;
        let identities = started
            .containment
            .as_ref()
            .map(ServiceContainment::live_process_identities)
            .unwrap_or_default();
        let listeners = read_process_listeners(&identities)?;
        let mut http = BTreeMap::new();
        for (&port, host) in &listeners {
            if self.cancel.load(Ordering::Relaxed) {
                return Ok(());
            }
            let previous = self.manifest.services.get(&format!("port-{port}"));
            let remaining = deadline
                .map(|deadline| deadline.saturating_duration_since(Instant::now()))
                .unwrap_or(Duration::from_millis(400))
                .min(Duration::from_millis(400));
            if remaining.is_zero() {
                break;
            }
            if previous.is_some_and(|service| &service.bind_host == host)
                || is_http(host, port, remaining)
            {
                http.insert(port, host.clone());
                discovery.rejected.remove(&port);
            } else if discovery.rejected.insert(port) {
                self.options.output.log_stdout(&self.manifest.name, &format!("Port {port} is listening but has not responded to HTTP; waiting before routing it."));
            }
        }
        discovery
            .rejected
            .retain(|port| listeners.contains_key(port));
        if http.len() == 1 && discovery.alias.is_none() && discovery.qualified.is_empty() {
            discovery.alias = http.keys().next().copied();
        }
        if http.len() > 1 {
            discovery.qualified.extend(http.keys().copied());
        }
        let mut next = self.manifest.clone();
        next.services.retain(|name, _| name == "command");
        next.service_order = vec!["command".to_owned()];
        for (port, host) in http {
            let name = format!("port-{port}");
            let mut hosts = Vec::new();
            if discovery.alias == Some(port) {
                hosts.push(format!("{}{}", next.name, next.domain_suffix));
            }
            if discovery.qualified.contains(&port) || discovery.alias != Some(port) {
                hosts.push(format!("{}-{port}{}", next.name, next.domain_suffix));
            }
            let service = super::super::serve::external_service(
                next.manifest_directory.clone(),
                &name,
                &host,
                port,
                hosts,
            );
            next.services.insert(name.clone(), service);
            next.service_order.push(name);
        }
        if self.manifest.services == next.services {
            return Ok(());
        }
        for host in collect_claimed_hosts(&next.services) {
            if !self.hosts.contains(&host) {
                routes::claim_host_with_options(
                    &self.options.caddy_dir,
                    &host,
                    "",
                    false,
                    None,
                    Some(&self.options.output),
                )?;
                self.hosts.push(host);
            }
        }
        let routes = self.documents.routes(&next)?;
        routes::replace_routes(
            &self.options.caddy_dir,
            self.routes,
            &routes,
            "",
            self.options.output.mode(),
            &mut self.options.output.caddy_stderr_writer(),
            !self.options.debug_caddy,
        )?;
        *self.routes = routes;
        let previous_urls = collect_manifest_service_urls(self.manifest);
        *self.manifest = next;
        self.documents.prune(self.manifest);
        self.publish_live();
        for name in self
            .manifest
            .services
            .keys()
            .filter(|name| name.as_str() != "command")
        {
            self.control.live.ready(name);
        }
        let urls = collect_manifest_service_urls(self.manifest);
        for url in &urls {
            if !previous_urls.contains(url) {
                self.options.output.log_stdout(&self.manifest.name, url);
            }
        }
        if ready {
            caddy::stacks::set_stack_ready(&self.options.caddy_dir, urls)?;
        }
        Ok(())
    }
}

fn is_http(host: &str, port: u16, timeout: Duration) -> bool {
    let agent = ureq::Agent::config_builder()
        .proxy(None)
        .timeout_global(Some(timeout))
        .timeout_recv_response(Some(Duration::from_millis(300).min(timeout)))
        .max_idle_connections(0)
        .max_redirects(0)
        .max_redirects_will_error(false)
        .http_status_as_error(false)
        .build()
        .new_agent();
    let host = if host.contains(':') {
        format!("[{host}]")
    } else {
        host.to_owned()
    };
    agent.head(format!("http://{host}:{port}/")).call().is_ok()
}
