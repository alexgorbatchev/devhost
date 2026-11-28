use super::control::origin;
use super::lifecycle::ready;
use super::*;

fn list(directory: &Path, manifest: Option<&Path>) -> Output {
    let mut command = Command::new(binary());
    command
        .current_dir(directory)
        .args(["service", "list"])
        .env("AGENT", "1")
        .env_remove("DEVHOST_MANIFEST");
    if let Some(path) = manifest {
        command.arg("--manifest").arg(path);
    }
    command.output().unwrap()
}

fn selected(output: Output, name: &str) {
    assert!(output.status.success(), "{output:?}");
    assert!(output.stderr.is_empty(), "{output:?}");
    assert_eq!(String::from_utf8(output.stdout).unwrap().trim(), name);
}

#[test]
fn invalid_dependency_graphs_and_references_reject_before_launch_or_registration() {
    let runtime = Runtime::start();
    for (name, a, b, diagnostic) in [
        (
            "cycle",
            "dependsOn=['b']",
            "dependsOn=['a']",
            "Dependency cycle detected: a -> b -> a",
        ),
        (
            "self-cycle",
            "dependsOn=['a']",
            "",
            "Dependency cycle detected: a -> a",
        ),
        (
            "missing-dependency",
            "dependsOn=['missing']",
            "",
            "dependsOn references an unknown service: missing",
        ),
        (
            "missing-reference",
            "env.OTHER='{{services.missing.port}}'",
            "",
            "referenced service \"missing\" in template \"{{services.missing.port}}\" does not exist",
        ),
    ] {
        let project = runtime.root.path().join(name);
        fs::create_dir(&project).unwrap();
        fs::write(
            project.join("devhost.toml"),
            format!(
                "name={name:?}\n[services.a]\ncommand=['sh','-c','touch a-launched; exec sleep 300']\nport='auto'\nhealth.process=true\n{a}\n[services.b]\ncommand=['sh','-c','touch b-launched; exec sleep 300']\nport='auto'\nhealth.process=true\n{b}\n"
            ),
        )
        .unwrap();
        let mut process = super::lifecycle::launch(&runtime, &project, &[]);
        let deadline = Instant::now() + Duration::from_secs(5);
        let status = loop {
            if let Some(status) = process.0.try_wait().unwrap() {
                break status;
            }
            assert!(
                Instant::now() < deadline,
                "{name} was not rejected: {}",
                fs::read_to_string(project.join("lifecycle.log")).unwrap()
            );
            thread::sleep(Duration::from_millis(20));
        };
        let log = fs::read_to_string(project.join("lifecycle.log")).unwrap();
        assert_eq!(status.code(), Some(1), "{name}: {log}");
        assert!(log.contains(diagnostic), "{name}: {log}");
        for marker in ["a-launched", "b-launched"] {
            assert!(!project.join(marker).exists(), "{name}: {marker}");
        }
        assert!(
            read_live_stack_owners(&runtime.state().join("caddy"))
                .unwrap()
                .is_empty(),
            "{name} registered stack, hostname or port ownership"
        );
    }
}

#[test]
fn included_service_cwd_does_not_rewrite_literal_environment_values() {
    let runtime = Runtime::start();
    let project = runtime.root.path().join("literal-environment");
    let work = project.join("sub/src");
    fs::create_dir_all(&work).unwrap();
    fs::write(
        project.join("devhost.toml"),
        "name='literal-environment'\nincludes=['sub/service.toml']\n",
    )
    .unwrap();
    fs::write(project.join("sub/service.toml"), "[services.worker]\ncwd='src'\ncommand=['python3','observe.py']\nhealth.process=true\n[services.worker.env]\ncwd='cache'\nserve='literal-root'\n").unwrap();
    fs::write(work.join("observe.py"), "import json,os,pathlib,time\npathlib.Path('observed.json.tmp').write_text(json.dumps({'directory':os.getcwd(),'cwd':os.environ['cwd'],'serve':os.environ['serve']}))\npathlib.Path('observed.json.tmp').replace('observed.json')\ntime.sleep(300)\n").unwrap();
    let log = File::create(project.join("lifecycle.log")).unwrap();
    let mut process = Process(
        runtime
            .command()
            .current_dir(&project)
            .args(["start", "--local"])
            .env_remove("BASH_ENV")
            .stdin(Stdio::null())
            .stdout(log.try_clone().unwrap())
            .stderr(log)
            .process_group(0)
            .spawn()
            .unwrap(),
    );
    let observed = work.join("observed.json");
    wait_until(|| {
        assert!(
            process.0.try_wait().unwrap().is_none(),
            "{}",
            fs::read_to_string(project.join("lifecycle.log")).unwrap()
        );
        observed.is_file()
    });
    let value: Value = serde_json::from_slice(&fs::read(observed).unwrap()).unwrap();
    assert_eq!(value["directory"], work.to_str().unwrap());
    assert_eq!(value["serve"], "literal-root");
    assert_eq!(
        value["cwd"], "cache",
        "included environment cwd was rewritten as a service path"
    );
    let output = runtime
        .command()
        .current_dir(&project)
        .arg("stop")
        .output()
        .unwrap();
    assert!(output.status.success(), "{output:?}");
    wait_until(|| process.0.try_wait().unwrap().is_some());
}

#[test]
fn discovery_stops_at_git_boundaries_and_explicit_paths_never_fall_back() {
    let fixture = tempfile::tempdir().unwrap();
    let root = fixture.path().canonicalize().unwrap();
    let project = root.join("repository");
    let nested = project.join("nested/deep");
    fs::create_dir_all(&nested).unwrap();
    let outer = root.join("devhost.toml");
    fs::write(
        &outer,
        "name='outer'\n[services.outer]\ncommand=['true']\nhealth.process=true\n",
    )
    .unwrap();
    for git_file in [false, true] {
        if git_file {
            fs::write(project.join(".git"), "gitdir: ../metadata\n").unwrap();
        } else {
            fs::create_dir(project.join(".git")).unwrap();
        }
        let output = list(&nested, None);
        assert_eq!(output.status.code(), Some(1), "{output:?}");
        assert!(output.stdout.is_empty());
        assert!(String::from_utf8_lossy(&output.stderr).contains("Could not find devhost.toml"));
        selected(list(&nested, Some(&outer)), "outer");
        let missing = project.join("missing/devhost.toml");
        let output = list(&nested, Some(&missing));
        assert_eq!(output.status.code(), Some(1), "{output:?}");
        assert!(output.stdout.is_empty());
        assert!(String::from_utf8_lossy(&output.stderr).contains("missing/devhost.toml"));
        if git_file {
            fs::remove_file(project.join(".git")).unwrap();
        } else {
            fs::remove_dir(project.join(".git")).unwrap();
        }
    }
    selected(list(&nested, None), "outer");
    fs::write(
        project.join("devhost.toml"),
        "name='inner'\n[services.inner]\ncommand=['true']\nhealth.process=true\n",
    )
    .unwrap();
    symlink(&nested, root.join("alias")).unwrap();
    selected(list(&root.join("alias"), None), "inner");
    selected(
        list(&nested, Some(Path::new("../../devhost.toml"))),
        "inner",
    );
}

#[test]
fn nested_includes_resolve_child_cwd_and_all_runtime_service_templates() {
    let runtime = Runtime::start();
    let project = runtime.root.path().join("interpolation-contract");
    let work = project.join("work with spaces");
    fs::create_dir_all(project.join("parts/deep")).unwrap();
    fs::create_dir(&work).unwrap();
    fs::write(
        project.join("devhost.toml"),
        "name='interpolation-contract'\nincludes=['parts/one.toml']\n",
    )
    .unwrap();
    fs::write(
        project.join("parts/one.toml"),
        "includes=['deep/two.toml']\n",
    )
    .unwrap();
    fs::write(project.join("parts/deep/two.toml"), r#"
[services.web]
cwd='../../work with spaces'
command=['python3','observe.py','{{ services.web.port }}','{{ services.web.host }}','{{ services.web.bindHost }}','{{ services.web.url }}','{{ env.DEVHOST_PARITY_VALUE }}']
port='auto'
host='{{ env.DEVHOST_PARITY_HOST }}'
health.http='{{ services.web.url }}/'
[services.web.env]
REFERENCES='{{services.web.port}}|{{services.web.host}}|{{services.web.bindHost}}|{{services.web.url}}'
VALUE='before-{{ env.DEVHOST_PARITY_VALUE }}-after'
EMPTY='before{{ env.DEVHOST_PARITY_EMPTY }}after'
LITERAL='{{ invalid.expression }} and {{ env.1INVALID }} and {{unfinished'
[services.worker]
command=['python3','worker.py']
health.process=true
[services.docs]
serve='../../work with spaces'
host='nested-docs.localhost'
"#).unwrap();
    fs::write(project.join("parts/deep/worker.py"), "import os,pathlib,time\npathlib.Path('worker-cwd.tmp').write_text(os.getcwd())\npathlib.Path('worker-cwd.tmp').replace('worker-cwd')\ntime.sleep(300)\n").unwrap();
    fs::write(work.join("nested.txt"), "nested include file root").unwrap();
    fs::write(work.join("observe.py"), "import http.server,json,os,pathlib,socketserver,sys\npathlib.Path('observed.json.tmp').write_text(json.dumps({'cwd':os.getcwd(),'args':sys.argv[1:],'port':os.environ['PORT'],'references':os.environ['REFERENCES'],'value':os.environ['VALUE'],'empty':os.environ['EMPTY'],'literal':os.environ['LITERAL']}))\npathlib.Path('observed.json.tmp').replace('observed.json')\nsocketserver.TCPServer.allow_reuse_address = True\nsocketserver.TCPServer(('127.0.0.1',int(os.environ['PORT'])),http.server.SimpleHTTPRequestHandler).serve_forever()\n").unwrap();
    // Keep interpolation inputs on the supervisor command, never in global test state.
    let source = fs::read_to_string(project.join("parts/deep/two.toml")).unwrap();
    let log = File::create(project.join("lifecycle.log")).unwrap();
    let mut command = runtime.command();
    command
        .current_dir(&project)
        .args(["start", "--local"])
        .env("DEVHOST_PARITY_VALUE", "value with spaces")
        .env("DEVHOST_PARITY_HOST", "interpolated.localhost")
        .env("DEVHOST_PARITY_EMPTY", "")
        .env_remove("BASH_ENV")
        .stdin(Stdio::null())
        .stdout(log.try_clone().unwrap())
        .stderr(log);
    // SAFETY: setsid is async-signal-safe and isolates this fixture's process group.
    unsafe {
        command.pre_exec(|| {
            if libc::setsid() < 0 {
                Err(std::io::Error::last_os_error())
            } else {
                Ok(())
            }
        });
    }
    let mut process = Process(command.spawn().unwrap());
    wait_until(|| {
        if process.0.try_wait().unwrap().is_some() {
            let log = fs::read_to_string(project.join("lifecycle.log")).unwrap();
            assert!(
                ["parts/work with spaces", "parts/parts/deep"]
                    .iter()
                    .any(|wrong| log.contains(project.join(wrong).to_str().unwrap())),
                "unexpected nested manifest startup failure: {log}"
            );
            panic!("nested include rebased a service more than once: {log}");
        }
        read_live_stacks(&runtime.state().join("caddy"))
            .unwrap()
            .iter()
            .any(|stack| stack.name == "interpolation-contract" && stack.control_port > 0)
    });
    ready(&origin(&runtime, "interpolation-contract"));
    let worker_cwd = project.join("parts/deep/worker-cwd");
    wait_until(|| worker_cwd.is_file());
    assert_eq!(
        fs::read_to_string(worker_cwd).unwrap(),
        project.join("parts/deep").to_str().unwrap()
    );
    let snapshot = super::control::body(&mut super::control::get(
        &origin(&runtime, "interpolation-contract"),
        "stack-info",
    ));
    let docs = snapshot["services"]
        .as_array()
        .unwrap()
        .iter()
        .find(|service| service["name"] == "docs")
        .unwrap();
    let mut response = super::control::client()
        .get(format!("http://127.0.0.1:{}/nested.txt", docs["port"]))
        .call()
        .unwrap();
    assert_eq!(response.status(), 200);
    assert_eq!(
        response.body_mut().read_to_string().unwrap(),
        "nested include file root"
    );
    let observed: Value =
        serde_json::from_slice(&fs::read(work.join("observed.json")).unwrap()).unwrap();
    let port = observed["port"].as_str().unwrap();
    assert!(port.parse::<u16>().unwrap() > 0);
    assert_eq!(observed["cwd"], work.to_str().unwrap());
    assert_eq!(
        observed["args"],
        json!([
            port,
            "interpolated.localhost",
            "127.0.0.1",
            format!("http://127.0.0.1:{port}"),
            "value with spaces"
        ])
    );
    assert_eq!(
        observed["references"],
        format!("{port}|interpolated.localhost|127.0.0.1|http://127.0.0.1:{port}")
    );
    assert_eq!(observed["value"], "before-value with spaces-after");
    assert_eq!(observed["empty"], "beforeafter");
    assert_eq!(
        observed["literal"],
        "{{ invalid.expression }} and {{ env.1INVALID }} and {{unfinished"
    );
    // Stop with the same interpolation environment used by the running supervisor.
    let output = runtime
        .command()
        .current_dir(&project)
        .arg("stop")
        .env("DEVHOST_PARITY_VALUE", "value with spaces")
        .env("DEVHOST_PARITY_HOST", "interpolated.localhost")
        .env("DEVHOST_PARITY_EMPTY", "")
        .output()
        .unwrap();
    assert!(output.status.success(), "{output:?}");
    wait_until(|| process.0.try_wait().unwrap().is_some());
    fs::write(
        project.join("parts/deep/two.toml"),
        source.replace(
            "{{ env.DEVHOST_PARITY_VALUE }}",
            "{{ env.DEVHOST_PARITY_MISSING_Z }} {{ env.DEVHOST_PARITY_MISSING_A }}",
        ),
    )
    .unwrap();
    let output = runtime
        .command()
        .current_dir(&project)
        .args(["service", "list"])
        .env("DEVHOST_PARITY_HOST", "interpolated.localhost")
        .env("DEVHOST_PARITY_EMPTY", "")
        .env_remove("DEVHOST_PARITY_MISSING_A")
        .env_remove("DEVHOST_PARITY_MISSING_Z")
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(1), "{output:?}");
    let error = String::from_utf8(output.stderr).unwrap();
    assert!(
        error.contains("DEVHOST_PARITY_MISSING_A") && error.contains("DEVHOST_PARITY_MISSING_Z"),
        "{error}"
    );
    assert!(
        error.find("DEVHOST_PARITY_MISSING_A").unwrap()
            < error.find("DEVHOST_PARITY_MISSING_Z").unwrap(),
        "{error}"
    );
    assert!(
        read_live_stacks(&runtime.state().join("caddy"))
            .unwrap()
            .is_empty()
    );
}
