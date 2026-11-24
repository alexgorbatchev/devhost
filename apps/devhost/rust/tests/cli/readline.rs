use std::{
    fs::File,
    io::{Read, Write},
    os::{
        fd::{AsRawFd, FromRawFd},
        unix::process::CommandExt,
    },
    path::Path,
    process::{Child, Command, Stdio},
    time::{Duration, Instant},
};

struct Shell {
    child: Child,
    terminal: File,
}

impl Shell {
    fn until(&mut self, marker: &[u8]) -> Vec<u8> {
        let deadline = Instant::now() + Duration::from_secs(8);
        let mut output = Vec::new();
        while !output.windows(marker.len()).any(|part| part == marker) {
            let remaining = deadline.saturating_duration_since(Instant::now());
            assert!(
                !remaining.is_zero(),
                "Readline timed out: {}",
                String::from_utf8_lossy(&output)
            );
            let mut descriptor = libc::pollfd {
                fd: self.terminal.as_raw_fd(),
                events: libc::POLLIN,
                revents: 0,
            };
            // SAFETY: the descriptor belongs to this fixture and is valid for this call.
            let result = unsafe {
                libc::poll(
                    &mut descriptor,
                    1,
                    remaining.as_millis().min(i32::MAX as u128) as i32,
                )
            };
            if result < 0
                && std::io::Error::last_os_error().kind() == std::io::ErrorKind::Interrupted
            {
                continue;
            }
            assert!(
                result > 0,
                "Readline did not respond: {}",
                String::from_utf8_lossy(&output)
            );
            let mut buffer = [0; 65536];
            let count = self.terminal.read(&mut buffer).expect("read Bash PTY");
            assert!(
                count > 0,
                "Bash exited: {}",
                String::from_utf8_lossy(&output)
            );
            output.extend_from_slice(&buffer[..count]);
        }
        output
    }
}

impl Drop for Shell {
    fn drop(&mut self) {
        // SAFETY: this unreaped child owns its session and cannot have a reused PID.
        unsafe {
            libc::kill(-(self.child.id() as i32), libc::SIGKILL);
        }
        self.child.wait().expect("join Bash fixture");
    }
}

pub(super) fn assert_completion(root: &Path, script: &Path, path: &std::ffi::OsStr) {
    let rc = root.join("bashrc");
    std::fs::write(&rc, r#"
if [[ -n $DEVHOST_TEST_BASH_COMPLETION ]]; then
    source "$DEVHOST_TEST_BASH_COMPLETION"
else
    for completion in /usr/share/bash-completion/bash_completion /opt/homebrew/share/bash-completion/bash_completion /usr/local/share/bash-completion/bash_completion; do
        if [[ -f $completion ]]; then source "$completion"; break; fi
    done
fi
source "$DEVHOST_COMPLETION_SCRIPT"
PS1='__DEVHOST_COMPLETION_READY__ '
bind 'set show-all-if-ambiguous on'
bind -x '"\C-x\C-r":printf "\nREADLINE_VALUE:%s\n" "$READLINE_LINE"'
"#).unwrap();
    let (mut master, mut slave) = (-1, -1);
    let size = libc::winsize {
        ws_row: 40,
        ws_col: 180,
        ws_xpixel: 0,
        ws_ypixel: 0,
    };
    // SAFETY: openpty writes two owned descriptors and reads the initialized size.
    assert_eq!(
        unsafe {
            libc::openpty(
                &mut master,
                &mut slave,
                std::ptr::null_mut(),
                std::ptr::null(),
                &size,
            )
        },
        0
    );
    // SAFETY: openpty returned new, uniquely owned descriptors.
    let (terminal, slave) = unsafe { (File::from_raw_fd(master), File::from_raw_fd(slave)) };
    for descriptor in [&terminal, &slave] {
        // SAFETY: both descriptors remain open; prevent the master leaking into Bash.
        assert_eq!(
            unsafe { libc::fcntl(descriptor.as_raw_fd(), libc::F_SETFD, libc::FD_CLOEXEC) },
            0
        );
    }
    let mut command = Command::new("bash");
    command
        .args(["--noprofile", "--rcfile"])
        .arg(rc)
        .arg("-i")
        .current_dir(root)
        .env("PATH", path)
        .env("TERM", "xterm-256color")
        .env("AGENT", "1")
        .env("HISTFILE", "/dev/null")
        .env("DEVHOST_COMPLETION_SCRIPT", script)
        .env_remove("BASH_ENV")
        .stdin(Stdio::from(slave.try_clone().unwrap()))
        .stdout(Stdio::from(slave.try_clone().unwrap()))
        .stderr(Stdio::from(slave));
    // SAFETY: these async-signal-safe calls establish the child's own controlling terminal.
    unsafe {
        command.pre_exec(|| {
            if libc::setsid() < 0 || libc::ioctl(0, libc::TIOCSCTTY as _, 0) < 0 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }
    let mut shell = Shell {
        child: command.spawn().expect("spawn interactive Bash"),
        terminal,
    };
    shell.until(b"__DEVHOST_COMPLETION_READY__ ");
    for (line, expected, expanded) in [
        ("devhost ca", vec!["caddy"], "devhost caddy "),
        (
            "devhost caddy ",
            vec!["download", "trust-remote"],
            "devhost caddy ",
        ),
        (
            "devhost start --",
            vec!["--manifest", "--idle-timeout", "--remote"],
            "devhost start --",
        ),
    ] {
        shell
            .terminal
            .write_all(format!("{line}\t\x18\x12").as_bytes())
            .unwrap();
        let mut output = shell.until(b"READLINE_VALUE:");
        let marker_end = output
            .windows(15)
            .position(|part| part == b"READLINE_VALUE:")
            .unwrap()
            + 15;
        if !output[marker_end..].contains(&b'\n') {
            output.extend(shell.until(b"\n"));
        }
        let output = String::from_utf8_lossy(&output);
        for candidate in expected {
            assert!(output.contains(candidate), "{line}: {output}");
        }
        assert!(
            output.contains(&format!("READLINE_VALUE:{expanded}")),
            "{line}: {output}"
        );
        assert!(
            !output.contains("not currently executing completion function"),
            "{output}"
        );
        // Clear the editable command without executing it or racing asynchronous SIGINT handling.
        shell.terminal.write_all(b"\x15").unwrap();
    }
}
