use super::*;

const SERVER: &str = r#"import http.server, json, pathlib, socketserver, sys
pathlib.Path('arguments.json').write_text(json.dumps(sys.argv[1:]))
class Handler(http.server.BaseHTTPRequestHandler):
    def do_HEAD(self):
        self.send_response(200); self.end_headers()
    def do_GET(self):
        self.send_response(200); self.send_header('Content-Type', 'text/plain'); self.end_headers(); self.wfile.write(b'argument boundaries preserved')
    def log_message(self, *args): pass
socketserver.TCPServer.allow_reuse_address = True
socketserver.TCPServer(('127.0.0.1', 0), Handler).serve_forever()
"#;

fn repository(directory: &Path, remote: Option<&str>) {
    fs::create_dir(directory).unwrap();
    for arguments in [
        vec!["init", "-q"],
        vec!["remote", "add", "origin", remote.unwrap_or("")],
    ] {
        if arguments[0] == "remote" && remote.is_none() {
            continue;
        }
        let output = Command::new("git")
            .current_dir(directory)
            .args(arguments)
            .output()
            .unwrap();
        assert!(output.status.success(), "{output:?}");
    }
}

fn shell_word(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

pub(super) fn compare_names_and_argument_boundaries(runtime: &Runtime) {
    let root = runtime.root.path();
    let plain = root.join("CWD.App ___");
    fs::create_dir(&plain).unwrap();
    let local = root.join("Local.Repo ___");
    repository(&local, None);
    let remote = root.join("remote checkout");
    repository(&remote, Some("git@github.com:fixture/Origin.App.git"));
    let entrypoint = root.join("entrypoint checkout");
    repository(&entrypoint, Some("https://example.test/Entry.Point.git/"));
    let plain_script = plain.join("server with spaces.py");
    let entrypoint_script = entrypoint.join("server with spaces.py");
    for script in [&plain_script, &entrypoint_script] {
        fs::write(script, SERVER).unwrap();
    }
    let long_name = format!("{} !!! ignored", "A".repeat(60));
    let long_label = "a".repeat(48);
    let cases = [
        (&plain, &plain_script, false, None, "cwd-app"),
        (&local, &plain_script, false, None, "local-repo"),
        (&remote, &plain_script, false, None, "origin-app"),
        (&remote, &entrypoint_script, true, None, "entry-point"),
        (&plain, &plain_script, false, Some(" !!! "), "app"),
        (
            &plain,
            &plain_script,
            false,
            Some(long_name.as_str()),
            long_label.as_str(),
        ),
    ];
    let expected = ["value with spaces", "literal $HOME", "", "quote\"value"];
    let mut names = std::collections::BTreeSet::new();
    for (index, (directory, script, shell, explicit, label)) in cases.into_iter().enumerate() {
        let marker = directory.join("arguments.json");
        if marker.exists() {
            fs::remove_file(&marker).unwrap();
        }
        let mut command = runtime.command();
        command.current_dir(directory).arg("serve");
        if let Some(name) = explicit {
            command.args(["--name", name]);
        }
        if shell {
            command.arg(
                std::iter::once("python3".to_owned())
                    .chain(std::iter::once(script.to_str().unwrap().to_owned()))
                    .chain(expected.iter().map(|value| (*value).to_owned()))
                    .map(|value| shell_word(&value))
                    .collect::<Vec<_>>()
                    .join(" "),
            );
        } else {
            command.args(["--", "python3"]).arg(script).args(expected);
        }
        let log = fs::File::create(root.join(format!("name-{index}.log"))).unwrap();
        command
            .stdin(Stdio::null())
            .stdout(log.try_clone().unwrap())
            .stderr(log);
        unsafe {
            command.pre_exec(|| {
                if libc::setsid() < 0 {
                    Err(std::io::Error::last_os_error())
                } else {
                    Ok(())
                }
            });
        }
        let mut child = Process(command.spawn().unwrap());
        let owner = session(runtime);
        let (actual_label, random) = owner.name.rsplit_once('-').unwrap();
        assert_eq!(actual_label, label, "case {index}: {}", owner.name);
        assert_eq!(random.len(), 8);
        assert!(random.bytes().all(|byte| byte.is_ascii_hexdigit()));
        assert!(
            names.insert(owner.name.clone()),
            "reused session identifier"
        );
        let host = format!("{}.localhost", owner.name);
        wait_until(|| response(runtime, &host).as_deref() == Some("argument boundaries preserved"));
        let arguments: Value = serde_json::from_slice(&fs::read(&marker).unwrap()).unwrap();
        assert_eq!(arguments, json!(expected), "case {index}");
        let output = runtime
            .command()
            .args(["stop", "--session", &owner.name])
            .output()
            .unwrap();
        assert!(output.status.success(), "{output:?}");
        wait_until(|| child.0.try_wait().unwrap().is_some());
        assert!(!owner.is_alive());
        assert!(
            read_live_stacks(&runtime.state().join("caddy"))
                .unwrap()
                .is_empty()
        );
        assert_ne!(
            response(runtime, &host).as_deref(),
            Some("argument boundaries preserved")
        );
    }
}
