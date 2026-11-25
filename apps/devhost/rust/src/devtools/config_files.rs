//! Configuration editing checks the same candidate as a watcher reload; saving
//! only replaces the file and lets that watcher apply it.
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::mpsc::TryRecvError,
    time::Duration,
};

use axum::{
    body::{Body, to_bytes},
    extract::State,
    http::{Method, Request, StatusCode, header},
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use super::server::{diagnostic, guard, is_local_client};
use crate::services::control::RuntimeHandle;

const CONTENT_LIMIT: usize = 1 << 20;

#[derive(Serialize)]
pub(super) struct ConfigFile {
    pub path: PathBuf,
    pub kind: &'static str,
    pub content: String,
    pub version: String,
}

#[derive(Default, Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
struct ValidateRequest {
    path: PathBuf,
    content: String,
}

#[derive(Default, Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
struct SaveRequest {
    path: PathBuf,
    content: String,
    base_version: String,
}

fn version(content: &[u8]) -> String {
    format!("{:x}", Sha256::digest(content))
}

pub(super) fn read_file(path: PathBuf, kind: &'static str) -> Result<ConfigFile, String> {
    let content = match fs::File::open(&path) {
        Ok(file) => {
            let mut bytes = Vec::new();
            file.take((CONTENT_LIMIT + 1) as u64)
                .read_to_end(&mut bytes)
                .map_err(|e| e.to_string())?;
            Some(bytes)
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(e.to_string()),
    };
    if content
        .as_ref()
        .is_some_and(|content| content.len() > CONTENT_LIMIT)
    {
        return Err(format!(
            "the file is too large for the configuration editor: {}",
            path.display()
        ));
    }
    let version = content.as_deref().map(version).unwrap_or_default();
    Ok(ConfigFile {
        path,
        kind,
        version,
        content: content
            .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
            .unwrap_or_default(),
    })
}

fn available(handle: &RuntimeHandle, request: &Request<Body>) -> Result<(), Box<Response>> {
    guard(handle, request).map_err(|error| diagnostic(StatusCode::FORBIDDEN, error))?;
    if !handle
        .live
        .manifest()
        .is_some_and(|manifest| manifest.devtools.config_editor_enabled)
    {
        return Err(Box::new(diagnostic(
            StatusCode::NOT_FOUND,
            "404 page not found",
        )));
    }
    Ok(())
}

fn listed(handle: &RuntimeHandle, path: &Path) -> Result<&'static str, Box<Response>> {
    handle
        .live
        .config_files()
        .into_iter()
        .find_map(|(listed, kind)| (listed == path).then_some(kind))
        .ok_or_else(|| {
            Box::new(diagnostic(
                StatusCode::FORBIDDEN,
                "The configuration editor cannot change this file.",
            ))
        })
}

fn json_response(status: StatusCode, value: impl Serialize) -> Response {
    (
        status,
        [(header::CACHE_CONTROL, super::CACHE_CONTROL_NO_STORE)],
        axum::Json(value),
    )
        .into_response()
}

fn method_error(allow: &'static str) -> Response {
    let mut response = diagnostic(StatusCode::METHOD_NOT_ALLOWED, "Method not allowed");
    response
        .headers_mut()
        .insert(header::ALLOW, header::HeaderValue::from_static(allow));
    response
}

pub(super) async fn files(State(handle): State<RuntimeHandle>, request: Request<Body>) -> Response {
    if let Err(response) = available(&handle, &request) {
        return *response;
    }
    let refs = handle.live.config_files();
    match tokio::task::spawn_blocking(move || {
        refs.into_iter()
            .map(|(path, kind)| read_file(path, kind))
            .collect::<Result<Vec<_>, _>>()
    })
    .await
    {
        Ok(Ok(files)) => json_response(StatusCode::OK, json!({"files":files})),
        Ok(Err(error)) => diagnostic(StatusCode::INTERNAL_SERVER_ERROR, &error),
        Err(error) => diagnostic(StatusCode::INTERNAL_SERVER_ERROR, &error.to_string()),
    }
}

pub(super) async fn schema(
    State(handle): State<RuntimeHandle>,
    request: Request<Body>,
) -> Response {
    if let Err(response) = available(&handle, &request) {
        return *response;
    }
    json_response(
        StatusCode::OK,
        json!({"manifest":crate::manifest::validation::editor_schema(),"config":crate::config::editor_schema()}),
    )
}

async fn decode<T: serde::de::DeserializeOwned>(
    request: Request<Body>,
) -> Result<T, Box<Response>> {
    if request.method() != Method::POST {
        return Err(Box::new(method_error("POST")));
    }
    let invalid = || {
        Box::new(diagnostic(
            StatusCode::BAD_REQUEST,
            "Invalid configuration payload.",
        ))
    };
    let bytes = to_bytes(request.into_body(), 6 * CONTENT_LIMIT + 4096)
        .await
        .map_err(|_| invalid())?;
    serde_json::from_slice(&bytes).map_err(|_| invalid())
}

async fn issues(handle: &RuntimeHandle, path: PathBuf, content: String) -> Vec<Value> {
    if content.len() > CONTENT_LIMIT {
        return vec![json!({"message":"The content is too large for the configuration editor."})];
    }
    // Preserve syntax locations for the editor before the runtime checks includes,
    // interpolation, selected services, ports and working directories.
    if let Err(error) = content.parse::<toml::Table>() {
        let offset = error.span().map_or(0, |span| span.start.min(content.len()));
        let prefix = &content[..content.floor_char_boundary(offset)];
        let line = prefix.bytes().filter(|byte| *byte == b'\n').count() + 1;
        let column = prefix
            .rsplit('\n')
            .next()
            .unwrap_or_default()
            .chars()
            .count()
            + 1;
        return vec![json!({"message":error.to_string(),"path":path,"line":line,"column":column})];
    }
    let result = match handle.check_config(path, content) {
        Ok(result) => result,
        Err(error) => return vec![json!({"message":error})],
    };
    loop {
        match result.try_recv() {
            Ok(Ok(())) => return Vec::new(),
            Ok(Err(error)) => return validation_issues(&error),
            Err(TryRecvError::Disconnected) => {
                return vec![json!({"message":"devhost is shutting down"})];
            }
            Err(TryRecvError::Empty) => tokio::time::sleep(Duration::from_millis(10)).await,
        }
    }
}

fn validation_issues(error: &str) -> Vec<Value> {
    let manifest = error.starts_with("Manifest schema is invalid:\n")
        || error.starts_with("Manifest validation failed:\n");
    let config = error.starts_with("devhost config ") && error.contains(" is invalid:\n");
    let validation = manifest || config;
    let messages = if validation {
        error.split_once('\n').map_or(error, |(_, body)| body)
    } else {
        error
    };
    messages
        .lines()
        .filter(|line| !line.is_empty())
        .map(|message| {
            let mut issue = json!({"message":message});
            let key = if manifest {
                crate::manifest::validation::issue_key_path(message)
            } else if config {
                crate::config::issue_key_path(message)
            } else {
                String::new()
            };
            if !key.is_empty() {
                issue["keyPath"] = json!(key);
            }
            issue
        })
        .collect()
}

pub(super) async fn validate(
    State(handle): State<RuntimeHandle>,
    request: Request<Body>,
) -> Response {
    if let Err(response) = available(&handle, &request) {
        return *response;
    }
    let payload: ValidateRequest = match decode(request).await {
        Ok(payload) => payload,
        Err(response) => return *response,
    };
    if let Err(response) = listed(&handle, &payload.path) {
        return *response;
    }
    json_response(
        StatusCode::OK,
        json!({"issues":issues(&handle,payload.path,payload.content).await}),
    )
}

pub(super) async fn save(State(handle): State<RuntimeHandle>, request: Request<Body>) -> Response {
    if let Err(response) = available(&handle, &request) {
        return *response;
    }
    if !is_local_client(request.headers()) {
        return diagnostic(
            StatusCode::FORBIDDEN,
            "Only a browser on this machine can save the configuration.",
        );
    }
    let payload: SaveRequest = match decode(request).await {
        Ok(payload) => payload,
        Err(response) => return *response,
    };
    let kind = match listed(&handle, &payload.path) {
        Ok(kind) => kind,
        Err(response) => return *response,
    };
    let _save = handle.live.events.config_save.lock().await;
    let path = payload.path.clone();
    let current = match tokio::task::spawn_blocking(move || read_file(path, kind)).await {
        Ok(Ok(current)) => current,
        Ok(Err(error)) => return diagnostic(StatusCode::INTERNAL_SERVER_ERROR, &error),
        Err(error) => return diagnostic(StatusCode::INTERNAL_SERVER_ERROR, &error.to_string()),
    };
    if current.version != payload.base_version {
        return json_response(StatusCode::CONFLICT, current);
    }
    let issues = issues(&handle, payload.path.clone(), payload.content.clone()).await;
    if !issues.is_empty() {
        return json_response(StatusCode::UNPROCESSABLE_ENTITY, json!({"issues":issues}));
    }
    match tokio::task::spawn_blocking(move || {
        write_file(&payload.path, payload.content.as_bytes())?;
        Ok::<_, String>(version(payload.content.as_bytes()))
    })
    .await
    {
        Ok(Ok(version)) => json_response(StatusCode::OK, json!({"version":version})),
        Ok(Err(error)) => diagnostic(StatusCode::INTERNAL_SERVER_ERROR, &error),
        Err(error) => diagnostic(StatusCode::INTERNAL_SERVER_ERROR, &error.to_string()),
    }
}

pub(super) fn write_file(path: &Path, content: &[u8]) -> Result<(), String> {
    let target = match path.canonicalize() {
        Ok(target) => target,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => path.to_owned(),
        Err(e) => return Err(e.to_string()),
    };
    let parent = target.parent().ok_or("configuration file has no parent")?;
    let mut directories = fs::DirBuilder::new();
    directories.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        directories.mode(0o700);
    }
    directories.create(parent).map_err(|e| e.to_string())?;
    let permissions = match fs::metadata(&target) {
        Ok(meta) => Some(meta.permissions()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(e.to_string()),
    };
    let mut file = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    if let Some(permissions) = permissions {
        file.as_file()
            .set_permissions(permissions)
            .map_err(|e| e.to_string())?;
    }
    file.write_all(content)
        .and_then(|_| file.as_file().sync_all())
        .map_err(|e| e.to_string())?;
    file.persist(&target).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    fs::File::open(parent)
        .and_then(|file| file.sync_all())
        .map_err(|e| e.to_string())?;
    Ok(())
}
