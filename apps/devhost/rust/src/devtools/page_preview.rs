use axum::{
    Router,
    body::Body,
    extract::State,
    http::{HeaderMap, HeaderValue, Method, StatusCode, Uri, header},
    response::{IntoResponse, Response},
    routing::any,
};

use super::{
    CACHE_CONTROL_NO_STORE, PAGE_PREVIEW_PATH, RECOVERY_HEADER, RecoveryState, Worktree,
    WorktreeRepository,
    assets::AssetStore,
    recovery::{no_store_error, serve_recovery_page, set_document_recovery_error},
};
use crate::{
    files::FileHandler,
    statuspage::{self, Page, RouteLink},
};

pub fn page_preview_state(name: &str) -> Option<(RecoveryState, u16)> {
    let mut state = RecoveryState {
        stack: "preview".to_owned(),
        service: "web".to_owned(),
        phase: "unavailable".to_owned(),
        title: String::new(),
        message: String::new(),
        address: "127.0.0.1:3000".to_owned(),
        can_restart: true,
        logs: vec![
            "[web] Starting development server".to_owned(),
            "[web] Could not resolve an application import".to_owned(),
            "[web] Waiting for file changes…".to_owned(),
        ],
        repositories: Vec::new(),
    };
    let mut status = StatusCode::SERVICE_UNAVAILABLE.as_u16();
    match name {
        "starting" => {
            state.phase = "starting".to_owned();
            state.title = "Starting web".to_owned();
            state.message =
                "Waiting for the service to accept connections on its assigned address.".to_owned();
            state.can_restart = false;
            state.logs = vec![
                "[web] Starting development server".to_owned(),
                "[web] Checking TCP readiness at 127.0.0.1:3000".to_owned(),
            ];
        }
        "failed" => {
            state.title = "web exited".to_owned();
            state.message =
                "The service exited with code 1. Review the logs and restart when ready."
                    .to_owned();
        }
        "external" => {
            state.title = "External service unavailable".to_owned();
            state.message = "Start the external service, then refresh this page.".to_owned();
            state.can_restart = false;
            state.logs.clear();
        }
        "worktrees" => {
            status = StatusCode::INTERNAL_SERVER_ERROR.as_u16();
            state.repositories = vec![WorktreeRepository {
                id: "preview".to_owned(),
                name: "preview-project".to_owned(),
                selected_path: "/preview/main".to_owned(),
                worktrees: vec![
                    Worktree {
                        path: "/preview/main".to_owned(),
                        branch: "main".to_owned(),
                        available: true,
                        ..Worktree::default()
                    },
                    Worktree {
                        path: "/preview/feature".to_owned(),
                        branch: "feature/design".to_owned(),
                        available: true,
                        ..Worktree::default()
                    },
                    Worktree {
                        path: "/preview/missing".to_owned(),
                        branch: "feature/missing".to_owned(),
                        available: false,
                        reason: "Checkout is unavailable".to_owned(),
                        ..Worktree::default()
                    },
                ],
                ..WorktreeRepository::default()
            }];
            set_document_recovery_error(&mut state, status);
        }
        "404" | "500" | "502" | "503" | "504" => {
            status = name.parse::<u16>().ok()?;
            set_document_recovery_error(&mut state, status);
        }
        _ => return None,
    }
    Some((state, status))
}

pub fn preview_routes(store: AssetStore) -> Router {
    let base = PAGE_PREVIEW_PATH;
    let rest = format!("{PAGE_PREVIEW_PATH}{{*rest}}");
    Router::new()
        .route(base, any(handle_preview_request))
        .route(&rest, any(handle_preview_request))
        .with_state(store)
}

async fn handle_preview_request(
    State(store): State<AssetStore>,
    method: Method,
    uri: Uri,
    headers: HeaderMap,
) -> Response {
    if store.dev_source().is_none() {
        return (StatusCode::NOT_FOUND, "404 page not found\n").into_response();
    }
    handle_page_preview(&store, &method, &uri, &headers)
}

pub fn handle_page_preview(
    store: &AssetStore,
    method: &Method,
    uri: &Uri,
    headers: &HeaderMap,
) -> Response {
    let name = uri
        .path()
        .strip_prefix(PAGE_PREVIEW_PATH)
        .unwrap_or_default();
    if let Some((state, status)) = page_preview_state(name) {
        if *method == Method::POST {
            return no_store_error(
                StatusCode::CONFLICT,
                "Preview only. Restart and worktree actions do not affect running services.",
            );
        }
        if *method != Method::GET && *method != Method::HEAD {
            let mut resp = no_store_error(StatusCode::METHOD_NOT_ALLOWED, "Method not allowed");
            resp.headers_mut()
                .insert(header::ALLOW, HeaderValue::from_static("GET, HEAD"));
            return resp;
        }
        let action = headers
            .get(RECOVERY_HEADER)
            .and_then(|v| v.to_str().ok())
            .unwrap_or_default();
        return match action {
            "status" | "worktrees" => {
                let body = if *method == Method::HEAD {
                    Body::empty()
                } else {
                    Body::from(serde_json::to_vec(&state).expect("serialize preview state"))
                };
                Response::builder()
                    .status(StatusCode::OK)
                    .header(header::CACHE_CONTROL, CACHE_CONTROL_NO_STORE)
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(body)
                    .expect("preview json")
            }
            "" | "probe" => serve_recovery_page(
                method,
                headers,
                &state,
                StatusCode::from_u16(status).unwrap_or(StatusCode::SERVICE_UNAVAILABLE),
                false,
            ),
            _ => no_store_error(StatusCode::BAD_REQUEST, "Unknown preview action"),
        };
    }

    if *method != Method::GET && *method != Method::HEAD {
        let mut resp = no_store_error(StatusCode::METHOD_NOT_ALLOWED, "Method not allowed");
        resp.headers_mut()
            .insert(header::ALLOW, HeaderValue::from_static("GET, HEAD"));
        return resp;
    }

    if name.starts_with("files/") {
        let Some(checkout) = store.dev_source() else {
            return no_store_error(StatusCode::NOT_FOUND, "404 page not found");
        };
        let files_dir = checkout.root_path().join("demos/pages/files");
        let Ok(handler) = FileHandler::open(&files_dir) else {
            return no_store_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Could not open the checkout's demos/pages/files preview directory",
            );
        };
        return handler.serve(method, uri, &format!("{PAGE_PREVIEW_PATH}files"));
    }

    match name {
        "" => {
            let page = Page::basic(
                "previews",
                StatusCode::OK.as_u16(),
                "Standalone page previews",
                "Examples use the real page components with sample data. Preview actions cannot change running services.",
            );
            render_preview_document(method, &page, "", StatusCode::OK)
        }
        "status.css" => {
            let body = if *method == Method::HEAD {
                Body::empty()
            } else {
                Body::from(statuspage::PAGE_CSS)
            };
            Response::builder()
                .status(StatusCode::OK)
                .header(header::CACHE_CONTROL, CACHE_CONTROL_NO_STORE)
                .header(header::CONTENT_TYPE, "text/css; charset=utf-8")
                .body(body)
                .expect("status.css preview")
        }
        "route-not-found" | "route-not-found-empty" => {
            let routes = if name == "route-not-found" {
                vec![
                    RouteLink {
                        host: "web.localhost".to_owned(),
                        url: format!("{PAGE_PREVIEW_PATH}files/"),
                    },
                    RouteLink {
                        host: "api.localhost".to_owned(),
                        url: format!("{PAGE_PREVIEW_PATH}500"),
                    },
                ]
            } else {
                Vec::new()
            };
            let css_url = format!("{PAGE_PREVIEW_PATH}status.css");
            let Ok(html) = statuspage::not_found_page(routes, &css_url) else {
                return no_store_error(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Unable to render preview",
                );
            };
            serve_preview_html(method, html, StatusCode::NOT_FOUND)
        }
        "backend-unavailable" => {
            let page = Page::basic(
                "unavailable",
                StatusCode::BAD_GATEWAY.as_u16(),
                "Service unavailable",
                "Use devhost to view logs and restart it.",
            );
            render_preview_document(method, &page, "", StatusCode::BAD_GATEWAY)
        }
        _ => no_store_error(StatusCode::NOT_FOUND, "404 page not found"),
    }
}

fn render_preview_document(
    method: &Method,
    page: &Page,
    stylesheet_url: &str,
    status: StatusCode,
) -> Response {
    let Ok(html) = statuspage::render(page, stylesheet_url) else {
        return no_store_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Unable to render preview",
        );
    };
    serve_preview_html(method, html, status)
}

fn serve_preview_html(method: &Method, html: String, status: StatusCode) -> Response {
    let body = if *method == Method::HEAD {
        Body::empty()
    } else {
        Body::from(html)
    };
    Response::builder()
        .status(status)
        .header(header::CACHE_CONTROL, CACHE_CONTROL_NO_STORE)
        .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
        .body(body)
        .expect("preview html")
}
