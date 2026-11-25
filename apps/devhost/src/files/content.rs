use std::{
    fs::File,
    io::{Read, Seek},
    ops::Range,
    pin::Pin,
    time::{SystemTime, UNIX_EPOCH},
};

use axum::{
    body::{Body, Bytes},
    http::{HeaderMap, HeaderValue, Method, StatusCode, header},
    response::Response,
};
use futures_util::{Stream, StreamExt, stream};
use http_range::{HttpRange, HttpRangeParseError};
use http_serve::{BoxError, ChunkedReadFile, Entity};
use mime_sniffer::MimeTypeSniffer;

enum Content {
    File(ChunkedReadFile<Bytes, BoxError>),
    Document(Bytes),
}

struct FileContent {
    content: Content,
    content_type: HeaderValue,
}

impl FileContent {
    fn len(&self) -> u64 {
        match &self.content {
            Content::File(file) => file.len(),
            Content::Document(bytes) => bytes.len() as u64,
        }
    }
    fn get_range(
        &self,
        range: Range<u64>,
    ) -> Pin<Box<dyn Stream<Item = Result<Bytes, BoxError>> + Send + Sync>> {
        match &self.content {
            Content::File(file) => file.get_range(range),
            Content::Document(bytes) => {
                let bytes = bytes.slice(range.start as usize..range.end as usize);
                Box::pin(stream::once(async move { Ok(bytes) }))
            }
        }
    }
    fn last_modified(&self) -> Option<SystemTime> {
        let Content::File(file) = &self.content else {
            return None;
        };
        // Truncate modification times to HTTP-date second precision so conditional
        // requests compare consistently across sub-second filesystem ticks.
        let seconds = file
            .last_modified()?
            .duration_since(UNIX_EPOCH)
            .ok()?
            .as_secs();
        Some(UNIX_EPOCH + std::time::Duration::from_secs(seconds))
    }
}

pub(super) fn serve_file(
    method: &Method,
    headers: &HeaderMap,
    mut file: File,
    name: &str,
) -> Option<Response> {
    let content_type = content_type_for(name, &mut file)?;
    let content = Content::File(ChunkedReadFile::new(file, HeaderMap::new()).ok()?);
    Some(serve(method, headers, content, content_type))
}

pub(super) fn serve_document(method: &Method, headers: &HeaderMap, html: String) -> Response {
    serve(
        method,
        headers,
        Content::Document(Bytes::from(html)),
        HeaderValue::from_static("text/html; charset=utf-8"),
    )
}

fn serve(
    method: &Method,
    headers: &HeaderMap,
    content: Content,
    content_type: HeaderValue,
) -> Response {
    let entity = FileContent {
        content,
        content_type,
    };
    let modified = entity.last_modified();
    let mut response = Response::builder()
        .header(header::CACHE_CONTROL, "no-cache")
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff");
    if let Some(modified) = modified {
        response = response.header(header::LAST_MODIFIED, httpdate::fmt_http_date(modified));
    }
    if let Some(status) = precondition(headers, modified) {
        return response
            .status(status)
            .body(Body::empty())
            .expect("conditional response");
    }
    let length = entity.len();
    let ranges = match requested_ranges(headers, modified, length) {
        Ok(ranges) => ranges,
        Err(error) => {
            let (message, content_range) = match error {
                HttpRangeParseError::NoOverlap => (
                    "invalid range: failed to overlap\n",
                    Some(format!("bytes */{length}")),
                ),
                HttpRangeParseError::InvalidRange => ("invalid range\n", None),
            };
            if let Some(value) = content_range {
                response = response.header(header::CONTENT_RANGE, value);
            }
            let mut response = response
                .status(StatusCode::RANGE_NOT_SATISFIABLE)
                .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
                .header(header::CONTENT_LENGTH, message.len())
                .body(if *method == Method::HEAD {
                    Body::empty()
                } else {
                    Body::from(message)
                })
                .expect("range error response");
            response.headers_mut().remove(header::CACHE_CONTROL);
            response.headers_mut().remove(header::LAST_MODIFIED);
            return response;
        }
    };
    response = response.header(header::ACCEPT_RANGES, "bytes");
    if ranges.len() > 1 {
        return serve_multipart(method, response, &entity, &ranges);
    }
    let range = if let Some(range) = ranges.first() {
        response = response.status(StatusCode::PARTIAL_CONTENT).header(
            header::CONTENT_RANGE,
            format!("bytes {}-{}/{length}", range.start, inclusive_end(range)),
        );
        range.start..range.start + range.length
    } else {
        0..length
    };
    response
        .header(header::CONTENT_TYPE, entity.content_type.clone())
        .header(header::CONTENT_LENGTH, range.end - range.start)
        .body(if *method == Method::HEAD {
            Body::empty()
        } else {
            Body::from_stream(entity.get_range(range))
        })
        .expect("file response")
}

fn header_text(headers: &HeaderMap, name: header::HeaderName) -> &str {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
}

fn header_date(headers: &HeaderMap, name: header::HeaderName) -> Option<SystemTime> {
    httpdate::parse_http_date(header_text(headers, name)).ok()
}

// Files have Last-Modified but no entity tag, just as net/http.ServeContent
// does when its caller hasn't supplied an ETag. Preserve condition ordering.
fn precondition(headers: &HeaderMap, modified: Option<SystemTime>) -> Option<StatusCode> {
    let if_match = header_text(headers, header::IF_MATCH);
    if !if_match.is_empty() {
        if !if_match.trim_start().starts_with('*') {
            return Some(StatusCode::PRECONDITION_FAILED);
        }
    } else if let (Some(modified), Some(date)) =
        (modified, header_date(headers, header::IF_UNMODIFIED_SINCE))
        && modified > date
    {
        return Some(StatusCode::PRECONDITION_FAILED);
    }
    let if_none_match = header_text(headers, header::IF_NONE_MATCH);
    if !if_none_match.is_empty() {
        if if_none_match.trim_start().starts_with('*') {
            return Some(StatusCode::NOT_MODIFIED);
        }
    } else if let (Some(modified), Some(date)) =
        (modified, header_date(headers, header::IF_MODIFIED_SINCE))
        && modified <= date
    {
        return Some(StatusCode::NOT_MODIFIED);
    }
    None
}

fn requested_ranges(
    headers: &HeaderMap,
    modified: Option<SystemTime>,
    length: u64,
) -> Result<Vec<HttpRange>, HttpRangeParseError> {
    let range = header_text(headers, header::RANGE);
    let if_range = header_text(headers, header::IF_RANGE);
    if !if_range.is_empty()
        && (modified.is_none() || header_date(headers, header::IF_RANGE) != modified)
    {
        return Ok(Vec::new());
    }
    if !range.is_empty() && !range.starts_with("bytes=") {
        return Err(HttpRangeParseError::InvalidRange);
    }
    if let Some(value) = range.strip_prefix("bytes=") {
        for number in value
            .split([',', '-'])
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            if number.parse::<i64>().is_err() {
                return Err(HttpRangeParseError::InvalidRange);
            }
        }
    }
    let normalized = range.replace('+', "");
    let ranges = match HttpRange::parse(&normalized, length) {
        Err(HttpRangeParseError::NoOverlap) if length == 0 => return Ok(Vec::new()),
        result => result?,
    };
    // Ignore a range set whose combined content exceeds the representation.
    if ranges
        .iter()
        .try_fold(0_u64, |sum, range| sum.checked_add(range.length))
        .is_none_or(|sum| sum > length)
    {
        return Ok(Vec::new());
    }
    Ok(ranges)
}

type ContentStream = Pin<Box<dyn Stream<Item = Result<Bytes, BoxError>> + Send + Sync>>;

fn bytes_stream(bytes: Bytes) -> ContentStream {
    Box::pin(stream::once(async move { Ok(bytes) }))
}

fn inclusive_end(range: &HttpRange) -> i128 {
    i128::from(range.start) + i128::from(range.length) - 1
}

fn serve_multipart(
    method: &Method,
    response: axum::http::response::Builder,
    entity: &FileContent,
    ranges: &[HttpRange],
) -> Response {
    let mut random = [0_u8; 30];
    if getrandom::fill(&mut random).is_err() {
        return Response::builder()
            .status(StatusCode::INTERNAL_SERVER_ERROR)
            .body(Body::empty())
            .expect("multipart entropy error");
    }
    let boundary: String = random.iter().map(|byte| format!("{byte:02x}")).collect();
    let mut parts = Vec::new();
    let mut length = 0;
    for range in ranges {
        let prefix = Bytes::from(format!(
            "--{boundary}\r\nContent-Range: bytes {}-{}/{}\r\nContent-Type: {}\r\n\r\n",
            range.start,
            inclusive_end(range),
            entity.len(),
            entity.content_type.to_str().expect("valid MIME type")
        ));
        length += prefix.len() as u64 + range.length + 2;
        parts.push(bytes_stream(prefix));
        parts.push(entity.get_range(range.start..range.start + range.length));
        parts.push(bytes_stream(Bytes::from_static(b"\r\n")));
    }
    let ending = Bytes::from(format!("--{boundary}--\r\n"));
    length += ending.len() as u64;
    parts.push(bytes_stream(ending));
    response
        .status(StatusCode::PARTIAL_CONTENT)
        .header(
            header::CONTENT_TYPE,
            format!("multipart/byteranges; boundary={boundary}"),
        )
        .header(header::CONTENT_LENGTH, length)
        .body(if *method == Method::HEAD {
            Body::empty()
        } else {
            Body::from_stream(stream::iter(parts).flatten())
        })
        .expect("multipart file response")
}

fn content_type_for(name: &str, file: &mut File) -> Option<HeaderValue> {
    let guessed = mime_guess::from_path(name).first_raw();
    let content_type = if let Some(value) = guessed {
        value.to_owned()
    } else {
        let mut prefix = [0; 512];
        let count = file.read(&mut prefix).ok()?;
        file.rewind().ok()?;
        let prefix = &prefix[..count];
        if prefix.starts_with(b"\xFE\xFF") {
            "text/plain; charset=utf-16be".to_owned()
        } else if prefix.starts_with(b"\xFF\xFE") {
            "text/plain; charset=utf-16le".to_owned()
        } else {
            prefix
                .sniff_mime_type()
                .unwrap_or_else(|| {
                    if prefix
                        .iter()
                        .any(|byte| matches!(byte, 0..=8 | 11 | 14..=26 | 28..=31))
                    {
                        "application/octet-stream"
                    } else {
                        "text/plain"
                    }
                })
                .to_owned()
        }
    };
    let content_type = if content_type.starts_with("text/") && !content_type.contains("charset=") {
        format!("{content_type}; charset=utf-8")
    } else {
        content_type
    };
    HeaderValue::from_str(&content_type).ok()
}
