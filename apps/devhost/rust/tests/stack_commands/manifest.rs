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
    fs::write(project.join("parts/deep/worker.py"), "import os,pathlib,time\npathlib.Path('worker-cwd').write_text(os.getcwd())\ntime.sleep(300)\n").unwrap();
    fs::write(work.join("nested.txt"), "nested include file root").unwrap();
    fs::write(work.join("observe.py"), "import http.server,json,os,pathlib,sys\npathlib.Path('observed.json').write_text(json.dumps({'cwd':os.getcwd(),'args':sys.argv[1:],'port':os.environ['PORT'],'references':os.environ['REFERENCES'],'value':os.environ['VALUE'],'empty':os.environ['EMPTY'],'literal':os.environ['LITERAL']}))\nhttp.server.HTTPServer(('127.0.0.1',int(os.environ['PORT'])),http.server.SimpleHTTPRequestHandler).serve_forever()\n").unwrap();
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
