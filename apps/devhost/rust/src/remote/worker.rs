use std::{
    convert::Infallible,
    io,
    path::{Path, PathBuf},
    time::{Duration, Instant},
};

use super::{
    Settings, proxy,
    settings::read_credentials,
    state::{self, Owner, STARTUP_TIMEOUT, WorkerRecord},
    transport::Connector,
};
use axum::body::Body;
use http::{Request, Response, StatusCode};
use hyper::{body::Incoming, server::conn::http1, service::service_fn};
use hyper_util::rt::{TokioIo, TokioTimer};
use tokio::{
    net::TcpListener,
    sync::{mpsc, oneshot, watch},
    task::JoinSet,
};

/// Serves the machine-wide connector; stack leases determine its lifetime.
pub async fn run(state_directory: &Path) -> io::Result<()> {
    let dir = state_directory.join("remote");
    let lock = state::private_file(&dir.join("worker.lock"))?;
    lock.try_lock().map_err(|e| {
        io::Error::other(format!("another remote connector owns this machine: {e}"))
    })?;
    let owner = Owner::current()?;
    let result = serve(dir.clone(), owner.clone()).await;
    let cleanup = tokio::task::spawn_blocking(move || {
        state::with_lock(&dir, Instant::now() + Duration::from_secs(5), || {
            if state::read_worker(&dir)?.owner == owner {
                state::remove_file(&dir.join("worker.json"))?;
            }
            Ok(())
        })
    })
    .await
    .map_err(io::Error::other)?;
    match (result, cleanup) {
        (Err(error), Err(cleanup)) => Err(io::Error::other(format!("{error}\ncleanup: {cleanup}"))),
        (result, Ok(())) => result,
        (Ok(()), Err(error)) => Err(error),
    }
}

async fn serve(dir: PathBuf, owner: Owner) -> io::Result<()> {
    let settings_dir = dir.clone();
    let (settings, credentials) = tokio::task::spawn_blocking(move || {
        let settings = state::read_json::<Settings>(&settings_dir.join("settings.json"))?;
        let credentials = read_credentials(&settings.credential_file)?;
        Ok::<_, io::Error>((settings, credentials))
    })
    .await
    .map_err(io::Error::other)??;
    let proxy_listener = TcpListener::bind("127.0.0.1:0").await?;
    let admin = TcpListener::bind("127.0.0.1:0").await?;
    let address = admin.local_addr()?.to_string();
    let destination = proxy_listener.local_addr()?;
    let record = WorkerRecord {
        owner,
        admin_address: address.clone(),
        stopping: false,
    };
    let (ready_tx, ready) = watch::channel(false);
    let (stop_tx, stop) = watch::channel(false);
    let connector = reconnect(settings, credentials, destination, ready_tx, stop);
    tokio::pin!(connector);
    let mut connector_finished = false;
    let mut connections = JoinSet::new();
    let mut admin_connections = JoinSet::new();
    let (upgrade_tx, mut upgrades) = mpsc::channel::<proxy::Upgrade>(128);
    let mut ticker = tokio::time::interval(Duration::from_millis(250));
    let publish_dir = dir.clone();
    let publish_record = record.clone();
    tokio::task::spawn_blocking(move || {
        state::with_lock(&publish_dir, Instant::now() + STARTUP_TIMEOUT, || {
            state::write_json(&publish_dir.join("worker.json"), &publish_record)
        })
    })
    .await
    .map_err(io::Error::other)??;
    let signal = termination();
    tokio::pin!(signal);
    let result = loop {
        tokio::select! {
            _ = &mut signal => break Ok(()),
            result = &mut connector => {connector_finished = true; break result;},
            accepted = proxy_listener.accept(), if connections.len() < 128 => match accepted {
                Ok((socket, _)) => {
                    let dir = dir.clone();
                    let upgrades = upgrade_tx.clone();
                    connections.spawn(async move {
                        let service = service_fn(move |request| proxy::serve(dir.clone(), request, upgrades.clone()));
                        let _ = http1::Builder::new().timer(TokioTimer::new()).header_read_timeout(Duration::from_secs(10)).serve_connection(TokioIo::new(socket), service).with_upgrades().await;
                    });
                },
                Err(error) => break Err(error),
            },
            accepted = admin.accept(), if admin_connections.len() < 32 => match accepted {
                Ok((socket, _)) => {
                    let ready = ready.clone();
                    let address = address.clone();
                    admin_connections.spawn(async move {
                        let service = service_fn(move |request| readiness(request, address.clone(), ready.clone()));
                        let _ = http1::Builder::new().timer(TokioTimer::new()).header_read_timeout(Duration::from_secs(5)).serve_connection(TokioIo::new(socket), service).await;
                    });
                },
                Err(error) => break Err(error),
            },
            Some((incoming, outgoing)) = upgrades.recv() => {
                connections.spawn(async move {
                    if let Ok((incoming, outgoing)) = tokio::try_join!(incoming, outgoing) {
                        let _ = tokio::io::copy_bidirectional(&mut TokioIo::new(incoming), &mut TokioIo::new(outgoing)).await;
                    }
                });
            },
            Some(_) = connections.join_next(), if !connections.is_empty() => {},
            Some(_) = admin_connections.join_next(), if !admin_connections.is_empty() => {},
            _ = ticker.tick() => {
                let dir = dir.clone();
                let next = record.clone();
                match tokio::task::spawn_blocking(move || state::with_lock(&dir, Instant::now() + Duration::from_secs(5), || {
                    let stop = state::read_leases(&dir)?.is_empty();
                    if stop {state::write_json(&dir.join("worker.json"), &WorkerRecord {stopping: true, ..next})?;}
                    Ok(stop)
                })).await {
                    Ok(Ok(true)) => break Ok(()),
                    Ok(Ok(false)) => {},
                    Ok(Err(error)) => break Err(error),
                    Err(error) => break Err(io::Error::other(error)),
                }
            }
        }
    };
    let _ = stop_tx.send(true);
    // Join the SSH channels before retiring HTTP and hijacked WebSocket handlers.
    if !connector_finished {
        let _ = connector.await;
    }
    connections.shutdown().await;
    admin_connections.shutdown().await;
    result
}

async fn reconnect(
    settings: Settings,
    credentials: String,
    destination: std::net::SocketAddr,
    ready: watch::Sender<bool>,
    mut stop: watch::Receiver<bool>,
) -> io::Result<()> {
    let mut delay = Duration::from_millis(100);
    loop {
        let connected = tokio::select! {
            _ = stop.changed() => return Ok(()),
            result = Connector::connect(&settings.server_url, &settings.fingerprint, &credentials, settings.remote_port, destination) => result,
        };
        match connected {
            Ok(connector) => {
                delay = Duration::from_millis(100);
                let _ = ready.send(true);
                let (shutdown, done) = oneshot::channel();
                let session = connector.run(done);
                tokio::pin!(session);
                tokio::select! {
                    _ = stop.changed() => {let _ = shutdown.send(()); let _ = session.await; return Ok(());},
                    result = &mut session => if let Err(error) = result {eprintln!("remote connector disconnected: {error}");},
                }
            }
            Err(error) => eprintln!("remote connector connection failed: {error}"),
        }
        let _ = ready.send(false);
        tokio::select! {
            _ = stop.changed() => return Ok(()),
            _ = tokio::time::sleep(delay) => {},
        }
        delay = (delay * 2).min(Duration::from_secs(10));
    }
}

async fn readiness(
    request: Request<Incoming>,
    address: String,
    mut ready: watch::Receiver<bool>,
) -> Result<Response<Body>, Infallible> {
    if request.method() != http::Method::GET
        || request.uri().path() != "/ready"
        || request
            .headers()
            .get("Host")
            .is_none_or(|host| host != address.as_str())
    {
        let mut response = Response::new(Body::from("404 page not found\n"));
        *response.status_mut() = StatusCode::NOT_FOUND;
        return Ok(response);
    }
    let wait = async {
        loop {
            if *ready.borrow_and_update() {
                return true;
            }
            if ready.changed().await.is_err() {
                return false;
            }
        }
    };
    if tokio::time::timeout(STARTUP_TIMEOUT, wait).await == Ok(true) {
        return Ok(Response::new(Body::empty()));
    }
    let mut response = Response::new(Body::from(
        "relay authentication or connection did not become ready; inspect connector.log\n",
    ));
    *response.status_mut() = StatusCode::SERVICE_UNAVAILABLE;
    Ok(response)
}

async fn termination() {
    #[cfg(unix)]
    {
        if let Ok(mut signal) =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        {
            tokio::select! {_ = signal.recv() => {}, _ = tokio::signal::ctrl_c() => {}}
            return;
        }
    }
    let _ = tokio::signal::ctrl_c().await;
}
