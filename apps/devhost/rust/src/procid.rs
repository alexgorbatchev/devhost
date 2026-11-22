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
    let boot_id = boot_id()?;
    let stat = read_linux_stat(pid)?;
    Ok(format!("{boot_id}:{}", stat.start_ticks))
}

#[cfg(not(target_os = "linux"))]
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
    let text = fs::read_to_string(&path)?;
    parse_linux_stat(&path, &text)
}

#[cfg(target_os = "linux")]
fn parse_linux_stat(path: &str, text: &str) -> io::Result<LinuxStat> {
    let line = text.trim();
    let rest = line
        .rfind(')')
        .and_then(|close| line.get(close + 2..))
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, format!("parse {path}")))?;
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

#[cfg(not(target_os = "linux"))]
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

    #[test]
    fn current_process_is_alive_and_has_stable_identity() {
        let pid = std::process::id() as i32;
        assert!(is_process_alive(pid));
        assert!(!is_process_alive(0));
        assert!(!is_process_alive(i32::MAX));
        assert!(is_record_owner_alive(pid, ""));
        assert!(!is_record_owner_alive(i32::MAX, ""));

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
