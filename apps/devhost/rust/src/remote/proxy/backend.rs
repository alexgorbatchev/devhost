use std::{
    future::Future,
    io,
    pin::Pin,
    sync::Arc,
    task::{Context, Poll},
    time::Duration,
};

use super::Backend;
use hyper_util::{client::legacy::connect::HttpConnector, rt::TokioIo};
use rustls::pki_types::{CertificateDer, ServerName, pem::PemObject};
use tower_service::Service;

// Hyper's standard TCP connector supplies dialing and keepalive. The TLS
// boundary is explicit because its deadline must exclude TCP connection time.
#[derive(Clone)]
pub(super) struct BackendConnector {
    http: HttpConnector,
    tls: Arc<rustls::ClientConfig>,
    hostname: ServerName<'static>,
}

pub(super) fn backend_connector(backend: &Backend, hostname: &str) -> io::Result<BackendConnector> {
    let mut roots = rustls::RootCertStore::empty();
    if backend.scheme == "https" {
        let pem = std::fs::read(&backend.root_certificate_path)?;
        for certificate in CertificateDer::pem_slice_iter(&pem) {
            roots
                .add(certificate.map_err(io::Error::other)?)
                .map_err(io::Error::other)?;
        }
        if roots.is_empty() {
            return Err(io::Error::other("Caddy root certificate is invalid"));
        }
    }
    let tls = rustls::ClientConfig::builder_with_provider(Arc::new(
        rustls::crypto::ring::default_provider(),
    ))
    .with_protocol_versions(&[&rustls::version::TLS13, &rustls::version::TLS12])
    .map_err(io::Error::other)?
    .with_root_certificates(roots)
    .with_no_client_auth();
    let mut http = HttpConnector::new();
    http.enforce_http(false);
    http.set_connect_timeout(Some(Duration::from_secs(10)));
    http.set_keepalive(Some(Duration::from_secs(30)));
    Ok(BackendConnector {
        http,
        tls: Arc::new(tls),
        hostname: ServerName::try_from(hostname.to_owned()).map_err(io::Error::other)?,
    })
}

impl Service<http::Uri> for BackendConnector {
    type Response = hyper_rustls::MaybeHttpsStream<TokioIo<tokio::net::TcpStream>>;
    type Error = io::Error;
    type Future = Pin<Box<dyn Future<Output = io::Result<Self::Response>> + Send>>;

    fn poll_ready(&mut self, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        self.http.poll_ready(cx).map_err(io::Error::other)
    }

    fn call(&mut self, uri: http::Uri) -> Self::Future {
        let https = uri.scheme_str() == Some("https");
        let tcp = self.http.call(uri);
        let tls = self.tls.clone();
        let hostname = self.hostname.clone();
        Box::pin(async move {
            let tcp = tcp.await.map_err(io::Error::other)?;
            if !https {
                return Ok(hyper_rustls::MaybeHttpsStream::Http(tcp));
            }
            let tls = tokio_rustls::TlsConnector::from(tls);
            let stream = tokio::time::timeout(
                Duration::from_secs(10),
                tls.connect(hostname, TokioIo::new(tcp)),
            )
            .await
            .map_err(|_| {
                io::Error::new(
                    io::ErrorKind::TimedOut,
                    "local preview TLS handshake timed out",
                )
            })??;
            Ok(hyper_rustls::MaybeHttpsStream::Https(TokioIo::new(stream)))
        })
    }
}
