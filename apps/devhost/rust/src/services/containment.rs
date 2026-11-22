use std::{
    collections::{BTreeMap, BTreeSet, VecDeque},
    fs,
    net::{IpAddr, Ipv4Addr, Ipv6Addr},
    path::Path,
    sync::{
        Arc, Mutex, OnceLock,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    thread::{self, JoinHandle},
    time::Duration,
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
    service_token: String,
    tracked: Arc<Mutex<BTreeSet<i32>>>,
    stop_flag: Arc<AtomicBool>,
    poller: Option<JoinHandle<()>>,
}

impl ServiceContainment {
    pub fn start(root_pid: i32, service_token: String) -> Result<Self, String> {
        prepare_service_containment()?;
        let tracked = Arc::new(Mutex::new(BTreeSet::new()));
        let stop_flag = Arc::new(AtomicBool::new(false));
        refresh_tracked(&tracked, root_pid, &service_token)?;

        let bg_tracked = tracked.clone();
        let bg_stop = stop_flag.clone();
        let bg_token = service_token.clone();
        let poller = thread::spawn(move || {
            while !bg_stop.load(Ordering::Relaxed) {
                let end = std::time::Instant::now() + PROCESS_TREE_POLL_INTERVAL;
                while std::time::Instant::now() < end {
                    if bg_stop.load(Ordering::Relaxed) {
                        return;
                    }
                    thread::sleep(Duration::from_millis(25));
                }
                let _ = refresh_tracked(&bg_tracked, root_pid, &bg_token);
            }
        });

        Ok(Self {
            root_pid,
            service_token,
            tracked,
            stop_flag,
            poller: Some(poller),
        })
    }

    pub fn live_descendant_pids(&self) -> Vec<i32> {
        let _ = refresh_tracked(&self.tracked, self.root_pid, &self.service_token);
        let mut guard = self.tracked.lock().expect("tracked lock");
        let mut live = Vec::new();
        guard.retain(|&pid| {
            if pid == self.root_pid || !procid::is_process_alive(pid) {
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

    pub fn signal(&self, include_root_group: bool, sig: i32) {
        let _ = refresh_tracked(&self.tracked, self.root_pid, &self.service_token);
        if include_root_group {
            send_signal_to_group(self.root_pid, sig);
        }
        for pid in self.live_descendant_pids() {
            send_signal_to_pid(pid, sig);
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
    tracked: &Arc<Mutex<BTreeSet<i32>>>,
    root_pid: i32,
    service_token: &str,
) -> Result<(), String> {
    let children_by_parent = read_process_snapshot()?;
    let mut descendants = collect_descendant_pids(&children_by_parent, root_pid);
    for pid in collect_platform_containment_root_pids(&children_by_parent, service_token) {
        descendants.push(pid);
        descendants.extend(collect_descendant_pids(&children_by_parent, pid));
    }
    let mut guard = tracked.lock().expect("tracked lock");
    guard.extend(descendants);
    Ok(())
}

fn collect_descendant_pids(
    children_by_parent: &BTreeMap<i32, Vec<i32>>,
    root_pid: i32,
) -> Vec<i32> {
    let mut queue = VecDeque::new();
    if let Some(children) = children_by_parent.get(&root_pid) {
        queue.extend(children.iter().copied());
    }
    let mut seen = BTreeSet::new();
    let mut descendants = Vec::new();
    while let Some(pid) = queue.pop_front() {
        if !seen.insert(pid) {
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
fn read_process_snapshot() -> Result<BTreeMap<i32, Vec<i32>>, String> {
    let entries = fs::read_dir("/proc").map_err(|error| format!("read /proc: {error}"))?;
    let mut children_by_parent: BTreeMap<i32, Vec<i32>> = BTreeMap::new();
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
        children_by_parent
            .entry(stat.parent_pid)
            .or_default()
            .push(pid);
    }
    Ok(children_by_parent)
}

#[cfg(not(target_os = "linux"))]
fn read_process_snapshot() -> Result<BTreeMap<i32, Vec<i32>>, String> {
    Ok(BTreeMap::new())
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
pub fn read_listening_process_ids_for_bind_host(_bind_host: &str, _port: u16) -> Vec<i32> {
    Vec::new()
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

    #[test]
    fn containment_tracks_and_kills_escaped_descendant_and_reads_listener_pid() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        #[cfg(target_os = "linux")]
        {
            let pids = read_listening_process_ids_for_bind_host("127.0.0.1", port);
            assert!(pids.contains(&(std::process::id() as i32)));
            let parsed_v4 = parse_linux_socket_address("0100007F:0050").unwrap();
            assert_eq!(parsed_v4, (IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1)), 80));
            let parsed_v6 =
                parse_linux_socket_address("00000000000000000000000001000000:01BB").unwrap();
            assert_eq!(parsed_v6, (IpAddr::V6(Ipv6Addr::LOCALHOST), 443));
        }
        drop(listener);

        let token = create_service_containment_token();
        let mut child = Command::new("sh")
            .args(["-c", "sleep 30 & wait"])
            .env(SERVICE_CONTAINMENT_TOKEN_ENV, &token)
            .process_group(0)
            .spawn()
            .unwrap();
        let root_pid = child.id() as i32;
        let mut containment = ServiceContainment::start(root_pid, token).unwrap();

        let deadline = std::time::Instant::now() + Duration::from_secs(3);
        while !containment.has_live_descendants() && std::time::Instant::now() < deadline {
            thread::sleep(Duration::from_millis(20));
        }
        assert!(containment.has_live_descendants());

        containment.signal(true, libc::SIGKILL);
        let _ = child.wait();
        let wait_dead = std::time::Instant::now() + Duration::from_secs(3);
        while containment.has_live_descendants() && std::time::Instant::now() < wait_dead {
            thread::sleep(Duration::from_millis(20));
        }
        assert!(!containment.has_live_descendants());
        containment.close();
    }
}
