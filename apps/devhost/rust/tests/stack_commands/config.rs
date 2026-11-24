use super::*;

#[test]
fn config_directory_precedence_and_unusable_selected_paths_do_not_fall_back() {
    let fixture = tempfile::tempdir().unwrap();
    let root = fixture.path().canonicalize().unwrap();
    for (directory, marker) in [
        ("explicit", "selectedExplicit"),
        ("xdg/devhost", "selectedXdg"),
        ("home/.config/devhost", "selectedHome"),
    ] {
        fs::create_dir_all(root.join(directory)).unwrap();
        fs::write(
            root.join(directory).join("config.toml"),
            format!("{marker}=true\n"),
        )
        .unwrap();
    }
    for (explicit, xdg, selected, marker) in [
        (
            " explicit/unused/.. ",
            "xdg",
            "explicit",
            "selectedExplicit",
        ),
        (" \t", " xdg ", "xdg/devhost", "selectedXdg"),
        ("", " ", "~/.config/devhost", "selectedHome"),
    ] {
        let output = Command::new(binary())
            .current_dir(&root)
            .args(["caddy", "stop"])
            .env("AGENT", "1")
            .env("HOME", root.join("home"))
            .env_remove("USERPROFILE")
            .env("DEVHOST_STATE_DIR", root.join("private-state"))
            .env("DEVHOST_CONFIG_DIR", explicit)
            .env("XDG_CONFIG_HOME", xdg)
            .output()
            .unwrap();
        assert_eq!(output.status.code(), Some(1), "{output:?}");
        assert!(output.stdout.is_empty(), "{output:?}");
        let error = String::from_utf8(output.stderr).unwrap();
        assert!(error.contains(marker), "{error}");
        assert!(
            error.contains(&format!("{selected}/config.toml")),
            "{error}"
        );
        assert!(!root.join("private-state").exists());
    }
    // A directory at the selected file path must report a read error, not load XDG.
    fs::create_dir_all(root.join("unusable/config.toml")).unwrap();
    let output = Command::new(binary())
        .current_dir(&root)
        .args(["caddy", "stop"])
        .env("AGENT", "1")
        .env("HOME", root.join("home"))
        .env("DEVHOST_STATE_DIR", root.join("private-state"))
        .env("DEVHOST_CONFIG_DIR", "unusable")
        .env("XDG_CONFIG_HOME", "xdg")
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(1), "{output:?}");
    let error = String::from_utf8(output.stderr).unwrap();
    assert!(error.contains("unusable/config.toml"), "{error}");
    assert!(!error.contains("selectedXdg"), "{error}");
    assert!(!root.join("private-state").exists());
}
