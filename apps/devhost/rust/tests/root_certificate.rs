use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};

const CERTIFICATE_PATH: &str = "caddy/storage/pki/authorities/local/root.crt";

fn binary() -> PathBuf {
    std::env::var_os("DEVHOST_CLI_TEST_BINARY")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_BIN_EXE_devhost")))
}

fn command(root: &Path) -> Command {
    let mut command = Command::new(binary());
    command
        .current_dir(root)
        .args(["caddy", "print-root-cert"])
        .env("AGENT", "1")
        .env_remove("DEVHOST_STATE_DIR")
        .env_remove("XDG_STATE_HOME")
        .env_remove("HOME")
        .env_remove("USERPROFILE");
    command
}

#[test]
fn prints_the_raw_certificate_from_the_selected_state_directory() {
    let fixture = tempfile::tempdir().unwrap();
    let root = fixture.path();
    for (path, bytes) in [
        ("state", b"explicit\r\n".as_slice()),
        ("xdg/devhost", b"xdg\n"),
        ("home/.local/state/devhost", b"home"),
    ] {
        let path = root.join(path).join(CERTIFICATE_PATH);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, bytes).unwrap();
    }
    for (explicit, xdg, expected) in [
        ("  state/unused/.. ", "xdg", b"explicit\r\n".as_slice()),
        ("  ", "  xdg ", b"xdg\n"),
        ("", "", b"home"),
    ] {
        let output = command(root)
            .env("DEVHOST_STATE_DIR", explicit)
            .env("XDG_STATE_HOME", xdg)
            .env("HOME", " home ")
            .output()
            .unwrap();
        assert!(output.status.success(), "{:?}", output.stderr);
        assert_eq!(output.stdout, expected);
        assert!(output.stderr.is_empty());
    }
}

#[test]
fn reports_missing_state_and_certificates_without_creating_directories() {
    let fixture = tempfile::tempdir().unwrap();
    let root = fixture.path();
    let output = command(root).output().unwrap();
    assert_eq!(output.status.code(), Some(1));
    assert!(output.stdout.is_empty());
    assert_eq!(
        String::from_utf8(output.stderr).unwrap(),
        "devhost: ERR: Could not determine the devhost state directory. Set DEVHOST_STATE_DIR or HOME.\n"
    );

    let output = command(root)
        .env("DEVHOST_STATE_DIR", "isolated")
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(1));
    assert!(output.stdout.is_empty());
    let path = Path::new("isolated").join(CERTIFICATE_PATH);
    assert_eq!(
        String::from_utf8(output.stderr).unwrap(),
        format!(
            "devhost: ERR: Managed Caddy root certificate not found at {}. Run 'devhost caddy start' first.\n",
            path.display()
        )
    );
    assert!(!root.join("isolated").exists());
}

#[test]
fn caddy_group_prints_help_without_starting_a_server() {
    let fixture = tempfile::tempdir().unwrap();
    let output = Command::new(binary())
        .arg("caddy")
        .current_dir(fixture.path())
        .output()
        .unwrap();
    assert!(output.status.success());
    assert!(
        String::from_utf8(output.stdout)
            .unwrap()
            .contains("print-root-cert")
    );
}
