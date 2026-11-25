use std::{
    fs,
    io::{self, Write},
    process::{Command, Stdio},
};

use cli_command_kit::Mode;
use sha2::{Digest, Sha256};

use super::CommandOutput;
use crate::Failure;

pub fn trust(target: &str, mode: Mode, output: &mut impl Write) -> Result<(), Failure> {
    if !cfg!(target_os = "macos") {
        return Err(
            "Managed Caddy remote trust is currently supported on macOS only."
                .to_owned()
                .into(),
        );
    }
    // SAFETY: geteuid has no arguments and does not access Rust memory.
    let root = unsafe { libc::geteuid() == 0 };
    install(target, mode, output, root, |command, inherit| {
        if inherit {
            let status = command
                .stdin(Stdio::inherit())
                .stdout(Stdio::inherit())
                .stderr(Stdio::inherit())
                .status()?;
            Ok(CommandOutput {
                stdout: Vec::new(),
                stderr: Vec::new(),
                success: status.success(),
            })
        } else {
            let result = command.output()?;
            Ok(CommandOutput {
                stdout: result.stdout,
                stderr: result.stderr,
                success: result.status.success(),
            })
        }
    })
}

fn install(
    target: &str,
    mode: Mode,
    output: &mut impl Write,
    root: bool,
    mut run: impl FnMut(&mut Command, bool) -> io::Result<CommandOutput>,
) -> Result<(), Failure> {
    log(
        mode,
        output,
        "managed caddy remote trust may prompt for your password because installing a root CA into the system trust store is privileged.",
        "remote trust warning",
    )?;
    let mut ssh = Command::new("ssh");
    ssh.args([target, "devhost", "caddy", "print-root-cert"]);
    let fetched = run(&mut ssh, false).unwrap_or_else(|error| CommandOutput {
        stdout: Vec::new(),
        stderr: error.to_string().into_bytes(),
        success: false,
    });
    if !fetched.success {
        let mut message = format!(
            "Failed to fetch the managed Caddy root certificate from {target}. Check SSH access and confirm 'devhost' is installed on the remote host."
        );
        for bytes in [&fetched.stderr, &fetched.stdout] {
            let text = String::from_utf8_lossy(bytes);
            let text = text.trim();
            if !text.is_empty() {
                message.push('\n');
                message.push_str(text);
            }
        }
        return Err(message.into());
    }
    let directory = tempfile::Builder::new()
        .prefix("devhost-caddy-remote-trust-")
        .tempdir()
        .map_err(|error| {
            Failure::from(format!("create temporary remote certificate file: {error}"))
        })?;
    let certificate = directory.path().join("root.crt");
    fs::write(&certificate, &fetched.stdout).map_err(|error| {
        Failure::from(format!("create temporary remote certificate file: {error}"))
    })?;
    log(
        mode,
        output,
        &format!(
            "managed caddy remote root sha256 from {target}: {:x}",
            Sha256::digest(&fetched.stdout)
        ),
        "remote certificate fingerprint",
    )?;
    let mut command = Command::new(if root { "security" } else { "sudo" });
    if !root {
        command.arg("security");
    }
    command
        .args([
            "add-trusted-cert",
            "-d",
            "-r",
            "trustRoot",
            "-k",
            "/Library/Keychains/System.keychain",
        ])
        .arg(&certificate);
    if !run(&mut command, true).is_ok_and(|result| result.success) {
        return Err("Failed to install the fetched managed Caddy root certificate into the macOS system keychain.".to_owned().into());
    }
    log(
        mode,
        output,
        &format!("managed caddy local CA from {target} trusted."),
        "remote trust success",
    )
}

fn log(mode: Mode, output: &mut impl Write, message: &str, context: &str) -> Result<(), Failure> {
    super::log_labeled(mode, output, "devhost", message)
        .map_err(|error| Failure::from(format!("log {context}: {error}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn fetched_certificate_is_installed_and_removed_on_every_outcome() {
        for root in [false, true] {
            for success in [false, true] {
                let mut path = PathBuf::new();
                let mut calls = 0;
                let mut output = Vec::new();
                let result = install(
                    "user@remote",
                    Mode::Agent,
                    &mut output,
                    root,
                    |command, inherit| {
                        calls += 1;
                        let args: Vec<_> = command.get_args().collect();
                        if calls == 1 {
                            assert_eq!(command.get_program(), "ssh");
                            assert_eq!(
                                args,
                                ["user@remote", "devhost", "caddy", "print-root-cert"]
                            );
                            assert!(!inherit);
                            return Ok(CommandOutput {
                                stdout: b"certificate\n".to_vec(),
                                stderr: Vec::new(),
                                success: true,
                            });
                        }
                        assert!(inherit);
                        assert_eq!(
                            command.get_program(),
                            if root { "security" } else { "sudo" }
                        );
                        let expected = [
                            "add-trusted-cert",
                            "-d",
                            "-r",
                            "trustRoot",
                            "-k",
                            "/Library/Keychains/System.keychain",
                        ];
                        let offset = usize::from(!root);
                        if !root {
                            assert_eq!(args[0], "security");
                        }
                        assert_eq!(args[offset..args.len() - 1], expected);
                        path = PathBuf::from(args.last().unwrap());
                        assert_eq!(fs::read(&path).unwrap(), b"certificate\n");
                        Ok(CommandOutput {
                            stdout: Vec::new(),
                            stderr: Vec::new(),
                            success,
                        })
                    },
                );
                assert_eq!(calls, 2);
                assert_eq!(result.is_ok(), success);
                assert!(!path.parent().unwrap().exists());
                let output = String::from_utf8(output).unwrap();
                assert!(output.contains(&format!("{:x}", Sha256::digest(b"certificate\n"))));
                assert_eq!(output.contains("trusted."), success);
            }
        }
    }

    #[test]
    fn fetch_failure_preserves_both_diagnostics_and_does_not_install() {
        let error = install(
            "remote",
            Mode::Agent,
            &mut Vec::new(),
            false,
            |command, inherit| {
                assert_eq!(command.get_program(), "ssh");
                assert!(!inherit);
                Ok(CommandOutput {
                    stdout: b" output \n".to_vec(),
                    stderr: b" denied \n".to_vec(),
                    success: false,
                })
            },
        )
        .unwrap_err();
        assert!(error.message.ends_with("\ndenied\noutput"));
    }

    #[test]
    fn missing_ssh_is_a_fetch_error() {
        let error = install("remote", Mode::Agent, &mut Vec::new(), false, |_, _| {
            Err(io::Error::new(io::ErrorKind::NotFound, "missing ssh"))
        })
        .unwrap_err();
        assert!(error.message.ends_with("\nmissing ssh"));
    }
}
