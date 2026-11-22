use std::{
    fs,
    path::Path,
    process::{Command, Output},
};

use tempfile::tempdir;

const MANIFEST: &str = r#"
name = "sample"

[services.zebra]

[services.bootstrap]
alwaysStart = true

[services.api]
"#;

fn list(cwd: &Path, args: &[&str], manifest: Option<&Path>, agent: bool) -> Output {
    let mut command = Command::new(env!("CARGO_BIN_EXE_devhost"));
    command
        .current_dir(cwd)
        .args(["service", "list"])
        .args(args)
        .env_remove("DEVHOST_MANIFEST")
        .env_remove("AGENT")
        .env("NO_COLOR", "1");
    if let Some(path) = manifest {
        command.env("DEVHOST_MANIFEST", path);
    }
    if agent {
        command.env("AGENT", "1");
    }
    command.output().unwrap()
}

fn stdout(output: Output) -> String {
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout).unwrap()
}

fn stderr(output: Output) -> String {
    assert_eq!(output.status.code(), Some(1));
    assert!(output.stdout.is_empty());
    String::from_utf8(output.stderr).unwrap()
}

#[test]
fn discovers_sorted_services_and_filters_implicit_services() {
    let fixture = tempdir().unwrap();
    let root = fixture.path();
    let child = root.join("nested");
    fs::create_dir(&child).unwrap();
    fs::write(root.join("devhost.toml"), MANIFEST).unwrap();

    assert_eq!(
        stdout(list(&child, &[], None, false)),
        "api\nbootstrap\nzebra\n"
    );
    assert_eq!(stdout(list(&child, &["-s"], None, true)), "api\nzebra\n");
    fs::write(child.join(".git"), "gitdir: elsewhere").unwrap();
    assert!(stderr(list(&child, &[], None, false)).contains("devhost | [INFO]"));
}

#[test]
fn explicit_manifest_overrides_environment_and_bypasses_discovery() {
    let fixture = tempdir().unwrap();
    let root = fixture.path();
    let alternate = root.join("alternate-devhost.toml");
    fs::write(&alternate, "name = 'alternate'\n[services.web]").unwrap();
    fs::write(root.join("devhost.toml"), MANIFEST).unwrap();

    assert_eq!(stdout(list(root, &[], Some(&alternate), true)), "web\n");
    let args = ["-m", "nonexistent/../devhost.toml"];
    assert_eq!(
        stdout(list(root, &args, Some(&alternate), true)),
        "api\nbootstrap\nzebra\n"
    );
    assert!(
        stderr(list(root, &["-m", "other.toml"], None, true))
            .starts_with("devhost: ERR: --manifest")
    );
    assert!(
        stderr(list(root, &["-m", "absent/devhost.toml"], None, true))
            .contains("no such file or directory")
    );
    fs::create_dir(root.join("directory-devhost.toml")).unwrap();
    assert!(
        stderr(list(root, &["-m", "directory-devhost.toml"], None, true)).contains("read manifest")
    );
}

#[test]
fn reports_invalid_manifest_input() {
    let fixture = tempdir().unwrap();
    let root = fixture.path();
    let path = root.join("devhost.toml");
    for (input, message) in [
        ("[", "Failed to parse"),
        (
            "includes = 123",
            "includes must be a string or string array",
        ),
        ("includes = [123]", "includes must contain only strings"),
        ("includes = '[invalid'", "syntax error in pattern"),
        ("[services.web]", "non-empty string"),
        ("name = 'sample'", "services must be an object"),
        ("name = 'sample'\n[services]", "at least one service"),
        (
            "name = 'sample'\n[services]\nweb = 3",
            "services.web must be an object",
        ),
        ("name = 'sample'\n[services.UPPER]", "invalid name"),
        (
            "name = 'sample'\n[services.web]\nalwaysStart = 1",
            "Expected a boolean",
        ),
    ] {
        fs::write(&path, input).unwrap();
        let error = stderr(list(root, &[], None, true));
        assert!(error.contains(message), "{error}");
    }
}

#[test]
fn locates_manifest_syntax_errors() {
    let fixture = tempdir().unwrap();
    let root = fixture.path();
    let path = root.join("devhost.toml");
    for (input, message) in [
        (
            "name = 'sample'\n[services.web]\nport = 3000\n\n[services.web]\n",
            "TOML table [services.web] is declared more than once (lines 2 and 5). Merge those settings into a single table instead of repeating the header.",
        ),
        (
            "[services.web]\nport = 3000\nport = 3001\n",
            "toml: line 3 (last key \"services.web.port\"): Key 'services.web.port' has already been defined.",
        ),
        (
            "name = \"sample\n[services.web]\n",
            "toml: line 1 (last key \"name\"): strings cannot contain newlines",
        ),
        (
            "name = 'sample'\n[services.web\n",
            "toml: line 3: expected '.' or ']' to end table name, but got '\\n' instead",
        ),
    ] {
        fs::write(&path, input).unwrap();
        assert_eq!(
            stderr(list(root, &[], Some(&path), true)),
            format!(
                "devhost: ERR: Failed to parse {}: {message}\n",
                path.display()
            )
        );
    }
}

#[test]
fn lists_nested_includes_once_and_interpolates_environment_values() {
    let fixture = tempdir().unwrap();
    let root = fixture.path();
    fs::create_dir(root.join("parts")).unwrap();
    fs::write(
        root.join("devhost.toml"),
        "name = '{{ env. NO_COLOR }}'\nincludes = ['parts/**.toml', 'parts/child.toml', 'missing/*.toml']\n[services.web]\ncommand = ['web']\nport = 3300\n",
    )
    .unwrap();
    fs::write(
        root.join("parts/child.toml"),
        "includes = '../devhost.toml'\n[services.api]\ncommand = ['{{env.NO_COLOR}}', '{{service.web.port}}']\nport = 3301\nalwaysStart = true\n[groups]\nbackend = ['api', 'web']\n",
    )
    .unwrap();
    assert_eq!(stdout(list(root, &[], None, true)), "api\nweb\n");
    assert_eq!(stdout(list(root, &["-s"], None, true)), "web\n");
}

#[test]
fn reports_include_conflicts_and_sorted_missing_variables() {
    let fixture = tempdir().unwrap();
    let root = fixture.path();
    fs::write(
        root.join("devhost.toml"),
        "name = 'sample'\nincludes = 'child.toml'\n[services.web]\ncommand = ['{{env.DEVHOST_TEST_UNSET_Z}}']\nport = 3300\n",
    )
    .unwrap();
    let child = root.join("child.toml");
    fs::write(&child, "[services.web]\n").unwrap();
    assert!(
        stderr(list(root, &[], None, true)).contains("service \"web\" is defined multiple times")
    );
    fs::write(
        &child,
        "[services.api]\ncommand = ['{{env.DEVHOST_TEST_UNSET_A}}', '{{env.DEVHOST_TEST_UNSET_Z}}']\nport = 3301\n",
    )
    .unwrap();
    assert!(
        stderr(list(root, &[], None, true)).contains(
            "undefined environment variables: DEVHOST_TEST_UNSET_A, DEVHOST_TEST_UNSET_Z"
        )
    );
}

#[test]
fn validates_included_group_members_in_both_output_modes() {
    let fixture = tempdir().unwrap();
    let root = fixture.path();
    fs::write(
        root.join("devhost.toml"),
        "name = 'sample'\nincludes = 'child.toml'\n[services.web]\ncommand = ['web']\nport = 3300\n",
    )
    .unwrap();
    fs::write(root.join("child.toml"), "[groups]\nbackend = ['missing']\n").unwrap();
    assert_eq!(
        stderr(list(root, &[], None, true)),
        "devhost: ERR: Manifest validation failed:\ndevhost: groups.backend references an unknown service: missing\n"
    );
    assert_eq!(
        stderr(list(root, &[], None, false)),
        "devhost | [ERROR] Manifest validation failed:\ndevhost | groups.backend references an unknown service: missing\n"
    );
    let child = root.join("child.toml");
    for (content, error) in [
        ("[groups]\nbackend = []", "must contain at least one string"),
        (
            "[groups]\nbackend = [1]",
            "must contain only non-empty strings",
        ),
        ("[groups]\nbackend = 'web'", "must be a string array"),
        ("[groups]\nUPPER = ['web']", "has an invalid name"),
        ("[groups]\nweb = ['web']", "conflicts with a service name"),
        ("groups = 1", "must be a table"),
        ("[annotation]", "Unrecognized key in included manifest"),
    ] {
        fs::write(&child, content).unwrap();
        assert!(stderr(list(root, &[], None, true)).contains(error));
    }
}

#[test]
fn service_group_shows_help_without_a_subcommand() {
    let output = Command::new(env!("CARGO_BIN_EXE_devhost"))
        .arg("service")
        .env("AGENT", "1")
        .output()
        .unwrap();
    assert!(stdout(output).contains("list"));
}
