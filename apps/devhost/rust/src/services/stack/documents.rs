use super::*;
use crate::devtools::document_injection::{DocumentInjectionOptions, DocumentInjectionServer};
use crate::services::control::RuntimeHandle;

/// Document listeners survive backend replacement and read current runtime state.
pub(super) struct Documents {
    servers: BTreeMap<String, DocumentInjectionServer>,
    handle: RuntimeHandle,
}

impl Documents {
    pub fn new(handle: RuntimeHandle) -> Self {
        Self {
            servers: BTreeMap::new(),
            handle,
        }
    }

    pub fn routes(
        &mut self,
        manifest: &ResolvedManifest,
    ) -> Result<Vec<ActivateRouteOptions>, String> {
        let mut routes = collect_manifest_routes(manifest);
        for route in &mut routes {
            let name = route.service_name.clone();
            let host = resolve_proxy_host(&route.app_bind_host)?;
            if !self.servers.contains_key(&name) {
                let inject = self.handle.live.clone();
                let recovery = self.handle.live.clone();
                let restart = self.handle.clone();
                let worktrees = self.handle.clone();
                let inject_name = name.clone();
                let recovery_name = name.clone();
                let restart_name = name.clone();
                let server = DocumentInjectionServer::start(DocumentInjectionOptions {
                    backend_host: host.to_owned(),
                    backend_port: route.app_port,
                    should_inject: Some(Arc::new(move || {
                        inject.manifest().is_some_and(|manifest| {
                            crate::devtools::configuration::injects(&manifest, &inject_name)
                        })
                    })),
                    get_recovery: Some(Arc::new(move || recovery.recovery(&recovery_name))),
                    restart: Some(Arc::new(move || {
                        let result = restart.restart_services(vec![restart_name.clone()])?;
                        loop {
                            match result.recv_timeout(Duration::from_millis(100)) {
                                Ok(result) => return result,
                                Err(std::sync::mpsc::RecvTimeoutError::Timeout)
                                    if !*restart.live.events.stopping.borrow() => {}
                                Err(_) => return Err("devhost is shutting down".to_owned()),
                            }
                        }
                    })),
                    worktrees: Some(Arc::new(move |request| {
                        crate::devtools::server::recovery_worktrees(worktrees.clone(), request)
                    })),
                })?;
                self.servers.insert(name.clone(), server);
            }
            let server = self.servers.get(&name).expect("document listener");
            server.set_backend(host, route.app_port);
            route.document_injection_port = Some(server.port());
            if crate::devtools::configuration::injects(manifest, &name) {
                route.devtools_control_port = Some(self.handle.live.control_port());
            }
        }
        Ok(routes)
    }

    pub fn prune(&mut self, manifest: &ResolvedManifest) {
        self.servers.retain(|name, _| {
            manifest
                .services
                .get(name)
                .is_some_and(|service| !service.hosts.is_empty() && service.port.is_some())
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::{
        control::{RuntimeControl, RuntimeRequest, WorktreeOperation},
        resolve::{PortResolutionOptions, resolve_service_ports},
        serve::FileServer,
    };
    use serde_json::Value;

    fn request(port: u16, method: &str, action: &str) -> (u16, String) {
        let agent: ureq::Agent = ureq::Agent::config_builder()
            .proxy(None)
            .http_status_as_error(false)
            .timeout_global(Some(Duration::from_secs(3)))
            .build()
            .into();
        let mut request = http::Request::builder()
            .method(method)
            .uri(format!("http://127.0.0.1:{port}/"));
        if !action.is_empty() {
            request = request.header(crate::devtools::RECOVERY_HEADER, action);
        }
        let mut response = agent.run(request.body("").unwrap()).unwrap();
        (
            response.status().as_u16(),
            response.body_mut().read_to_string().unwrap(),
        )
    }

    #[test]
    fn document_listeners_follow_live_recovery_and_serialize_runtime_actions() {
        let root = tempfile::tempdir().unwrap();
        fs::write(
            root.path().join("index.html"),
            "<html><body>backend ready</body></html>",
        )
        .unwrap();
        fs::write(
            root.path().join("devhost.toml"),
            "name='documents'\n[services.web]\ncommand=['sleep','30']\nhealth.process=true\n",
        )
        .unwrap();
        let config = crate::manifest::read_manifest(root.path(), None).unwrap();
        let mut manifest =
            resolve_service_ports(&config, &PortResolutionOptions::default()).unwrap();
        let mut backend = FileServer::start(root.path(), "127.0.0.1:0").unwrap();
        let web = manifest.services.get_mut("web").unwrap();
        web.hosts = vec!["documents.test".to_owned()];
        web.command.clear();
        web.managed = false;
        web.port = Some(backend.port());
        web.health.kind = HealthKind::Tcp;
        web.health.port = Some(backend.port());
        web.health.host = Some("127.0.0.1".to_owned());
        let (handle, control) = RuntimeControl::channel();
        handle.live.initialize(&manifest);
        handle.live.ready("web");
        handle.live.finish_startup();
        let mut documents = Documents::new(handle.clone());
        let routes = documents.routes(&manifest).unwrap();
        let port = routes[0].document_injection_port.unwrap();
        assert_eq!(routes[0].devtools_control_port, Some(0));
        let (status, body) = request(port, "GET", "");
        assert_eq!(status, 200);
        assert!(body.contains("backend ready"));
        assert!(body.contains(crate::devtools::INJECTED_SCRIPT_PATH));
        let (_, body) = request(port, "GET", "status");
        assert_eq!(
            serde_json::from_str::<Value>(&body).unwrap()["phase"],
            "ready"
        );
        let web = manifest.services.get_mut("web").unwrap();
        web.command = vec!["sleep".to_owned(), "30".to_owned()];
        web.managed = true;
        handle.live.update_manifest(&manifest);
        handle.live.failed("web", "backend failed");
        let (status, body) = request(port, "GET", "");
        assert_eq!(status, 503);
        assert!(body.contains("backend failed"));
        let restart = thread::spawn(move || request(port, "POST", "restart"));
        let RuntimeRequest::Restart { names, result } = control
            .requests
            .recv_timeout(Duration::from_secs(2))
            .unwrap()
        else {
            panic!("expected restart request");
        };
        assert_eq!(names, ["web"]);
        result.send(Ok(())).unwrap();
        assert_eq!(restart.join().unwrap().0, 204);
        let worktrees = thread::spawn(move || request(port, "GET", "worktrees"));
        let RuntimeRequest::Worktrees { operation, result } = control
            .requests
            .recv_timeout(Duration::from_secs(2))
            .unwrap()
        else {
            panic!("expected worktree refresh");
        };
        assert!(matches!(operation, WorktreeOperation::Refresh));
        result.send(Ok(Vec::new())).unwrap();
        let (status, body) = worktrees.join().unwrap();
        assert_eq!(status, 200);
        assert_eq!(
            serde_json::from_str::<Value>(&body).unwrap()["repositories"],
            serde_json::json!([])
        );
        // A route refresh retains the document listener while replacing its backend.
        let replacement = FileServer::start(root.path(), "127.0.0.1:0").unwrap();
        manifest.services.get_mut("web").unwrap().port = Some(replacement.port());
        assert_eq!(
            documents.routes(&manifest).unwrap()[0].document_injection_port,
            Some(port)
        );
        let mut connection = std::net::TcpStream::connect(("127.0.0.1", port)).unwrap();
        connection
            .set_read_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        manifest.services.clear();
        documents.prune(&manifest);
        assert!(documents.servers.is_empty());
        // Observe this listener's connection, since another test can reuse its port.
        let mut byte = [0];
        match std::io::Read::read(&mut connection, &mut byte) {
            Ok(0) => {}
            Err(error)
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::ConnectionReset | std::io::ErrorKind::ConnectionAborted
                ) => {}
            result => panic!("document listener left its connection open: {result:?}"),
        }
        backend.stop();
    }
}
