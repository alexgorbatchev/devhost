use std::{
    collections::BTreeMap,
    fs,
    net::TcpListener,
    os::unix::fs::DirBuilderExt,
    path::{Path, PathBuf},
    sync::{
        Arc, Condvar, Mutex,
        mpsc::{self, Receiver},
    },
    thread::{self, JoinHandle},
};

use axum::{
    Router,
    http::{HeaderMap, Method, Uri},
    routing::any,
};
use tokio::sync::oneshot;

use super::{
    resolve::{HealthKind, ResolvedHealthConfig, ResolvedManifest, ResolvedService},
    stack::{StartStackError, StartStackOptions, start_stack},
};
use crate::{
    files::FileHandler,
    manifest::{DevtoolsConfig, ServiceLifecycleConfig, WorktreesConfig, is_valid_host},
    paths,
};

pub struct FileServer {
    port: u16,
    shutdown: Option<oneshot::Sender<()>>,
    thread: Option<JoinHandle<()>>,
    errors: Option<Receiver<String>>,
    pub(crate) exit_state: Arc<(Mutex<Option<i32>>, Condvar)>,
    pub(crate) exited_at: Arc<Mutex<String>>,
}

impl FileServer {
    pub fn start(directory: &Path, address: &str) -> Result<Self, String> {
        let handler = FileHandler::open(directory)?;
        let listener =
            TcpListener::bind(address).map_err(|error| format!("start file listener: {error}"))?;
        listener
            .set_nonblocking(true)
            .map_err(|error| format!("start file listener: {error}"))?;
        let shutdown_listener = listener
            .try_clone()
            .map_err(|error| format!("duplicate file listener for shutdown: {error}"))?;
        let port = listener
            .local_addr()
            .map_err(|error| format!("start file listener: {error}"))?
            .port();
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
            .map_err(|error| format!("start file server runtime: {error}"))?;
        let (shutdown, shutdown_rx) = oneshot::channel();
        let (errors_tx, errors) = mpsc::channel();
        let exit_state = Arc::new((Mutex::new(None), Condvar::new()));
        let finished = exit_state.clone();
        let exited_at = Arc::new(Mutex::new(String::new()));
        let finished_at = exited_at.clone();
        let thread = thread::spawn(move || {
            let result = runtime.block_on(async move {
                let listener = tokio::net::TcpListener::from_std(listener)?;
                let app = Router::new().fallback(any(
                    move |method: Method, uri: Uri, headers: HeaderMap| {
                        let handler = handler.clone();
                        async move {
                            tokio::task::block_in_place(|| {
                                handler.serve_with_headers(&method, &uri, &headers, "")
                            })
                        }
                    },
                ));
                let result = tokio::select! {
                    result = axum::serve(listener, app) => result,
                    _ = shutdown_rx => Ok(()),
                };
                crate::sockets::shutdown_listener(&shutdown_listener);
                result
            });
            // Dropping the runtime closes accepted connections too. Waiting for
            // graceful HTTP shutdown would let an idle client hold the session.
            drop(runtime);
            let code = if let Err(error) = result {
                let _ = errors_tx.send(format!("serve directory: {error}"));
                1
            } else {
                0
            };
            *finished_at.lock().expect("file server exit timestamp") = super::stack::live::now();
            *finished.0.lock().expect("file server exit state") = Some(code);
            finished.1.notify_all();
        });
        Ok(Self {
            port,
            shutdown: Some(shutdown),
            thread: Some(thread),
            errors: Some(errors),
            exit_state,
            exited_at,
        })
    }

    pub fn port(&self) -> u16 {
        self.port
    }
    pub fn stop(&mut self) {
        if let Some(shutdown) = self.shutdown.take() {
            let _ = shutdown.send(());
        }
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

impl Drop for FileServer {
    fn drop(&mut self) {
        self.stop();
    }
}

pub fn start_serve(
    directory: &Path,
    domain: &str,
    port: Option<u16>,
    mut options: StartStackOptions,
) -> Result<i32, StartStackError> {
    if !is_valid_host(domain) {
        return Err(
            format!("invalid domain {domain:?}; use a hostname such as notes.localhost").into(),
        );
    }
    let directory = if directory.is_absolute() {
        paths::clean(directory)
    } else {
        paths::clean(
            &std::env::current_dir()
                .map_err(|error| format!("resolve served directory: {error}"))?
                .join(directory),
        )
    };
    let state_dir = options
        .caddy_dir
        .parent()
        .ok_or_else(|| "serve session state directory is required".to_owned())?;
    fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(state_dir)
        .map_err(|error| format!("create serve session state directory: {error}"))?;
    let mut file_server = match port {
        Some(_) => None,
        None => Some(FileServer::start(&directory, "127.0.0.1:0")?),
    };
    let port = port.unwrap_or_else(|| file_server.as_ref().expect("directory server").port());
    if let Some(server) = &mut file_server {
        options.runtime_errors = server.errors.take();
    }
    options.serve_session = true;
    let mut manifest = serve_manifest(directory, domain, port);
    start_stack(&mut manifest, &["serve".to_owned()], options)
}

fn serve_manifest(directory: PathBuf, domain: &str, port: u16) -> ResolvedManifest {
    let service = ResolvedService {
        proxy_local_origin: false,
        bind_host: "127.0.0.1".to_owned(),
        command: Vec::new(),
        serve: String::new(),
        cwd: directory.clone(),
        depends_on: Vec::new(),
        env: BTreeMap::new(),
        health: ResolvedHealthConfig {
            fixed_tcp_port: false,
            host: Some("127.0.0.1".to_owned()),
            interval_ms: 200,
            kind: HealthKind::Tcp,
            port: Some(port),
            retries: 0,
            timeout_ms: 30_000,
            url: None,
        },
        hosts: vec![domain.to_owned()],
        inject_port: false,
        lifecycle: ServiceLifecycleConfig::default(),
        managed: false,
        name: "serve".to_owned(),
        path: Some("/".to_owned()),
        port: Some(port),
        port_source: String::new(),
        watch: Vec::new(),
    };
    ResolvedManifest {
        remote: None,
        configuration: None,
        requested: Vec::new(),
        caddy: crate::config::CaddySettings::default(),
        domain_suffix: String::new(),
        devtools: DevtoolsConfig::default(),
        worktrees: WorktreesConfig::default(),
        manifest_directory: directory,
        manifest_path: PathBuf::new(),
        name: format!("serve-{domain}"),
        primary_service: "serve".to_owned(),
        service_order: vec!["serve".to_owned()],
        services: BTreeMap::from([("serve".to_owned(), service)]),
        stopped: BTreeMap::new(),
        kill_zombies: false,
    }
}
