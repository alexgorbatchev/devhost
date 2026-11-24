use super::documents::Backend;
use super::lifecycle::{launch, ready, stop};
use super::*;

#[path = "proxy/routes.rs"]
mod routes;

#[test]
fn bind_hosts_and_local_origin_translation_preserve_external_backend_ownership() {
    let runtime = Runtime::start();
    for (index, (bind, loopback, authority)) in [
        ("127.0.0.1", "127.0.0.1", "127.0.0.1"),
        ("0.0.0.0", "127.0.0.1", "127.0.0.1"),
        ("::1", "::1", "[::1]"),
        ("::", "::1", "[::1]"),
    ]
    .into_iter()
    .enumerate()
    {
        for enabled in [false, true] {
            let backend = Backend::start_at(loopback);
            let local = format!("{authority}:{}", backend.port);
            let name = format!("origin-{index}-{enabled}");
            let host = format!("{name}.localhost");
            let project = runtime.root.path().join(&name);
            fs::create_dir(&project).unwrap();
            fs::write(
                project.join("devhost.toml"),
                format!(
                    "name={name:?}\n[worktrees]\nenabled=false\n[services.web]\nmanaged=false\nport={}\nbindHost={bind:?}\nhost={host:?}\nproxyLocalOrigin={enabled}\nhealth.http='http://{local}/inspect'\n",
                    backend.port
                ),
            )
            .unwrap();
            let mut process = launch(&runtime, &project, &[]);
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
            ready(&control::origin(&runtime, &name));
            let url = format!("http://127.0.0.1:{}/inspect", runtime.settings.http_port);
            for document in [false, true] {
                for origin in [
                    None,
                    Some(format!("http://{host}")),
                    Some(format!("https://{host}")),
                ] {
                    let mut request = control::client().get(&url).header("Host", &host);
                    if let Some(origin) = &origin {
                        request = request.header("Origin", origin);
                    }
                    if document {
                        request = request.header("Sec-Fetch-Dest", "document");
                    }
                    let mut response = request.call().unwrap();
                    assert_eq!(response.status(), 200, "{name} document={document}");
                    let observed: Value =
                        serde_json::from_str(&response.body_mut().read_to_string().unwrap())
                            .unwrap();
                    assert_eq!(
                        observed["host"],
                        if enabled || document {
                            local.as_str()
                        } else {
                            host.as_str()
                        }
                    );
                    assert_eq!(observed["forwardedHost"], host);
                    assert_eq!(
                        observed["origin"],
                        match origin {
                            None => Value::Null,
                            Some(_) if enabled => json!(format!("http://{local}")),
                            Some(origin) => json!(origin),
                        },
                        "{name} document={document}"
                    );
                }
                for origin in ["https://foreign.example", "null"] {
                    let mut request = control::client()
                        .get(&url)
                        .header("Host", &host)
                        .header("Origin", origin);
                    if document {
                        request = request.header("Sec-Fetch-Dest", "document");
                    }
                    let mut response = request.call().unwrap();
                    assert_eq!(response.status(), if enabled { 403 } else { 200 });
                    if enabled {
                        assert_eq!(
                            response.body_mut().read_to_string().unwrap(),
                            "Origin does not match the routed host"
                        );
                    } else {
                        let observed: Value =
                            serde_json::from_str(&response.body_mut().read_to_string().unwrap())
                                .unwrap();
                        assert_eq!(
                            observed["host"],
                            if document {
                                local.as_str()
                            } else {
                                host.as_str()
                            }
                        );
                        assert_eq!(observed["origin"], origin);
                    }
                }
            }
            stop(&runtime, &project, &mut process);
            assert_eq!(
                control::client()
                    .get(format!("http://{local}/inspect"))
                    .call()
                    .unwrap()
                    .status(),
                200,
                "{name}: stopping the stack stopped the external backend"
            );
            if index == 3 && enabled {
                let mut process = launch(&runtime, &project, &[]);
                wait_until(|| {
                    read_live_stacks(&runtime.state().join("caddy"))
                        .unwrap()
                        .iter()
                        .any(|stack| stack.name == name && stack.control_port > 0)
                });
                ready(&control::origin(&runtime, &name));
                drop(backend);
                for document in [false, true] {
                    let mut request = control::client().get(&url).header("Host", &host);
                    if document {
                        request = request.header("Sec-Fetch-Dest", "document");
                    }
                    let mut response = request.call().unwrap();
                    assert_eq!(response.status(), if document { 503 } else { 502 });
                    if document {
                        assert_eq!(response.headers()["cache-control"], "no-store");
                        let page = response.body_mut().read_to_string().unwrap();
                        assert!(page.contains("Service unavailable"));
                        assert!(page.contains("/__devhost__/inject.js"));
                    }
                }
                stop(&runtime, &project, &mut process);
            }
        }
    }
}
