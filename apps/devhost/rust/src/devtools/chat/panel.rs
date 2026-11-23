use crate::devtools::server::{diagnostic, guard};
use crate::services::control::RuntimeHandle;
use axum::{
    body::{Body, to_bytes},
    extract::State,
    http::{Method, Request, StatusCode},
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::Write;

#[derive(Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Layout {
    position: Option<Position>,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Position {
    #[serde(default)]
    left: f64,
    #[serde(default)]
    top: f64,
}
impl Layout {
    fn valid(&self) -> bool {
        self.position
            .as_ref()
            .is_none_or(|p| [p.left, p.top].iter().all(|v| v.is_finite() && *v >= 0.0))
    }
}

pub(in crate::devtools) async fn serve(
    State(handle): State<RuntimeHandle>,
    request: Request<Body>,
) -> Response {
    if let Err(e) = guard(&handle, &request) {
        return diagnostic(StatusCode::FORBIDDEN, e);
    }
    let Some(manifest) = handle.live.manifest() else {
        return diagnostic(StatusCode::NOT_FOUND, "404 page not found");
    };
    if manifest.manifest_path.as_os_str().is_empty() {
        return diagnostic(StatusCode::NOT_FOUND, "404 page not found");
    }
    let key = format!(
        "{:x}",
        Sha256::digest(manifest.manifest_path.as_os_str().as_encoded_bytes())
    );
    let caddy_dir = handle.live.caddy_dir();
    let state_dir = caddy_dir.parent().unwrap_or(&caddy_dir);
    let path = state_dir.join("chat-panels").join(format!("{key}.json"));
    match *request.method() {
        Method::GET => {
            let result = tokio::task::spawn_blocking(move || match std::fs::read(&path) {
                Ok(bytes) => Ok(serde_json::from_slice::<Layout>(&bytes)
                    .ok()
                    .filter(Layout::valid)
                    .unwrap_or_default()),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Layout::default()),
                Err(e) => Err(format!("read chat panel layout: {e}")),
            })
            .await;
            match result {
                Ok(Ok(layout)) => super::transport::json(&layout),
                Ok(Err(e)) => diagnostic(StatusCode::INTERNAL_SERVER_ERROR, &e),
                Err(e) => diagnostic(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
            }
        }
        Method::PUT => {
            if let Err(e) = super::transport::require_page(&request) {
                return diagnostic(StatusCode::FORBIDDEN, e);
            }
            let bytes = match to_bytes(request.into_body(), 1024).await {
                Ok(b) => b,
                Err(e) => return diagnostic(StatusCode::BAD_REQUEST, &e.to_string()),
            };
            let layout = match serde_json::from_slice::<Layout>(&bytes) {
                Ok(l) => l,
                Err(e) => return diagnostic(StatusCode::BAD_REQUEST, &e.to_string()),
            };
            if !layout.valid() {
                return diagnostic(
                    StatusCode::BAD_REQUEST,
                    "chat panel position must be finite and not negative",
                );
            }
            let saved = tokio::task::spawn_blocking(move || -> Result<(), String> {
                let directory = path.parent().ok_or("invalid chat panel directory")?;
                std::fs::create_dir_all(directory)
                    .map_err(|e| format!("create chat panel state: {e}"))?;
                let mut file =
                    tempfile::NamedTempFile::new_in(directory).map_err(|e| e.to_string())?;
                file.write_all(&serde_json::to_vec(&layout).map_err(|e| e.to_string())?)
                    .map_err(|e| e.to_string())?;
                file.persist(path)
                    .map_err(|e| format!("save chat panel layout: {e}"))?;
                Ok(())
            })
            .await;
            match saved {
                Ok(Ok(())) => StatusCode::NO_CONTENT.into_response(),
                Ok(Err(e)) => diagnostic(StatusCode::INTERNAL_SERVER_ERROR, &e),
                Err(e) => diagnostic(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
            }
        }
        _ => diagnostic(StatusCode::METHOD_NOT_ALLOWED, "method not allowed"),
    }
}
