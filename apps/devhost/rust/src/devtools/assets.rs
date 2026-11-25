use std::{
    collections::BTreeMap,
    path::Path,
    sync::{Arc, Mutex, RwLock},
};

use axum::{
    Router,
    body::Body,
    extract::{Path as AxumPath, State},
    http::{HeaderMap, HeaderValue, Method, StatusCode, Uri, header},
    response::{IntoResponse, Response},
    routing::any,
};
use include_dir::{Dir, include_dir};
use sha2::{Digest, Sha256};

use super::{
    CACHE_CONTROL_IMMUTABLE, CACHE_CONTROL_NO_STORE, DEVTOOLS_ASSETS_PATH, INJECTED_CONFIG_PATH,
    INJECTED_SCRIPT_PATH, REDUX_MONITOR_PATH, REDUX_MONITOR_SCRIPT_PATH,
    REDUX_MONITOR_STYLESHEET_PATH, REDUX_REGISTRATION_SCRIPT_PATH,
    dev_source::{DevSourceCheckout, check_and_build_assets, format_js_error, read_checkout_asset},
};

static BUNDLED_ASSETS: Dir<'_> = include_dir!("$CARGO_MANIFEST_DIR/../internal/devtools/dist");

const APPLICATION_JS_CONTENT_TYPE: &str = "application/javascript; charset=utf-8";
const TEXT_JS_CONTENT_TYPE: &str = "text/javascript; charset=utf-8";
const TEXT_CSS_CONTENT_TYPE: &str = "text/css; charset=utf-8";
const TEXT_HTML_CONTENT_TYPE: &str = "text/html; charset=utf-8";
const JSON_CONTENT_TYPE: &str = "application/json; charset=utf-8";

pub const REDUX_MONITOR_DOCUMENT: &str = r#"<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Redux DevTools</title><link rel="stylesheet" href="/__devhost__/redux-monitor.css"><style>html,body,#redux-monitor{height:100%;margin:0}</style></head><body><div id="redux-monitor"></div><script type="module" src="/__devhost__/redux-monitor.js"></script></body></html>"#;

type LogCallback = Arc<dyn Fn(&str) + Send + Sync>;

#[derive(Clone)]
pub struct AssetStore {
    dev_source: Option<DevSourceCheckout>,
    build_mu: Arc<Mutex<()>>,
    on_log: LogCallback,
    config_json: Arc<RwLock<Vec<u8>>>,
}

impl AssetStore {
    pub fn new(dev_source: Option<DevSourceCheckout>, config_json: Vec<u8>) -> Self {
        Self {
            dev_source,
            build_mu: Arc::new(Mutex::new(())),
            on_log: Arc::new(|_| {}),
            config_json: Arc::new(RwLock::new(config_json)),
        }
    }

    pub fn with_logger(mut self, on_log: LogCallback) -> Self {
        self.on_log = on_log;
        self
    }

    pub fn dev_source(&self) -> Option<&DevSourceCheckout> {
        self.dev_source.as_ref()
    }

    pub fn set_config_json(&self, bytes: Vec<u8>) {
        *self.config_json.write().expect("config_json write lock") = bytes;
    }

    pub fn read_asset(&self, name: &str) -> Result<(Vec<u8>, Option<Vec<u8>>), String> {
        if let Some(ref checkout) = self.dev_source {
            return read_checkout_asset(checkout, name);
        }
        let file = BUNDLED_ASSETS
            .get_file(name)
            .ok_or_else(|| format!("embedded asset {name} not found"))?;
        let content = file.contents().to_vec();
        let compressed = if name.ends_with(".js") || name.ends_with(".css") {
            BUNDLED_ASSETS
                .get_file(format!("{name}.gz"))
                .map(|gz| gz.contents().to_vec())
        } else {
            None
        };
        Ok((content, compressed))
    }

    pub fn check_and_build(&self, filename: &str) -> Result<(Vec<u8>, Option<Vec<u8>>), String> {
        let Some(ref checkout) = self.dev_source else {
            return self.read_asset(filename);
        };
        let on_log = self.on_log.clone();
        check_and_build_assets(checkout, &self.build_mu, filename, &move |msg| {
            for line in msg.trim_end_matches('\n').split('\n') {
                on_log(line);
            }
        })
    }
}

pub fn asset_routes(store: AssetStore) -> Router {
    let assets_pattern = format!("{DEVTOOLS_ASSETS_PATH}{{*name}}");
    Router::new()
        .route(INJECTED_CONFIG_PATH, any(handle_injected_config))
        .route(INJECTED_SCRIPT_PATH, any(handle_injected_script))
        .route(&assets_pattern, any(handle_devtools_asset))
        .route(REDUX_MONITOR_PATH, any(handle_redux_monitor))
        .route(
            REDUX_REGISTRATION_SCRIPT_PATH,
            any(handle_redux_registration),
        )
        .route(REDUX_MONITOR_SCRIPT_PATH, any(handle_redux_monitor_script))
        .route(
            REDUX_MONITOR_STYLESHEET_PATH,
            any(handle_redux_monitor_stylesheet),
        )
        .with_state(store)
}

async fn handle_injected_config(
    State(store): State<AssetStore>,
    method: Method,
    headers: HeaderMap,
) -> Response {
    let bytes = store
        .config_json
        .read()
        .expect("config_json read lock")
        .clone();
    serve_asset(
        &method,
        &headers,
        AssetResponse {
            content_type: JSON_CONTENT_TYPE,
            cache_control: CACHE_CONTROL_NO_STORE,
            content: bytes,
            compressed: None,
        },
    )
}

async fn handle_injected_script(
    State(store): State<AssetStore>,
    method: Method,
    uri: Uri,
    headers: HeaderMap,
) -> Response {
    if !is_allowed_method(&method) {
        return method_not_allowed();
    }
    if store.dev_source.is_some() {
        let (content, compressed) = match store.check_and_build("devtools.js") {
            Ok(pair) => pair,
            Err(err) => (format_js_error(&err).into_bytes(), None),
        };
        return serve_asset(
            &method,
            &headers,
            AssetResponse {
                content_type: APPLICATION_JS_CONTENT_TYPE,
                cache_control: CACHE_CONTROL_NO_STORE,
                content,
                compressed,
            },
        );
    }
    let Ok((content, compressed)) = store.read_asset("devtools.js") else {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Devtools script unavailable\n",
        )
            .into_response();
    };
    serve_versioned_asset(
        &method,
        &uri,
        &headers,
        APPLICATION_JS_CONTENT_TYPE,
        content,
        compressed,
    )
}

async fn handle_devtools_asset(
    State(store): State<AssetStore>,
    AxumPath(name): AxumPath<String>,
    method: Method,
    headers: HeaderMap,
) -> Response {
    let name_path = Path::new(&name);
    if name.is_empty()
        || name.contains('/')
        || name.contains('\\')
        || name == "."
        || name == ".."
        || name_path.file_name().is_none()
    {
        return not_found_no_store();
    }
    let content_type = match name_path.extension().and_then(|e| e.to_str()) {
        Some("js") => APPLICATION_JS_CONTENT_TYPE,
        Some("woff2") => "font/woff2",
        _ => return not_found_no_store(),
    };
    let Ok((content, compressed)) = store.read_asset(&format!("assets/{name}")) else {
        return not_found_no_store();
    };
    serve_asset(
        &method,
        &headers,
        AssetResponse {
            content_type,
            cache_control: CACHE_CONTROL_IMMUTABLE,
            content,
            compressed,
        },
    )
}

async fn handle_redux_monitor() -> Response {
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CACHE_CONTROL, CACHE_CONTROL_NO_STORE)
        .header(header::CONTENT_TYPE, TEXT_HTML_CONTENT_TYPE)
        .body(Body::from(REDUX_MONITOR_DOCUMENT))
        .expect("redux document")
}

async fn handle_redux_registration(
    State(store): State<AssetStore>,
    method: Method,
    uri: Uri,
    headers: HeaderMap,
) -> Response {
    serve_redux_asset(
        &store,
        &method,
        &uri,
        &headers,
        "redux.js",
        TEXT_JS_CONTENT_TYPE,
    )
}

async fn handle_redux_monitor_script(
    State(store): State<AssetStore>,
    method: Method,
    uri: Uri,
    headers: HeaderMap,
) -> Response {
    serve_redux_asset(
        &store,
        &method,
        &uri,
        &headers,
        "redux-monitor.js",
        TEXT_JS_CONTENT_TYPE,
    )
}

async fn handle_redux_monitor_stylesheet(
    State(store): State<AssetStore>,
    method: Method,
    uri: Uri,
    headers: HeaderMap,
) -> Response {
    serve_redux_asset(
        &store,
        &method,
        &uri,
        &headers,
        "redux-monitor.css",
        TEXT_CSS_CONTENT_TYPE,
    )
}

fn serve_redux_asset(
    store: &AssetStore,
    method: &Method,
    uri: &Uri,
    headers: &HeaderMap,
    filename: &str,
    content_type: &'static str,
) -> Response {
    if !is_allowed_method(method) {
        return (
            StatusCode::METHOD_NOT_ALLOWED,
            [
                (header::CACHE_CONTROL, CACHE_CONTROL_NO_STORE),
                (header::ALLOW, "GET, HEAD"),
            ],
            "Method not allowed\n",
        )
            .into_response();
    }
    if store.dev_source.is_some() {
        let (content, compressed) = match store.check_and_build(filename) {
            Ok(pair) => pair,
            Err(err) => {
                return (
                    StatusCode::SERVICE_UNAVAILABLE,
                    [(header::CACHE_CONTROL, CACHE_CONTROL_NO_STORE)],
                    format!("{err}\n"),
                )
                    .into_response();
            }
        };
        return serve_asset(
            method,
            headers,
            AssetResponse {
                content_type,
                cache_control: CACHE_CONTROL_NO_STORE,
                content,
                compressed,
            },
        );
    }
    let Ok((content, compressed)) = store.read_asset(filename) else {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            [(header::CACHE_CONTROL, CACHE_CONTROL_NO_STORE)],
            "Redux asset unavailable\n",
        )
            .into_response();
    };
    serve_versioned_asset(method, uri, headers, content_type, content, compressed)
}

pub struct AssetResponse {
    pub content_type: &'static str,
    pub cache_control: &'static str,
    pub content: Vec<u8>,
    pub compressed: Option<Vec<u8>>,
}

pub fn asset_version(content: &[u8]) -> String {
    let digest = Sha256::digest(content);
    let mut out = String::with_capacity(digest.len() * 2);
    for byte in digest {
        use std::fmt::Write;
        let _ = write!(out, "{byte:02x}");
    }
    out
}

pub fn serve_versioned_asset(
    method: &Method,
    uri: &Uri,
    headers: &HeaderMap,
    content_type: &'static str,
    content: Vec<u8>,
    compressed: Option<Vec<u8>>,
) -> Response {
    if !is_allowed_method(method) {
        return method_not_allowed();
    }
    let version = asset_version(&content);
    let requested = uri.query().and_then(|q| {
        q.split('&').find_map(|pair| {
            let (k, v) = pair.split_once('=')?;
            (k == "v" && !v.is_empty()).then_some(v)
        })
    });
    match requested {
        None => {
            let mut location = uri.path().to_owned();
            let filtered_params: Vec<&str> = uri
                .query()
                .map(|q| {
                    q.split('&')
                        .filter(|p| !p.is_empty() && *p != "v=" && *p != "v")
                        .collect()
                })
                .unwrap_or_default();
            if filtered_params.is_empty() {
                location.push_str("?v=");
                location.push_str(&version);
            } else {
                location.push('?');
                location.push_str(&filtered_params.join("&"));
                location.push_str("&v=");
                location.push_str(&version);
            }
            Response::builder()
                .status(StatusCode::TEMPORARY_REDIRECT)
                .header(header::CACHE_CONTROL, CACHE_CONTROL_NO_STORE)
                .header(header::LOCATION, location)
                .body(Body::empty())
                .expect("redirect response")
        }
        Some(v) if v != version => not_found_no_store(),
        Some(_) => serve_asset(
            method,
            headers,
            AssetResponse {
                content_type,
                cache_control: CACHE_CONTROL_IMMUTABLE,
                content,
                compressed,
            },
        ),
    }
}

pub fn serve_asset(method: &Method, headers: &HeaderMap, asset: AssetResponse) -> Response {
    if !is_allowed_method(method) {
        return method_not_allowed();
    }
    let accept_values: Vec<&str> = headers
        .get_all(header::ACCEPT_ENCODING)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .collect();
    let has_gzip = asset.compressed.as_ref().is_some_and(|c| !c.is_empty());
    let (encoding, acceptable) = select_asset_encoding(&accept_values, has_gzip);
    if !acceptable {
        return (
            StatusCode::NOT_ACCEPTABLE,
            [
                (header::VARY, "Accept-Encoding"),
                (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
                (header::CACHE_CONTROL, CACHE_CONTROL_NO_STORE),
            ],
            "No acceptable content encoding\n",
        )
            .into_response();
    }

    let payload = if encoding == Some("gzip") {
        asset.compressed.unwrap_or_default()
    } else {
        asset.content
    };
    let etag = format!("\"{}\"", asset_version(&payload));

    let not_modified = headers
        .get(header::IF_NONE_MATCH)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|hdr| etag_matches(hdr, &etag));

    let mut builder = Response::builder()
        .header(header::VARY, "Accept-Encoding")
        .header(header::CACHE_CONTROL, asset.cache_control)
        .header(header::CONTENT_TYPE, asset.content_type)
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .header(header::ETAG, &etag);
    if let Some(enc) = encoding {
        builder = builder.header(header::CONTENT_ENCODING, enc);
    }

    if not_modified {
        return builder
            .status(StatusCode::NOT_MODIFIED)
            .body(Body::empty())
            .expect("304 response");
    }

    let len = payload.len();
    let body = if *method == Method::HEAD {
        Body::empty()
    } else {
        Body::from(payload)
    };
    builder = builder.header(header::CONTENT_LENGTH, len.to_string());
    builder
        .status(StatusCode::OK)
        .body(body)
        .expect("asset response")
}

pub fn select_asset_encoding(headers: &[&str], has_gzip: bool) -> (Option<&'static str>, bool) {
    let mut qualities: BTreeMap<String, f64> = BTreeMap::new();
    for raw in headers {
        for item in raw.split(',') {
            let (coding, params) = match item.split_once(';') {
                Some((c, p)) => (c, p),
                None => (item, ""),
            };
            let mut quality = 1.0_f64;
            for param in params.split(';') {
                let Some((k, v)) = param.trim().split_once('=') else {
                    continue;
                };
                if !k.eq_ignore_ascii_case("q") {
                    continue;
                }
                let trimmed = v.trim();
                quality = if valid_qvalue(trimmed) {
                    trimmed.parse::<f64>().unwrap_or(0.0)
                } else {
                    0.0
                };
            }
            qualities.insert(coding.trim().to_ascii_lowercase(), quality);
        }
    }

    let gzip_quality = qualities
        .get("gzip")
        .copied()
        .or_else(|| qualities.get("*").copied())
        .unwrap_or(0.0);
    let identity_quality = match qualities.get("identity").copied() {
        Some(q) => q,
        None if qualities.get("*").copied() == Some(0.0) => 0.0,
        None => 1.0,
    };
    if has_gzip && gzip_quality > 0.0 && gzip_quality >= identity_quality {
        (Some("gzip"), true)
    } else {
        (None, identity_quality > 0.0)
    }
}

fn valid_qvalue(value: &str) -> bool {
    if value == "0" || value == "1" {
        return true;
    }
    if let Some(frac) = value.strip_prefix("0.") {
        return frac.len() <= 3 && frac.bytes().all(|b| b.is_ascii_digit());
    }
    if let Some(frac) = value.strip_prefix("1.") {
        return frac.len() <= 3 && frac.bytes().all(|b| b == b'0');
    }
    false
}

fn etag_matches(header_value: &str, etag: &str) -> bool {
    header_value.split(',').any(|candidate| {
        let trimmed = candidate.trim();
        trimmed == "*" || trimmed == etag || trimmed.strip_prefix("W/") == Some(etag)
    })
}

fn is_allowed_method(method: &Method) -> bool {
    *method == Method::GET || *method == Method::HEAD
}

fn method_not_allowed() -> Response {
    (
        StatusCode::METHOD_NOT_ALLOWED,
        [(header::ALLOW, "GET, HEAD")],
        "Method not allowed\n",
    )
        .into_response()
}

fn not_found_no_store() -> Response {
    let mut response = (StatusCode::NOT_FOUND, "404 page not found\n").into_response();
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static(CACHE_CONTROL_NO_STORE),
    );
    response
}
