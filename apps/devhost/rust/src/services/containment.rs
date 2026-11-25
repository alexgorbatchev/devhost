use std::{
    collections::{BTreeMap, BTreeSet, VecDeque},
    sync::{
        Arc, Mutex, OnceLock,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

#[cfg(target_os = "linux")]
use std::{
    fs,
    net::{IpAddr, Ipv4Addr, Ipv6Addr},
    path::Path,
};

use crate::procid;

pub const SERVICE_CONTAINMENT_TOKEN_ENV: &str = "DEVHOST_SERVICE_TOKEN";
const PROCESS_TREE_POLL_INTERVAL: Duration = Duration::from_millis(200);

static CONTAINMENT_TOKEN_COUNTER: AtomicU64 = AtomicU64::new(0);

pub fn create_service_containment_token() -> String {
    let seq = CONTAINMENT_TOKEN_COUNTER.fetch_add(1, Ordering::Relaxed) + 1;
    format!("{}-{seq}", std::process::id())
}

#[cfg(target_os = "linux")]
pub fn prepare_service_containment() -> Result<(), String> {
    static RESULT: OnceLock<Result<(), String>> = OnceLock::new();
    RESULT
        .get_or_init(|| {
            // SAFETY: prctl(PR_SET_CHILD_SUBREAPER, 1, 0, 0, 0) sets the calling process as a
            // child subreaper on Linux and has no pointer arguments.
            let rc = unsafe { libc::prctl(libc::PR_SET_CHILD_SUBREAPER, 1, 0, 0, 0) };
            if rc != 0 {
                Err(format!(
                    "enable linux child subreaper containment: {}",
                    std::io::Error::last_os_error()
                ))
            } else {
                Ok(())
            }
        })
        .clone()
}

#[cfg(not(target_os = "linux"))]
pub fn prepare_service_containment() -> Result<(), String> {
    Ok(())
}

pub struct ServiceContainment {
    root_pid: i32,
    root_identity: Option<String>,
    service_token: String,
    tracked: Arc<Mutex<BTreeMap<i32, String>>>,
    stop_flag: Arc<AtomicBool>,
    poller: Option<JoinHandle<()>>,
}

impl ServiceContainment {
    pub fn start(root_pid: i32, service_token: String) -> Result<Self, String> {
        prepare_service_containment()?;
        let root_identity = procid::start_identity(root_pid).ok();
        let tracked = Arc::new(Mutex::new(BTreeMap::new()));
        let stop_flag = Arc::new(AtomicBool::new(false));
        refresh_tracked(&tracked, root_pid, root_identity.as_deref(), &service_token)?;

        let bg_tracked = tracked.clone();
        let bg_stop = stop_flag.clone();
        let bg_token = service_token.clone();
        let bg_identity = root_identity.clone();
        let poller = thread::spawn(move || {
            while !bg_stop.load(Ordering::Relaxed) {
                let end = std::time::Instant::now() + PROCESS_TREE_POLL_INTERVAL;
                while std::time::Instant::now() < end {
                    if bg_stop.load(Ordering::Relaxed) {
                        return;
                    }
                    thread::sleep(Duration::from_millis(25));
                }
                let _ = refresh_tracked(&bg_tracked, root_pid, bg_identity.as_deref(), &bg_token);
            }
        });

        Ok(Self {
            root_pid,
            root_identity,
            service_token,
            tracked,
            stop_flag,
            poller: Some(poller),
        })
    }

    pub fn live_descendant_pids(&self) -> Vec<i32> {
        let _ = refresh_tracked(
            &self.tracked,
            self.root_pid,
            self.root_identity.as_deref(),
            &self.service_token,
        );
        let mut guard = self.tracked.lock().expect("tracked lock");
        let mut live = Vec::new();
        guard.retain(|&pid, identity| {
            if pid == self.root_pid || !matches_identity(pid, identity) {
                false
            } else {
                live.push(pid);
                true
            }
        });
        live
    }

    pub fn has_live_descendants(&self) -> bool {
        !self.live_descendant_pids().is_empty()
    }

    pub(crate) fn live_process_identities(&self) -> Vec<(i32, String)> {
        self.live_descendant_pids();
        let mut processes: Vec<_> = self
            .tracked
            .lock()
            .expect("tracked lock")
            .iter()
            .map(|(&pid, identity)| (pid, identity.clone()))
            .collect();
        if let Some(identity) = &self.root_identity
            && matches_identity(self.root_pid, identity)
        {
            processes.push((self.root_pid, identity.clone()));
        }
        processes
    }

    pub fn signal(&self, include_root_group: bool, sig: i32) {
        // Discover new children before their parent can exit in response to this signal.
        // The shared polling snapshot may predate a detached child's creation.
        if let Ok(snapshot) = read_process_snapshot() {
            refresh_tracked_from_snapshot(
                &self.tracked,
                self.root_pid,
                self.root_identity.as_deref(),
                &self.service_token,
                &snapshot,
            );
        }
        let descendants = self.live_descendant_pids();
        let root_matches = self
            .root_identity
            .as_deref()
            .is_some_and(|identity| matches_identity(self.root_pid, identity));
        // A surviving verified group member also proves the original group still exists.
        let group_matches = descendants.iter().any(|&pid| {
            // SAFETY: getpgid reads the process group of a positive PID.
            unsafe { libc::getpgid(pid) == self.root_pid }
        });
        if include_root_group && (root_matches || group_matches) {
            // Never fall back to the root PID: it may have exited while its group survived.
            // SAFETY: a verified live member authorizes this original process group.
            unsafe {
                libc::kill(-self.root_pid, sig);
            }
        }
        let guard = self.tracked.lock().expect("tracked lock");
        for pid in descendants {
            if let Some(identity) = guard.get(&pid) {
                signal_identity(pid, identity, sig);
            }
        }
    }

    pub fn close(&mut self) {
        self.stop_flag.store(true, Ordering::Relaxed);
        if let Some(handle) = self.poller.take() {
            let _ = handle.join();
        }
    }
}

impl Drop for ServiceContainment {
    fn drop(&mut self) {
        self.close();
    }
}

pub fn send_signal_to_group(pid: i32, sig: i32) {
    if pid <= 0 {
        return;
    }
    #[cfg(unix)]
    {
        // SAFETY: kill(-pid, sig) delivers signal to process group -pid.
        let rc = unsafe { libc::kill(-pid, sig) };
        if rc != 0 {
            send_signal_to_pid(pid, sig);
        }
    }
}

pub fn send_signal_to_pid(pid: i32, sig: i32) {
    if pid <= 0 {
        return;
    }
    #[cfg(unix)]
    {
        // SAFETY: libc::kill delivers a POSIX signal to the target PID.
        let _ = unsafe { libc::kill(pid, sig) };
    }
}

fn refresh_tracked(
    tracked: &Arc<Mutex<BTreeMap<i32, String>>>,
    root_pid: i32,
    root_identity: Option<&str>,
    service_token: &str,
) -> Result<(), String> {
    let snapshot = shared_process_snapshot()?;
    refresh_tracked_from_snapshot(tracked, root_pid, root_identity, service_token, &snapshot);
    Ok(())
}

fn refresh_tracked_from_snapshot(
    tracked: &Arc<Mutex<BTreeMap<i32, String>>>,
    root_pid: i32,
    root_identity: Option<&str>,
    service_token: &str,
    snapshot: &ProcessSnapshot,
) {
    let children_by_parent = &snapshot.children;
    let mut guard = tracked.lock().expect("tracked lock");
    guard.retain(|&pid, identity| matches_identity(pid, identity));
    let mut roots: Vec<i32> = guard
        .iter()
        .filter_map(|(&pid, identity)| {
            (snapshot.identities.get(&pid) == Some(identity)).then_some(pid)
        })
        .collect();
    if root_identity.is_some_and(|identity| {
        snapshot
            .identities
            .get(&root_pid)
            .is_some_and(|cached| cached == identity)
            && matches_identity(root_pid, identity)
    }) {
        roots.push(root_pid);
    }
    let mut descendants = Vec::new();
    for pid in roots {
        descendants.extend(collect_descendant_pids(snapshot, pid));
    }
    for pid in collect_platform_containment_root_pids(children_by_parent, service_token) {
        if snapshot
            .identities
            .get(&pid)
            .is_some_and(|identity| matches_identity(pid, identity))
        {
            descendants.push(pid);
            descendants.extend(collect_descendant_pids(snapshot, pid));
        }
    }
    for pid in descendants {
        if let Some(identity) = snapshot.identities.get(&pid)
            && matches_identity(pid, identity)
        {
            guard.entry(pid).or_insert_with(|| identity.clone());
        }
    }
}

fn matches_identity(pid: i32, identity: &str) -> bool {
    procid::start_identity(pid).is_ok_and(|current| current == identity)
        && procid::is_process_alive(pid)
}

fn signal_identity(pid: i32, identity: &str, sig: i32) {
    #[cfg(target_os = "linux")]
    {
        use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
        // SAFETY: pidfd_open accepts a positive PID and zero flags, returning an owned fd.
        let fd = unsafe { libc::syscall(libc::SYS_pidfd_open, pid, 0) } as i32;
        if fd >= 0 {
            // SAFETY: a successful pidfd_open returned a fresh descriptor.
            let fd = unsafe { OwnedFd::from_raw_fd(fd) };
            if matches_identity(pid, identity) {
                // SAFETY: this pidfd pins the process; a null siginfo requests ordinary delivery.
                unsafe {
                    libc::syscall(
                        libc::SYS_pidfd_send_signal,
                        fd.as_raw_fd(),
                        sig,
                        std::ptr::null::<libc::siginfo_t>(),
                        0,
                    );
                }
            }
            return;
        }
    }
    if matches_identity(pid, identity) {
        send_signal_to_pid(pid, sig);
    }
}

struct ProcessSnapshot {
    children: BTreeMap<i32, Vec<i32>>,
    identities: BTreeMap<i32, String>,
}

fn shared_process_snapshot() -> Result<Arc<ProcessSnapshot>, String> {
    struct CachedSnapshot {
        read_at: Instant,
        snapshot: Arc<ProcessSnapshot>,
    }
    static SNAPSHOT: OnceLock<Mutex<Option<CachedSnapshot>>> = OnceLock::new();
    let mut cache = SNAPSHOT
        .get_or_init(|| Mutex::new(None))
        .lock()
        .expect("process snapshot");
    if let Some(cached) = cache.as_ref()
        && cached.read_at.elapsed() < PROCESS_TREE_POLL_INTERVAL
    {
        return Ok(cached.snapshot.clone());
    }
    let snapshot = Arc::new(read_process_snapshot()?);
    *cache = Some(CachedSnapshot {
        read_at: Instant::now(),
        snapshot: snapshot.clone(),
    });
    Ok(snapshot)
}

fn collect_descendant_pids(snapshot: &ProcessSnapshot, root_pid: i32) -> Vec<i32> {
    let children_by_parent = &snapshot.children;
    let mut queue = VecDeque::new();
    if let Some(children) = children_by_parent.get(&root_pid) {
        queue.extend(children.iter().copied());
    }
    let mut seen = BTreeSet::new();
    let mut descendants = Vec::new();
    while let Some(pid) = queue.pop_front() {
        if !seen.insert(pid)
            || !snapshot
                .identities
                .get(&pid)
                .is_some_and(|identity| matches_identity(pid, identity))
        {
            continue;
        }
        descendants.push(pid);
        if let Some(children) = children_by_parent.get(&pid) {
            queue.extend(children.iter().copied());
        }
    }
    descendants
}

#[cfg(target_os = "linux")]
fn read_process_snapshot() -> Result<ProcessSnapshot, String> {
    let entries = fs::read_dir("/proc").map_err(|error| format!("read /proc: {error}"))?;
    let mut children_by_parent: BTreeMap<i32, Vec<i32>> = BTreeMap::new();
    let mut identities = BTreeMap::new();
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name_str) = name.to_str() else {
            continue;
        };
        let Ok(pid) = name_str.parse::<i32>() else {
            continue;
        };
        let Ok(stat) = procid::read_linux_stat(pid) else {
            continue;
        };
        if let Ok(identity) = procid::linux_stat_identity(&stat) {
            identities.insert(pid, identity);
        }
        children_by_parent
            .entry(stat.parent_pid)
            .or_default()
            .push(pid);
    }
    Ok(ProcessSnapshot {
        children: children_by_parent,
        identities,
    })
}

#[cfg(target_os = "macos")]
fn read_process_snapshot() -> Result<ProcessSnapshot, String> {
    use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System};
    let mut system = System::new();
    system.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing().without_tasks(),
    );
    if system.processes().is_empty() {
        return Err("read process table: no processes returned".to_owned());
    }
    let mut children_by_parent: BTreeMap<i32, Vec<i32>> = BTreeMap::new();
    let mut identities = BTreeMap::new();
    for pid in system.processes().keys() {
        if pid.as_u32() == 0 {
            continue;
        }
        // Read the parent and start identity from one kernel record.
        if let Ok(info) = procid::read_macos_info(pid.as_u32() as i32) {
            identities.insert(pid.as_u32() as i32, procid::macos_info_identity(&info));
            children_by_parent
                .entry(info.pbi_ppid as i32)
                .or_default()
                .push(pid.as_u32() as i32);
        }
    }
    Ok(ProcessSnapshot {
        children: children_by_parent,
        identities,
    })
}

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
fn read_process_snapshot() -> Result<ProcessSnapshot, String> {
    Ok(ProcessSnapshot {
        children: BTreeMap::new(),
        identities: BTreeMap::new(),
    })
}

#[cfg(target_os = "linux")]
fn collect_platform_containment_root_pids(
    children_by_parent: &BTreeMap<i32, Vec<i32>>,
    service_token: &str,
) -> Vec<i32> {
    if service_token.is_empty() {
        return Vec::new();
    }
    let self_pid = std::process::id() as i32;
    let Some(children) = children_by_parent.get(&self_pid) else {
        return Vec::new();
    };
    let mut roots = Vec::new();
    for &pid in children {
        if read_linux_process_env(pid, SERVICE_CONTAINMENT_TOKEN_ENV).as_deref()
            == Some(service_token)
        {
            roots.push(pid);
        }
    }
    roots
}

#[cfg(not(target_os = "linux"))]
fn collect_platform_containment_root_pids(
    _children_by_parent: &BTreeMap<i32, Vec<i32>>,
    _service_token: &str,
) -> Vec<i32> {
    Vec::new()
}

#[cfg(target_os = "linux")]
fn read_linux_process_env(pid: i32, key: &str) -> Option<String> {
    let bytes = fs::read(format!("/proc/{pid}/environ")).ok()?;
    let prefix = format!("{key}=");
    for part in bytes.split(|&b| b == 0) {
        let Ok(text) = std::str::from_utf8(part) else {
            continue;
        };
        if let Some(value) = text.strip_prefix(&prefix) {
            return Some(value.to_owned());
        }
    }
    None
}

#[cfg(target_os = "linux")]
pub fn read_listening_process_ids_for_bind_host(bind_host: &str, port: u16) -> Vec<i32> {
    let Ok(target_ip) = bind_host.trim().parse::<IpAddr>() else {
        return Vec::new();
    };
    let inodes = read_linux_listening_socket_inodes(target_ip, port);
    if inodes.is_empty() {
        return Vec::new();
    }
    read_linux_listening_pids_by_inode(&inodes)
}

#[cfg(not(target_os = "linux"))]
pub fn read_listening_process_ids_for_bind_host(bind_host: &str, port: u16) -> Vec<i32> {
    let Ok(output) = std::process::Command::new("lsof")
        .args([
            "-nP",
            &format!("-iTCP@{bind_host}:{port}"),
            "-sTCP:LISTEN",
            "-Fp",
        ])
        .stdin(std::process::Stdio::null())
        .output()
    else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }
    parse_lsof_pids(&String::from_utf8_lossy(&output.stdout))
}

#[cfg(any(test, not(target_os = "linux")))]
fn parse_lsof_pids(output: &str) -> Vec<i32> {
    output
        .lines()
        .filter_map(|line| line.strip_prefix('p')?.parse::<i32>().ok())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

pub(crate) fn read_process_listeners(
    processes: &[(i32, String)],
) -> Result<BTreeMap<u16, String>, String> {
    let mut listeners = BTreeMap::new();
    for (pid, identity) in processes {
        if !matches_identity(*pid, identity) {
            continue;
        }
        let found = process_listeners(*pid);
        if !matches_identity(*pid, identity) {
            continue;
        }
        for (port, host) in found? {
            listeners
                .entry(port)
                .and_modify(|old: &mut String| {
                    if host < *old {
                        *old = host.clone();
                    }
                })
                .or_insert(host);
        }
    }
    Ok(listeners)
}

#[cfg(target_os = "linux")]
fn process_listeners(pid: i32) -> Result<Vec<(u16, String)>, String> {
    let directory = format!("/proc/{pid}");
    let entries = fs::read_dir(format!("{directory}/fd"))
        .map_err(|error| format!("discover listeners for PID {pid}: {error}"))?;
    let sockets: BTreeSet<_> = entries
        .filter_map(Result::ok)
        .filter_map(|entry| fs::read_link(entry.path()).ok())
        .filter_map(|link| {
            link.to_str()?
                .strip_prefix("socket:[")?
                .strip_suffix(']')
                .map(str::to_owned)
        })
        .collect();
    let mut listeners = Vec::new();
    for table in ["tcp", "tcp6"] {
        let text = match fs::read_to_string(format!("{directory}/net/{table}")) {
            Ok(text) => text,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => return Err(format!("discover listeners for PID {pid}: {error}")),
        };
        for line in text.lines().skip(1) {
            let fields: Vec<_> = line.split_whitespace().collect();
            if fields.len() < 10 || fields[3] != "0A" || !sockets.contains(fields[9]) {
                continue;
            }
            if let Some((mut ip, port)) = parse_linux_socket_address(fields[1])
                && port > 0
            {
                if ip.is_unspecified() {
                    ip = match ip {
                        IpAddr::V4(_) => IpAddr::V4(Ipv4Addr::LOCALHOST),
                        IpAddr::V6(_) => IpAddr::V6(Ipv6Addr::LOCALHOST),
                    };
                }
                listeners.push((port, ip.to_string()));
            }
        }
    }
    Ok(listeners)
}

#[cfg(not(target_os = "linux"))]
fn process_listeners(pid: i32) -> Result<Vec<(u16, String)>, String> {
    let output = std::process::Command::new("lsof")
        .args([
            "-nP",
            "-a",
            "-p",
            &pid.to_string(),
            "-iTCP",
            "-sTCP:LISTEN",
            "-Ftn",
        ])
        .stdin(std::process::Stdio::null())
        .output()
        .map_err(|error| format!("discover listeners for PID {pid}: {error}"))?;
    if !output.status.success() && output.status.code() != Some(1) {
        return Err(format!(
            "discover listeners for PID {pid}: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    Ok(parse_process_listeners(&String::from_utf8_lossy(
        &output.stdout,
    )))
}

#[cfg(any(test, not(target_os = "linux")))]
fn parse_process_listeners(text: &str) -> Vec<(u16, String)> {
    let mut ipv6 = false;
    text.lines()
        .filter_map(|line| {
            if line.starts_with('t') {
                ipv6 = line == "tIPv6";
            }
            let (host, port) = line.strip_prefix('n')?.rsplit_once(':')?;
            let port: u16 = port.parse().ok()?;
            let host = host.trim_matches(['[', ']']);
            let host = match host {
                "*" | "" | "0.0.0.0" if !ipv6 => "127.0.0.1",
                "*" | "" | "::" => "::1",
                host => host,
            };
            (port > 0).then(|| (port, host.to_owned()))
        })
        .collect()
}

#[cfg(target_os = "linux")]
fn read_linux_listening_socket_inodes(target_ip: IpAddr, port: u16) -> BTreeSet<String> {
    let mut inodes = BTreeSet::new();
    for path in ["/proc/net/tcp", "/proc/net/tcp6"] {
        let Ok(text) = fs::read_to_string(path) else {
            continue;
        };
        for line in text.lines().skip(1) {
            let fields: Vec<&str> = line.split_whitespace().collect();
            if fields.len() < 10 || fields[3] != "0A" {
                continue;
            }
            if let Some((local_ip, local_port)) = parse_linux_socket_address(fields[1])
                && local_port == port
                && local_ip == target_ip
            {
                inodes.insert(fields[9].to_owned());
            }
        }
    }
    inodes
}

#[cfg(target_os = "linux")]
fn parse_linux_socket_address(value: &str) -> Option<(IpAddr, u16)> {
    let (ip_hex, port_hex) = value.split_once(':')?;
    let port = u16::from_str_radix(port_hex, 16).ok()?;
    let bytes = decode_hex_bytes(ip_hex)?;
    let ip = match bytes.len() {
        4 => IpAddr::V4(Ipv4Addr::new(bytes[3], bytes[2], bytes[1], bytes[0])),
        16 => {
            let mut decoded = [0u8; 16];
            for chunk in (0..16).step_by(4) {
                decoded[chunk] = bytes[chunk + 3];
                decoded[chunk + 1] = bytes[chunk + 2];
                decoded[chunk + 2] = bytes[chunk + 1];
                decoded[chunk + 3] = bytes[chunk];
            }
            IpAddr::V6(Ipv6Addr::from(decoded))
        }
        _ => return None,
    };
    Some((ip, port))
}

#[cfg(target_os = "linux")]
fn decode_hex_bytes(hex: &str) -> Option<Vec<u8>> {
    if !hex.len().is_multiple_of(2) {
        return None;
    }
    let mut out = Vec::with_capacity(hex.len() / 2);
    for idx in (0..hex.len()).step_by(2) {
        let byte = u8::from_str_radix(&hex[idx..idx + 2], 16).ok()?;
        out.push(byte);
    }
    Some(out)
}

#[cfg(target_os = "linux")]
fn read_linux_listening_pids_by_inode(target_inodes: &BTreeSet<String>) -> Vec<i32> {
    let Ok(entries) = fs::read_dir("/proc") else {
        return Vec::new();
    };
    let mut pids = BTreeSet::new();
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name_str) = name.to_str() else {
            continue;
        };
        let Ok(pid) = name_str.parse::<i32>() else {
            continue;
        };
        let fd_dir = Path::new("/proc").join(name_str).join("fd");
        let Ok(fds) = fs::read_dir(&fd_dir) else {
            continue;
        };
        for fd in fds.flatten() {
            let Ok(target) = fs::read_link(fd.path()) else {
                continue;
            };
            let target_str = target.to_string_lossy();
            if let Some(inode) = target_str
                .strip_prefix("socket:[")
                .and_then(|rest| rest.strip_suffix(']'))
                && target_inodes.contains(inode)
            {
                pids.insert(pid);
                break;
            }
        }
    }
    pids.into_iter().collect()
}

#[cfg(test)]
mod tests {
    use std::{net::TcpListener, os::unix::process::CommandExt, process::Command};

    use super::*;

    struct Child(std::process::Child);
    impl Drop for Child {
        fn drop(&mut self) {
            // SAFETY: this fixture owns the child's isolated process group.
            unsafe { libc::kill(-(self.0.id() as i32), libc::SIGKILL) };
            let _ = self.0.wait();
        }
    }

    #[test]
    fn reused_root_and_descendant_identities_cannot_authorize_signals() {
        let mut child = Child(
            Command::new("sleep")
                .arg("30")
                .process_group(0)
                .spawn()
                .unwrap(),
        );
        let pid = child.0.id() as i32;
        let mut containment = ServiceContainment::start(pid, String::new()).unwrap();
        containment.close();
        containment.root_identity = Some("previous-process".to_owned());
        containment
            .tracked
            .lock()
            .unwrap()
            .insert(pid, "previous-process".to_owned());
        containment.signal(true, libc::SIGKILL);
        assert!(child.0.try_wait().unwrap().is_none());
        assert!(containment.live_descendant_pids().is_empty());
        signal_identity(pid, "previous-process", libc::SIGKILL);
        assert!(child.0.try_wait().unwrap().is_none());
    }

    #[test]
    fn concurrent_services_reuse_one_process_snapshot() {
        let first = shared_process_snapshot().unwrap();
        let others: Vec<_> = (0..8)
            .map(|_| thread::spawn(shared_process_snapshot))
            .collect();
        for other in others {
            assert!(Arc::ptr_eq(&first, &other.join().unwrap().unwrap()));
        }
    }

    #[test]
    fn containment_tracks_and_kills_escaped_descendant_and_reads_listener_pid() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        #[cfg(any(target_os = "linux", target_os = "macos"))]
        {
            let pids = read_listening_process_ids_for_bind_host("127.0.0.1", port);
            assert!(pids.contains(&(std::process::id() as i32)));
        }
        #[cfg(target_os = "linux")]
        {
            let parsed_v4 = parse_linux_socket_address("0100007F:0050").unwrap();
            assert_eq!(parsed_v4, (IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1)), 80));
            let parsed_v6 =
                parse_linux_socket_address("00000000000000000000000001000000:01BB").unwrap();
            assert_eq!(parsed_v6, (IpAddr::V6(Ipv6Addr::LOCALHOST), 443));
        }
        drop(listener);

        let token = create_service_containment_token();
        let mut child = Child(
            Command::new("sh")
                .args(["-c", "sleep 30 & wait"])
                .env(SERVICE_CONTAINMENT_TOKEN_ENV, &token)
                .process_group(0)
                .spawn()
                .unwrap(),
        );
        let root_pid = child.0.id() as i32;
        let mut containment = ServiceContainment::start(root_pid, token).unwrap();

        let deadline = std::time::Instant::now() + Duration::from_secs(3);
        while !containment.has_live_descendants() && std::time::Instant::now() < deadline {
            thread::sleep(Duration::from_millis(20));
        }
        assert!(containment.has_live_descendants());

        containment.signal(true, libc::SIGKILL);
        let _ = child.0.wait();
        let wait_dead = std::time::Instant::now() + Duration::from_secs(3);
        while containment.has_live_descendants() && std::time::Instant::now() < wait_dead {
            thread::sleep(Duration::from_millis(20));
        }
        assert!(!containment.has_live_descendants());
        containment.close();
    }

    #[test]
    fn listener_pid_fields_are_sorted_and_deduplicated() {
        assert_eq!(parse_lsof_pids("p9\np3\nf12\np9\npbroken\np\n"), [3, 9]);
    }

    #[test]
    fn command_listener_fields_normalize_wildcard_and_ipv6_addresses() {
        assert_eq!(
            parse_process_listeners(
                "p123\ntIPv4\nn*:1234\ntIPv6\nn[::]:2345\nn[::1]:3456\nn[fe80::1]:4567\nninvalid\nn127.0.0.1:0\n"
            ),
            vec![
                (1234, "127.0.0.1".to_owned()),
                (2345, "::1".to_owned()),
                (3456, "::1".to_owned()),
                (4567, "fe80::1".to_owned())
            ]
        );
    }
}
