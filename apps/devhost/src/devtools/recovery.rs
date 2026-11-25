use std::sync::Arc;

use axum::{
    body::Body,
    http::{HeaderMap, HeaderValue, Method, Request, StatusCode, header},
    response::{IntoResponse, Response},
};

use super::{
    CACHE_CONTROL_NO_STORE, RECOVERY_HEADER, RecoveryState,
    document_injection::inject_devtools_script, request_guard::check_cross_origin,
};
use crate::statuspage::{self, Page};

pub type WorktreesHandler = Arc<dyn Fn(Request<Body>) -> Response + Send + Sync>;

pub fn set_document_recovery_error(state: &mut RecoveryState, status: u16) {
    if status != StatusCode::NOT_FOUND.as_u16() {
        state.phase = "unavailable".to_owned();
        state.title = format!("{} could not load", state.service);
        state.message = format!(
            "The application returned HTTP {status}. Review the service logs and restart after addressing the error."
        );
        return;
    }
    state.phase = "not-found".to_owned();
    state.title = "Page not found".to_owned();
    state.message = "This path does not exist in the current checkout. Check the URL.".to_owned();
    if !state.repositories.is_empty() {
        state.message =
            "This path does not exist in the current checkout. Choose another worktree below or check the URL."
                .to_owned();
    }
}

pub fn render_recovery_document(
    state: &RecoveryState,
    status: u16,
    inject_toolbar: bool,
) -> Result<String, String> {
    let mut page = Page::basic("recovery", status, &state.title, &state.message);
    page.recovery = Some(serde_json::to_value(state).expect("serialize recovery state"));
    let mut document = statuspage::render(&page, "")?;
    if inject_toolbar {
        document = inject_devtools_script(&document);
    }
    Ok(document)
}

pub fn render_unavailable_document() -> Result<String, String> {
    let page = Page::basic(
        "unavailable",
        StatusCode::BAD_GATEWAY.as_u16(),
        "Service unavailable",
        "Use devhost to view logs and restart it.",
    );
    statuspage::render(&page, "")
}

pub fn serve_recovery_page(
    method: &Method,
    headers: &HeaderMap,
    state: &RecoveryState,
    status: StatusCode,
    inject_toolbar: bool,
) -> Response {
    let sec_fetch_dest = headers
        .get("sec-fetch-dest")
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default();
    let accepts_json = headers
        .get(header::ACCEPT)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.contains("application/json"));
    if sec_fetch_dest != "document" && accepts_json {
        let json = serde_json::to_vec(state).expect("serialize recovery json");
        return Response::builder()
            .status(status)
            .header(header::CACHE_CONTROL, CACHE_CONTROL_NO_STORE)
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(json))
            .expect("json recovery response");
    }
    let Ok(document) = render_recovery_document(state, status.as_u16(), inject_toolbar) else {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            [(header::CACHE_CONTROL, CACHE_CONTROL_NO_STORE)],
            "Unable to render service status\n",
        )
            .into_response();
    };
    let body = if *method == Method::HEAD {
        Body::empty()
    } else {
        Body::from(document)
    };
    Response::builder()
        .status(status)
        .header(header::CACHE_CONTROL, CACHE_CONTROL_NO_STORE)
        .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
        .body(body)
        .expect("html recovery response")
}

pub(crate) fn recovery_control_guard(
    method: &Method,
    headers: &HeaderMap,
) -> Result<Option<String>, &'static str> {
    let host = headers
        .get(header::HOST)
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default();
    let proto = headers
        .get("x-forwarded-proto")
        .and_then(|v| v.to_str().ok());
    check_cross_origin(method, headers, host, proto)?;
    let action = headers
        .get(RECOVERY_HEADER)
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned);
    Ok(action)
}

pub(crate) fn no_store_error(status: StatusCode, msg: &str) -> Response {
    let mut response = (status, format!("{msg}\n")).into_response();
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static(CACHE_CONTROL_NO_STORE),
    );
    response
}
