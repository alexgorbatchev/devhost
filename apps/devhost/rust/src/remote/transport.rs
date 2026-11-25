use std::{future::Future, io, net::SocketAddr, pin::Pin, time::Duration};

use async_tungstenite::{
    bytes::{ByteReader, ByteWriter},
    tungstenite::client::IntoClientRequest,
};
use base64::{Engine, engine::general_purpose::STANDARD};
use futures_util::StreamExt;
use makiko::{Client, ClientEvent, ClientReceiver, GlobalReply, GlobalReq};
use serde_json::json;
use sha2::{Digest, Sha256};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpStream,
    sync::oneshot,
    task::JoinSet,
    time,
};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(45);
const KEEPALIVE: Duration = Duration::from_secs(25);

pub struct Connector {
    client: Client,
    events: ClientReceiver,
    driver: Pin<Box<dyn Future<Output = makiko::Result<()>> + Send>>,
    destination: SocketAddr,
    fingerprint: String,
}

impl Connector {
    pub async fn connect(
        server_url: &str,
        fingerprint: &str,
        credentials: &str,
        remote_port: u16,
        destination: SocketAddr,
    ) -> io::Result<Self> {
        time::timeout(
            CONNECT_TIMEOUT,
            Self::handshake(
                server_url,
                fingerprint,
                credentials,
                remote_port,
                destination,
            ),
        )
        .await
        .map_err(|_| io::Error::new(io::ErrorKind::TimedOut, "remote connector timed out"))?
    }

    async fn handshake(
        server_url: &str,
        fingerprint: &str,
        credentials: &str,
        remote_port: u16,
        destination: SocketAddr,
    ) -> io::Result<Self> {
        let (username, password) = credentials
            .split_once(':')
            .filter(|(user, password)| !user.is_empty() && !password.is_empty())
            .ok_or_else(|| {
                io::Error::new(io::ErrorKind::InvalidInput, "invalid remote credentials")
            })?;
        let mut url = url::Url::parse(server_url).map_err(io::Error::other)?;
        let scheme = match url.scheme() {
            "http" | "ws" => "ws",
            "https" | "wss" => "wss",
            _ => {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "invalid remote server URL",
                ));
            }
        };
        url.set_scheme(scheme)
            .map_err(|()| io::Error::other("invalid remote server URL"))?;
        let mut request = url
            .as_str()
            .into_client_request()
            .map_err(io::Error::other)?;
        request.headers_mut().insert(
            "Sec-WebSocket-Protocol",
            http::HeaderValue::from_static("chisel-v3"),
        );
        // Chisel requires the protocol in the request but does not echo it. Hyper
        // performs the upgrade; validate the response before using the raw socket.
        let accept = async_tungstenite::tungstenite::handshake::derive_accept_key(
            request.headers()["Sec-WebSocket-Key"].as_bytes(),
        );
        let http_scheme = if scheme == "wss" { "https" } else { "http" };
        url.set_scheme(http_scheme)
            .map_err(|()| io::Error::other("invalid remote server URL"))?;
        *request.uri_mut() = url.as_str().parse().map_err(io::Error::other)?;
        let tls = hyper_rustls::HttpsConnectorBuilder::new()
            .with_native_roots()?
            .https_or_http()
            .enable_http1()
            .build();
        let http =
            hyper_util::client::legacy::Client::builder(hyper_util::rt::TokioExecutor::new())
                .build::<_, http_body_util::Empty<hyper::body::Bytes>>(tls);
        let mut response = http
            .request(request.map(|_| http_body_util::Empty::new()))
            .await
            .map_err(io::Error::other)?;
        let header_has = |name: &str, token: &str| {
            response
                .headers()
                .get(name)
                .and_then(|value| value.to_str().ok())
                .is_some_and(|value| {
                    value
                        .split(',')
                        .any(|part| part.trim().eq_ignore_ascii_case(token))
                })
        };
        if response.status() != http::StatusCode::SWITCHING_PROTOCOLS
            || !header_has("Upgrade", "websocket")
            || !header_has("Connection", "upgrade")
            || response
                .headers()
                .get("Sec-WebSocket-Accept")
                .is_none_or(|value| value != accept.as_str())
            || response
                .headers()
                .get("Sec-WebSocket-Protocol")
                .is_some_and(|value| value != "chisel-v3")
            || response.headers().contains_key("Sec-WebSocket-Extensions")
        {
            return Err(io::Error::other("invalid remote WebSocket handshake"));
        }
        let upgraded = hyper::upgrade::on(&mut response)
            .await
            .map_err(io::Error::other)?;
        let websocket = async_tungstenite::WebSocketStream::from_raw_socket(
            async_tungstenite::tokio::TokioAdapter::new(hyper_util::rt::TokioIo::new(upgraded)),
            async_tungstenite::tungstenite::protocol::Role::Client,
            Some(
                async_tungstenite::tungstenite::protocol::WebSocketConfig::default()
                    .write_buffer_size(0),
            ),
        )
        .await;
        let (writer, reader) = websocket.split();
        let reader = reader.filter_map(|message| async {
            use async_tungstenite::tungstenite::{Error, Message};
            match message {
                Ok(message @ Message::Binary(_)) => Some(Ok(message)),
                Ok(Message::Text(_)) => Some(Err(Error::Io(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "text frame in remote transport",
                )))),
                Ok(_) => None,
                Err(error) => Some(Err(error)),
            }
        });
        let stream = tokio::io::join(ByteReader::new(Box::pin(reader)), ByteWriter::new(writer));
        // AES-GCM avoids vulnerable cipher/MAC combinations on peers without
        // the strict key-exchange extension.
        let config = makiko::ClientConfig::default().with(|config| {
            config.cipher_algos = vec![&makiko::cipher::AES256_GCM, &makiko::cipher::AES128_GCM];
            // Chisel generates a P-256 host key, which is not in Makiko's
            // default host-key algorithm list. The configured pin authenticates it.
            config
                .server_pubkey_algos
                .push(&makiko::pubkey::ECDSA_SHA2_NISTP256);
        });
        let (client, events, driver) = Client::open(stream, config).map_err(io::Error::other)?;
        let mut connector = Self {
            client,
            events,
            driver: Box::pin(driver),
            destination,
            fingerprint: fingerprint.to_owned(),
        };
        let client = connector.client.clone();
        let auth = connector
            .wait(client.auth_password(username.to_owned(), password.to_owned()))
            .await?;
        if !matches!(auth, makiko::AuthPasswordResult::Success) {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "remote authentication failed",
            ));
        }
        let config = json!({"Version":"1.12.0", "Remotes":[{
            "LocalHost":"0.0.0.0", "LocalPort":remote_port.to_string(), "LocalProto":"tcp",
            "RemoteHost":destination.ip().to_string(), "RemotePort":destination.port().to_string(),
            "RemoteProto":"tcp", "Reverse":true, "Socks":false, "Stdio":false
        }]});
        let reply = send_request(&client, "config", serde_json::to_vec(&config)?.into())?;
        match connector
            .wait(async { reply.await.map_err(|_| makiko::Error::ClientClosed) })
            .await?
        {
            GlobalReply::Success(_) => Ok(connector),
            GlobalReply::Failure => Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "remote enrollment rejected",
            )),
        }
    }

    async fn wait<T>(&mut self, future: impl Future<Output = makiko::Result<T>>) -> io::Result<T> {
        tokio::pin!(future);
        loop {
            tokio::select! {
                result = &mut future => return result.map_err(io::Error::other),
                result = &mut self.driver => return Err(match result {
                    Ok(()) => io::Error::new(io::ErrorKind::UnexpectedEof, "remote connection closed"),
                    Err(error) => io::Error::other(error),
                }),
                event = self.events.recv() => self.verify(event.map_err(io::Error::other)?.ok_or_else(|| io::Error::other("remote connection closed"))?)?,
            }
        }
    }

    fn verify(&self, event: ClientEvent) -> io::Result<()> {
        match event {
            ClientEvent::ServerPubkey(key, accept) => {
                if STANDARD.encode(Sha256::digest(key.encode())) != self.fingerprint {
                    return Err(io::Error::new(
                        io::ErrorKind::PermissionDenied,
                        "remote fingerprint mismatch",
                    ));
                }
                accept.accept();
            }
            ClientEvent::ServerRequest(request) => {
                if let Some(reply) = request.reply_tx {
                    let response = if request.request_type == "ping" {
                        GlobalReply::Success(makiko::bytes::Bytes::from_static(b"pong"))
                    } else {
                        GlobalReply::Failure
                    };
                    let _ = reply.send(response);
                }
            }
            _ => {}
        }
        Ok(())
    }

    pub async fn run(mut self, mut stop: oneshot::Receiver<()>) -> io::Result<()> {
        let mut connections = JoinSet::new();
        let mut keepalive = time::interval_at(time::Instant::now() + KEEPALIVE, KEEPALIVE);
        let mut ping = None;
        let result = loop {
            tokio::select! {
                _ = &mut stop => break Ok(()),
                result = &mut self.driver => break result.map_err(io::Error::other),
                event = self.events.recv() => match event {
                    Ok(Some(ClientEvent::Channel(channel))) if channel.channel_type == "chisel" && connections.len() < 128 => {
                        let destination = self.destination;
                        connections.spawn(forward(channel, destination));
                    }
                    Ok(Some(event)) => if let Err(error) = self.verify(event) { break Err(error); },
                    Ok(None) => break Err(io::Error::other("remote connection closed")),
                    Err(error) => break Err(io::Error::other(error)),
                },
                _ = keepalive.tick() => {
                    if let Some(receiver) = ping.as_mut() {
                        match oneshot::Receiver::<GlobalReply>::try_recv(receiver) {
                            Ok(GlobalReply::Success(reply)) if reply.as_ref() == b"pong" => {},
                            _ => break Err(io::Error::other("remote keepalive failed")),
                        }
                    }
                    match send_request(&self.client, "ping", makiko::bytes::Bytes::new()) {
                        Ok(receiver) => ping = Some(receiver),
                        Err(error) => break Err(error),
                    }
                }
                Some(_) = connections.join_next(), if !connections.is_empty() => {}
            }
        };
        let _ = self.client.disconnect(makiko::DisconnectError::by_app());
        connections.shutdown().await;
        // Dropping the owned driver closes the upgraded connection even if a
        // peer ignores disconnect. No detached SSH session survives cancellation.
        result
    }
}

fn send_request(
    client: &Client,
    name: &str,
    payload: makiko::bytes::Bytes,
) -> io::Result<oneshot::Receiver<GlobalReply>> {
    let (sender, receiver) = oneshot::channel();
    client
        .send_request(GlobalReq {
            request_type: name.to_owned(),
            payload,
            reply_tx: Some(sender),
        })
        .map_err(io::Error::other)?;
    Ok(receiver)
}

async fn forward(accept: makiko::AcceptChannel, destination: SocketAddr) {
    let Ok(Ok(socket)) =
        time::timeout(Duration::from_secs(10), TcpStream::connect(destination)).await
    else {
        return;
    };
    let Ok((channel, mut receiver)) = accept
        .accept(
            makiko::ChannelConfig::default(),
            makiko::bytes::Bytes::new(),
        )
        .await
    else {
        return;
    };
    let (mut reader, mut writer) = socket.into_split();
    let upload = async {
        let mut buffer = vec![0; 32 * 1024];
        loop {
            let count = reader.read(&mut buffer).await?;
            if count == 0 {
                return channel.send_eof().await.map_err(io::Error::other);
            }
            channel
                .send_data(
                    makiko::bytes::Bytes::copy_from_slice(&buffer[..count]),
                    makiko::DATA_STANDARD,
                )
                .await
                .map_err(io::Error::other)?;
        }
    };
    let download = async {
        while let Some(event) = receiver.recv().await {
            match event {
                makiko::ChannelEvent::Data(bytes, makiko::DATA_STANDARD) => {
                    writer.write_all(&bytes).await?
                }
                makiko::ChannelEvent::Eof => break,
                _ => {}
            }
        }
        writer.shutdown().await
    };
    let _ = tokio::try_join!(upload, download);
    let _ = channel.close();
}
