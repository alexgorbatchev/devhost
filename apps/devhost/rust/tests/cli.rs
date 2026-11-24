use std::process::{Command, Output};

#[cfg(unix)]
#[path = "cli/readline.rs"]
mod readline;

fn binary() -> std::path::PathBuf {
    std::env::var_os("DEVHOST_STACK_TEST_BINARY")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| env!("CARGO_BIN_EXE_devhost").into())
}

const ALERT: &str = "ALERT: Agents must read `AGENT=1 devhost skill` before using this tool.";
const SKILL: &str = "Install the devhost skill using the Skills CLI:\n\n  npx skills add alexgorbatchev/devhost --skill devhost\n\nSkill:\n\n  https://github.com/alexgorbatchev/devhost/tree/main/skills/devhost\n";

fn invoke(args: &[&str], agent: &str, columns: &str) -> Output {
    Command::new(binary())
        .args(args)
        .env("AGENT", agent)
        .env("COLUMNS", columns)
        .env("NO_COLOR", "1")
        .output()
        .expect("run devhost")
}

fn stdout(output: Output) -> String {
    assert!(output.status.success(), "{output:?}");
    assert!(output.stderr.is_empty(), "{output:?}");
    String::from_utf8(output.stdout).expect("CLI output is UTF-8")
}

#[test]
fn version_is_bare_in_either_mode() {
    let version = std::env::var("DEVHOST_CLI_TEST_VERSION")
        .unwrap_or_else(|_| option_env!("DEVHOST_BUILD_VERSION").unwrap_or("dev").into());
    for flag in ["--version", "-v"] {
        for agent in ["0", "1"] {
            assert_eq!(stdout(invoke(&[flag], agent, "80")), format!("{version}\n"));
        }
    }
}

#[test]
fn skill_instructions_match_the_published_skill_in_either_mode() {
    let skill = include_str!("../../../../skills/devhost/SKILL.md");
    assert!(skill.lines().any(|line| line == "name: devhost"));
    for agent in ["0", "1"] {
        assert_eq!(stdout(invoke(&["skill"], agent, "80")), SKILL);
    }
    let rejected = invoke(&["skill", "extra"], "1", "80");
    assert_eq!(rejected.status.code(), Some(1));
    assert!(rejected.stdout.is_empty());
    assert!(!rejected.stderr.is_empty());
}

#[test]
fn help_entry_points_obey_mode_and_terminal_width() {
    let human = stdout(invoke(&["--help"], "0", "100"));
    assert!(!human.contains(ALERT));
    assert!(human.contains("╰─ skill"));
    assert_eq!(stdout(invoke(&[], "0", "100")), human);
    assert_eq!(stdout(invoke(&["-h"], "0", "100")), human);
    let narrow = stdout(invoke(&["--help"], "0", "45"));
    assert_ne!(narrow, human);
    assert!(narrow.contains("version for devhost"));

    let agent = stdout(invoke(&["--help"], " YeS ", "100"));
    assert!(agent.starts_with(ALERT));
    assert_eq!(stdout(invoke(&["--help"], "1", "45")), agent);
    assert_eq!(stdout(invoke(&["help"], "true", "100")), agent);
    assert!(stdout(invoke(&["skill", "--help"], "1", "100")).starts_with(ALERT));
}

#[test]
fn help_aliases_modes_width_and_error_streams_match_public_contract() {
    let human = stdout(invoke(&["--help"], "0", "100"));
    let agent = stdout(invoke(&["--help"], "1", "100"));
    assert!(!human.contains(ALERT));
    assert!(agent.starts_with(ALERT));
    assert_ne!(stdout(invoke(&["--help"], "0", "45")), human);
    for args in [vec![], vec!["--help"], vec!["-h"], vec!["help"]] {
        assert_eq!(stdout(invoke(&args, "0", "100")), human);
        for mode in ["1", "true", " YeS "] {
            for width in ["45", "100"] {
                assert_eq!(stdout(invoke(&args, mode, width)), agent);
            }
        }
    }
    // Cobra treats an unsupported completion shell as a successful help request.
    // The Rust-only diagnostic regression below retains its stricter rejection.
    for args in invalid_invocations()
        .into_iter()
        .filter(|args| args.as_slice() != ["completion", "unknown"])
    {
        for mode in ["0", "1"] {
            let output = invoke(&args, mode, "100");
            assert_eq!(output.status.code(), Some(1), "{args:?}: {output:?}");
            assert!(output.stdout.is_empty(), "{args:?}: {output:?}");
            assert!(!output.stderr.is_empty(), "{args:?}: {output:?}");
        }
    }
}

#[test]
fn serve_rejects_invalid_domains_ports_and_conflicting_inputs() {
    for args in [
        vec!["serve"],
        vec!["serve", "--domain", "https://notes.localhost"],
        vec!["serve", "--domain", "notes.localhost:443"],
        vec!["serve", "--domain", "notes.localhost", "--port", "0"],
        vec!["serve", "--domain", "notes.localhost", "--port", "65536"],
        vec!["serve", "--domain", "notes.localhost", "--port", "-1"],
        vec![
            "serve",
            "--domain",
            "notes.localhost",
            "--port",
            "3000",
            "--dir",
            ".",
        ],
    ] {
        let output = invoke(&args, "1", "80");
        assert_eq!(output.status.code(), Some(1), "{args:?}: {output:?}");
        assert!(output.stdout.is_empty(), "{args:?}: {output:?}");
        assert!(!output.stderr.is_empty(), "{args:?}: {output:?}");
    }
}

#[test]
fn completion_scripts_register_all_shells_without_private_commands() {
    for (shell, registration) in [
        ("bash", "complete -"),
        ("zsh", "compdef _devhost devhost"),
        ("fish", "complete -c devhost"),
        ("powershell", "Register-ArgumentCompleter"),
    ] {
        let script = stdout(invoke(&["completion", shell], "1", "100"));
        assert!(
            script.contains(registration),
            "{shell}: missing registration"
        );
        assert!(!script.contains(ALERT), "{shell}: script polluted by help");
        assert!(
            !script.contains("_remote-worker"),
            "{shell}: private worker leaked"
        );
        let no_descriptions = stdout(invoke(
            &["completion", shell, "--no-descriptions"],
            "1",
            "100",
        ));
        assert!(no_descriptions.contains(registration));
        assert!(!no_descriptions.contains("Start the services in devhost.toml"));
        assert!(!no_descriptions.contains("Path to the devhost.toml file to use"));
        assert_eq!(script, stdout(invoke(&["completion", shell], "0", "45")));
    }
    let group = stdout(invoke(&["completion"], "0", "100"));
    for shell in ["bash", "zsh", "fish", "powershell"] {
        assert!(group.contains(shell), "{group}");
    }
}

#[test]
fn completion_installation_help_covers_all_shells() {
    for (shell, installation) in [
        ("bash", "bash-completion/completions/devhost"),
        ("zsh", "${fpath[1]}/_devhost"),
        ("fish", "fish/completions/devhost.fish"),
        ("powershell", "$PROFILE"),
    ] {
        let help = stdout(invoke(&["completion", shell, "--help"], "0", "100"));
        assert!(help.contains(installation), "{shell}: {help}");
        assert!(help.contains("--no-descriptions"), "{shell}: {help}");
    }
}

fn invalid_invocations() -> [Vec<&'static str>; 10] {
    [
        vec!["bun"],
        vec!["caddy", "restart"],
        vec!["start", "--bogus"],
        vec!["stop", "--manifest"],
        vec!["stack", "list", "extra"],
        vec!["start", "--debug=perhaps"],
        vec!["completion", "unknown"],
        vec!["completion", "bash", "extra"],
        vec!["completion", "fish", "--no-descriptions=perhaps"],
        vec!["serve", "--port", "oops"],
    ]
}

#[test]
fn invalid_arguments_report_to_stderr_and_point_to_usage() {
    for args in invalid_invocations() {
        for mode in ["0", "1"] {
            let output = invoke(&args, mode, "100");
            assert_eq!(output.status.code(), Some(1), "{args:?}: {output:?}");
            assert!(output.stdout.is_empty(), "{args:?}: {output:?}");
            let diagnostic = String::from_utf8(output.stderr).unwrap();
            assert!(diagnostic.contains("--help"), "{args:?}: {diagnostic}");
        }
    }
}

#[test]
#[cfg(unix)]
fn bash_completion_resolves_commands_and_flags_in_a_real_shell() {
    let temp = tempfile::tempdir().unwrap();
    let script = temp.path().join("completion.bash");
    std::fs::write(&script, stdout(invoke(&["completion", "bash"], "1", "100"))).unwrap();
    let selected = binary().canonicalize().unwrap();
    let path = std::env::join_paths(
        std::iter::once(selected.parent().unwrap().to_path_buf()).chain(std::env::split_paths(
            &std::env::var_os("PATH").unwrap_or_default(),
        )),
    )
    .unwrap();
    readline::assert_completion(temp.path(), &script, &path);
}

#[test]
fn boolean_values_and_manifest_precedence_match_cli_contract() {
    let temp = tempfile::tempdir().unwrap();
    let manifest = temp.path().join("devhost.toml");
    std::fs::write(
        &manifest,
        "name='cli'\n[services.api]\ncommand=['true']\nhealth.process=true\n[services.worker]\ncommand=['true']\nhealth.process=true\nalwaysStart=true\n",
    )
    .unwrap();
    for (value, expected) in [
        ("true", "api\n"),
        ("1", "api\n"),
        ("T", "api\n"),
        ("false", "api\nworker\n"),
        ("0", "api\nworker\n"),
        ("False", "api\nworker\n"),
    ] {
        let output = Command::new(binary())
            .args(["service", "list", "-m"])
            .arg(&manifest)
            .arg(format!("--startable={value}"))
            .env("AGENT", "1")
            .env("DEVHOST_MANIFEST", "ignored.toml")
            .output()
            .unwrap();
        assert_eq!(stdout(output), expected);
    }
    for (args, expected) in [
        (vec!["--startable", "--startable=false"], "api\nworker\n"),
        (vec!["--startable=false", "-s"], "api\n"),
    ] {
        let output = Command::new(binary())
            .args(["service", "list"])
            .args(args)
            .env("AGENT", "1")
            .env("DEVHOST_MANIFEST", &manifest)
            .output()
            .unwrap();
        assert_eq!(stdout(output), expected);
    }
}
