use super::control::{body, client, get, origin};
use super::lifecycle::{launch, stop};
use super::*;

const SERVER: &str = r#"import http.server, json, os, pathlib, socket, socketserver, sys
root = pathlib.Path.cwd()
port = int(os.environ['PORT'])
trace = root/'attempts.jsonl'
previous = trace.read_text().splitlines() if trace.exists() else []
with trace.open('a') as output:
    output.write(json.dumps({'port':port,'pid':os.getpid()})+'\n')
if len(previous) < int(sys.argv[1]):
    blocker = socket.socket()
    if sys.argv[2] == "self":
        blocker.bind(('127.0.0.1',port)); blocker.listen()
    contender = socket.socket()
    try:
        contender.bind(('127.0.0.1',port))
    except OSError as error:
        print(str(error),file=sys.stderr,flush=True)
        sys.exit(7)
    raise RuntimeError('the fixture failed to occupy its assigned port')
class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200); self.end_headers(); self.wfile.write(b'assigned port backend')
    def log_message(self,*args): pass
socketserver.TCPServer.allow_reuse_address = True
socketserver.TCPServer(('127.0.0.1',port),Handler).serve_forever()
"#;

enum Collision {
    Recover,
    Exhaust,
    Fixed,
}

#[test]
fn automatic_port_retries_refresh_dependants() {
    run_case(Collision::Recover);
}
#[test]
fn automatic_port_exhaustion_preserves_final_port_and_references() {
    run_case(Collision::Exhaust);
}
#[test]
fn fixed_port_collision_never_retries() {
    run_case(Collision::Fixed);
}

fn release_reservation(listener: TcpListener) {
    // Closing our descriptor alone leaves a concurrent child's forked copy bound.
    #[cfg(target_os = "linux")]
    socket2::SockRef::from(&listener)
        .shutdown(std::net::Shutdown::Both)
        .unwrap();
    drop(listener);
}

#[cfg(target_os = "linux")]
#[test]
fn reservation_release_unbinds_inherited_socket_copies() {
    let listener = fixture_ports::reserve_listener();
    let address = listener.local_addr().unwrap();
    let inherited = listener.try_clone().unwrap();
    release_reservation(listener);
    let replacement = TcpListener::bind(address)
        .expect("reservation must unbind even while a forked child retains a descriptor");
    drop(inherited);
    drop(replacement);
}

fn run_case(case: Collision) {
    let runtime = Runtime::start();
    let (name, automatic, failures, count, successful) = match case {
        Collision::Recover => ("retry-success", true, 2, 3, true),
        Collision::Exhaust => ("retry-exhausted", true, 99, 4, false),
        Collision::Fixed => ("fixed-collision", false, 99, 1, false),
    };
    let project = runtime.root.path().join(name);
    fs::create_dir(&project).unwrap();
    fs::write(project.join("server.py"), SERVER).unwrap();
    fs::write(project.join("client.py"), "import json,os,pathlib,time\np=pathlib.Path('observed.pending')\nv={k:os.environ[k] for k in ['REFERENCE','URL','BIND','HOST']}\nv['ATTEMPTS']=len(pathlib.Path('attempts.jsonl').read_text().splitlines())\np.write_text(json.dumps(v))\np.replace('observed.json')\ntime.sleep(300)\n").unwrap();
    let fixed = fixture_ports::reserve_listener();
    let fixed_port = fixed.local_addr().unwrap().port();
    let port = if automatic {
        "'auto'".to_owned()
    } else {
        fixed_port.to_string()
    };
    let fixed = if automatic {
        release_reservation(fixed);
        None
    } else {
        Some(fixed)
    };
    let collision = if automatic { "self" } else { "external" };
    fs::write(project.join("devhost.toml"), format!("name={name:?}\n[worktrees]\nenabled=false\n[services.web]\ncommand=['python3','server.py','{failures}','{collision}']\nport={port}\nhost={name:?}\n[services.web.health]\nhttp='/'\ninterval=25\ntimeout=1000\n[services.consumer]\ncommand=['python3','client.py']\ndependsOn=['web']\nhealth.process=true\n[services.consumer.env]\nREFERENCE='{{{{services.web.port}}}}'\nURL='{{{{services.web.url}}}}'\nBIND='{{{{services.web.bindHost}}}}'\nHOST='{{{{services.web.host}}}}'\n")).unwrap();
    let mut process = launch(&runtime, &project, &["consumer"]);
    wait_until(|| {
        assert!(
            process.0.try_wait().unwrap().is_none(),
            "{}",
            fs::read_to_string(project.join("lifecycle.log")).unwrap()
        );
        read_live_stacks(&runtime.state().join("caddy"))
            .unwrap()
            .iter()
            .any(|stack| stack.name == name && stack.control_port > 0)
    });
    let origin = origin(&runtime, name);
    wait_until(|| body(&mut get(&origin, "stack-info"))["starting"] == false);
    if !successful {
        wait_until(|| {
            body(&mut get(&origin, "stack-info"))["services"]
                .as_array()
                .unwrap()
                .iter()
                .any(|service| service["name"] == "web" && service["state"] == "exited")
        });
    }
    let snapshot = body(&mut get(&origin, "stack-info"));
    let web = snapshot["services"]
        .as_array()
        .unwrap()
        .iter()
        .find(|service| service["name"] == "web")
        .unwrap();
    let attempts: Vec<Value> = fs::read_to_string(project.join("attempts.jsonl"))
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    assert_eq!(attempts.len(), count, "{name}: {snapshot}");
    let ports: std::collections::BTreeSet<_> = attempts
        .iter()
        .map(|attempt| attempt["port"].as_u64().unwrap() as u16)
        .collect();
    for pair in attempts.windows(2) {
        assert_ne!(
            pair[0]["port"], pair[1]["port"],
            "{name}: a retry retained its conflicting assigned port"
        );
    }
    let final_port = attempts.last().unwrap()["port"].as_u64().unwrap();
    assert_eq!(
        web["port"], final_port,
        "retry exhaustion must retain the final attempted port: {name}: {snapshot}; attempts={attempts:?}"
    );
    wait_until(|| project.join("observed.json").exists());
    let observed: Value =
        serde_json::from_slice(&fs::read(project.join("observed.json")).unwrap()).unwrap();
    assert_eq!(
        observed,
        json!({"REFERENCE":final_port.to_string(),"URL":format!("http://127.0.0.1:{final_port}"),"BIND":"127.0.0.1","HOST":format!("{name}.localhost"),"ATTEMPTS":count})
    );
    if successful {
        assert_eq!(web["state"], "ready", "{snapshot}");
        assert_eq!(
            client()
                .get(format!("http://127.0.0.1:{final_port}/"))
                .call()
                .unwrap()
                .status(),
            200
        );
    } else {
        assert_eq!(web["state"], "exited", "{snapshot}");
        assert_eq!(web["exitCode"], 7, "{snapshot}");
    }
    let log = fs::read_to_string(project.join("lifecycle.log")).unwrap();
    assert_eq!(
        log.matches("with a new auto port after a bind collision")
            .count(),
        if automatic { count - 1 } else { 0 },
        "{name}: {log}"
    );
    stop(&runtime, &project, &mut process);
    wait_until(|| {
        attempts
            .iter()
            .all(|attempt| !procid::is_process_alive(attempt["pid"].as_i64().unwrap() as i32))
    });
    if let Some(listener) = fixed {
        // The conflicting listener belongs to the caller, not the stopped stack.
        assert_eq!(
            TcpListener::bind(listener.local_addr().unwrap())
                .unwrap_err()
                .kind(),
            std::io::ErrorKind::AddrInUse
        );
        release_reservation(listener);
    }
    for port in ports {
        let socket =
            socket2::Socket::new(socket2::Domain::IPV4, socket2::Type::STREAM, None).unwrap();
        socket.set_reuse_address(true).unwrap();
        socket
            .bind(&std::net::SocketAddr::from(([127, 0, 0, 1], port)).into())
            .unwrap_or_else(|error| {
                let address = format!("0100007F:{port:04X}");
                let connections = fs::read_to_string("/proc/net/tcp")
                    .unwrap_or_default()
                    .lines()
                    .filter(|line| line.contains(&address))
                    .collect::<Vec<_>>()
                    .join("\n");
                panic!(
                    "{name}: port {port} was not reusable after stopping: {error}; attempts={attempts:?}; connections={connections}; lifecycle={log}"
                );
            });
        socket.listen(1).unwrap();
    }
}
