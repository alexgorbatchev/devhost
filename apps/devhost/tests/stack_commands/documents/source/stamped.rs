use super::*;

struct Checkout(PathBuf);

impl Drop for Checkout {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn checkout(path: &Path, marker: &str) {
    let source = path.join("packages/devhost-ui/src/devtools/main.ts");
    let app = path.join("apps/devhost");
    fs::create_dir_all(source.parent().unwrap()).unwrap();
    fs::create_dir_all(app.join("dist/devtools")).unwrap();
    fs::write(&source, format!("console.log({marker:?});\n")).unwrap();
    fs::copy(&source, app.join("dist/devtools/devtools.js")).unwrap();
    fs::write(app.join("justfile"), "build-devtools-bundle:\n    cp ../../packages/devhost-ui/src/devtools/main.ts dist/devtools/devtools.js\n").unwrap();
}

#[test]
#[ignore = "requires a binary stamped with the absent DEVHOST_STAMP_TEST_CHECKOUT path"]
fn recorded_checkout_override_rejection_and_embedded_fallback_match() {
    let recorded = PathBuf::from(std::env::var_os("DEVHOST_STAMP_TEST_CHECKOUT").unwrap());
    assert!(recorded.is_absolute());
    // Refuse an existing directory: only this fixture's newly created checkout
    // may be removed to exercise an unavailable compile-time source path.
    fs::create_dir(&recorded).unwrap();
    let recorded = Checkout(recorded);
    checkout(&recorded.0, "recorded checkout");
    let runtime = Runtime::start();
    let project = runtime.root.path().join("stamp-contract");
    fs::create_dir(&project).unwrap();
    checkout(&project.join("alternate"), "explicit checkout");
    fs::write(project.join("devhost.toml"), "name='stamp-contract'\n[worktrees]\nenabled=false\n[services.worker]\ncommand=['sleep','300']\nhealth.process=true\n").unwrap();
    for (override_path, expected, marker) in [
        (None, recorded.0.clone(), "recorded checkout"),
        (
            Some("alternate"),
            project.join("alternate"),
            "explicit checkout",
        ),
    ] {
        let mut process = launch(&runtime, &project, override_path);
        let origin = control::origin(&runtime, "stamp-contract");
        lifecycle::ready(&origin);
        let config = control::body(&mut control::get(&origin, "config.json"));
        assert_eq!(config["devhostSourceRootPath"], expected.to_str().unwrap());
        assert_eq!(script(&origin), format!("console.log({marker:?});\n"));
        lifecycle::stop(&runtime, &project, &mut process);
    }
    let rejected = runtime
        .command()
        .current_dir(&project)
        .args(["start", "--local", "--detach"])
        .env("DEVHOST_DEV_SOURCE_DIR", "missing-explicit")
        .output()
        .unwrap();
    assert!(!rejected.status.success(), "{rejected:?}");
    let diagnostic = String::from_utf8(rejected.stderr).unwrap();
    assert!(
        diagnostic.contains("DEVHOST_DEV_SOURCE_DIR")
            && diagnostic.contains("not a devhost checkout"),
        "{diagnostic}"
    );
    fs::remove_dir_all(&recorded.0).unwrap();
    let mut process = launch(&runtime, &project, None);
    let origin = control::origin(&runtime, "stamp-contract");
    lifecycle::ready(&origin);
    let config = control::body(&mut control::get(&origin, "config.json"));
    assert_eq!(config["devhostSourceRootPath"], "");
    let mut response = control::get(&origin, "inject.js");
    assert_eq!(response.status(), 200);
    let embedded = response.body_mut().read_to_string().unwrap();
    assert!(!embedded.contains("recorded checkout") && !embedded.contains("explicit checkout"));
    assert!(
        fs::read_to_string(project.join("lifecycle.log"))
            .unwrap()
            .contains("This development build serves its embedded devtools assets:")
    );
    lifecycle::stop(&runtime, &project, &mut process);
}
