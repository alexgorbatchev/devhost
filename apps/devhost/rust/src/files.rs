use std::{
    fs::{self, Metadata},
    path::{Component, Path, PathBuf},
};

use axum::{
    body::Body,
    http::{Method, StatusCode, Uri, header},
    response::{IntoResponse, Response},
};

use crate::statuspage::{self, FileLink, FilePage, Page};

const MAX_SYMLINK_DEPTH: usize = 40;

#[derive(Debug, Clone)]
pub struct FileHandler {
    root: PathBuf,
}

impl FileHandler {
    pub fn open(directory: &Path) -> Result<Self, String> {
        let canonical = fs::canonicalize(directory)
            .map_err(|err| format!("resolve served directory {}: {err}", directory.display()))?;
        let meta = fs::metadata(&canonical)
            .map_err(|err| format!("open served directory {}: {err}", canonical.display()))?;
        if !meta.is_dir() {
            return Err(format!(
                "open served directory {}: not a directory",
                canonical.display()
            ));
        }
        Ok(Self { root: canonical })
    }

    pub fn serve(&self, method: &Method, uri: &Uri, strip_prefix: &str) -> Response {
        if *method != Method::GET && *method != Method::HEAD {
            return (
                StatusCode::METHOD_NOT_ALLOWED,
                [(header::ALLOW, "GET, HEAD")],
                "Method not allowed\n",
            )
                .into_response();
        }
        let raw_path = uri.path();
        let Some(decoded_path) = percent_decode_path(raw_path) else {
            return not_found();
        };
        let req_path = decoded_path
            .strip_prefix(strip_prefix)
            .map(|rest| {
                if rest.starts_with('/') {
                    rest.to_owned()
                } else {
                    format!("/{rest}")
                }
            })
            .unwrap_or_else(|| "/".to_owned());

        let name = req_path.trim_matches('/');
        let name = if name.is_empty() { "." } else { name };
        let Some((resolved, meta)) = self.open_confined(name) else {
            return not_found();
        };

        if meta.is_dir() {
            if !req_path.ends_with('/') {
                let mut target = format!("{raw_path}/");
                if let Some(query) = uri.query() {
                    target.push('?');
                    target.push_str(query);
                }
                return Response::builder()
                    .status(StatusCode::MOVED_PERMANENTLY)
                    .header(header::CACHE_CONTROL, "no-cache")
                    .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
                    .header(header::LOCATION, target)
                    .body(Body::empty())
                    .expect("redirect response");
            }
            return self.serve_directory(method, &req_path, name, &resolved);
        }
        if req_path.ends_with('/') {
            return not_found();
        }
        self.serve_file(method, &req_path, &resolved, name)
    }

    fn open_confined(&self, name: &str) -> Option<(PathBuf, Metadata)> {
        if !is_visible(name) {
            return None;
        }
        let mut current = self.root.clone();
        let mut pending: Vec<String> = if name == "." {
            Vec::new()
        } else {
            name.split('/').map(str::to_owned).collect()
        };
        let mut idx = 0usize;
        let mut links = 0usize;
        while idx < pending.len() {
            let part = pending[idx].clone();
            idx += 1;
            match part.as_str() {
                "" | "." => continue,
                ".." => {
                    if current == self.root {
                        return None;
                    }
                    current.pop();
                    continue;
                }
                _ => {}
            }
            if part.starts_with('.') {
                return None;
            }
            current.push(&part);
            let meta = fs::symlink_metadata(&current).ok()?;
            if meta.file_type().is_symlink() {
                links += 1;
                if links > MAX_SYMLINK_DEPTH {
                    return None;
                }
                let target = fs::read_link(&current).ok()?;
                current.pop();
                let rel_parts: Vec<String> = if target.is_absolute() {
                    let rest = target.strip_prefix(&self.root).ok()?;
                    current = self.root.clone();
                    rest.components()
                        .filter_map(|c| match c {
                            Component::ParentDir => Some("..".to_owned()),
                            Component::Normal(s) => Some(s.to_string_lossy().into_owned()),
                            _ => None,
                        })
                        .collect()
                } else {
                    target
                        .components()
                        .filter_map(|c| match c {
                            Component::ParentDir => Some("..".to_owned()),
                            Component::Normal(s) => Some(s.to_string_lossy().into_owned()),
                            _ => None,
                        })
                        .collect()
                };
                let mut rest = rel_parts;
                rest.extend(pending.drain(idx..));
                pending = rest;
                idx = 0;
                continue;
            }
            if idx < pending.len() && !meta.is_dir() {
                return None;
            }
        }
        let meta = fs::metadata(&current).ok()?;
        if !meta.is_dir() && !meta.is_file() {
            return None;
        }
        Some((current, meta))
    }

    fn serve_directory(
        &self,
        method: &Method,
        req_path: &str,
        dir_name: &str,
        dir: &Path,
    ) -> Response {
        let child_name = |entry: &str| {
            if dir_name == "." {
                entry.to_owned()
            } else {
                format!("{dir_name}/{entry}")
            }
        };
        for index in ["index.html", "index.md", "README.md", "readme.md"] {
            if let Some((candidate, meta)) = self.open_confined(&child_name(index))
                && meta.is_file()
            {
                return self.serve_file(method, req_path, &candidate, index);
            }
        }
        let Ok(read_dir) = fs::read_dir(dir) else {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Could not read directory\n",
            )
                .into_response();
        };
        let mut names: Vec<String> = Vec::new();
        for entry in read_dir.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') {
                continue;
            }
            names.push(name);
        }
        names.sort();
        let mut entries = Vec::new();
        for name in names {
            let Some((_, meta)) = self.open_confined(&child_name(&name)) else {
                continue;
            };
            let mut label = name;
            let mut href = encode_path_segment(&label);
            if meta.is_dir() {
                label.push('/');
                href.push('/');
            }
            entries.push(FileLink { name: label, href });
        }
        let page = FilePage {
            breadcrumbs: Vec::new(),
            markdown: false,
            source: String::new(),
            entries,
        };
        render_file_document(method, req_path, page)
    }

    fn serve_file(
        &self,
        method: &Method,
        req_path: &str,
        file_path: &Path,
        name: &str,
    ) -> Response {
        if name
            .rsplit('.')
            .next()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("md"))
        {
            let Ok(source) = fs::read_to_string(file_path) else {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Could not read document\n",
                )
                    .into_response();
            };
            let page = FilePage {
                breadcrumbs: Vec::new(),
                markdown: true,
                source,
                entries: Vec::new(),
            };
            return render_file_document(method, req_path, page);
        }
        let Ok(bytes) = fs::read(file_path) else {
            return not_found();
        };
        let content_type = content_type_for(name);
        let body = if *method == Method::HEAD {
            Body::empty()
        } else {
            Body::from(bytes)
        };
        Response::builder()
            .status(StatusCode::OK)
            .header(header::CACHE_CONTROL, "no-cache")
            .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
            .header(header::CONTENT_TYPE, content_type)
            .body(body)
            .expect("file response")
    }
}

fn render_file_document(method: &Method, req_path: &str, mut files: FilePage) -> Response {
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
    let body = if *method == Method::HEAD {
        Body::empty()
    } else {
        Body::from(html)
    };
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CACHE_CONTROL, "no-cache")
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
        .body(body)
        .expect("file document response")
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
    let mut idx = 0usize;
    while idx < bytes.len() {
        if bytes[idx] == b'%' {
            if idx + 2 >= bytes.len() {
                return None;
            }
            let hex = std::str::from_utf8(&bytes[idx + 1..idx + 3]).ok()?;
            let decoded = u8::from_str_radix(hex, 16).ok()?;
            if decoded == 0 {
                return None;
            }
            out.push(decoded);
            idx += 3;
        } else {
            if bytes[idx] == 0 {
                return None;
            }
            out.push(bytes[idx]);
            idx += 1;
        }
    }
    String::from_utf8(out).ok()
}

fn is_visible(name: &str) -> bool {
    if name == "." {
        return true;
    }
    if name.contains('\0') || name.starts_with('/') {
        return false;
    }
    !name.split('/').any(|part| part.starts_with('.'))
}

fn encode_path_segment(segment: &str) -> String {
    let mut out = String::with_capacity(segment.len());
    for byte in segment.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char);
            }
            other => {
                out.push('%');
                out.push_str(&format!("{other:02X}"));
            }
        }
    }
    out
}

fn content_type_for(name: &str) -> &'static str {
    let ext = name
        .rsplit('.')
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    match ext.as_str() {
        "html" | "htm" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "json" => "application/json; charset=utf-8",
        "txt" | "toml" | "yaml" | "yml" => "text/plain; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "woff2" => "font/woff2",
        _ => "application/octet-stream",
    }
}
