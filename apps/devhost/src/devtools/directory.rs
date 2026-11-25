use super::server::{diagnostic, is_local_client};
use crate::{
    caddy::{
        files::read_applied_settings,
        stacks::{LiveStack, read_live_stacks},
    },
    services::control::RuntimeHandle,
    statuspage::{self, Stack, StackConfig, StackService},
};
use axum::{
    body::Body,
    extract::State,
    http::{Method, Request, StatusCode, header},
    response::{IntoResponse, Response},
};
use std::{path::Path, time::Duration};

const SELF_PATH: &str = "/__devhost__/stacks/self";

fn guard(handle: &RuntimeHandle, request: &Request<Body>) -> Result<(), Box<Response>> {
    let settings = read_applied_settings(&handle.live.caddy_dir())
        .map_err(|_| {
            diagnostic(
                StatusCode::SERVICE_UNAVAILABLE,
                "Stack directory settings unavailable",
            )
        })?
        .ok_or_else(|| {
            diagnostic(
                StatusCode::SERVICE_UNAVAILABLE,
                "Stack directory settings unavailable",
            )
        })?;
    if !(is_local_client(request.headers())
        || settings.stack_directory_allow_remote && request.uri().path() != SELF_PATH)
    {
        return Err(Box::new(diagnostic(
            StatusCode::FORBIDDEN,
            "The stack directory is available on this machine only.",
        )));
    }
    if !matches!(*request.method(), Method::GET | Method::HEAD) {
        let mut response = diagnostic(StatusCode::METHOD_NOT_ALLOWED, "Method not allowed");
        response
            .headers_mut()
            .insert(header::ALLOW, header::HeaderValue::from_static("GET, HEAD"));
        return Err(Box::new(response));
    }
    let host = request
        .headers()
        .get(header::HOST)
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default();
    let scheme = if request
        .headers()
        .get("x-forwarded-proto")
        .is_some_and(|v| v == "https")
    {
        "https"
    } else {
        "http"
    };
    if request
        .headers()
        .get(header::ORIGIN)
        .is_some_and(|v| v != format!("{scheme}://{host}").as_str())
        || request
            .headers()
            .get("sec-fetch-site")
            .is_some_and(|v| v == "cross-site" || v == "same-site")
            && !request
                .headers()
                .get("sec-fetch-mode")
                .is_some_and(|v| v == "navigate")
    {
        return Err(Box::new(diagnostic(
            StatusCode::FORBIDDEN,
            "Cross-origin directory request",
        )));
    }
    let hostname = url::Url::parse(&format!("{scheme}://{host}"))
        .ok()
        .and_then(|url| url.host_str().map(str::to_owned))
        .unwrap_or_default();
    if !hostname.eq_ignore_ascii_case(settings.stack_directory_hostname())
        && super::server::guard(handle, request).is_err()
    {
        return Err(Box::new(diagnostic(
            StatusCode::FORBIDDEN,
            "Unknown stack directory host",
        )));
    }
    Ok(())
}

fn snapshot(handle: &RuntimeHandle) -> Result<Stack, String> {
    let manifest = handle.live.manifest().ok_or("Stack is not available.")?;
    let info = handle.live.snapshot()?;
    let services = info
        .services
        .into_iter()
        .map(|info| {
            let service = manifest
                .services
                .get(&info.name)
                .or_else(|| manifest.stopped.get(&info.name))
                .expect("snapshot service belongs to manifest");
            let status = match info.state.as_str() {
                "not-started" => "Not started",
                "starting" => "Starting",
                "restarting" => "Restarting",
                "exited" => "Exited",
                "failed" => "Failed",
                _ if !service.managed && service.command.is_empty() && service.serve.is_empty() => {
                    "External"
                }
                _ => "Running",
            };
            StackService {
                name: info.name,
                directory: service.cwd.display().to_string(),
                urls: info.urls,
                status: status.to_owned(),
            }
        })
        .collect();
    let configs = handle
        .live
        .config_files()
        .into_iter()
        .map(|(path, kind)| {
            let mut config = StackConfig {
                path: path.display().to_string(),
                kind: kind.to_owned(),
                ..Default::default()
            };
            match super::config_files::read_file(path, kind) {
                Ok(file) if file.version.is_empty() => {
                    config.error = "File does not exist; defaults apply.".to_owned()
                }
                Ok(file) => config.content = file.content,
                Err(error) => config.error = error,
            }
            config
        })
        .collect();
    Ok(Stack {
        name: manifest.name,
        directory: manifest.manifest_directory.display().to_string(),
        services,
        configs,
        ..Default::default()
    })
}

fn read_owner(owner: &LiveStack) -> Stack {
    let result = || -> Result<Stack, String> {
        if owner.control_port == 0 {
            return Err("control server is not available".to_owned());
        }
        let agent: ureq::Agent = ureq::Agent::config_builder()
            .timeout_global(Some(Duration::from_secs(2)))
            .max_redirects(0)
            .proxy(None)
            .build()
            .into();
        let mut response = agent
            .get(format!(
                "http://127.0.0.1:{}{SELF_PATH}",
                owner.control_port
            ))
            .call()
            .map_err(|e| e.to_string())?;
        let bytes = response
            .body_mut()
            .with_config()
            .limit(16 << 20)
            .read_to_vec()
            .map_err(|e| e.to_string())?;
        serde_json::from_slice(&bytes).map_err(|e| e.to_string())
    };
    let mut stack = match result() {
        Ok(stack) => stack,
        Err(error) => Stack {
            error: format!("Stack details unavailable: {error}"),
            ..Default::default()
        },
    };
    stack.pid = owner.pid;
    stack.manifest_path.clone_from(&owner.manifest_path);
    stack.started_at.clone_from(&owner.started_at);
    if stack.name.is_empty() {
        stack.name.clone_from(&owner.name);
    }
    if stack.directory.is_empty() {
        stack.directory = Path::new(&owner.manifest_path)
            .parent()
            .unwrap_or_else(|| Path::new(""))
            .display()
            .to_string();
    }
    stack
}

fn matches(stack: &Stack, query: &str) -> bool {
    [&stack.name, &stack.directory, &stack.manifest_path]
        .into_iter()
        .chain(
            stack
                .services
                .iter()
                .flat_map(|s| [&s.name, &s.directory].into_iter().chain(s.urls.iter())),
        )
        .chain(stack.configs.iter().map(|c| &c.path))
        .any(|value| value.to_lowercase().contains(query))
}

async fn response(handle: RuntimeHandle, request: Request<Body>) -> Response {
    if let Err(response) = guard(&handle, &request) {
        return *response;
    }
    if request.uri().path() == SELF_PATH {
        if request.method() == Method::HEAD {
            return ([(header::CONTENT_TYPE, "application/json")], "").into_response();
        }
        return match tokio::task::spawn_blocking(move || snapshot(&handle)).await {
            Ok(Ok(stack)) => axum::Json(stack).into_response(),
            Ok(Err(error)) => axum::Json(Stack {
                error,
                ..Default::default()
            })
            .into_response(),
            Err(error) => diagnostic(StatusCode::INTERNAL_SERVER_ERROR, &error.to_string()),
        };
    }
    let query = request
        .uri()
        .query()
        .and_then(|query| {
            url::form_urlencoded::parse(query.as_bytes())
                .find(|(key, _)| key == "q")
                .map(|(_, value)| value.trim().to_owned())
        })
        .unwrap_or_default();
    let result = tokio::task::spawn_blocking(move || {
        let owners = read_live_stacks(&handle.live.caddy_dir())?;
        let stacks = std::thread::scope(|scope| {
            let readers = owners
                .iter()
                .map(|owner| scope.spawn(move || read_owner(owner)))
                .collect::<Vec<_>>();
            readers
                .into_iter()
                .map(|reader| reader.join().map_err(|_| "Stack reader failed".to_owned()))
                .collect::<Result<Vec<_>, _>>()
        })?;
        let lower = query.to_lowercase();
        statuspage::stack_directory(
            stacks
                .into_iter()
                .filter(|stack| matches(stack, &lower))
                .collect(),
            &query,
        )
    })
    .await;
    match result {
        Ok(Ok(document)) => (
            [(header::CONTENT_TYPE, "text/html; charset=utf-8")],
            if request.method() == Method::HEAD {
                String::new()
            } else {
                document
            },
        )
            .into_response(),
        Ok(Err(error)) => diagnostic(StatusCode::SERVICE_UNAVAILABLE, &error),
        Err(error) => diagnostic(StatusCode::INTERNAL_SERVER_ERROR, &error.to_string()),
    }
}

pub(super) async fn serve(State(handle): State<RuntimeHandle>, request: Request<Body>) -> Response {
    let mut response = response(handle, request).await;
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        header::HeaderValue::from_static(super::CACHE_CONTROL_NO_STORE),
    );
    response.headers_mut().insert(
        header::REFERRER_POLICY,
        header::HeaderValue::from_static("no-referrer"),
    );
    response
}
