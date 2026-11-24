use std::{
    env, fs,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    process::Command,
    thread,
    time::{Duration, Instant},
};

use crate::{
    caddy::{
        ctx, path_ctx,
        stacks::{StackOwner, read_live_stack_owners},
    },
    cliout::{self, ServiceOutput},
    paths::{clean, manifest_identity},
    procid,
};

pub const STOP_GRACE_PERIOD: Duration = Duration::from_secs(15);
const GIT_WORKTREE_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, Clone)]
pub struct StopStackOptions {
    pub manifest_path: PathBuf,
    pub worktrees: bool,
    pub grace_period: Option<Duration>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct GitRepository {
    pub root: PathBuf,
    pub common_dir: PathBuf,
}

pub fn stop_stack(
    options: &StopStackOptions,
    caddy_dir: &Path,
    output: &ServiceOutput,
) -> Result<(), String> {
    let absolute_target = if options.manifest_path.is_absolute() {
        clean(&options.manifest_path)
    } else {
        let cwd = ctx(env::current_dir(), "resolve current directory")?;
        clean(&cwd.join(&options.manifest_path))
    };
    let absolute_target_str = absolute_target.to_string_lossy().into_owned();
    let owners = ctx(
        read_live_stack_owners(caddy_dir),
        "scan claim directories for manifest process IDs",
    )?;
    let (targets, siblings) = select_stacks_to_stop(&absolute_target, options.worktrees, &owners)?;

    if !options.worktrees && siblings > 0 {
        output.log_stdout(
            "devhost",
            &format!(
                "{siblings} other stack(s) run in this repository's worktrees. Run devhost stop --worktrees --manifest {} to stop them all.",
                cliout::shell_path(&absolute_target_str)
            ),
        );
    }

    if targets.is_empty() {
        if options.worktrees {
            output.log_stdout(
                "devhost",
                &format!(
                    "No active devhost stack process found in the Git repository of manifest: {absolute_target_str}"
                ),
            );
            return Ok(());
        }
        output.log_stdout(
            "devhost",
            &format!("No active devhost stack process found for manifest: {absolute_target_str}"),
        );
        if !owners.is_empty() {
            output.log_stdout(
                "devhost",
                "Other stacks are running. Run \"devhost stack list\" to print their PIDs and manifests.",
            );
        }
        return Ok(());
    }

    let scope = if options.worktrees {
        "this Git repository's worktrees"
    } else {
        "manifest"
    };
    output.log_stdout(
        "devhost",
        &format!(
            "Stopping {} active stack process(es) associated with {scope}...",
            targets.len()
        ),
    );
    let grace = options.grace_period.unwrap_or(STOP_GRACE_PERIOD);
    for owner in &targets {
        if options.worktrees {
            output.log_stdout(
                "devhost",
                &format!("Stopping stack PID {}: {}", owner.pid, owner.manifest_path),
            );
        }
        ctx(
            stop_process(owner.pid, grace, output),
            &format!("stop process {}", owner.pid),
        )?;
    }
    Ok(())
}

pub fn select_stacks_to_stop(
    manifest_path: &Path,
    worktrees: bool,
    owners: &[StackOwner],
) -> Result<(Vec<StackOwner>, usize), String> {
    let identity = manifest_identity(manifest_path);
    let parent = manifest_path.parent().unwrap_or_else(|| Path::new("."));
    let repo_result = discover_git_repository(parent);
    let repository = if worktrees {
        let repo = ctx(repo_result, "resolve Git repository for --worktrees")?;
        if repo.common_dir.as_os_str().is_empty() {
            return Err(
                "--worktrees requires the selected manifest to be inside a Git repository"
                    .to_owned(),
            );
        }
        repo
    } else {
        repo_result.unwrap_or_default()
    };

    let mut targets = Vec::new();
    let mut siblings = 0usize;
    for owner in owners {
        let exact = manifest_identity(Path::new(&owner.manifest_path)) == identity;
        if exact {
            targets.push(owner.clone());
            continue;
        }
        if repository.common_dir.as_os_str().is_empty() {
            continue;
        }
        let owner_dir = Path::new(&owner.manifest_path)
            .parent()
            .unwrap_or_else(|| Path::new("."));
        let other = match discover_git_repository(owner_dir) {
            Ok(repo) => repo,
            Err(error) => {
                if worktrees {
                    return Err(format!(
                        "resolve repository of stack PID {} ({}): {error}",
                        owner.pid, owner.manifest_path
                    ));
                }
                continue;
            }
        };
        if other.common_dir != repository.common_dir {
            continue;
        }
        siblings += 1;
        if worktrees {
            targets.push(owner.clone());
        }
    }
    Ok((targets, siblings))
}

pub fn discover_git_repository(cwd: &Path) -> Result<GitRepository, String> {
    let root = match run_git(cwd, &["rev-parse", "--show-toplevel"]) {
        Ok(out) => out,
        Err(error) if error.contains("not a git repository") => {
            return Ok(GitRepository::default());
        }
        Err(error) => return Err(error),
    };
    let common = run_git(
        cwd,
        &["rev-parse", "--path-format=absolute", "--git-common-dir"],
    )?;
    let root = path_ctx(
        fs::canonicalize(&root),
        "resolve checkout",
        Path::new(&root),
    )?;
    let common_dir = path_ctx(
        fs::canonicalize(&common),
        "resolve repository",
        Path::new(&common),
    )?;
    Ok(GitRepository { root, common_dir })
}

pub fn run_git(cwd: &Path, args: &[&str]) -> Result<String, String> {
    run_git_with_timeout(cwd, args, GIT_WORKTREE_TIMEOUT)
}

pub(super) fn run_git_with_timeout(
    cwd: &Path,
    args: &[&str],
    timeout: Duration,
) -> Result<String, String> {
    // Drain into owned files while polling: Git output can exceed a pipe's
    // capacity before it exits, including worktree and remote-ref listings.
    let mut stdout = ctx(tempfile::tempfile(), "create Git stdout")?;
    let mut stderr = ctx(tempfile::tempfile(), "create Git stderr")?;
    let mut command = Command::new("git");
    command
        .arg("-C")
        .arg(cwd)
        .args(args)
        .env_clear()
        .stdout(ctx(stdout.try_clone(), "capture Git stdout")?)
        .stderr(ctx(stderr.try_clone(), "capture Git stderr")?);
    for (key, value) in env::vars_os() {
        let key_str = key.to_string_lossy();
        if key_str.starts_with("GIT_") || key_str == "LC_ALL" {
            continue;
        }
        command.env(key, value);
    }
    command.env("LC_ALL", "C").env("GIT_TERMINAL_PROMPT", "0");

    let mut child = path_ctx(command.spawn(), "git in", cwd)?;
    let deadline = Instant::now() + timeout;
    let status = loop {
        match path_ctx(child.try_wait(), "git in", cwd)? {
            Some(status) => break status,
            None if Instant::now() < deadline => thread::sleep(Duration::from_millis(10)),
            None => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("git in {}: timed out", cwd.display()));
            }
        }
    };
    let read = |file: &mut fs::File| -> Result<String, String> {
        ctx(file.seek(SeekFrom::Start(0)), "rewind Git output")?;
        let mut text = String::new();
        ctx(file.read_to_string(&mut text), "read Git output")?;
        Ok(text)
    };
    if !status.success() {
        let stderr = read(&mut stderr)?;
        return Err(format!(
            "git in {}: {}: {}",
            cwd.display(),
            status,
            stderr.trim()
        ));
    }
    let stdout = read(&mut stdout)?;
    Ok(stdout.strip_suffix('\n').unwrap_or(&stdout).to_owned())
}

fn stop_process(pid: i32, grace_period: Duration, output: &ServiceOutput) -> Result<(), String> {
    output.log_stdout("devhost", &format!("Sending SIGTERM to process {pid}..."));
    match send_unix_signal(pid, libc::SIGTERM) {
        Ok(()) => {}
        Err(error) if error.raw_os_error() == Some(libc::ESRCH) => {
            output.log_stdout("devhost", &format!("Process {pid} already stopped."));
            return Ok(());
        }
        Err(error) => return Err(format!("signal process {pid} with SIGTERM: {error}")),
    }

    let deadline = Instant::now() + grace_period;
    while Instant::now() < deadline {
        if !procid::is_process_alive(pid) {
            output.log_stdout("devhost", &format!("Process {pid} stopped cleanly."));
            return Ok(());
        }
        thread::sleep(Duration::from_millis(100));
    }

    output.log_stderr(
        "devhost",
        &format!("Process {pid} did not stop in time. Sending SIGKILL..."),
    );
    match send_unix_signal(pid, libc::SIGKILL) {
        Ok(()) => {}
        Err(error) if error.raw_os_error() == Some(libc::ESRCH) => {
            output.log_stdout("devhost", &format!("Process {pid} already stopped."));
            return Ok(());
        }
        Err(error) => return Err(format!("kill process {pid}: {error}")),
    }

    for _ in 0..10 {
        if !procid::is_process_alive(pid) {
            output.log_stdout("devhost", &format!("Process {pid} terminated."));
            return Ok(());
        }
        thread::sleep(Duration::from_millis(100));
    }
    Err(format!("failed to terminate process {pid} after SIGKILL"))
}

fn send_unix_signal(pid: i32, sig: i32) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        // SAFETY: libc::kill sends a POSIX signal to the given PID.
        let rc = unsafe { libc::kill(pid, sig) };
        if rc == 0 {
            Ok(())
        } else {
            Err(std::io::Error::last_os_error())
        }
    }
    #[cfg(not(unix))]
    {
        let _ = (pid, sig);
        Err(std::io::Error::new(
            std::io::ErrorKind::Unsupported,
            "signals are not supported on this platform",
        ))
    }
}

#[cfg(test)]
mod tests {
    use std::{
        io::{self, Write},
        sync::{Arc, Mutex},
    };

    use cli_command_kit::Mode;

    use super::*;

    #[derive(Clone, Default)]
    struct SharedBuf(Arc<Mutex<Vec<u8>>>);

    impl Write for SharedBuf {
        fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
            self.0.lock().unwrap().extend_from_slice(buf);
            Ok(buf.len())
        }
        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    #[test]
    fn stops_graceful_and_stubborn_processes_and_handles_worktrees() {
        let fixture = tempfile::tempdir().unwrap();
        let caddy_dir = fixture.path().join("caddy");
        let manifest = fixture.path().join("devhost.toml");
        fs::write(&manifest, "name = 'demo'\n").unwrap();

        let out = SharedBuf::default();
        let err = SharedBuf::default();
        let output = ServiceOutput::new(
            Mode::Agent,
            Box::new(out.clone()),
            Box::new(err.clone()),
            &["devhost"],
        );

        // No active stack.
        stop_stack(
            &StopStackOptions {
                manifest_path: manifest.clone(),
                worktrees: false,
                grace_period: Some(Duration::from_millis(500)),
            },
            &caddy_dir,
            &output,
        )
        .unwrap();
        assert!(
            String::from_utf8(out.0.lock().unwrap().clone())
                .unwrap()
                .contains("No active devhost stack process found for manifest:")
        );

        // --worktrees outside git repo fails.
        let wt_err = stop_stack(
            &StopStackOptions {
                manifest_path: manifest.clone(),
                worktrees: true,
                grace_period: Some(Duration::from_millis(500)),
            },
            &caddy_dir,
            &output,
        )
        .unwrap_err();
        assert!(
            wt_err.contains(
                "--worktrees requires the selected manifest to be inside a Git repository"
            )
        );

        // Stop a stubborn process that ignores SIGTERM -> escalates to SIGKILL.
        let mut stubborn = Command::new("sh")
            .args(["-c", "trap '' TERM; sleep 30"])
            .spawn()
            .unwrap();
        let pid = stubborn.id() as i32;
        thread::sleep(Duration::from_millis(100));
        stop_process(pid, Duration::from_millis(200), &output).unwrap();
        let _ = stubborn.wait();
        assert!(
            String::from_utf8(err.0.lock().unwrap().clone())
                .unwrap()
                .contains("Sending SIGKILL...")
        );

        // Already-stopped PID reports ESRCH gracefully; empty repo with --worktrees in git repo says no active stack.
        stop_process(i32::MAX, Duration::from_millis(50), &output).unwrap();
        assert!(
            String::from_utf8(out.0.lock().unwrap().clone())
                .unwrap()
                .contains("already stopped.")
        );

        let git_repo = fixture.path().join("git-repo");
        fs::create_dir_all(&git_repo).unwrap();
        assert!(
            Command::new("git")
                .args(["-C", git_repo.to_str().unwrap(), "init"])
                .status()
                .unwrap()
                .success()
        );
        let git_manifest = git_repo.join("devhost.toml");
        fs::write(&git_manifest, "name = 'g'\n").unwrap();
        stop_stack(
            &StopStackOptions {
                manifest_path: git_manifest,
                worktrees: true,
                grace_period: Some(Duration::from_millis(50)),
            },
            &caddy_dir,
            &output,
        )
        .unwrap();
        assert!(
            String::from_utf8(out.0.lock().unwrap().clone())
                .unwrap()
                .contains("No active devhost stack process found in the Git repository")
        );
    }
}
