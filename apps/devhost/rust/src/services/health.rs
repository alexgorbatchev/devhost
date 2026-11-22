use std::{
    net::{IpAddr, SocketAddr, TcpStream},
    sync::atomic::{AtomicBool, Ordering},
    thread,
    time::{Duration, Instant},
};

use crate::{
    caddy::{
        files::create_managed_url,
        routes::{format_proxy_address, resolve_proxy_host},
    },
    cliout::{self, ServiceOutput},
    services::resolve::{HealthKind, ResolvedHealthConfig, ResolvedService},
};

const MIN_PROBE_TIMEOUT: Duration = Duration::from_millis(200);
const STARTUP_PROGRESS_DELAY: Duration = Duration::from_secs(2);
const STARTUP_PROGRESS_INTERVAL: Duration = Duration::from_secs(5);
const LOOPBACK_PROBE_TIMEOUT: Duration = Duration::from_millis(750);

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HealthWaitError {
    Canceled,
    Failed(String),
}

pub fn probe_timeout_for(health: &ResolvedHealthConfig) -> Duration {
    Duration::from_millis(health.interval_ms).max(MIN_PROBE_TIMEOUT)
}

pub fn check_service_health(health: &ResolvedHealthConfig) -> bool {
    let timeout = probe_timeout_for(health);
    match health.kind {
        HealthKind::Process => true,
        HealthKind::Tcp => {
            let (Some(host), Some(port)) = (health.host.as_deref(), health.port) else {
                return false;
            };
            let Ok(resolved) = resolve_proxy_host(host) else {
                return false;
            };
            can_connect_to_port(resolved, port, timeout)
        }
        HealthKind::Http => {
            let Some(url) = health.url.as_deref() else {
                return false;
            };
            is_ready_http_endpoint(url, timeout)
        }
    }
}

pub fn wait_for_service_health<F, P>(
    health: &ResolvedHealthConfig,
    service_name: &str,
    cancel: &AtomicBool,
    mut read_exit_code: F,
    mut on_progress: P,
) -> Result<(), HealthWaitError>
where
    F: FnMut() -> Option<i32>,
    P: FnMut(usize, Duration),
{
    if cancel.load(Ordering::Relaxed) {
        return Err(HealthWaitError::Canceled);
    }
    if health.kind == HealthKind::Process {
        return check_exited(service_name, &mut read_exit_code);
    }

    let timeout = Duration::from_millis(health.timeout_ms);
    let interval = Duration::from_millis(health.interval_ms);
    let start = Instant::now();
    let deadline = start + timeout;
    let mut consecutive_failures = 0u64;
    let mut attempts = 0usize;

    while Instant::now() < deadline {
        if cancel.load(Ordering::Relaxed) {
            return Err(HealthWaitError::Canceled);
        }
        if check_service_health(health) {
            return Ok(());
        }
        if cancel.load(Ordering::Relaxed) {
            return Err(HealthWaitError::Canceled);
        }

        consecutive_failures += 1;
        attempts += 1;
        if health.retries > 0 && consecutive_failures > health.retries {
            return Err(HealthWaitError::Failed(format!(
                "Service {service_name} failed its health check {consecutive_failures} consecutive times."
            )));
        }
        check_exited(service_name, &mut read_exit_code)?;
        on_progress(attempts, start.elapsed());
        if !sleep_interruptible(interval, cancel) {
            return Err(HealthWaitError::Canceled);
        }
    }

    Err(HealthWaitError::Failed(format!(
        "Service {service_name} did not pass its health check within {}ms.",
        health.timeout_ms
    )))
}

pub fn wait_for_startup_health<F>(
    service: &ResolvedService,
    stack_name: &str,
    output: &ServiceOutput,
    cancel: &AtomicBool,
    read_exit_code: F,
) -> Result<(), HealthWaitError>
where
    F: FnMut() -> Option<i32>,
{
    wait_for_startup_health_with_delay(
        service,
        stack_name,
        output,
        cancel,
        read_exit_code,
        STARTUP_PROGRESS_DELAY,
    )
}

fn wait_for_startup_health_with_delay<F>(
    service: &ResolvedService,
    stack_name: &str,
    output: &ServiceOutput,
    cancel: &AtomicBool,
    mut read_exit_code: F,
    progress_delay: Duration,
) -> Result<(), HealthWaitError>
where
    F: FnMut() -> Option<i32>,
{
    let mut last_progress: Option<Instant> = None;
    let mut mismatch = String::new();
    let result = wait_for_service_health(
        &service.health,
        &service.name,
        cancel,
        &mut read_exit_code,
        |_attempts, elapsed| {
            let now = Instant::now();
            if elapsed < progress_delay {
                return;
            }
            if let Some(prev) = last_progress
                && now.duration_since(prev) < STARTUP_PROGRESS_INTERVAL
            {
                return;
            }
            last_progress = Some(now);
            let rounded_secs = (elapsed.as_millis() + 500) / 1000;
            output.log_stdout(
                stack_name,
                &format!(
                    "Waiting for service {} to pass its {} (elapsed: {rounded_secs}s; timeout: {})...",
                    service.name,
                    describe_startup_health(&service.health),
                    format_go_duration_ms(service.health.timeout_ms)
                ),
            );
            if mismatch.is_empty() {
                mismatch = startup_bind_mismatch(service);
                if !mismatch.is_empty() {
                    output.log_stdout(
                        stack_name,
                        &cliout::warning(
                            output.mode(),
                            &format!("Service {}: {mismatch}", service.name),
                        ),
                    );
                }
            }
        },
    );
    let Err(HealthWaitError::Failed(base)) = result else {
        return result;
    };
    if read_exit_code().is_some() {
        return Err(HealthWaitError::Failed(base));
    }

    match service.health.kind {
        HealthKind::Tcp => {
            let address = startup_tcp_address(&service.health);
            if address.is_empty() {
                return Err(HealthWaitError::Failed(base));
            }
            if mismatch.is_empty() {
                mismatch = startup_bind_mismatch(service);
            }
            if cancel.load(Ordering::Relaxed) {
                return Err(HealthWaitError::Canceled);
            }
            if mismatch.is_empty() {
                mismatch =
                    format!("Configure the app to listen on {address} and check its startup logs.");
            }
            Err(HealthWaitError::Failed(format!(
                "{base} TCP health check could not connect to {address}. {mismatch}"
            )))
        }
        HealthKind::Http => {
            if let Some(url) = service.health.url.as_deref() {
                return Err(HealthWaitError::Failed(format!(
                    "{base} HTTP health check requires a 2xx response from {url}. Check the app's startup logs and services.{}.health.http.",
                    service.name
                )));
            }
            Err(HealthWaitError::Failed(base))
        }
        HealthKind::Process => Err(HealthWaitError::Failed(base)),
    }
}

pub fn read_loopback_bind_host_ambiguity_warning(
    service: &ResolvedService,
    https_port: u16,
) -> Option<String> {
    if service.hosts.is_empty() {
        return None;
    }
    let port = service.port?;
    let proxy_host = resolve_proxy_host(&service.bind_host).ok()?;
    let preferred_bind_host = read_alternative_bind_host(&service.bind_host)?;
    let https_port = if https_port == 0 { 443 } else { https_port };

    let localhost_probe = probe_http_response("localhost", port)?;
    let routed_probe = probe_http_response(proxy_host, port)?;
    if localhost_probe == routed_probe {
        return None;
    }

    let preferred_proxy = resolve_proxy_host(preferred_bind_host).ok()?;
    let preferred_probe = probe_http_response(preferred_proxy, port);
    let recommendation = if preferred_probe.as_ref() == Some(&localhost_probe) {
        format!(
            " Consider setting services.{}.bindHost = {preferred_bind_host:?}.",
            service.name
        )
    } else {
        " Set services.<name>.bindHost explicitly to match the listener your app prints.".to_owned()
    };

    let managed_url = create_managed_url("https", &service.hosts[0], https_port, "/");
    let managed_url = managed_url.trim_end_matches('/');
    Some(format!(
        "services.{}.port = {port} is ambiguous: http://localhost:{port}/ responded differently than http://{}/. devhost routes {managed_url} through {}:{port}, so a localhost URL may hit a different loopback listener on this machine.{recommendation}",
        service.name,
        format_proxy_address(proxy_host, port),
        service.bind_host
    ))
}

pub fn read_alternative_bind_host(bind_host: &str) -> Option<&'static str> {
    match bind_host {
        "127.0.0.1" | "0.0.0.0" => Some("::1"),
        "::1" | "::" => Some("127.0.0.1"),
        _ => None,
    }
}

fn check_exited<F>(service_name: &str, read_exit_code: &mut F) -> Result<(), HealthWaitError>
where
    F: FnMut() -> Option<i32>,
{
    if let Some(code) = read_exit_code() {
        return Err(HealthWaitError::Failed(format!(
            "Service {service_name} exited before passing its health check with code {code}."
        )));
    }
    Ok(())
}

fn sleep_interruptible(duration: Duration, cancel: &AtomicBool) -> bool {
    let end = Instant::now() + duration;
    let step = Duration::from_millis(25);
    while Instant::now() < end {
        if cancel.load(Ordering::Relaxed) {
            return false;
        }
        let remaining = end.saturating_duration_since(Instant::now());
        thread::sleep(remaining.min(step));
    }
    !cancel.load(Ordering::Relaxed)
}

fn can_connect_to_port(host: &str, port: u16, timeout: Duration) -> bool {
    let Ok(ip) = host.parse::<IpAddr>() else {
        return false;
    };
    let addr = SocketAddr::new(ip, port);
    TcpStream::connect_timeout(&addr, timeout).is_ok()
}

fn is_ready_http_endpoint(url: &str, timeout: Duration) -> bool {
    let agent = ureq::Agent::config_builder()
        .timeout_global(Some(timeout))
        .max_redirects(0)
        .http_status_as_error(false)
        .proxy(None)
        .build()
        .new_agent();
    agent
        .get(url)
        .call()
        .is_ok_and(|response| response.status().is_success())
}

#[derive(Debug, PartialEq, Eq)]
struct LoopbackProbe {
    status: u16,
    location: Option<String>,
}

fn probe_http_response(host: &str, port: u16) -> Option<LoopbackProbe> {
    let url = format!("http://{}/", format_proxy_address(host, port));
    let agent = ureq::Agent::config_builder()
        .timeout_global(Some(LOOPBACK_PROBE_TIMEOUT))
        .max_redirects(0)
        .http_status_as_error(false)
        .proxy(None)
        .build()
        .new_agent();
    let response = agent.get(&url).call().ok()?;
    let status = response.status().as_u16();
    let location = response
        .headers()
        .get("location")
        .and_then(|v| v.to_str().ok())
        .filter(|s| !s.is_empty())
        .map(str::to_owned);
    Some(LoopbackProbe { status, location })
}

fn describe_startup_health(health: &ResolvedHealthConfig) -> String {
    match health.kind {
        HealthKind::Tcp => format!("TCP health check on {}", startup_tcp_address(health)),
        HealthKind::Http => match health.url.as_deref() {
            Some(url) => format!("HTTP health check on {url}"),
            None => "health check".to_owned(),
        },
        HealthKind::Process => "health check".to_owned(),
    }
}

fn startup_tcp_address(health: &ResolvedHealthConfig) -> String {
    let (Some(host), Some(port)) = (health.host.as_deref(), health.port) else {
        return String::new();
    };
    let Ok(resolved) = resolve_proxy_host(host) else {
        return String::new();
    };
    format_proxy_address(resolved, port)
}

fn startup_bind_mismatch(service: &ResolvedService) -> String {
    let health = &service.health;
    if health.kind != HealthKind::Tcp {
        return String::new();
    }
    let (Some(host), Some(port)) = (health.host.as_deref(), health.port) else {
        return String::new();
    };
    let Some(alt_host) = read_alternative_bind_host(host) else {
        return String::new();
    };
    if !can_connect_to_port(alt_host, port, probe_timeout_for(health)) {
        return String::new();
    }
    format!(
        "A TCP connection to {} succeeded instead. Set services.{}.bindHost = {alt_host:?} in your manifest, or configure the app to listen on {}.",
        format_proxy_address(alt_host, port),
        service.name,
        startup_tcp_address(health)
    )
}

fn format_go_duration_ms(ms: u64) -> String {
    if ms.is_multiple_of(1000) {
        format!("{}s", ms / 1000)
    } else {
        format!("{ms}ms")
    }
}

#[cfg(test)]
mod tests {
    use std::{
        io::{Read, Write},
        net::TcpListener,
    };

    use cli_command_kit::Mode;

    use super::*;

    #[test]
    fn tcp_http_and_process_health_checks_behave_accurately() {
        let cancel = AtomicBool::new(false);
        let proc_health = ResolvedHealthConfig {
            fixed_tcp_port: false,
            host: None,
            interval_ms: 50,
            kind: HealthKind::Process,
            port: None,
            retries: 0,
            timeout_ms: 500,
            url: None,
        };
        assert!(check_service_health(&proc_health));
        assert!(
            wait_for_service_health(&proc_health, "worker", &cancel, || None, |_, _| {}).is_ok()
        );
        let exited =
            wait_for_service_health(&proc_health, "worker", &cancel, || Some(42), |_, _| {})
                .unwrap_err();
        assert_eq!(
            exited,
            HealthWaitError::Failed(
                "Service worker exited before passing its health check with code 42.".to_owned()
            )
        );

        let tcp_listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let tcp_port = tcp_listener.local_addr().unwrap().port();
        let tcp_health = ResolvedHealthConfig {
            fixed_tcp_port: false,
            host: Some("0.0.0.0".to_owned()),
            interval_ms: 50,
            kind: HealthKind::Tcp,
            port: Some(tcp_port),
            retries: 0,
            timeout_ms: 500,
            url: None,
        };
        assert!(check_service_health(&tcp_health));
        drop(tcp_listener);

        let retry_health = ResolvedHealthConfig {
            retries: 1,
            interval_ms: 20,
            timeout_ms: 1000,
            ..tcp_health.clone()
        };
        let retry_err =
            wait_for_service_health(&retry_health, "api", &cancel, || None, |_, _| {}).unwrap_err();
        assert_eq!(
            retry_err,
            HealthWaitError::Failed(
                "Service api failed its health check 2 consecutive times.".to_owned()
            )
        );

        // Serve a 200 OK HTTP endpoint and verify HTTP health check passes.
        let http_listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let http_port = http_listener.local_addr().unwrap().port();
        let server = thread::spawn(move || {
            if let Ok((mut stream, _)) = http_listener.accept() {
                let mut buf = [0u8; 512];
                let _ = stream.read(&mut buf);
                let _ = stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok");
            }
        });
        let http_health = ResolvedHealthConfig {
            fixed_tcp_port: false,
            host: None,
            interval_ms: 50,
            kind: HealthKind::Http,
            port: None,
            retries: 0,
            timeout_ms: 1000,
            url: Some(format!("http://127.0.0.1:{http_port}/healthz")),
        };
        assert!(check_service_health(&http_health));
        server.join().unwrap();

        assert_eq!(read_alternative_bind_host("127.0.0.1"), Some("::1"));
        assert_eq!(read_alternative_bind_host("::"), Some("127.0.0.1"));
        assert_eq!(read_alternative_bind_host("10.0.0.1"), None);

        let output = ServiceOutput::new(
            Mode::Agent,
            Box::new(Vec::<u8>::new()),
            Box::new(Vec::<u8>::new()),
            &["demo"],
        );
        let mut svc = crate::services::resolve::ResolvedService {
            proxy_local_origin: false,
            bind_host: "127.0.0.1".to_owned(),
            command: vec![],
            serve: String::new(),
            cwd: std::path::PathBuf::new(),
            depends_on: vec![],
            env: Default::default(),
            health: ResolvedHealthConfig {
                fixed_tcp_port: false,
                host: Some("127.0.0.1".to_owned()),
                interval_ms: 20,
                kind: HealthKind::Tcp,
                port: Some(tcp_port),
                retries: 1,
                timeout_ms: 500,
                url: None,
            },
            hosts: vec![],
            inject_port: true,
            lifecycle: Default::default(),
            managed: true,
            name: "api".to_owned(),
            path: None,
            port: Some(tcp_port),
            port_source: "auto".to_owned(),
            watch: vec![],
        };
        let err = wait_for_startup_health(&svc, "demo", &output, &cancel, || None).unwrap_err();
        let HealthWaitError::Failed(msg) = err else {
            panic!("expected failed health");
        };
        assert!(msg.contains("TCP health check could not connect"));

        svc.health.kind = HealthKind::Http;
        svc.health.url = Some(format!("http://127.0.0.1:{tcp_port}/healthz"));
        let err = wait_for_startup_health(&svc, "demo", &output, &cancel, || None).unwrap_err();
        let HealthWaitError::Failed(msg) = err else {
            panic!("expected failed http health");
        };
        assert!(msg.contains("HTTP health check requires a 2xx response"));

        // Cancellation returns Canceled immediately.
        let canceled = AtomicBool::new(true);
        assert_eq!(
            wait_for_service_health(&svc.health, "api", &canceled, || None, |_, _| {}),
            Err(HealthWaitError::Canceled)
        );

        // Timeout returns timeout message.
        let timeout_health = ResolvedHealthConfig {
            fixed_tcp_port: false,
            host: Some("127.0.0.1".to_owned()),
            interval_ms: 10,
            kind: HealthKind::Tcp,
            port: Some(tcp_port),
            retries: 0,
            timeout_ms: 30,
            url: None,
        };
        let timed_out =
            wait_for_service_health(&timeout_health, "api", &cancel, || None, |_, _| {})
                .unwrap_err();
        assert_eq!(
            timed_out,
            HealthWaitError::Failed(
                "Service api did not pass its health check within 30ms.".to_owned()
            )
        );

        // Exercise describe_startup_health, format_go_duration_ms, and loopback ambiguity probes.
        assert!(
            describe_startup_health(&timeout_health).contains("TCP health check on 127.0.0.1:")
        );
        assert!(describe_startup_health(&svc.health).contains("HTTP health check on http://"));
        assert_eq!(describe_startup_health(&proc_health), "health check");
        assert_eq!(format_go_duration_ms(30_000), "30s");
        assert_eq!(format_go_duration_ms(250), "250ms");

        // Loopback ambiguity warning when ipv4 & ipv6 respond identically returns None;
        // when ipv4 returns 200 and ipv6 returns 302 (if ipv6 available), returns Some.
        if let Ok(v4) = TcpListener::bind("127.0.0.1:0") {
            let port = v4.local_addr().unwrap().port();
            if let Ok(v6) = TcpListener::bind(("::1", port)) {
                let _ = v4.set_nonblocking(true);
                let _ = v6.set_nonblocking(true);
                let stop_probe = std::sync::Arc::new(AtomicBool::new(false));
                let stop_v4 = stop_probe.clone();
                let stop_v6 = stop_probe.clone();
                let s4 = thread::spawn(move || {
                    while !stop_v4.load(Ordering::Relaxed) {
                        match v4.accept() {
                            Ok((mut s, _)) => {
                                let mut b = [0u8; 256];
                                let _ = s.read(&mut b);
                                let _ =
                                    s.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n");
                            }
                            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                                thread::sleep(Duration::from_millis(10));
                            }
                            Err(_) => break,
                        }
                    }
                });
                let s6 = thread::spawn(move || {
                    while !stop_v6.load(Ordering::Relaxed) {
                        match v6.accept() {
                            Ok((mut s, _)) => {
                                let mut b = [0u8; 256];
                                let _ = s.read(&mut b);
                                let _ = s.write_all(
                                    b"HTTP/1.1 302 Found\r\nLocation: /login\r\nContent-Length: 0\r\n\r\n",
                                );
                            }
                            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                                thread::sleep(Duration::from_millis(10));
                            }
                            Err(_) => break,
                        }
                    }
                });
                svc.hosts = vec!["app.localhost".to_owned()];
                svc.port = Some(port);
                svc.bind_host = "::1".to_owned();
                let warn = read_loopback_bind_host_ambiguity_warning(&svc, 443);
                if let Some(text) = warn {
                    assert!(text.contains("is ambiguous"));
                }
                stop_probe.store(true, Ordering::Relaxed);
                let _ = s4.join();
                let _ = s6.join();
            }
        }

        // Exercise startup progress logging and alternative bind-host mismatch warning.
        if let Ok(alt_v6) = TcpListener::bind(("::1", 0)) {
            let mismatch_port = alt_v6.local_addr().unwrap().port();
            svc.hosts.clear();
            svc.bind_host = "127.0.0.1".to_owned();
            svc.port = Some(mismatch_port);
            svc.health = ResolvedHealthConfig {
                fixed_tcp_port: false,
                host: Some("127.0.0.1".to_owned()),
                interval_ms: 15,
                kind: HealthKind::Tcp,
                port: Some(mismatch_port),
                retries: 2,
                timeout_ms: 200,
                url: None,
            };
            let err = wait_for_startup_health_with_delay(
                &svc,
                "demo",
                &output,
                &cancel,
                || None,
                Duration::from_millis(1),
            )
            .unwrap_err();
            drop(alt_v6);
            let HealthWaitError::Failed(msg) = err else {
                panic!("expected mismatch failure");
            };
            assert!(msg.contains("succeeded instead"));
        }
    }
}
