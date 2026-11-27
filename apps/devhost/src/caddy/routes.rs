use std::{
    collections::{BTreeMap, BTreeSet},
    fs, io,
    path::{Path, PathBuf},
    sync::{Arc, OnceLock},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use cli_command_kit::Mode;
use serde::{Deserialize, Serialize};

use super::{
    files::{
        self, encode_path_segment, format_site_address, normalize_route_path, read_route_settings,
        read_running_settings, sync_not_found_site, write_applied_settings, write_caddyfile,
    },
    path_ctx, reload_managed_caddy, route_lock,
};
use crate::{cliout::ServiceOutput, config::CaddySettings, procid};

#[derive(Debug, Default)]
pub struct ZombieCleanup {
    attempted: BTreeMap<(i32, String), Result<(), String>>,
}

impl ZombieCleanup {
    pub fn kill(
        &mut self,
        pid: i32,
        start_identity: &str,
        claim: &str,
        output: Option<&ServiceOutput>,
    ) -> Result<(), String> {
        let key = (pid, start_identity.to_owned());
        if let Some(previous) = self.attempted.get(&key) {
            return previous.clone();
        }
        let result = stop_zombie(pid, start_identity, claim, output);
        self.attempted.insert(key, result.clone());
        result
    }
}

fn stop_zombie(
    pid: i32,
    start_identity: &str,
    claim: &str,
    output: Option<&ServiceOutput>,
) -> Result<(), String> {
    if let Some(out) = output {
        out.log_stdout(
            "devhost",
            &format!("Stopping zombie PID {pid} claiming {claim}..."),
        );
    }
    #[cfg(unix)]
    {
        // SAFETY: kill(pid, SIGKILL) terminates the zombie owner process.
        let rc = unsafe { libc::kill(pid, libc::SIGKILL) };
        if rc != 0 {
            let err = io::Error::last_os_error();
            if err.raw_os_error() != Some(libc::ESRCH) {
                return Err(format!("stop zombie PID {pid} claiming {claim}: {err}"));
            }
        }
    }
    let deadline = Instant::now() + Duration::from_secs(5);
    while Instant::now() < deadline {
        if !procid::is_record_owner_alive(pid, start_identity) {
            if let Some(out) = output {
                out.log_stdout(
                    "devhost",
                    &format!("Stopped zombie PID {pid} claiming {claim}."),
                );
            }
            return Ok(());
        }
        thread::sleep(Duration::from_millis(10));
    }
    Err(format!(
        "confirm exit of zombie PID {pid} claiming {claim}: timed out"
    ))
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ActivateRouteOptions {
    pub proxy_local_origin: bool,
    pub app_bind_host: String,
    pub app_port: u16,
    pub devtools_control_port: Option<u16>,
    pub document_injection_port: Option<u16>,
    pub host: String,
    pub path: String,
    pub service_name: String,
    pub access_log_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HostClaimRecord {
    pub(crate) created_at: String,
    pub(crate) host: String,
    pub(crate) manifest_path: String,
    pub(crate) owner_pid: i32,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub(crate) owner_start_identity: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub(crate) owner_stack_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FixedPortClaimRecord {
    pub(crate) bind_host: String,
    pub(crate) created_at: String,
    pub(crate) manifest_path: String,
    pub(crate) owner_pid: i32,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub(crate) owner_start_identity: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub(crate) owner_stack_id: String,
    pub(crate) port: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RouteRegistration {
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub(crate) proxy_local_origin: bool,
    pub(crate) app_bind_host: String,
    pub(crate) app_port: u16,
    pub(crate) created_at: String,
    pub(crate) host: String,
    pub(crate) manifest_path: String,
    pub(crate) owner_pid: i32,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub(crate) owner_start_identity: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub(crate) owner_stack_id: String,
    pub(crate) path: String,
    pub(crate) service_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) devtools_control_port: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) document_injection_port: Option<u16>,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub(crate) access_log_name: String,
}

type InProcessStackStopper = Arc<dyn Fn(&str) -> Result<(), String> + Send + Sync>;

static IN_PROCESS_STACK_STOPPER: OnceLock<InProcessStackStopper> = OnceLock::new();

pub(crate) fn set_in_process_stack_stopper(stopper: InProcessStackStopper) {
    let _ = IN_PROCESS_STACK_STOPPER.set(stopper);
}

fn stop_in_process_zombie(
    owner_stack_id: &str,
    claim: &str,
    output: Option<&ServiceOutput>,
) -> Result<(), String> {
    if let Some(output) = output {
        output.log_stdout(
            "devhost",
            &format!("Stopping zombie stack {owner_stack_id} holding {claim}..."),
        );
    }
    if let Some(stopper) = IN_PROCESS_STACK_STOPPER.get() {
        stopper(owner_stack_id)?;
    }
    if let Some(output) = output {
        output.log_stdout(
            "devhost",
            &format!("Stopped zombie stack {owner_stack_id} holding {claim}."),
        );
    }
    Ok(())
}

fn is_same_owner(
    owner_pid: i32,
    owner_stack_id: &str,
    owner_manifest: &str,
    my_stack_id: &str,
    my_manifest: &str,
) -> bool {
    if owner_pid != current_pid() {
        return false;
    }
    if !my_stack_id.is_empty() || !owner_stack_id.is_empty() {
        owner_stack_id == my_stack_id
    } else {
        owner_manifest == my_manifest
    }
}

struct RegistrationSnapshot {
    path: PathBuf,
    contents: Option<Vec<u8>>,
}

pub fn claim_fixed_port(
    caddy_dir: &Path,
    bind_host: &str,
    port: u16,
    manifest_path: &str,
) -> Result<(), String> {
    claim_fixed_port_for_stack(
        caddy_dir,
        bind_host,
        port,
        manifest_path,
        "",
        false,
        None,
        None,
    )
}

pub fn claim_fixed_port_with_options(
    caddy_dir: &Path,
    bind_host: &str,
    port: u16,
    manifest_path: &str,
    kill_zombies: bool,
    zombie_cleanup: Option<&mut ZombieCleanup>,
    output: Option<&ServiceOutput>,
) -> Result<(), String> {
    claim_fixed_port_for_stack(
        caddy_dir,
        bind_host,
        port,
        manifest_path,
        "",
        kill_zombies,
        zombie_cleanup,
        output,
    )
}

#[allow(clippy::too_many_arguments)]
pub fn claim_fixed_port_for_stack(
    caddy_dir: &Path,
    bind_host: &str,
    port: u16,
    manifest_path: &str,
    stack_id: &str,
    kill_zombies: bool,
    zombie_cleanup: Option<&mut ZombieCleanup>,
    output: Option<&ServiceOutput>,
) -> Result<(), String> {
    let claim_path = fixed_port_claim_path(caddy_dir, bind_host, port);
    let claim = FixedPortClaimRecord {
        bind_host: bind_host.to_owned(),
        created_at: utc_timestamp(),
        manifest_path: manifest_path.to_owned(),
        owner_pid: current_pid(),
        owner_start_identity: own_start_identity(),
        owner_stack_id: stack_id.to_owned(),
        port,
    };
    let text = serde_json::to_string_pretty(&claim).expect("serialize fixed port claim");
    match write_exclusive(&claim_path, text.as_bytes()) {
        Ok(()) => return Ok(()),
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
        Err(error) => return path_ctx(Err(error), "write fixed port claim", &claim_path),
    }
    let existing_bytes = path_ctx(fs::read(&claim_path), "read fixed port claim", &claim_path)?;
    let existing: FixedPortClaimRecord = path_ctx(
        serde_json::from_slice(&existing_bytes),
        "parse fixed port claim",
        &claim_path,
    )?;
    let stale = existing.owner_pid != current_pid()
        && !procid::is_record_owner_alive(existing.owner_pid, &existing.owner_start_identity);
    if !stale {
        if kill_zombies && existing.manifest_path == manifest_path {
            let claim_label = format!("port {port}");
            if existing.owner_pid == current_pid()
                && !existing.owner_stack_id.is_empty()
                && existing.owner_stack_id != stack_id
            {
                stop_in_process_zombie(&existing.owner_stack_id, &claim_label, output)?;
                remove_if_exists(&claim_path)?;
                return path_ctx(
                    write_exclusive(&claim_path, text.as_bytes()),
                    "write fixed port claim",
                    &claim_path,
                );
            } else if existing.owner_pid != current_pid() {
                if let Some(cleanup) = zombie_cleanup {
                    cleanup.kill(
                        existing.owner_pid,
                        &existing.owner_start_identity,
                        &claim_label,
                        output,
                    )?;
                } else {
                    stop_zombie(
                        existing.owner_pid,
                        &existing.owner_start_identity,
                        &claim_label,
                        output,
                    )?;
                }
                remove_if_exists(&claim_path)?;
                return path_ctx(
                    write_exclusive(&claim_path, text.as_bytes()),
                    "write fixed port claim",
                    &claim_path,
                );
            }
        }
        return Err(format!(
            "{bind_host}:{port} is already claimed via {}.",
            existing.manifest_path
        ));
    }
    remove_if_exists(&claim_path)?;
    path_ctx(
        write_exclusive(&claim_path, text.as_bytes()),
        "write fixed port claim",
        &claim_path,
    )
}

pub fn cleanup_stale_fixed_port_claims(caddy_dir: &Path) -> Result<(), String> {
    let dir = caddy_dir.join("port-claims");
    if !dir.exists() {
        return Ok(());
    }
    for path in files::json_files(&dir, "read port claims directory")? {
        let bytes = path_ctx(fs::read(&path), "read fixed port claim", &path)?;
        let claim: FixedPortClaimRecord = path_ctx(
            serde_json::from_slice(&bytes),
            "parse fixed port claim",
            &path,
        )?;
        let stale = claim.owner_pid != current_pid()
            && !procid::is_record_owner_alive(claim.owner_pid, &claim.owner_start_identity);
        if stale {
            remove_if_exists(&path)?;
        }
    }
    Ok(())
}

pub fn release_fixed_port_claim(
    caddy_dir: &Path,
    bind_host: &str,
    port: u16,
    manifest_path: &str,
) -> Result<(), String> {
    release_fixed_port_claim_for_stack(caddy_dir, bind_host, port, manifest_path, "")
}

pub fn release_fixed_port_claim_for_stack(
    caddy_dir: &Path,
    bind_host: &str,
    port: u16,
    manifest_path: &str,
    stack_id: &str,
) -> Result<(), String> {
    let claim_path = fixed_port_claim_path(caddy_dir, bind_host, port);
    let bytes = match fs::read(&claim_path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return path_ctx(Err(error), "read fixed port claim", &claim_path),
    };
    let claim: FixedPortClaimRecord = path_ctx(
        serde_json::from_slice(&bytes),
        "parse fixed port claim",
        &claim_path,
    )?;
    if !is_same_owner(
        claim.owner_pid,
        &claim.owner_stack_id,
        &claim.manifest_path,
        stack_id,
        manifest_path,
    ) {
        return Ok(());
    }
    remove_if_exists(&claim_path)
}

pub fn claim_host(caddy_dir: &Path, host: &str, manifest_path: &str) -> Result<(), String> {
    claim_host_for_stack(caddy_dir, host, manifest_path, "", false, None, None)
}

pub fn claim_host_with_options(
    caddy_dir: &Path,
    host: &str,
    manifest_path: &str,
    kill_zombies: bool,
    zombie_cleanup: Option<&mut ZombieCleanup>,
    output: Option<&ServiceOutput>,
) -> Result<(), String> {
    claim_host_for_stack(
        caddy_dir,
        host,
        manifest_path,
        "",
        kill_zombies,
        zombie_cleanup,
        output,
    )
}

pub fn claim_host_for_stack(
    caddy_dir: &Path,
    host: &str,
    manifest_path: &str,
    stack_id: &str,
    kill_zombies: bool,
    mut zombie_cleanup: Option<&mut ZombieCleanup>,
    output: Option<&ServiceOutput>,
) -> Result<(), String> {
    let settings = read_running_settings(caddy_dir, &CaddySettings::default())?;
    if host.eq_ignore_ascii_case(settings.stack_directory_hostname()) {
        return Err(format!(
            "hostname {host} is reserved for the devhost stack directory"
        ));
    }
    assert_host_available(
        caddy_dir,
        host,
        manifest_path,
        stack_id,
        kill_zombies,
        zombie_cleanup.as_deref_mut(),
        output,
    )?;
    let claim_path = host_claim_path(caddy_dir, host);
    let claim = HostClaimRecord {
        created_at: utc_timestamp(),
        host: host.to_owned(),
        manifest_path: manifest_path.to_owned(),
        owner_pid: current_pid(),
        owner_start_identity: own_start_identity(),
        owner_stack_id: stack_id.to_owned(),
    };
    let text = serde_json::to_string_pretty(&claim).expect("serialize host claim");
    match write_exclusive(&claim_path, text.as_bytes()) {
        Ok(()) => return Ok(()),
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
        Err(error) => return path_ctx(Err(error), "write host claim", &claim_path),
    }
    let existing_bytes = path_ctx(fs::read(&claim_path), "read host claim", &claim_path)?;
    let existing: HostClaimRecord = path_ctx(
        serde_json::from_slice(&existing_bytes),
        "parse host claim",
        &claim_path,
    )?;
    let stale = existing.owner_pid != current_pid()
        && !procid::is_record_owner_alive(existing.owner_pid, &existing.owner_start_identity);
    if stale {
        remove_if_exists(&claim_path)?;
        return path_ctx(
            write_exclusive(&claim_path, text.as_bytes()),
            "write host claim",
            &claim_path,
        );
    }
    if is_same_owner(
        existing.owner_pid,
        &existing.owner_stack_id,
        &existing.manifest_path,
        stack_id,
        manifest_path,
    ) {
        return Ok(());
    }
    if kill_zombies && existing.manifest_path == manifest_path {
        if existing.owner_pid == current_pid()
            && !existing.owner_stack_id.is_empty()
            && existing.owner_stack_id != stack_id
        {
            stop_in_process_zombie(&existing.owner_stack_id, host, output)?;
            remove_if_exists(&claim_path)?;
            return path_ctx(
                write_exclusive(&claim_path, text.as_bytes()),
                "write host claim",
                &claim_path,
            );
        } else if existing.owner_pid != current_pid() {
            if let Some(cleanup) = zombie_cleanup {
                cleanup.kill(
                    existing.owner_pid,
                    &existing.owner_start_identity,
                    host,
                    output,
                )?;
            } else {
                stop_zombie(
                    existing.owner_pid,
                    &existing.owner_start_identity,
                    host,
                    output,
                )?;
            }
            remove_if_exists(&claim_path)?;
            return path_ctx(
                write_exclusive(&claim_path, text.as_bytes()),
                "write host claim",
                &claim_path,
            );
        }
    }
    Err(format!(
        "{host} is already claimed by PID {} from {}.",
        existing.owner_pid, existing.manifest_path
    ))
}

pub fn release_host_claim(caddy_dir: &Path, host: &str, manifest_path: &str) -> Result<(), String> {
    release_host_claim_for_stack(caddy_dir, host, manifest_path, "")
}

pub fn release_host_claim_for_stack(
    caddy_dir: &Path,
    host: &str,
    manifest_path: &str,
    stack_id: &str,
) -> Result<(), String> {
    let claim_path = host_claim_path(caddy_dir, host);
    let bytes = match fs::read(&claim_path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return path_ctx(Err(error), "read host claim", &claim_path),
    };
    let claim: HostClaimRecord = path_ctx(
        serde_json::from_slice(&bytes),
        "parse host claim",
        &claim_path,
    )?;
    if !is_same_owner(
        claim.owner_pid,
        &claim.owner_stack_id,
        &claim.manifest_path,
        stack_id,
        manifest_path,
    ) {
        return Ok(());
    }
    remove_if_exists(&claim_path)
}

pub fn cleanup_stale_registrations(caddy_dir: &Path) -> Result<(), String> {
    let _lock = route_lock(caddy_dir)?;
    let settings = read_running_settings(caddy_dir, &CaddySettings::default())?;
    let registrations_dir = caddy_dir.join("routes/.registrations");
    let mut affected_hosts = BTreeSet::new();
    for path in files::json_files(
        &registrations_dir,
        "read managed caddy registrations directory",
    )? {
        let Some(bytes) = files::read_listed_registration(&path)? else {
            continue;
        };
        let record: RouteRegistration = path_ctx(
            serde_json::from_slice(&bytes),
            "parse managed route registration",
            &path,
        )?;
        if procid::is_record_owner_alive(record.owner_pid, &record.owner_start_identity) {
            continue;
        }
        affected_hosts.insert(record.host);
        remove_if_exists(&path)?;
    }
    cleanup_stale_host_claims(&caddy_dir.join("routes/.host-claims"))?;
    for host in &affected_hosts {
        sync_host_route(caddy_dir, host, &settings)?;
    }
    if !affected_hosts.is_empty() {
        sync_not_found_site(caddy_dir, &settings)?;
    }
    Ok(())
}

/// Remove host claims, fixed-port claims, and route registrations owned by
/// `(owner_pid, manifest_path)` whose `owner_stack_id` is not present in
/// `active_stack_ids`, syncing Caddy when any route was removed. Used when
/// cleaning up orphaned records left under a live shared daemon without
/// signaling the daemon process itself.
pub fn release_orphaned_owner_records(
    caddy_dir: &Path,
    owner_pid: i32,
    manifest_path: &str,
    active_stack_ids: &BTreeSet<String>,
    mode: Mode,
    output: &mut impl io::Write,
) -> Result<usize, String> {
    let _lock = route_lock(caddy_dir)?;
    let target_identity = crate::paths::manifest_identity(Path::new(manifest_path));
    let mut removed = 0usize;

    let host_claims_dir = caddy_dir.join("routes/.host-claims");
    if host_claims_dir.exists() {
        for path in files::json_files(&host_claims_dir, "read host claims directory")? {
            let bytes = path_ctx(fs::read(&path), "read host claim", &path)?;
            let claim: HostClaimRecord =
                path_ctx(serde_json::from_slice(&bytes), "parse host claim", &path)?;
            if claim.owner_pid == owner_pid
                && crate::paths::manifest_identity(Path::new(&claim.manifest_path))
                    == target_identity
                && !active_stack_ids.contains(&claim.owner_stack_id)
            {
                remove_if_exists(&path)?;
                removed += 1;
            }
        }
    }

    let port_claims_dir = caddy_dir.join("port-claims");
    if port_claims_dir.exists() {
        for path in files::json_files(&port_claims_dir, "read fixed port claims directory")? {
            let bytes = path_ctx(fs::read(&path), "read fixed port claim", &path)?;
            let claim: FixedPortClaimRecord = path_ctx(
                serde_json::from_slice(&bytes),
                "parse fixed port claim",
                &path,
            )?;
            if claim.owner_pid == owner_pid
                && crate::paths::manifest_identity(Path::new(&claim.manifest_path))
                    == target_identity
                && !active_stack_ids.contains(&claim.owner_stack_id)
            {
                remove_if_exists(&path)?;
                removed += 1;
            }
        }
    }

    let mut affected_hosts = BTreeSet::new();
    let registrations_dir = caddy_dir.join("routes/.registrations");
    if registrations_dir.exists() {
        for path in files::json_files(
            &registrations_dir,
            "read managed caddy registrations directory",
        )? {
            let Some(bytes) = files::read_listed_registration(&path)? else {
                continue;
            };
            let record: RouteRegistration = path_ctx(
                serde_json::from_slice(&bytes),
                "parse managed route registration",
                &path,
            )?;
            if record.owner_pid == owner_pid
                && crate::paths::manifest_identity(Path::new(&record.manifest_path))
                    == target_identity
                && !active_stack_ids.contains(&record.owner_stack_id)
            {
                affected_hosts.insert(record.host);
                remove_if_exists(&path)?;
                removed += 1;
            }
        }
    }

    if !affected_hosts.is_empty() {
        let (settings, running) = read_route_settings(caddy_dir)?;
        for host in &affected_hosts {
            sync_host_route(caddy_dir, host, &settings)?;
        }
        sync_not_found_site(caddy_dir, &settings)?;
        if running {
            reload_managed_caddy(caddy_dir, &settings.admin_address, mode, output, true)?;
        }
    }
    Ok(removed)
}

pub fn replace_routes(
    caddy_dir: &Path,
    previous: &[ActivateRouteOptions],
    options: &[ActivateRouteOptions],
    manifest_path: &str,
    mode: Mode,
    output: &mut impl io::Write,
    quiet: bool,
) -> Result<(), String> {
    replace_routes_for_stack(
        caddy_dir,
        previous,
        options,
        manifest_path,
        "",
        mode,
        output,
        quiet,
    )
}

#[allow(clippy::too_many_arguments)]
pub fn replace_routes_for_stack(
    caddy_dir: &Path,
    previous: &[ActivateRouteOptions],
    options: &[ActivateRouteOptions],
    manifest_path: &str,
    stack_id: &str,
    mode: Mode,
    output: &mut impl io::Write,
    quiet: bool,
) -> Result<(), String> {
    let mut affected: Vec<&ActivateRouteOptions> = options.iter().collect();
    affected.extend(previous.iter());
    if affected.is_empty() {
        return Ok(());
    }
    let _lock = route_lock(caddy_dir)?;
    let (settings, running) = read_route_settings(caddy_dir)?;
    let snapshots = snapshot_registrations(caddy_dir, &affected)?;
    let mut reload_attempted = false;

    let apply = (|| -> Result<(), String> {
        let mut desired = BTreeSet::new();
        for route in options {
            let path = registration_path(caddy_dir, &route.service_name, &route.host, &route.path);
            desired.insert(path.clone());
            let record = RouteRegistration {
                proxy_local_origin: route.proxy_local_origin,
                app_bind_host: route.app_bind_host.clone(),
                app_port: route.app_port,
                created_at: utc_timestamp(),
                host: route.host.clone(),
                manifest_path: manifest_path.to_owned(),
                owner_pid: current_pid(),
                owner_start_identity: own_start_identity(),
                owner_stack_id: stack_id.to_owned(),
                path: normalize_route_path(&route.path),
                service_name: route.service_name.clone(),
                devtools_control_port: route.devtools_control_port,
                document_injection_port: route.document_injection_port,
                access_log_name: route.access_log_name.clone(),
            };
            let text = serde_json::to_string_pretty(&record).expect("serialize route registration");
            path_ctx(fs::write(&path, text), "write route registration", &path)?;
        }
        for route in previous {
            let path = registration_path(caddy_dir, &route.service_name, &route.host, &route.path);
            if desired.contains(&path) {
                continue;
            }
            let bytes = match fs::read(&path) {
                Ok(bytes) => bytes,
                Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
                Err(error) => return path_ctx(Err(error), "read route registration", &path),
            };
            let existing: RouteRegistration = path_ctx(
                serde_json::from_slice(&bytes),
                "parse route registration",
                &path,
            )?;
            if !is_same_owner(
                existing.owner_pid,
                &existing.owner_stack_id,
                &existing.manifest_path,
                stack_id,
                manifest_path,
            ) {
                return Err(format!(
                    "route {} is owned by another stack",
                    path.display()
                ));
            }
            remove_if_exists(&path)?;
        }
        sync_affected_hosts(caddy_dir, &affected, &settings)?;
        sync_not_found_site(caddy_dir, &settings)?;
        if !running {
            return Ok(());
        }
        reload_attempted = true;
        reload_managed_caddy(caddy_dir, &settings.admin_address, mode, output, quiet)
    })();

    if let Err(original) = apply {
        let mut errors = vec![original];
        if let Err(error) = restore_registrations(&snapshots) {
            errors.push(error);
        }
        if let Err(error) = sync_affected_hosts(caddy_dir, &affected, &settings) {
            errors.push(format!("restore host routes: {error}"));
        }
        if let Err(error) = sync_not_found_site(caddy_dir, &settings) {
            errors.push(format!("restore not-found site: {error}"));
        }
        if reload_attempted
            && snapshots.iter().any(|snap| snap.contents.is_some())
            && let Err(error) =
                reload_managed_caddy(caddy_dir, &settings.admin_address, mode, output, quiet)
        {
            errors.push(format!("reload restored Caddy configuration: {error}"));
        }
        return Err(errors.join("\n"));
    }
    Ok(())
}

pub fn apply_managed_settings(
    caddy_dir: &Path,
    settings: &CaddySettings,
    mode: Mode,
    output: &mut impl io::Write,
    quiet: bool,
) -> Result<bool, String> {
    let _lock = route_lock(caddy_dir)?;
    let (running, has_applied) = match files::read_applied_settings(caddy_dir)? {
        Some(applied) => (applied, true),
        None => (settings.clone(), false),
    };
    if has_applied && running == *settings {
        return Ok(false);
    }
    if let Err(error) = render_managed_settings(caddy_dir, settings) {
        let _ = render_managed_settings(caddy_dir, &running);
        return Err(error);
    }
    if let Err(error) = reload_managed_caddy(caddy_dir, &running.admin_address, mode, output, quiet)
    {
        let _ = render_managed_settings(caddy_dir, &running);
        return Err(error);
    }
    write_applied_settings(caddy_dir, settings)?;
    Ok(true)
}

pub(crate) fn render_managed_settings(
    caddy_dir: &Path,
    settings: &CaddySettings,
) -> Result<(), String> {
    sync_global_state(caddy_dir, settings)?;
    sync_not_found_site(caddy_dir, settings)
}

pub(crate) fn sync_global_state(caddy_dir: &Path, settings: &CaddySettings) -> Result<(), String> {
    let registrations_dir = caddy_dir.join("routes/.registrations");
    let mut hosts = BTreeSet::new();
    for path in files::json_files(
        &registrations_dir,
        "read managed caddy registrations directory",
    )? {
        let Some(bytes) = files::read_listed_registration(&path)? else {
            continue;
        };
        if let Ok(record) = serde_json::from_slice::<RouteRegistration>(&bytes) {
            hosts.insert(record.host);
        }
    }
    write_caddyfile(caddy_dir, settings)?;
    for host in hosts {
        sync_host_route(caddy_dir, &host, settings)?;
    }
    Ok(())
}

pub(crate) fn sync_host_route(
    caddy_dir: &Path,
    host: &str,
    settings: &CaddySettings,
) -> Result<(), String> {
    let registrations = read_host_registrations(caddy_dir, host)?;
    let route_path = host_route_path(caddy_dir, host);
    if registrations.is_empty() {
        return remove_if_exists(&route_path);
    }
    let snippet = render_host_route_snippet(&registrations, settings, caddy_dir)?;
    path_ctx(
        fs::write(&route_path, snippet),
        "write host route",
        &route_path,
    )
}

pub(crate) fn read_host_registrations(
    caddy_dir: &Path,
    host: &str,
) -> Result<Vec<RouteRegistration>, String> {
    let registrations_dir = caddy_dir.join("routes/.registrations");
    let mut registrations = Vec::new();
    for path in files::json_files(
        &registrations_dir,
        "read managed caddy registrations directory",
    )? {
        let Some(bytes) = files::read_listed_registration(&path)? else {
            continue;
        };
        let Ok(mut record) = serde_json::from_slice::<RouteRegistration>(&bytes) else {
            continue;
        };
        if record.host != host {
            continue;
        }
        record.path = normalize_route_path(&record.path);
        registrations.push(record);
    }
    registrations.sort_by(|left, right| {
        route_priority_weight(&right.path)
            .cmp(&route_priority_weight(&left.path))
            .then_with(|| left.service_name.cmp(&right.service_name))
    });
    Ok(registrations)
}

pub(crate) fn owner_urls(
    caddy_dir: &Path,
    pid: i32,
    identity: &str,
    stack_id: &str,
) -> Result<Vec<String>, String> {
    let settings = read_running_settings(caddy_dir, &CaddySettings::default())?;
    let mut urls = BTreeSet::new();
    for path in files::json_files(
        &caddy_dir.join("routes/.registrations"),
        "read managed route registrations",
    )? {
        let Some(bytes) = files::read_listed_registration(&path)? else {
            continue;
        };
        let record: RouteRegistration = path_ctx(
            serde_json::from_slice(&bytes),
            "read managed route registration",
            &path,
        )?;
        let matches_stack = stack_id.is_empty()
            || record.owner_stack_id.is_empty()
            || record.owner_stack_id == stack_id;
        if record.owner_pid == pid && record.owner_start_identity == identity && matches_stack {
            let path = record
                .path
                .split('*')
                .next()
                .filter(|path| !path.is_empty())
                .unwrap_or("/");
            urls.insert(files::create_managed_url(
                "https",
                &record.host,
                settings.https_port,
                path,
            ));
        }
    }
    Ok(urls.into_iter().collect())
}

fn route_priority_weight(path: &str) -> isize {
    if path == "/" {
        return -1;
    }
    if let Some(base) = path.strip_suffix("/*") {
        (base.len() as isize) * 10
    } else {
        (path.len() as isize) * 10 + 1
    }
}

fn render_host_route_snippet(
    registrations: &[RouteRegistration],
    settings: &CaddySettings,
    caddy_dir: &Path,
) -> Result<String, String> {
    let http_port = if settings.http_port == 0 {
        80
    } else {
        settings.http_port
    };
    let https_port = if settings.https_port == 0 {
        443
    } else {
        settings.https_port
    };
    let host = &registrations[0].host;
    let mut root_reg = None;
    let mut non_root = Vec::new();
    for reg in registrations {
        if reg.path == "/" {
            root_reg = Some(reg);
        } else {
            non_root.push(reg);
        }
    }
    let mut lines = Vec::new();
    if settings.http_enabled {
        lines.extend(render_site_block(
            &format_site_address("http", http_port, host),
            root_reg,
            &non_root,
            false,
            caddy_dir,
        )?);
    }
    lines.extend(render_site_block(
        &format_site_address("https", https_port, host),
        root_reg,
        &non_root,
        true,
        caddy_dir,
    )?);
    Ok(lines.join("\n"))
}

fn render_site_block(
    site_address: &str,
    root: Option<&RouteRegistration>,
    non_root: &[&RouteRegistration],
    use_tls: bool,
    caddy_dir: &Path,
) -> Result<Vec<String>, String> {
    let mut lines = vec![format!("{site_address} {{")];
    if use_tls {
        lines.push("    tls internal".to_owned());
    }
    lines.push(String::new());

    let access_log_name = root
        .filter(|r| !r.access_log_name.is_empty())
        .map(|r| r.access_log_name.as_str())
        .or_else(|| {
            non_root
                .iter()
                .find(|r| !r.access_log_name.is_empty())
                .map(|r| r.access_log_name.as_str())
        });
    if let Some(name) = access_log_name {
        let log_path = caddy_dir.join("logs").join(format!("{name}_access.log"));
        let log_slash = log_path.to_string_lossy().replace('\\', "/");
        lines.push("    log {".to_owned());
        lines.push(format!("        output file \"{log_slash}\""));
        lines.push("    }".to_owned());
        lines.push(String::new());
    }

    if let Some(root) = root
        && let Some(control_port) = root.devtools_control_port
    {
        lines.extend(render_named_proxy_handle(
            "@devhost_control path /__devhost__/*",
            "@devhost_control",
            control_port,
        ));
        lines.push(String::new());
    }

    for reg in non_root {
        lines.extend(render_service_handle(reg)?);
        lines.push(String::new());
    }

    if let Some(root) = root {
        if root.document_injection_port.is_some() {
            lines.extend(render_recovery_proxy_handle(root));
            lines.extend(render_document_proxy_handle(root)?);
            lines.push(String::new());
        }
        let target = app_target(root)?;
        let proxy_lines = render_service_proxy_lines(root, &target, true)?;
        lines.push("handle {".to_owned());
        lines.extend(indent_lines(&proxy_lines, 4));
        lines.push("}".to_owned());
    } else {
        lines.push("handle {".to_owned());
        lines.push("    error 404".to_owned());
        lines.push("}".to_owned());
    }
    lines.push("}\n".to_owned());
    Ok(lines)
}

fn render_service_handle(reg: &RouteRegistration) -> Result<Vec<String>, String> {
    let target = app_target(reg)?;
    let proxy_lines = render_service_proxy_lines(reg, &target, true)?;
    let mut lines = vec![format!("    handle {} {{", reg.path)];
    if reg.document_injection_port.is_some() {
        lines.extend(indent_lines(&render_recovery_proxy_handle(reg), 8));
        lines.extend(indent_lines(&render_document_proxy_handle(reg)?, 8));
        lines.push("        handle {".to_owned());
        lines.extend(indent_lines(&proxy_lines, 12));
        lines.push("        }".to_owned());
    } else {
        lines.extend(indent_lines(&proxy_lines, 8));
    }
    lines.push("    }".to_owned());
    Ok(lines)
}

fn render_recovery_proxy_handle(reg: &RouteRegistration) -> Vec<String> {
    let matcher = format!("@devhost_recovery_{}", reg.service_name);
    render_named_proxy_handle(
        &format!("{matcher} header X-Devhost-Recovery *"),
        &matcher,
        reg.document_injection_port.unwrap_or(0),
    )
}

fn render_document_proxy_handle(reg: &RouteRegistration) -> Result<Vec<String>, String> {
    let target = format_proxy_address("127.0.0.1", reg.document_injection_port.unwrap_or(0));
    let proxy_lines = render_service_proxy_lines(reg, &target, false)?;
    let matcher = format!("@devhost_document_{}", reg.service_name);
    let mut lines = vec![
        format!("{matcher} header Sec-Fetch-Dest document"),
        format!("handle {matcher} {{"),
    ];
    lines.extend(indent_lines(&proxy_lines, 4));
    lines.push("}".to_owned());
    Ok(lines)
}

fn render_named_proxy_handle(matcher: &str, name: &str, port: u16) -> Vec<String> {
    vec![
        matcher.to_owned(),
        format!("handle {name} {{"),
        format!(
            "    reverse_proxy {}",
            format_proxy_address("127.0.0.1", port)
        ),
        "}".to_owned(),
    ]
}

const FOREIGN_ORIGIN_MATCHER: &str = "@devhost_foreign_origin expression `{http.request.header.Origin} != '' && {http.request.header.Origin} != 'http://' + {http.request.hostport} && {http.request.header.Origin} != 'https://' + {http.request.hostport}`";

fn render_service_proxy_lines(
    reg: &RouteRegistration,
    target: &str,
    rewrite_host: bool,
) -> Result<Vec<String>, String> {
    if !reg.proxy_local_origin {
        return Ok(vec![format!("reverse_proxy {target}")]);
    }
    let local_target = app_target(reg)?;
    let mut lines = vec![
        "route {".to_owned(),
        format!("    {FOREIGN_ORIGIN_MATCHER}"),
        r#"    respond @devhost_foreign_origin "Origin does not match the routed host" 403"#
            .to_owned(),
        format!("    reverse_proxy {target} {{"),
    ];
    if rewrite_host {
        lines.push(format!("        header_up Host {local_target}"));
    }
    lines.push(format!(
        r#"        header_up Origin "^.+$" "http://{local_target}""#
    ));
    lines.push("    }".to_owned());
    lines.push("}".to_owned());
    Ok(lines)
}

fn indent_lines(lines: &[String], spaces: usize) -> Vec<String> {
    let prefix = " ".repeat(spaces);
    lines.iter().map(|line| format!("{prefix}{line}")).collect()
}

pub fn resolve_proxy_host(bind_host: &str) -> Result<&'static str, String> {
    match bind_host {
        "127.0.0.1" | "0.0.0.0" => Ok("127.0.0.1"),
        "::1" | "::" => Ok("::1"),
        other => Err(format!("Unsupported bind host: {other}")),
    }
}

fn app_target(reg: &RouteRegistration) -> Result<String, String> {
    let host = resolve_proxy_host(&reg.app_bind_host)?;
    Ok(format_proxy_address(host, reg.app_port))
}

pub fn format_proxy_address(host: &str, port: u16) -> String {
    if host.contains(':') {
        format!("[{host}]:{port}")
    } else {
        format!("{host}:{port}")
    }
}

fn assert_host_available(
    caddy_dir: &Path,
    host: &str,
    manifest_path: &str,
    stack_id: &str,
    kill_zombies: bool,
    mut zombie_cleanup: Option<&mut ZombieCleanup>,
    output: Option<&ServiceOutput>,
) -> Result<(), String> {
    let registrations_dir = caddy_dir.join("routes/.registrations");
    if !registrations_dir.exists() {
        return Ok(());
    }
    for path in files::json_files(
        &registrations_dir,
        "read managed caddy registrations directory",
    )? {
        let Some(bytes) = files::read_listed_registration(&path)? else {
            continue;
        };
        let record: RouteRegistration = path_ctx(
            serde_json::from_slice(&bytes),
            "parse managed route registration",
            &path,
        )?;
        if record.host != host
            || !procid::is_record_owner_alive(record.owner_pid, &record.owner_start_identity)
        {
            continue;
        }
        if is_same_owner(
            record.owner_pid,
            &record.owner_stack_id,
            &record.manifest_path,
            stack_id,
            manifest_path,
        ) {
            continue;
        }
        if kill_zombies && record.manifest_path == manifest_path {
            if record.owner_pid == current_pid()
                && !record.owner_stack_id.is_empty()
                && record.owner_stack_id != stack_id
            {
                stop_in_process_zombie(&record.owner_stack_id, host, output)?;
                remove_if_exists(&path)?;
                continue;
            } else if record.owner_pid != current_pid() {
                if let Some(cleanup) = zombie_cleanup.as_deref_mut() {
                    cleanup.kill(record.owner_pid, &record.owner_start_identity, host, output)?;
                } else {
                    stop_zombie(record.owner_pid, &record.owner_start_identity, host, output)?;
                }
                remove_if_exists(&path)?;
                continue;
            }
        }
        return Err(format!(
            "{host} is already claimed by PID {} from {}.",
            record.owner_pid, record.manifest_path
        ));
    }
    Ok(())
}

fn cleanup_stale_host_claims(host_claims_dir: &Path) -> Result<(), String> {
    if !host_claims_dir.exists() {
        return Ok(());
    }
    for path in files::json_files(host_claims_dir, "read host claims directory")? {
        let bytes = path_ctx(fs::read(&path), "read host claim", &path)?;
        let claim: HostClaimRecord =
            path_ctx(serde_json::from_slice(&bytes), "parse host claim", &path)?;
        let stale = claim.owner_pid != current_pid()
            && !procid::is_record_owner_alive(claim.owner_pid, &claim.owner_start_identity);
        if stale {
            remove_if_exists(&path)?;
        }
    }
    Ok(())
}

fn snapshot_registrations(
    caddy_dir: &Path,
    affected: &[&ActivateRouteOptions],
) -> Result<Vec<RegistrationSnapshot>, String> {
    let mut snapshots = Vec::new();
    let mut seen = BTreeSet::new();
    for route in affected {
        let path = registration_path(caddy_dir, &route.service_name, &route.host, &route.path);
        if !seen.insert(path.clone()) {
            continue;
        }
        let contents = match fs::read(&path) {
            Ok(bytes) => Some(bytes),
            Err(error) if error.kind() == io::ErrorKind::NotFound => None,
            Err(error) => return path_ctx(Err(error), "read previous route registration", &path),
        };
        snapshots.push(RegistrationSnapshot { path, contents });
    }
    Ok(snapshots)
}

fn restore_registrations(snapshots: &[RegistrationSnapshot]) -> Result<(), String> {
    let mut errors = Vec::new();
    for snap in snapshots {
        let result = match &snap.contents {
            Some(bytes) => path_ctx(
                fs::write(&snap.path, bytes),
                "restore route registration",
                &snap.path,
            ),
            None => remove_if_exists(&snap.path),
        };
        if let Err(error) = result {
            errors.push(error);
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("\n"))
    }
}

fn sync_affected_hosts(
    caddy_dir: &Path,
    affected: &[&ActivateRouteOptions],
    settings: &CaddySettings,
) -> Result<(), String> {
    let mut hosts = BTreeMap::new();
    for route in affected {
        hosts.insert(route.host.as_str(), ());
    }
    for host in hosts.keys() {
        sync_host_route(caddy_dir, host, settings)?;
    }
    Ok(())
}

fn registration_path(caddy_dir: &Path, service_name: &str, host: &str, path: &str) -> PathBuf {
    let normalized = normalize_route_path(path);
    let hex_path = encode_hex(normalized.as_bytes());
    caddy_dir.join("routes/.registrations").join(format!(
        "{}_{service_name}_{hex_path}.json",
        encode_path_segment(host)
    ))
}

fn host_route_path(caddy_dir: &Path, host: &str) -> PathBuf {
    caddy_dir
        .join("routes")
        .join(format!("{}.caddy", encode_path_segment(host)))
}

fn host_claim_path(caddy_dir: &Path, host: &str) -> PathBuf {
    caddy_dir
        .join("routes/.host-claims")
        .join(format!("{}.json", encode_path_segment(host)))
}

fn fixed_port_claim_path(caddy_dir: &Path, bind_host: &str, port: u16) -> PathBuf {
    let scope = match bind_host {
        "127.0.0.1" | "0.0.0.0" => "ipv4".to_owned(),
        "::1" | "::" => "ipv6".to_owned(),
        other => encode_path_segment(other),
    };
    caddy_dir
        .join("port-claims")
        .join(format!("{scope}_{port}.json"))
}

fn encode_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for &byte in bytes {
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 0x0f) as usize] as char);
    }
    out
}

fn write_exclusive(path: &Path, content: &[u8]) -> io::Result<()> {
    use std::io::Write;
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)?;
    file.write_all(content)
}

pub(crate) fn remove_if_exists(path: &Path) -> Result<(), String> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => path_ctx(Err(error), "remove", path),
    }
}

pub(crate) fn current_pid() -> i32 {
    std::process::id() as i32
}

pub(crate) fn own_start_identity() -> String {
    procid::start_identity(current_pid()).unwrap_or_default()
}

pub(crate) fn utc_timestamp() -> String {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let total_secs = duration.as_secs();
    let millis = duration.subsec_millis();
    let days = (total_secs / 86_400) as i64;
    let rem = total_secs % 86_400;
    let hour = rem / 3600;
    let minute = (rem % 3600) / 60;
    let second = rem % 60;
    // Civil date from days since 1970-01-01 (Howard Hinnant's algorithm)
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = (yoe as i64) + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if month <= 2 { y + 1 } else { y };
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}.{millis:03}Z")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn host_and_port_claims_detect_conflicts_and_reclaim_stale_records() {
        let fixture = tempfile::tempdir().unwrap();
        let caddy_dir = fixture.path().join("caddy");
        files::prepare_directories(&caddy_dir).unwrap();

        // Reserved stack-directory hostname is rejected.
        assert!(
            claim_host(&caddy_dir, "devhost.localhost", "/tmp/a/devhost.toml")
                .unwrap_err()
                .contains("reserved for the devhost stack directory")
        );

        // Claim and re-claim by same owner succeeds; different manifest conflicts.
        claim_host(&caddy_dir, "web.localhost", "/tmp/a/devhost.toml").unwrap();
        claim_host(&caddy_dir, "web.localhost", "/tmp/a/devhost.toml").unwrap();
        assert!(
            claim_host(&caddy_dir, "web.localhost", "/tmp/b/devhost.toml")
                .unwrap_err()
                .contains("is already claimed by PID")
        );
        release_host_claim(&caddy_dir, "web.localhost", "/tmp/b/devhost.toml").unwrap();
        assert!(host_claim_path(&caddy_dir, "web.localhost").exists());
        release_host_claim(&caddy_dir, "web.localhost", "/tmp/a/devhost.toml").unwrap();
        assert!(!host_claim_path(&caddy_dir, "web.localhost").exists());

        // Stale claim from dead PID is reclaimed.
        fs::write(
            host_claim_path(&caddy_dir, "stale.localhost"),
            r#"{"createdAt":"2026-01-01T00:00:00.000Z","host":"stale.localhost","manifestPath":"/old","ownerPid":99999999}"#,
        )
        .unwrap();
        claim_host(&caddy_dir, "stale.localhost", "/tmp/a/devhost.toml").unwrap();

        // Fixed port claims: live conflict, release, and stale reclaim.
        claim_fixed_port(&caddy_dir, "127.0.0.1", 3123, "/tmp/a/devhost.toml").unwrap();
        assert!(
            claim_fixed_port(&caddy_dir, "0.0.0.0", 3123, "/tmp/b/devhost.toml")
                .unwrap_err()
                .contains("is already claimed via")
        );
        release_fixed_port_claim(&caddy_dir, "127.0.0.1", 3123, "/tmp/b/devhost.toml").unwrap();
        release_fixed_port_claim(&caddy_dir, "127.0.0.1", 3123, "/tmp/a/devhost.toml").unwrap();
        fs::write(
            fixed_port_claim_path(&caddy_dir, "::1", 3124),
            r#"{"bindHost":"::1","createdAt":"2026-01-01T00:00:00.000Z","manifestPath":"/old","ownerPid":99999999,"port":3124}"#,
        )
        .unwrap();
        claim_fixed_port(&caddy_dir, "::", 3124, "/tmp/a/devhost.toml").unwrap();
    }

    #[test]
    fn route_replacement_renders_path_specificity_proxy_origin_and_rolls_back_on_error() {
        let fixture = tempfile::tempdir().unwrap();
        let caddy_dir = fixture.path().join("caddy");
        files::prepare_directories(&caddy_dir).unwrap();
        let mut log = Vec::new();

        let root_route = ActivateRouteOptions {
            proxy_local_origin: true,
            app_bind_host: "127.0.0.1".to_owned(),
            app_port: 3000,
            devtools_control_port: Some(4100),
            document_injection_port: Some(4101),
            host: "app.localhost".to_owned(),
            path: "/*".to_owned(),
            service_name: "web".to_owned(),
            access_log_name: "stack1".to_owned(),
        };
        let api_route = ActivateRouteOptions {
            proxy_local_origin: false,
            app_bind_host: "::1".to_owned(),
            app_port: 3001,
            devtools_control_port: None,
            document_injection_port: None,
            host: "app.localhost".to_owned(),
            path: "/api/*".to_owned(),
            service_name: "api".to_owned(),
            access_log_name: "stack1".to_owned(),
        };
        replace_routes(
            &caddy_dir,
            &[],
            &[root_route.clone(), api_route.clone()],
            "/tmp/a/devhost.toml",
            Mode::Agent,
            &mut log,
            true,
        )
        .unwrap();

        let snippet = fs::read_to_string(host_route_path(&caddy_dir, "app.localhost")).unwrap();
        assert!(snippet.contains("@devhost_control path /__devhost__/*"));
        assert!(snippet.contains("handle /api/*"));
        assert!(snippet.contains("reverse_proxy [::1]:3001"));
        assert!(snippet.contains("@devhost_document_web"));
        assert!(snippet.contains("@devhost_recovery_web"));
        assert!(snippet.contains("@devhost_foreign_origin"));
        assert!(snippet.contains("header_up Host 127.0.0.1:3000"));
        assert!(snippet.contains("stack1_access.log"));

        // Invalid bind host triggers rollback, preserving original routes.
        let bad_route = ActivateRouteOptions {
            app_bind_host: "10.0.0.9".to_owned(),
            ..api_route.clone()
        };
        let err = replace_routes(
            &caddy_dir,
            std::slice::from_ref(&api_route),
            &[bad_route],
            "/tmp/a/devhost.toml",
            Mode::Agent,
            &mut log,
            true,
        )
        .unwrap_err();
        assert!(err.contains("Unsupported bind host"));
        let restored = fs::read_to_string(host_route_path(&caddy_dir, "app.localhost")).unwrap();
        assert_eq!(restored, snippet);

        // Removing the root route leaves only /api/* with a root 404 handle.
        replace_routes(
            &caddy_dir,
            &[root_route],
            &[],
            "/tmp/a/devhost.toml",
            Mode::Agent,
            &mut log,
            true,
        )
        .unwrap();
        let updated = fs::read_to_string(host_route_path(&caddy_dir, "app.localhost")).unwrap();
        assert!(updated.contains("error 404"));
        assert!(updated.contains("handle /api/*"));

        // Stale registration cleanup removes dead-owner registrations and host claims.
        fs::write(
            registration_path(&caddy_dir, "old", "old.localhost", "/"),
            r#"{"appBindHost":"127.0.0.1","appPort":4000,"createdAt":"2026-01-01T00:00:00.000Z","host":"old.localhost","manifestPath":"/old","ownerPid":99999999,"path":"/","serviceName":"old"}"#,
        )
        .unwrap();
        fs::write(
            host_claim_path(&caddy_dir, "old.localhost"),
            r#"{"createdAt":"2026-01-01T00:00:00.000Z","host":"old.localhost","manifestPath":"/old","ownerPid":99999999}"#,
        )
        .unwrap();
        cleanup_stale_registrations(&caddy_dir).unwrap();
        assert!(!registration_path(&caddy_dir, "old", "old.localhost", "/").exists());
        assert!(!host_claim_path(&caddy_dir, "old.localhost").exists());

        // Live route registration from same manifest is reclaimed when kill_zombies is true.
        let mut live_owner = std::process::Command::new("sleep")
            .arg("20")
            .spawn()
            .unwrap();
        let owner_pid = live_owner.id() as i32;
        fs::write(
            registration_path(&caddy_dir, "zweb", "zroute.localhost", "/"),
            format!(
                r#"{{"appBindHost":"127.0.0.1","appPort":4010,"createdAt":"2026-01-01T00:00:00.000Z","host":"zroute.localhost","manifestPath":"/tmp/z/devhost.toml","ownerPid":{owner_pid},"path":"/","serviceName":"zweb"}}"#
            ),
        )
        .unwrap();
        assert!(
            claim_host(&caddy_dir, "zroute.localhost", "/tmp/z/devhost.toml")
                .unwrap_err()
                .contains("is already claimed by PID")
        );
        let mut cleanup = ZombieCleanup::default();
        claim_host_with_options(
            &caddy_dir,
            "zroute.localhost",
            "/tmp/z/devhost.toml",
            true,
            Some(&mut cleanup),
            None,
        )
        .unwrap();
        let _ = live_owner.wait();
        // Calling ZombieCleanup::kill again hits memoized result map.
        cleanup
            .kill(owner_pid, "", "zroute.localhost", None)
            .unwrap();
    }
}
