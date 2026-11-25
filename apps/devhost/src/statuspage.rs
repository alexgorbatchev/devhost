use serde::{Deserialize, Serialize};

pub const PAGE_CSS: &str = include_str!("../dist/statuspage/statusPages.css");
const PAGE_SCRIPT: &str = include_str!("../dist/statuspage/statusPages.js");
const THEME_SCRIPT: &str = include_str!("../assets/statuspage/theme.js");

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct RouteLink {
    pub host: String,
    pub url: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct FileLink {
    pub name: String,
    pub href: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct FilePage {
    pub breadcrumbs: Vec<FileLink>,
    pub markdown: bool,
    pub source: String,
    #[serde(serialize_with = "serialize_entries")]
    pub entries: Vec<FileLink>,
}

fn serialize_entries<S: serde::Serializer>(
    entries: &[FileLink],
    serializer: S,
) -> Result<S::Ok, S::Error> {
    if entries.is_empty() {
        serializer.serialize_none()
    } else {
        entries.serialize(serializer)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryRepoFallback {
    pub name: String,
    pub selected_path: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub blocked_reason: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub error: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryFallback {
    pub service: String,
    pub address: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub logs: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub repositories: Vec<RecoveryRepoFallback>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct StackService {
    pub name: String,
    pub directory: String,
    #[serde(deserialize_with = "null_list")]
    pub urls: Vec<String>,
    pub status: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct StackConfig {
    pub path: String,
    pub kind: String,
    pub content: String,
    pub error: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Stack {
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub id: String,
    pub name: String,
    pub pid: i32,
    pub manifest_path: String,
    pub directory: String,
    pub started_at: String,
    #[serde(deserialize_with = "null_list")]
    pub services: Vec<StackService>,
    #[serde(deserialize_with = "null_list")]
    pub configs: Vec<StackConfig>,
    pub error: String,
}

// Accept null lists from older supervisor directory replies as empty vectors.
fn null_list<'de, D: serde::Deserializer<'de>, T: Deserialize<'de>>(
    deserializer: D,
) -> Result<Vec<T>, D::Error> {
    Ok(Option::<Vec<T>>::deserialize(deserializer)?.unwrap_or_default())
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Page {
    pub kind: String,
    pub status: u16,
    pub title: String,
    pub message: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub routes: Vec<RouteLink>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recovery: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub stacks: Vec<Stack>,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub query: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub files: Option<FilePage>,
}

impl Page {
    pub fn basic(kind: &str, status: u16, title: &str, message: &str) -> Self {
        Self {
            kind: kind.to_owned(),
            status,
            title: title.to_owned(),
            message: message.to_owned(),
            routes: Vec::new(),
            recovery: None,
            stacks: Vec::new(),
            query: String::new(),
            files: None,
        }
    }
}

pub fn not_found_page(routes: Vec<RouteLink>, stylesheet_url: &str) -> Result<String, String> {
    let mut page = Page::basic(
        "not-found",
        404,
        "No active devhost route matched this hostname.",
        "The request reached the managed devhost Caddy instance, but this hostname is not currently mapped to an active route. If you expected an app here, check that the stack is running and that the service has claimed the correct host.",
    );
    page.routes = routes;
    render(&page, stylesheet_url)
}

pub fn stack_directory(stacks: Vec<Stack>, query: &str) -> Result<String, String> {
    let message = if stacks.is_empty() {
        if query.is_empty() {
            "No stacks running. Start a project with devhost start, then refresh this page."
        } else {
            "No matching stacks. Try another name, URL, or path."
        }
    } else {
        "Open a service URL or expand its configuration below. Refresh to update."
    };
    let mut page = Page::basic("stacks", 200, "Running stacks", message);
    page.stacks = stacks;
    page.query = query.to_owned();
    render(&page, "")
}

pub fn render(page: &Page, stylesheet_url: &str) -> Result<String, String> {
    let page_json = serialize_json_for_script(page)?;
    let script = PAGE_SCRIPT.replace("</", "<\\/");
    let mut out = String::with_capacity(PAGE_SCRIPT.len() + 4096);

    out.push_str("<!doctype html>\n<html lang=\"en\">\n  <head>\n    <meta charset=\"utf-8\" />\n    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />\n    <title>");
    push_html_escaped(&mut out, &page.title);
    out.push_str(" · devhost</title>\n    <script>\n      ");
    out.push_str(THEME_SCRIPT);
    out.push_str("\n    </script>\n    ");
    if stylesheet_url.is_empty() {
        out.push_str("\n    <style>\n      ");
        out.push_str(PAGE_CSS);
        out.push_str("\n    </style>\n    ");
    } else {
        out.push_str("\n    <link rel=\"stylesheet\" href=\"");
        push_html_escaped(&mut out, stylesheet_url);
        out.push_str("\" />\n    ");
    }
    out.push_str("\n  </head>\n  <body data-devhost-recovery=\"");
    push_html_escaped(&mut out, &page.kind);
    out.push_str("\">\n    <div id=\"devhost-status\">\n      ");
    if let Some(files) = page.files.as_ref().filter(|f| f.markdown) {
        out.push_str("\n      <noscript>\n        <main>\n          <p>devhost · ");
        out.push_str(&page.status.to_string());
        out.push_str("</p>\n          <h1>");
        push_html_escaped(&mut out, &page.title);
        out.push_str("</h1>\n          <pre><code>");
        push_html_escaped(&mut out, &files.source);
        out.push_str("</code></pre>\n        </main>\n      </noscript>\n      ");
    } else {
        out.push_str("\n      <main>\n        <p>devhost · ");
        out.push_str(&page.status.to_string());
        out.push_str("</p>\n        <h1>");
        push_html_escaped(&mut out, &page.title);
        out.push_str("</h1>\n        <p>");
        push_html_escaped(&mut out, &page.message);
        out.push_str("</p>\n        ");
        if let Some(files) = &page.files {
            out.push_str("\n        <ul>\n          ");
            for entry in &files.entries {
                out.push_str("\n          <li><a href=\"");
                push_html_escaped(&mut out, &entry.href);
                out.push_str("\">");
                push_html_escaped(&mut out, &entry.name);
                out.push_str("</a></li>\n          ");
            }
            out.push_str("\n        </ul>\n        ");
        }
        out.push(' ');
        if page.kind == "not-found" {
            out.push_str("\n        <h2>Active hostnames</h2>\n        <ul>\n          ");
            if page.routes.is_empty() {
                out.push_str("\n          <li>\n            No devhost hostnames are active right now. Start a stack and the available hostnames will appear here.\n          </li>\n          ");
            } else {
                for route in &page.routes {
                    out.push_str("\n          <li>\n            <a href=\"");
                    push_html_escaped(&mut out, &route.url);
                    out.push_str("\"><span>");
                    push_html_escaped(&mut out, &route.host);
                    out.push_str("</span></a>\n          </li>\n          ");
                }
            }
            out.push_str("\n        </ul>\n        ");
        }
        out.push(' ');
        if let Some(recovery) = &page.recovery {
            render_recovery_fallback(&mut out, recovery);
        }
        out.push_str("\n      </main>\n      ");
    }
    out.push_str(
        "\n    </div>\n    <script id=\"devhost-status-data\" type=\"application/json\">\n      ",
    );
    out.push_str(&page_json);
    out.push_str("\n    </script>\n    <script>\n      ");
    out.push_str(&script);
    out.push_str("\n    </script>\n  </body>\n</html>\n");
    Ok(out)
}

fn render_recovery_fallback(out: &mut String, recovery: &serde_json::Value) {
    let service = recovery
        .get("service")
        .and_then(|v| v.as_str())
        .unwrap_or_default();
    let address = recovery
        .get("address")
        .and_then(|v| v.as_str())
        .unwrap_or_default();
    out.push_str("\n        <p>Service: ");
    push_html_escaped(out, service);
    out.push_str(" · ");
    push_html_escaped(out, address);
    out.push_str("</p>\n        <p>\n          JavaScript is needed for live status, Restart and Switch worktree controls. Refresh this page after the\n          service is ready.\n        </p>\n        ");
    if let Some(repos) = recovery.get("repositories").and_then(|v| v.as_array()) {
        for repo in repos {
            let name = repo
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or_default();
            let selected = repo
                .get("selectedPath")
                .and_then(|v| v.as_str())
                .unwrap_or_default();
            out.push_str("\n        <h2>");
            push_html_escaped(out, name);
            out.push_str("</h2>\n        <p>");
            push_html_escaped(out, selected);
            out.push_str("</p>\n        ");
            if let Some(blocked) = repo
                .get("blockedReason")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
            {
                out.push_str("\n        <p>");
                push_html_escaped(out, blocked);
                out.push_str("</p>\n        ");
            }
            out.push(' ');
            if let Some(err) = repo
                .get("error")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
            {
                out.push_str("\n        <p>");
                push_html_escaped(out, err);
                out.push_str("</p>\n        ");
            }
            out.push(' ');
        }
    }
    out.push_str(
        "\n        <details open>\n          <summary>Recent logs</summary>\n          <pre>\n",
    );
    if let Some(logs) = recovery.get("logs").and_then(|v| v.as_array()) {
        for line in logs {
            if let Some(text) = line.as_str() {
                push_html_escaped(out, text);
                out.push('\n');
            }
        }
    }
    out.push_str("</pre\n          >\n        </details>\n        ");
}

fn push_html_escaped(out: &mut String, text: &str) {
    for ch in text.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&#34;"),
            '\'' => out.push_str("&#39;"),
            _ => out.push(ch),
        }
    }
}

fn serialize_json_for_script<T: Serialize>(value: &T) -> Result<String, String> {
    let raw = serde_json::to_string(value).expect("serialize status page");
    let mut escaped = String::with_capacity(raw.len());
    for ch in raw.chars() {
        match ch {
            '<' => escaped.push_str("\\u003c"),
            '>' => escaped.push_str("\\u003e"),
            '&' => escaped.push_str("\\u0026"),
            '\u{2028}' => escaped.push_str("\\u2028"),
            '\u{2029}' => escaped.push_str("\\u2029"),
            _ => escaped.push(ch),
        }
    }
    Ok(escaped)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escapes_fallback_markdown_and_recovery_page_data() {
        let hostile = "failure </script><img src=x onerror=alert(1)> & more\u{2028}";
        let mut page = Page::basic("not-found", 404, hostile, hostile);
        page.routes = vec![RouteLink {
            host: hostile.to_owned(),
            url: "https://web.localhost/path?q=a&b=c".to_owned(),
        }];
        let document = render(&page, "").unwrap();
        assert!(!document.contains("<img src=x"));
        assert!(document.contains(
            "<h1>failure &lt;/script&gt;&lt;img src=x onerror=alert(1)&gt; &amp; more\u{2028}</h1>"
        ));
        assert!(document.contains("href=\"https://web.localhost/path?q=a&amp;b=c\""));
        assert!(document.contains("\\u2028"));

        let mut md = Page::basic("files", 200, "/notes.md", "");
        md.files = Some(FilePage {
            breadcrumbs: vec![FileLink {
                name: "devhost".to_owned(),
                href: String::new(),
            }],
            markdown: true,
            source: "# Hello\n".to_owned(),
            entries: Vec::new(),
        });
        let md_doc = render(&md, "").unwrap();
        assert!(md_doc.contains("<noscript>"));
        assert!(md_doc.contains("# Hello"));

        let mut rec = Page::basic("recovery", 503, "Unavailable", "down");
        rec.recovery = Some(serde_json::json!({
            "service": "web",
            "address": "127.0.0.1:3000",
            "repositories": [{
                "name": "repo",
                "selectedPath": "/main",
                "blockedReason": "dirty",
                "error": "boom"
            }],
            "logs": ["[web] line 1"]
        }));
        let rec_doc = render(&rec, "").unwrap();
        assert!(rec_doc.contains("Service: web · 127.0.0.1:3000"));
        assert!(rec_doc.contains("[web] line 1"));
    }

    #[test]
    fn stack_directory_selects_empty_filtered_and_populated_messages() {
        let empty = stack_directory(Vec::new(), "").unwrap();
        assert!(empty.contains("No stacks running."));
        let filtered = stack_directory(Vec::new(), "web").unwrap();
        assert!(filtered.contains("No matching stacks."));
        let populated = stack_directory(
            vec![Stack {
                id: "stk-demo".to_owned(),
                name: "demo".to_owned(),
                pid: 42,
                manifest_path: "/tmp/devhost.toml".to_owned(),
                directory: "/tmp".to_owned(),
                started_at: "2026-01-01T00:00:00Z".to_owned(),
                services: Vec::new(),
                configs: Vec::new(),
                error: String::new(),
            }],
            "",
        )
        .unwrap();
        assert!(populated.contains("Open a service URL"));
    }
}
