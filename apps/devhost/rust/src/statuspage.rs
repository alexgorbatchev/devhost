use serde::Serialize;

pub(crate) const PAGE_CSS: &str = include_str!("../../internal/statuspage/dist/statusPages.css");
const PAGE_SCRIPT: &str = include_str!("../../internal/statuspage/dist/statusPages.js");
const THEME_SCRIPT: &str = include_str!("../../internal/statuspage/theme.js");

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(crate) struct RouteLink {
    pub(crate) host: String,
    pub(crate) url: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(crate) struct StackService {
    pub(crate) name: String,
    pub(crate) directory: String,
    pub(crate) urls: Vec<String>,
    pub(crate) status: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(crate) struct StackConfig {
    pub(crate) path: String,
    pub(crate) kind: String,
    pub(crate) content: String,
    pub(crate) error: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Stack {
    pub(crate) name: String,
    pub(crate) pid: i32,
    pub(crate) manifest_path: String,
    pub(crate) directory: String,
    pub(crate) started_at: String,
    pub(crate) services: Vec<StackService>,
    pub(crate) configs: Vec<StackConfig>,
    pub(crate) error: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(crate) struct Page {
    pub(crate) kind: String,
    pub(crate) status: u16,
    pub(crate) title: String,
    pub(crate) message: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub(crate) routes: Vec<RouteLink>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub(crate) stacks: Vec<Stack>,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub(crate) query: String,
}

pub(crate) fn not_found_page(
    routes: Vec<RouteLink>,
    stylesheet_url: &str,
) -> Result<String, String> {
    render(
        &Page {
            kind: "not-found".to_owned(),
            status: 404,
            title: "No active devhost route matched this hostname.".to_owned(),
            message: "The request reached the managed devhost Caddy instance, but this hostname is not currently mapped to an active route. If you expected an app here, check that the stack is running and that the service has claimed the correct host.".to_owned(),
            routes,
            stacks: Vec::new(),
            query: String::new(),
        },
        stylesheet_url,
    )
}

pub(crate) fn stack_directory(stacks: Vec<Stack>, query: &str) -> Result<String, String> {
    let message = if stacks.is_empty() {
        if query.is_empty() {
            "No stacks running. Start a project with devhost start, then refresh this page."
        } else {
            "No matching stacks. Try another name, URL, or path."
        }
    } else {
        "Open a service URL or expand its configuration below. Refresh to update."
    };
    render(
        &Page {
            kind: "stacks".to_owned(),
            status: 200,
            title: "Running stacks".to_owned(),
            message: message.to_owned(),
            routes: Vec::new(),
            stacks,
            query: query.to_owned(),
        },
        "",
    )
}

pub(crate) fn render(page: &Page, stylesheet_url: &str) -> Result<String, String> {
    let page_json = serialize_json_for_script(page)?;
    let script = PAGE_SCRIPT.replace("</", "<\\/");
    let mut out = String::with_capacity(PAGE_SCRIPT.len() + 2048);

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
    out.push_str(
        "\">\n    <div id=\"devhost-status\">\n      \n      <main>\n        <p>devhost · ",
    );
    out.push_str(&page.status.to_string());
    out.push_str("</p>\n        <h1>");
    push_html_escaped(&mut out, &page.title);
    out.push_str("</h1>\n        <p>");
    push_html_escaped(&mut out, &page.message);
    out.push_str("</p>\n         ");
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
        out.push_str("\n        </ul>\n         ");
    } else {
        out.push(' ');
    }
    out.push_str("\n      </main>\n      \n    </div>\n    <script id=\"devhost-status-data\" type=\"application/json\">\n      ");
    out.push_str(&page_json);
    out.push_str("\n    </script>\n    <script>\n      ");
    out.push_str(&script);
    out.push_str("\n    </script>\n  </body>\n</html>\n");
    Ok(out)
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
    let raw =
        serde_json::to_string(value).map_err(|error| format!("render status page: {error}"))?;
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
    fn escapes_fallback_and_round_trips_page_data() {
        let hostile = "failure </script><img src=x onerror=alert(1)> & more";
        let page = Page {
            kind: "not-found".to_owned(),
            status: 404,
            title: hostile.to_owned(),
            message: hostile.to_owned(),
            routes: vec![RouteLink {
                host: hostile.to_owned(),
                url: "https://web.localhost/path?q=a&b=c".to_owned(),
            }],
            stacks: Vec::new(),
            query: String::new(),
        };
        let document = render(&page, "").unwrap();
        assert!(!document.contains("<img src=x"));
        assert!(document.contains(
            "<h1>failure &lt;/script&gt;&lt;img src=x onerror=alert(1)&gt; &amp; more</h1>"
        ));
        assert!(document.contains("href=\"https://web.localhost/path?q=a&amp;b=c\""));
        let start = document
            .find("<script id=\"devhost-status-data\" type=\"application/json\">")
            .unwrap();
        let after = &document[start..];
        let payload_start = after.find('>').unwrap() + 1;
        let payload_end = after[payload_start..].find("</script>").unwrap();
        let payload = after[payload_start..payload_start + payload_end].trim();
        let decoded: serde_json::Value = serde_json::from_str(payload).unwrap();
        assert_eq!(decoded["title"], hostile);
        assert_eq!(
            decoded["routes"][0]["url"],
            "https://web.localhost/path?q=a&b=c"
        );
    }

    #[test]
    fn stack_directory_selects_empty_filtered_and_populated_messages() {
        let empty = stack_directory(Vec::new(), "").unwrap();
        assert!(empty.contains("No stacks running."));
        let filtered = stack_directory(Vec::new(), "web").unwrap();
        assert!(filtered.contains("No matching stacks."));
        let populated = stack_directory(
            vec![Stack {
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
