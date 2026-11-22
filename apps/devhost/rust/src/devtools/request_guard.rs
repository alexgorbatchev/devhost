use std::net::IpAddr;

use axum::http::{HeaderMap, Method, header};

const JSON_MEDIA_TYPE: &str = "application/json";

pub fn is_state_changing_request(method: &Method, headers: &HeaderMap) -> bool {
    if matches!(*method, Method::GET | Method::HEAD | Method::OPTIONS) {
        return is_websocket_upgrade(headers);
    }
    true
}

pub fn check_cross_origin(
    method: &Method,
    headers: &HeaderMap,
    host: &str,
    forwarded_proto: Option<&str>,
) -> Result<(), &'static str> {
    if matches!(*method, Method::GET | Method::HEAD | Method::OPTIONS)
        && !is_websocket_upgrade(headers)
    {
        return Ok(());
    }
    if let Some(sec_fetch_site) = headers.get("sec-fetch-site").and_then(|v| v.to_str().ok()) {
        return match sec_fetch_site {
            "same-origin" | "none" => Ok(()),
            _ => Err("cross-origin request detected from Sec-Fetch-Site header"),
        };
    }
    if let Some(origin) = headers.get(header::ORIGIN).and_then(|v| v.to_str().ok()) {
        let scheme = if forwarded_proto == Some("https") {
            "https"
        } else {
            "http"
        };
        let expected_http = format!("http://{host}");
        let expected = format!("{scheme}://{host}");
        if !origin.eq_ignore_ascii_case(&expected) && !origin.eq_ignore_ascii_case(&expected_http) {
            return Err(
                "cross-origin request detected, and/or browser is out of date: Sec-Fetch-Site is missing, and Origin does not match Host",
            );
        }
    }
    Ok(())
}

pub fn serves_request_host<F>(
    host: &str,
    forwarded_proto: Option<&str>,
    control_port: u16,
    owns_document_url: Option<&F>,
) -> bool
where
    F: Fn(u16, &str) -> Result<bool, String>,
{
    let hostname = split_host(host);
    if hostname.eq_ignore_ascii_case("localhost") {
        return true;
    }
    if let Ok(ip) = hostname.parse::<IpAddr>()
        && ip.is_loopback()
    {
        return true;
    }
    let Some(check) = owns_document_url else {
        return false;
    };
    let scheme = if forwarded_proto == Some("https") {
        "https"
    } else {
        "http"
    };
    let origin_url = format!("{scheme}://{host}/");
    matches!(check(control_port, &origin_url), Ok(true))
}

pub fn is_json_request(headers: &HeaderMap) -> bool {
    let Some(raw) = headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
    else {
        return false;
    };
    let media_type = raw.split(';').next().unwrap_or_default().trim();
    media_type.eq_ignore_ascii_case(JSON_MEDIA_TYPE)
}

fn is_websocket_upgrade(headers: &HeaderMap) -> bool {
    let upgrade = headers
        .get(header::UPGRADE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.eq_ignore_ascii_case("websocket"));
    let connection = headers
        .get(header::CONNECTION)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| {
            v.split(',')
                .any(|part| part.trim().eq_ignore_ascii_case("upgrade"))
        });
    upgrade && connection
}

fn split_host(authority: &str) -> &str {
    if let Some(bracketed) = authority.strip_prefix('[')
        && let Some((inside, _)) = bracketed.split_once(']')
    {
        return inside;
    }
    match authority.rsplit_once(':') {
        Some((h, port)) if port.bytes().all(|b| b.is_ascii_digit()) => h,
        _ => authority,
    }
}
