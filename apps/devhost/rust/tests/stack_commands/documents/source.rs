use super::*;

fn script(origin: &str) -> String {
    let mut response = control::get(origin, "inject.js");
    assert_eq!(response.status(), 200);
    assert_eq!(response.headers()["cache-control"], "no-store");
    response.body_mut().read_to_string().unwrap()
}

fn runs(checkout: &Path) -> usize {
    fs::read_to_string(checkout.join("apps/devhost/build-runs.log"))
        .unwrap()
        .lines()
        .count()
}

fn launch(runtime: &Runtime, project: &Path) -> Process {
    let log = File::create(project.join("lifecycle.log")).unwrap();
    let mut command = runtime.command();
    command
        .current_dir(project)
        .args(["start", "--local"])
        .env("DEVHOST_DEV_SOURCE_DIR", "checkout")
        .stdin(Stdio::null())
        .stdout(log.try_clone().unwrap())
        .stderr(log);
    // SAFETY: setsid is async-signal-safe and establishes fixture ownership.
    unsafe {
        command.pre_exec(|| {
            if libc::setsid() < 0 {
                Err(std::io::Error::last_os_error())
            } else {
                Ok(())
            }
        });
    }
    Process(command.spawn().unwrap())
}

#[test]
fn source_checkout_rebuilds_serially_retries_failures_and_limits_preview_mutations() {
    let runtime = Runtime::start();
    let project = runtime.root.path().join("source-contract");
    let checkout = project.join("checkout");
    let source = checkout.join("packages/devhost-ui/src/devtools/main.ts");
    let app = checkout.join("apps/devhost");
    let bundle = app.join("internal/devtools/dist/devtools.js");
    fs::create_dir_all(source.parent().unwrap()).unwrap();
    fs::create_dir_all(&app).unwrap();
    fs::write(&source, "console.log('first source bundle');\n").unwrap();
    // A minimal checkout exercises the real just invocation without rebuilding
    // unrelated frontend dependencies; this is also the Go component fixture.
    fs::write(app.join("justfile"), "build-devtools-bundle:\n    #!/usr/bin/env bash\n    set -euo pipefail\n    test \"$DEVHOST_DEVTOOLS_DEVELOPMENT\" = 1\n    mkdir build-lock\n    trap 'rmdir build-lock' EXIT\n    echo run >> build-runs.log\n    sleep 0.1\n    if test -f fail-build; then echo 'source build failed' >&2; exit 1; fi\n    if test -f silent-build; then exit 0; fi\n    mkdir -p internal/devtools/dist\n    cp ../../packages/devhost-ui/src/devtools/main.ts internal/devtools/dist/devtools.js\n").unwrap();
    fs::write(
        project.join("devhost.toml"),
        "name='source-contract'\n[services.worker]\ncommand=['sleep','300']\nhealth.process=true\n",
    )
    .unwrap();
    let mut process = launch(&runtime, &project);
    wait_until(|| {
        assert!(
            process.0.try_wait().unwrap().is_none(),
            "{}",
            fs::read_to_string(project.join("lifecycle.log")).unwrap()
        );
        read_live_stacks(&runtime.state().join("caddy"))
            .unwrap()
            .iter()
            .any(|stack| stack.name == "source-contract" && stack.control_port > 0)
    });
    let origin = control::origin(&runtime, "source-contract");
    lifecycle::ready(&origin);
    assert_eq!(script(&origin), "console.log('first source bundle');\n");
    assert_eq!(script(&origin), "console.log('first source bundle');\n");
    assert_eq!(runs(&checkout), 1, "fresh source assets must not rebuild");
    fs::write(&source, "console.log('updated source bundle');\n").unwrap();
    File::options()
        .write(true)
        .open(&bundle)
        .unwrap()
        .set_times(fs::FileTimes::new().set_modified(std::time::SystemTime::UNIX_EPOCH))
        .unwrap();
    let barrier = std::sync::Barrier::new(4);
    thread::scope(|scope| {
        let pending: Vec<_> = (0..4)
            .map(|_| {
                scope.spawn(|| {
                    barrier.wait();
                    script(&origin)
                })
            })
            .collect();
        for pending in pending {
            assert_eq!(
                pending.join().unwrap(),
                "console.log('updated source bundle');\n"
            );
        }
    });
    assert_eq!(
        runs(&checkout),
        2,
        "concurrent stale-asset requests share one build"
    );
    assert!(!app.join("build-lock").exists());

    fs::remove_file(&bundle).unwrap();
    fs::write(app.join("fail-build"), "").unwrap();
    let failed = script(&origin);
    assert!(
        failed.contains("DEVHOST COMPILATION ERROR") && failed.contains("source build failed"),
        "{failed}"
    );
    assert_eq!(runs(&checkout), 3);
    fs::remove_file(app.join("fail-build")).unwrap();
    fs::write(app.join("silent-build"), "").unwrap();
    for count in [4, 5] {
        let failed = script(&origin);
        assert!(
            failed.contains("DEVHOST COMPILATION ERROR")
                && failed.contains("finished without writing"),
            "{failed}"
        );
        assert_eq!(
            runs(&checkout),
            count,
            "a successful recipe without a bundle must be retried"
        );
    }
    fs::remove_file(app.join("silent-build")).unwrap();
    assert_eq!(script(&origin), "console.log('updated source bundle');\n");
    assert_eq!(runs(&checkout), 6);

    assert_eq!(control::get(&origin, "pages/").status(), 200);
    let mut request = client()
        .get(format!("{origin}/__devhost__/pages/failed"))
        .header("X-Devhost-Recovery", "status")
        .call()
        .unwrap();
    assert_eq!(request.status(), 200);
    let state = control::body(&mut request);
    assert_eq!(state["stack"], "preview");
    assert_eq!(state["phase"], "unavailable");
    assert_eq!(
        control::post(&origin, "pages/failed", json!({})).status(),
        409
    );
    assert_eq!(control::get(&origin, "pages/missing").status(), 404);
    lifecycle::ready(&origin);
    lifecycle::stop(&runtime, &project, &mut process);
    fs::remove_file(app.join("justfile")).unwrap();
    let rejected = runtime
        .command()
        .current_dir(&project)
        .args(["start", "--local", "--detach"])
        .env("DEVHOST_DEV_SOURCE_DIR", &checkout)
        .output()
        .unwrap();
    assert!(!rejected.status.success(), "{rejected:?}");
    let diagnostic = String::from_utf8(rejected.stderr).unwrap();
    assert!(
        diagnostic.contains("DEVHOST_DEV_SOURCE_DIR")
            && diagnostic.contains("not a devhost checkout"),
        "{diagnostic}"
    );
    assert!(
        read_live_stack_owners(&runtime.state().join("caddy"))
            .unwrap()
            .is_empty()
    );
}
