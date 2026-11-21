use std::process::{Command, Output};

const ALERT: &str = "ALERT: Agents must read `AGENT=1 devhost skill` before using this tool.";
const SKILL: &str = "Install the devhost skill using the Skills CLI:\n\n  npx skills add alexgorbatchev/devhost --skill devhost\n\nSkill:\n\n  https://github.com/alexgorbatchev/devhost/tree/main/skills/devhost\n";

fn invoke(args: &[&str], agent: &str, columns: &str) -> Output {
    Command::new(env!("CARGO_BIN_EXE_devhost"))
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
    let version = option_env!("DEVHOST_BUILD_VERSION").unwrap_or("dev");
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
