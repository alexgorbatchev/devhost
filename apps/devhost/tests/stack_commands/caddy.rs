use super::*;

#[test]
fn foreign_runtime_is_preserved_and_trust_commands_use_only_the_selected_state() {
    let runtime = Runtime::start();
    let mut session = runtime.start_serve();
    wait_until(|| runtime.serve_response().as_deref() == Some("preserved serve session"));
    let directory = runtime.state().join("caddy");
    let pid_text = fs::read_to_string(directory.join("caddy.pid")).unwrap();
    let pid: i32 = pid_text.trim().parse().unwrap();
    let ca_path = directory.join("storage/pki/authorities/local/root.crt");
    let ca = fs::read(&ca_path).unwrap();
    let foreign = runtime.root.path().join("foreign-state");
    for agent in ["0", "1"] {
        for action in ["start", "stop", "trust"] {
            let output = runtime
                .command()
                .env("AGENT", agent)
                .env("DEVHOST_STATE_DIR", &foreign)
                .args(["caddy", action])
                .output()
                .unwrap();
            assert_eq!(output.status.code(), Some(1), "{action}: {output:?}");
            assert!(
                String::from_utf8_lossy(&output.stderr).contains("not started by devhost"),
                "{action}: {output:?}"
            );
            assert!(!foreign.join("caddy/caddy.pid").exists());
            assert!(!foreign.join("caddy/runtime.json").exists());
            assert_eq!(
                fs::read_to_string(directory.join("caddy.pid")).unwrap(),
                pid_text
            );
            assert!(procid::is_process_alive(pid));
            assert_eq!(fs::read(&ca_path).unwrap(), ca);
            assert_eq!(
                runtime.serve_response().as_deref(),
                Some("preserved serve session")
            );
        }
    }

    // Record the CLI-to-Caddy trust boundary without executing a host trust tool.
    let recorded = foreign.join("caddy");
    let launcher = recorded.join("caddy");
    fs::write(recorded.join("caddy.pid"), &pid_text).unwrap();
    fs::write(&launcher, "#!/bin/sh\nprintf '%s\\n' \"$@\" > trust.args\nprintf '%s' \"$SUDO_PROMPT\" > sudo-prompt\nif [ -f reject-trust ]; then echo 'fixture trust rejected' >&2; exit 7; fi\n").unwrap();
    fs::set_permissions(&launcher, fs::Permissions::from_mode(0o700)).unwrap();
    for reject in [false, true] {
        if reject {
            fs::write(recorded.join("reject-trust"), "").unwrap();
        }
        let output = runtime
            .command()
            .env("DEVHOST_STATE_DIR", &foreign)
            .args(["caddy", "trust"])
            .output()
            .unwrap();
        assert_eq!(output.status.success(), !reject, "{output:?}");
        let diagnostic = String::from_utf8_lossy(&output.stderr);
        assert!(
            diagnostic.contains(if reject {
                "Caddy trust failed"
            } else {
                "managed caddy local CA trusted"
            }),
            "{diagnostic}"
        );
        if reject {
            assert!(
                diagnostic.contains("fixture trust rejected"),
                "{diagnostic}"
            );
        }
        let arguments = fs::read_to_string(recorded.join("trust.args")).unwrap();
        let config = recorded.canonicalize().unwrap().join("Caddyfile");
        assert_eq!(
            arguments.lines().collect::<Vec<_>>(),
            [
                "trust",
                "--address",
                &runtime.settings.admin_address,
                "--config",
                config.to_str().unwrap(),
                "--adapter",
                "caddyfile"
            ]
        );
        assert!(
            fs::read_to_string(recorded.join("sudo-prompt"))
                .unwrap()
                .contains("Password:")
        );
        assert_eq!(fs::read(&ca_path).unwrap(), ca);
        assert_eq!(
            runtime.serve_response().as_deref(),
            Some("preserved serve session")
        );
    }
    // Remove the synthetic ownership marker before any fixture cleanup can use it.
    fs::remove_file(recorded.join("caddy.pid")).unwrap();
    let stopped = runtime
        .command()
        .args(["stop", "--session", "serve-restart-serve.localhost"])
        .output()
        .unwrap();
    assert!(stopped.status.success(), "{stopped:?}");
    wait_until(|| session.0.try_wait().unwrap().is_some());
    let stopped = runtime.command().args(["caddy", "stop"]).output().unwrap();
    assert!(stopped.status.success(), "{stopped:?}");
    wait_until(|| !procid::is_process_alive(pid));
    assert!(!directory.join("caddy.pid").exists());
    assert!(!directory.join("applied.json").exists());
    assert_eq!(fs::read(&ca_path).unwrap(), ca);
}
