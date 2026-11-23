use std::io;
#[cfg(target_os = "linux")]
use std::{fs, sync::OnceLock};

#[cfg(target_os = "linux")]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct LinuxStat {
    pub state: u8,
    pub parent_pid: i32,
    pub start_ticks: u64,
}

#[cfg(target_os = "linux")]
pub(crate) fn start_identity(pid: i32) -> io::Result<String> {
    if pid <= 0 {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            format!("invalid pid {pid}"),
        ));
    }
    linux_stat_identity(&read_linux_stat(pid)?)
}

#[cfg(target_os = "linux")]
pub(crate) fn linux_stat_identity(stat: &LinuxStat) -> io::Result<String> {
    Ok(format!("{}:{}", boot_id()?, stat.start_ticks))
}

#[cfg(target_os = "macos")]
pub(crate) fn start_identity(pid: i32) -> io::Result<String> {
    let info = read_macos_info(pid)?;
    Ok(macos_info_identity(&info))
}

#[cfg(target_os = "macos")]
pub(crate) fn macos_info_identity(info: &libc::proc_bsdinfo) -> String {
    format!("{}.{:06}", info.pbi_start_tvsec, info.pbi_start_tvusec)
}

#[cfg(target_os = "macos")]
pub(crate) fn read_macos_info(pid: i32) -> io::Result<libc::proc_bsdinfo> {
    if pid <= 0 {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            "invalid process ID",
        ));
    }
    let mut info = std::mem::MaybeUninit::<libc::proc_bsdinfo>::uninit();
    let size = std::mem::size_of::<libc::proc_bsdinfo>();
    // SAFETY: the buffer has the size and alignment required by PROC_PIDTBSDINFO.
    let read = unsafe {
        libc::proc_pidinfo(
            pid,
            libc::PROC_PIDTBSDINFO,
            0,
            info.as_mut_ptr().cast(),
            size as i32,
        )
    };
    if read != size as i32 {
        let error = io::Error::last_os_error();
        return Err(if error.raw_os_error() == Some(libc::ESRCH) {
            io::Error::new(io::ErrorKind::NotFound, error)
        } else if read > 0 || error.raw_os_error() == Some(0) {
            io::Error::new(io::ErrorKind::InvalidData, "incomplete process information")
        } else {
            error
        });
    }
    // SAFETY: a full successful read initialized the complete buffer.
    Ok(unsafe { info.assume_init() })
}

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
pub(crate) fn start_identity(_pid: i32) -> io::Result<String> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "process start identity is not implemented for this platform",
    ))
}

#[cfg(target_os = "linux")]
fn boot_id() -> io::Result<&'static str> {
    static BOOT_ID: OnceLock<Option<String>> = OnceLock::new();
    BOOT_ID
        .get_or_init(|| {
            fs::read_to_string("/proc/sys/kernel/random/boot_id")
                .ok()
                .map(|text| text.trim().to_owned())
        })
        .as_deref()
        .ok_or_else(|| io::Error::other("read /proc/sys/kernel/random/boot_id"))
}

#[cfg(target_os = "linux")]
pub(crate) fn read_linux_stat(pid: i32) -> io::Result<LinuxStat> {
    let path = format!("/proc/{pid}/stat");
    let bytes = fs::read(&path)?;
    parse_linux_stat_bytes(&path, &bytes)
}

#[cfg(target_os = "linux")]
fn parse_linux_stat_bytes(path: &str, bytes: &[u8]) -> io::Result<LinuxStat> {
    // The kernel truncates comm by bytes, including in the middle of UTF-8.
    // Only the fields after the final ')' are ASCII numeric process data.
    let rest = bytes
        .iter()
        .rposition(|byte| *byte == b')')
        .and_then(|close| bytes.get(close + 2..))
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, format!("parse {path}")))?;
    let rest = std::str::from_utf8(rest)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    let fields: Vec<&str> = rest.split_whitespace().collect();
    if fields.len() <= 19 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("parse {path}: too few fields"),
        ));
    }
    let state = fields[0].as_bytes().first().copied().unwrap_or(b'?');
    let parent_pid = fields[1]
        .parse::<i32>()
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    let start_ticks = fields[19]
        .parse::<u64>()
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    Ok(LinuxStat {
        state,
        parent_pid,
        start_ticks,
    })
}

#[cfg(target_os = "linux")]
pub fn is_process_alive(pid: i32) -> bool {
    if pid <= 0 {
        return false;
    }
    match read_linux_stat(pid) {
        Ok(stat) => stat.state != b'Z' && stat.state != b'X' && stat.state != b'x',
        Err(error) if error.kind() == io::ErrorKind::NotFound => false,
        Err(_) => true,
    }
}

#[cfg(target_os = "macos")]
pub fn is_process_alive(pid: i32) -> bool {
    if pid <= 0 {
        return false;
    }
    // SAFETY: signal zero probes existence without delivering a signal.
    if unsafe { libc::kill(pid, 0) } != 0
        && io::Error::last_os_error().raw_os_error() != Some(libc::EPERM)
    {
        return false;
    }
    // Preserve a successful existence probe when inspection is restricted.
    read_macos_info(pid).map_or(true, |info| info.pbi_status != libc::SZOMB)
}

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
pub fn is_process_alive(pid: i32) -> bool {
    pid > 0 && pid == std::process::id() as i32
}

pub fn is_record_owner_alive(pid: i32, recorded_identity: &str) -> bool {
    if !is_process_alive(pid) {
        return false;
    }
    if recorded_identity.is_empty() {
        return true;
    }
    match start_identity(pid) {
        Ok(current) => current == recorded_identity,
        Err(error) if error.kind() == io::ErrorKind::NotFound => false,
        Err(_) => true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(target_os = "linux")]
    fn parse_linux_stat(path: &str, text: &str) -> io::Result<LinuxStat> {
        parse_linux_stat_bytes(path, text.as_bytes())
    }

    #[test]
    #[cfg(target_os = "linux")]
    fn kernel_name_bytes_do_not_hide_process_identity() {
        let mut bytes = b"123 (partial-".to_vec();
        bytes.push(0xe2);
        bytes.extend_from_slice(b") S 7 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 42");
        let stat = parse_linux_stat_bytes("fixture", &bytes).unwrap();
        assert_eq!(stat.parent_pid, 7);
        assert_eq!(stat.start_ticks, 42);
    }

    #[test]
    fn child_identity_survives_inspection_and_exited_children_are_not_live() {
        struct Child(std::process::Child);
        impl Drop for Child {
            fn drop(&mut self) {
                let _ = self.0.kill();
                let _ = self.0.wait();
            }
        }
        let mut child = Child(
            std::process::Command::new("sleep")
                .arg("300")
                .spawn()
                .unwrap(),
        );
        let pid = child.0.id() as i32;
        let identity = start_identity(pid).unwrap();
        assert!(is_record_owner_alive(pid, &identity));
        child.0.kill().unwrap();
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
        while is_process_alive(pid) {
            assert!(
                std::time::Instant::now() < deadline,
                "exited child still reported live"
            );
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
        assert!(!is_record_owner_alive(pid, &identity));
    }

    #[test]
    fn current_process_is_alive_and_has_stable_identity() {
        let pid = std::process::id() as i32;
        assert!(is_process_alive(pid));
        assert!(!is_process_alive(0));
        assert!(!is_process_alive(i32::MAX));
        assert!(is_record_owner_alive(pid, ""));
        assert!(!is_record_owner_alive(i32::MAX, ""));

        #[cfg(any(target_os = "linux", target_os = "macos"))]
        {
            let identity = start_identity(pid).unwrap();
            assert_eq!(start_identity(pid).unwrap(), identity);
            assert!(start_identity(0).is_err());
            assert!(is_record_owner_alive(pid, &identity));
            assert!(!is_record_owner_alive(pid, "wrong-process"));
            assert!(!is_record_owner_alive(i32::MAX, &identity));
        }

        #[cfg(target_os = "linux")]
        {
            assert!(start_identity(0).is_err());
            let identity = start_identity(pid).unwrap();
            assert!(is_record_owner_alive(pid, &identity));
            assert!(!is_record_owner_alive(pid, "wrong-boot:0"));
            assert!(!is_record_owner_alive(i32::MAX, &identity));
            assert!(parse_linux_stat("p", "123 no-parens").is_err());
            assert!(parse_linux_stat("p", "123 (cmd) S 1").is_err());
            assert!(
                parse_linux_stat(
                    "p",
                    "123 (cmd) S bad 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 42"
                )
                .is_err()
            );
            assert!(
                parse_linux_stat(
                    "p",
                    "123 (cmd) S 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 bad"
                )
                .is_err()
            );
            let parsed = parse_linux_stat(
                "p",
                "123 (cmd (x)) Z 7 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 42",
            )
            .unwrap();
            assert_eq!(parsed.state, b'Z');
            assert_eq!(parsed.parent_pid, 7);
            assert_eq!(parsed.start_ticks, 42);
        }
    }
}
