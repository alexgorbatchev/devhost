use std::{
    convert::Infallible,
    path::PathBuf,
    pin::Pin,
    task::{Context, Poll},
    time::{Duration, Instant},
};

use super::{Backend, state};
use axum::body::Body;
use http::{Request, Response, StatusCode, header};
use hyper::{body::Incoming, upgrade::OnUpgrade};
use hyper_util::{client::legacy::Client, rt::TokioExecutor};
use tokio::sync::{mpsc, oneshot};

mod backend;
use backend::backend_connector;

pub(super) type Upgrade = (OnUpgrade, OnUpgrade);

pub(super) async fn serve(
    dir: PathBuf,
    mut request: Request<Incoming>,
    upgrades: mpsc::Sender<Upgrade>,
) -> Result<Response<Body>, Infallible> {
    let host_header = request.headers().get(header::HOST).cloned();
    let authority = host_header
        .as_ref()
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let host = match authority.rsplit_once(':') {
        Some((host, "443")) => host,
        Some(_) => return Ok(error(StatusCode::NOT_FOUND, "404 page not found\n")),
        None => authority.as_str(),
    };
    let host = host.to_owned();
    let lookup_host = host.clone();
    let backend = tokio::task::spawn_blocking(move || {
        state::with_lock(&dir, Instant::now() + state::STARTUP_TIMEOUT, || {
            Ok(state::read_leases(&dir)?
                .into_iter()
                .find(|lease| lease.hosts.contains(&lookup_host))
                .map(|lease| lease.backend))
        })
    })
    .await;
    let backend = match backend {
        Ok(Ok(Some(backend))) => backend,
        Ok(Ok(None)) => return Ok(error(StatusCode::NOT_FOUND, "404 page not found\n")),
        _ => {
            return Ok(error(
                StatusCode::SERVICE_UNAVAILABLE,
                "Remote preview route is unavailable.\n",
            ));
        }
    };
    // Decode before normalizing so encoded names enforce the same local-only
    // write boundary as ordinary config-editor requests.
    let clean = clean_request_path(request.uri().path());
    if format!("{clean}/").starts_with("/__devhost__/config/")
        && !matches!(
            *request.method(),
            http::Method::GET | http::Method::HEAD | http::Method::OPTIONS
        )
    {
        return Ok(error(
            StatusCode::FORBIDDEN,
            "Configuration editing is available on the local machine.\n",
        ));
    }
    let connector_backend = backend.clone();
    let connector_host = host.clone();
    let connector =
        tokio::task::spawn_blocking(move || backend_connector(&connector_backend, &connector_host))
            .await;
    let connector = match connector {
        Ok(Ok(connector)) => connector,
        _ => {
            return Ok(error(
                StatusCode::BAD_GATEWAY,
                "The local preview certificate is unavailable.\n",
            ));
        }
    };
    let path = request
        .uri()
        .path_and_query()
        .map_or("/", |path| path.as_str());
    let uri = format!("{}://{}{path}", backend.scheme, backend.address).parse();
    let Ok(uri) = uri else {
        return Ok(error(
            StatusCode::BAD_GATEWAY,
            "The local preview is unavailable.\n",
        ));
    };
    let upgrade = request.headers().get(header::UPGRADE).cloned();
    let incoming_upgrade = upgrade.as_ref().map(|_| hyper::upgrade::on(&mut request));
    *request.uri_mut() = uri;
    remove_hop_headers(request.headers_mut(), upgrade.is_some());
    request.headers_mut().insert(
        "X-Forwarded-Proto",
        header::HeaderValue::from_static("https"),
    );
    if let Some(host_header) = host_header {
        request
            .headers_mut()
            .insert("X-Forwarded-Host", host_header);
    }
    let client = Client::builder(TokioExecutor::new())
        .pool_max_idle_per_host(0)
        .build::<_, Body>(connector);
    let (completed, uploaded) = oneshot::channel();
    let response = client.request(request.map(|body| {
        let mut body = Upload {
            body,
            completed: Some(completed),
        };
        body.notify_end();
        Body::new(body)
    }));
    tokio::pin!(response);
    // The response-header limit starts after the producer has finished, so
    // streaming uploads keep independent upload and response lifetimes.
    let response = tokio::select! {
        biased;
        response = &mut response => Ok(response),
        _ = uploaded => tokio::time::timeout(Duration::from_secs(30), &mut response).await,
    };
    let mut response = match response {
        Ok(Ok(response)) => response,
        _ => {
            return Ok(error(
                StatusCode::BAD_GATEWAY,
                "The local preview is unavailable.\n",
            ));
        }
    };
    if response.status() == StatusCode::SWITCHING_PROTOCOLS {
        if !upgrade.as_ref().is_some_and(|requested| {
            response
                .headers()
                .get(header::UPGRADE)
                .is_some_and(|returned| {
                    requested
                        .as_bytes()
                        .eq_ignore_ascii_case(returned.as_bytes())
                })
        }) {
            return Ok(error(
                StatusCode::BAD_GATEWAY,
                "The local preview is unavailable.\n",
            ));
        }
        if let Some(incoming) = incoming_upgrade {
            if upgrades
                .try_send((incoming, hyper::upgrade::on(&mut response)))
                .is_err()
            {
                return Ok(error(
                    StatusCode::SERVICE_UNAVAILABLE,
                    "Remote preview route is unavailable.\n",
                ));
            }
        } else {
            return Ok(error(
                StatusCode::BAD_GATEWAY,
                "The local preview is unavailable.\n",
            ));
        }
    } else {
        remove_hop_headers(response.headers_mut(), false);
    }
    Ok(response.map(Body::new))
}

fn error(status: StatusCode, message: &'static str) -> Response<Body> {
    let mut response = Response::new(Body::from(message));
    *response.status_mut() = status;
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        header::HeaderValue::from_static("text/plain; charset=utf-8"),
    );
    response.headers_mut().insert(
        "X-Content-Type-Options",
        header::HeaderValue::from_static("nosniff"),
    );
    response
}

fn remove_hop_headers(headers: &mut header::HeaderMap, upgrading: bool) {
    let names = headers
        .get_all(header::CONNECTION)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(','))
        .map(|name| name.trim().to_owned())
        .collect::<Vec<_>>();
    for name in names {
        if !upgrading || !name.eq_ignore_ascii_case("upgrade") {
            headers.remove(name);
        }
    }
    for name in [
        "Connection",
        "Proxy-Connection",
        "Keep-Alive",
        "Proxy-Authenticate",
        "Proxy-Authorization",
        "TE",
        "Trailer",
        "Transfer-Encoding",
        "Upgrade",
    ] {
        if upgrading && matches!(name, "Connection" | "Upgrade") {
            continue;
        }
        headers.remove(name);
    }
}

fn clean_request_path(path: &str) -> String {
    let decoded = percent_encoding::percent_decode_str(path).decode_utf8_lossy();
    let mut parts = Vec::new();
    for part in decoded.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            _ => parts.push(part),
        }
    }
    format!("/{}", parts.join("/"))
}

struct Upload {
    body: Incoming,
    completed: Option<oneshot::Sender<()>>,
}

impl Upload {
    fn notify_end(&mut self) {
        use http_body::Body;
        if self.body.is_end_stream()
            && let Some(completed) = self.completed.take()
        {
            let _ = completed.send(());
        }
    }
}

impl http_body::Body for Upload {
    type Data = hyper::body::Bytes;
    type Error = hyper::Error;

    fn poll_frame(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<Option<Result<http_body::Frame<Self::Data>, Self::Error>>> {
        let frame = Pin::new(&mut self.body).poll_frame(cx);
        self.notify_end();
        frame
    }

    fn is_end_stream(&self) -> bool {
        self.body.is_end_stream()
    }
    fn size_hint(&self) -> http_body::SizeHint {
        self.body.size_hint()
    }
}
