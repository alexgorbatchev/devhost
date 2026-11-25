mod confined;
mod content;

use std::{fs::File, io::Read, path::Path};

use axum::{
    body::Body,
    http::{HeaderMap, Method, StatusCode, Uri, header},
    response::{IntoResponse, Response},
};
use cap_std::fs::Dir;

use crate::statuspage::{self, FileLink, FilePage, Page};
use confined::ConfinedRoot;

#[derive(Debug, Clone)]
pub struct FileHandler {
    root: ConfinedRoot,
}

impl FileHandler {
    pub fn open(directory: &Path) -> Result<Self, String> {
        Ok(Self {
            root: ConfinedRoot::open(directory)?,
        })
    }

    pub fn serve(&self, method: &Method, uri: &Uri, strip_prefix: &str) -> Response {
        self.serve_with_headers(method, uri, &HeaderMap::new(), strip_prefix)
    }

    pub fn serve_with_headers(
        &self,
        method: &Method,
        uri: &Uri,
        headers: &HeaderMap,
        strip_prefix: &str,
    ) -> Response {
        if *method != Method::GET && *method != Method::HEAD {
            return (
                StatusCode::METHOD_NOT_ALLOWED,
                [
                    (header::ALLOW, "GET, HEAD"),
                    (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
                ],
                "Method not allowed\n",
            )
                .into_response();
        }
        let raw_path = uri.path();
        let Some(decoded_path) = percent_decode_path(raw_path) else {
            return not_found();
        };
        let Some(rest) = decoded_path.strip_prefix(strip_prefix) else {
            return not_found();
        };
        let req_path = if rest.starts_with('/') {
            rest.to_owned()
        } else {
            format!("/{rest}")
        };
        let name = req_path.strip_prefix('/').unwrap_or(&req_path);
        let name = name.strip_suffix('/').unwrap_or(name);
        let name = if name.is_empty() { "." } else { name };
        let Some(file) = self.root.open_file(name) else {
            return not_found();
        };
        let Ok(metadata) = file.metadata() else {
            return not_found();
        };
        if metadata.is_dir() {
            if !req_path.ends_with('/') {
                let mut target = format!("{raw_path}/");
                if let Some(query) = uri.query() {
                    target.push('?');
                    target.push_str(query);
                }
                let escaped = target
                    .replace('&', "&amp;")
                    .replace('<', "&lt;")
                    .replace('>', "&gt;")
                    .replace('"', "&#34;")
                    .replace('\'', "&#39;");
                let body = if *method == Method::HEAD {
                    Body::empty()
                } else {
                    Body::from(format!("<a href=\"{escaped}\">Moved Permanently</a>.\n\n"))
                };
                return Response::builder()
                    .status(StatusCode::MOVED_PERMANENTLY)
                    .header(header::CACHE_CONTROL, "no-cache")
                    .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
                    .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
                    .header(header::LOCATION, target)
                    .body(body)
                    .expect("redirect response");
            }
            return self.serve_directory(method, headers, &req_path, name, file);
        }
        if req_path.ends_with('/') {
            return not_found();
        }
        self.serve_file(method, headers, &req_path, file, name)
    }

    fn serve_directory(
        &self,
        method: &Method,
        headers: &HeaderMap,
        req_path: &str,
        dir_name: &str,
        directory: File,
    ) -> Response {
        let child_name = |entry: &str| {
            if dir_name == "." {
                entry.to_owned()
            } else {
                format!("{dir_name}/{entry}")
            }
        };
        for index in ["index.html", "index.md", "README.md", "readme.md"] {
            if let Some(candidate) = self.root.open_file(&child_name(index))
                && candidate
                    .metadata()
                    .is_ok_and(|metadata| metadata.is_file())
            {
                return self.serve_file(method, headers, req_path, candidate, index);
            }
        }
        let directory = Dir::from_std_file(directory);
        let Ok(read_dir) = directory.entries() else {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Could not read directory\n",
            )
                .into_response();
        };
        let mut names: Vec<String> = read_dir
            .filter_map(Result::ok)
            .filter_map(|entry| entry.file_name().into_string().ok())
            .collect();
        names.sort();
        let mut entries = Vec::new();
        for mut name in names {
            let Some(file) = self.root.open_file(&child_name(&name)) else {
                continue;
            };
            let Ok(metadata) = file.metadata() else {
                continue;
            };
            let mut href = encode_path_segment(&name);
            if metadata.is_dir() {
                name.push('/');
                href.push('/');
            }
            entries.push(FileLink { name, href });
        }
        render_file_document(
            method,
            headers,
            req_path,
            FilePage {
                breadcrumbs: Vec::new(),
                markdown: false,
                source: String::new(),
                entries,
            },
        )
    }

    fn serve_file(
        &self,
        method: &Method,
        headers: &HeaderMap,
        req_path: &str,
        mut file: File,
        name: &str,
    ) -> Response {
        if Path::new(name)
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
        {
            let mut bytes = Vec::new();
            if file.read_to_end(&mut bytes).is_err() {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Could not read document\n",
                )
                    .into_response();
            }
            return render_file_document(
                method,
                headers,
                req_path,
                FilePage {
                    breadcrumbs: Vec::new(),
                    markdown: true,
                    source: String::from_utf8_lossy(&bytes).into_owned(),
                    entries: Vec::new(),
                },
            );
        }
        content::serve_file(method, headers, file, name).unwrap_or_else(not_found)
    }
}

fn render_file_document(
    method: &Method,
    headers: &HeaderMap,
    req_path: &str,
    mut files: FilePage,
) -> Response {
    files.breadcrumbs = breadcrumbs(req_path);
    let title = if files.markdown {
        req_path
    } else {
        "Directory listing"
    };
    let mut page = Page::basic("files", 200, title, "");
    page.files = Some(files);
    let Ok(html) = statuspage::render(&page, "") else {
        return (StatusCode::INTERNAL_SERVER_ERROR, "Could not render page\n").into_response();
    };
    content::serve_document(method, headers, html)
}

pub fn breadcrumbs(request_path: &str) -> Vec<FileLink> {
    let mut crumbs = vec![FileLink {
        name: "devhost".to_owned(),
        href: "/".to_owned(),
    }];
    let mut prefix = "/".to_owned();
    for part in request_path.trim_matches('/').split('/') {
        if part.is_empty() {
            continue;
        }
        prefix.push_str(&encode_path_segment(part));
        prefix.push('/');
        crumbs.push(FileLink {
            name: part.to_owned(),
            href: prefix.clone(),
        });
    }
    if let Some(last) = crumbs.last_mut() {
        last.href.clear();
    }
    crumbs
}

fn not_found() -> Response {
    (
        StatusCode::NOT_FOUND,
        [
            (header::CACHE_CONTROL, "no-cache"),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
        ],
        "404 page not found\n",
    )
        .into_response()
}

fn percent_decode_path(raw: &str) -> Option<String> {
    let bytes = raw.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let hex = std::str::from_utf8(bytes.get(index + 1..index + 3)?).ok()?;
            let decoded = u8::from_str_radix(hex, 16).ok()?;
            if decoded == 0 {
                return None;
            }
            out.push(decoded);
            index += 3;
        } else {
            if bytes[index] == 0 {
                return None;
            }
            out.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(out).ok()
}

fn encode_path_segment(segment: &str) -> String {
    let mut out = String::with_capacity(segment.len());
    for byte in segment.bytes() {
        match byte {
            b'A'..=b'Z'
            | b'a'..=b'z'
            | b'0'..=b'9'
            | b'-'
            | b'_'
            | b'.'
            | b'~'
            | b'$'
            | b'&'
            | b'+'
            | b':'
            | b'='
            | b'@' => out.push(byte as char),
            other => {
                out.push('%');
                out.push_str(&format!("{other:02X}"));
            }
        }
    }
    out
}
