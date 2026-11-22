use std::{collections::BTreeMap, fs, process::Command};

use devhost_rust::{
    manifest::read_manifest,
    services::resolve::{
        PortResolutionOptions, interpolate_service_templates, resolve_service_order,
        resolve_service_ports, validate_requested_services,
    },
};

#[test]
fn validates_full_devtools_worktrees_health_hosts_and_watch_warning() {
    let fixture = tempfile::tempdir().unwrap();
    let root = fixture.path();
    fs::write(
        root.join("devhost.toml"),
        r#"
name = "full"
killZombies = false

[worktrees]
enabled = false

[devtools]
idleTimeout = "5m"
[devtools.chat]
enabled = false
prompt = "be concise"
[devtools.annotations]
enabled = false
[devtools.configEditor]
enabled = true
[devtools.externalToolbars]
enabled = false
[devtools.minimap]
enabled = false
[devtools.editor]
enabled = true
ide = "cursor"
[devtools.status]
enabled = true
position = "top-right"
[devtools.shortcuts]
restartServices = "alt+r"
[devtools.resources]
enabled = true
pollInterval = "1s"
[devtools.resources.cpu]
enabled = true
pollInterval = "500ms"
[devtools.resources.memory]
enabled = false
[devtools.resources.disk]
pollInterval = "2s"

[services.web]
command = ["web"]
port = 3000
host = ["web", "web-alt.localhost"]
path = "/*"
proxyLocalOrigin = true
bindHost = "127.0.0.1"
injectPort = true
watch = ["../../outside"]
[services.web.env]
FOO = "bar"
[services.web.health]
http = "/health"
interval = 100
timeout = 5000
retries = 2

[services.api]
command = ["api"]
port = 3001
host = "web"
path = "/api/*"
[services.api.health]
http = "http://127.0.0.1:3001/ok"
"#,
    )
    .unwrap();

    let manifest = read_manifest(root, None).unwrap();
    assert!(!manifest.kill_zombies);
    assert!(!manifest.worktrees.enabled);
    assert_eq!(manifest.devtools.idle_timeout, "5m");
    assert_eq!(manifest.devtools.editor.ide, "cursor");
    assert_eq!(manifest.devtools.status.position, "top-right");
    assert_eq!(manifest.devtools.restart_shortcut, "alt+r");
    assert!(manifest.devtools.config_editor_enabled);
    assert!(!manifest.devtools.chat.enabled);
    assert_eq!(manifest.devtools.chat.prompt, "be concise");
    assert_eq!(manifest.services["web"].path.as_deref(), Some("/"));
    assert_eq!(manifest.services["api"].path.as_deref(), Some("/api/*"));

    // Invalid shortcut falls back to default (matching Go)
    fs::write(
        root.join("devhost.toml"),
        "name = 's'\n[devtools.shortcuts]\nrestartServices = 'INVALID!'\n[services.web]\ncommand = ['w']\nport = 3000\n",
    )
    .unwrap();
    let fallback = read_manifest(root, None).unwrap();
    assert_eq!(fallback.devtools.restart_shortcut, "alt+ctrl+r");

    // Watch path outside emits warning in both modes
    fs::write(
        root.join("devhost.toml"),
        "name = 'w'\n[services.web]\ncommand = ['w']\nport = 3000\nwatch = ['../../outside']\n",
    )
    .unwrap();
    for (agent, tag) in [("1", "WARN:"), ("0", "[WARN]")] {
        let out = Command::new(env!("CARGO_BIN_EXE_devhost"))
            .current_dir(root)
            .args(["service", "list"])
            .env("AGENT", agent)
            .output()
            .unwrap();
        assert!(out.status.success());
        assert!(String::from_utf8_lossy(&out.stderr).contains(tag));
    }
}

#[test]
fn rejects_invalid_devtools_worktrees_health_hosts_routes_and_ports() {
    let fixture = tempfile::tempdir().unwrap();
    let root = fixture.path();
    let path = root.join("devhost.toml");

    for (content, expected) in [
        (
            "name = 'a'\nworktrees = 1\ndevtools = 2\n[services.w]\ncommand = ['w']\nport = 3000\n",
            "devtools must be a table.",
        ),
        (
            "name = 'a'\n[devtools]\nchat = 1\nannotations = 2\nresources = 3\neditor = 4\nstatus = 5\nshortcuts = 6\nidleTimeout = 'bad'\n[services.w]\ncommand = ['w']\nport = 3000\n",
            "devtools.idleTimeout must be a valid duration",
        ),
        (
            "name = 'a'\n[devtools.editor]\nide = 'emacs'\n[devtools.status]\nposition = 'center'\n[devtools.resources]\npollInterval = 5\n[devtools.resources.cpu]\npollInterval = '10ms'\n[devtools.resources.disk]\npollInterval = 'bad'\n[services.w]\ncommand = ['w']\nport = 3000\n",
            "must be at least 250ms.",
        ),
        (
            "name = 'a'\n[devtools.resources]\ncpu = 1\n[services.w]\ncommand = ['w']\nport = 3000\n",
            "devtools.resources.cpu must be a table.",
        ),
        (
            "name = 'a'\n[services.w]\ncommand = ['w']\nport = 3000\nbindHost = '10.0.0.1'\nenv = 'bad'\n[services.w.health]\ntcp = 0\nhttp = 1\nprocess = false\ninterval = 0\ntimeout = 0\nretries = -1\n",
            "services.w.health.retries must be an integer >= 0.",
        ),
        (
            "name = 'a'\n[services.w]\ncommand = ['w']\nport = 3000\nhealth = 1\n[services.w.env]\nX = 1\n",
            "services.w.health must be a table.",
        ),
        (
            "name = 'a'\n[services.w]\ncommand = ['w']\nport = 3000\n[services.w.health]\ntcp = 3000\nhttp = '/ok'\n",
            "must define at most one of tcp, http, or process.",
        ),
        (
            "name = 'a'\n[services.w]\ncommand = ['w']\nhost = 'bad host'\npath = '/a*b'\nproxyLocalOrigin = true\n",
            "must be a valid hostname",
        ),
        (
            "name = 'a'\n[services.w]\ncommand = ['w']\nport = 3000\nhost = ['web', 'WEB']\npath = ''\n",
            "services.w.path Expected a non-empty string.",
        ),
        (
            "name = 'a'\n[services.w]\ncommand = ['w']\nproxyLocalOrigin = true\n[services.w.health]\ninterval = 100\n",
            "services.w.health must define a probe or a service port.",
        ),
        (
            "name = 'a'\n[services.w]\nserve = '.'\n[services.w.health]\nprocess = true\n",
            "must not use health.process when serve is configured.",
        ),
        (
            "name = 'a'\n[services.w]\n[services.w.lifecycle]\nmode = 'daemon'\nstart = ['s']\nstop = ['k']\n[services.w.health]\nprocess = true\n",
            "must not use health.process when lifecycle.mode",
        ),
        (
            "name = 'a'\n[services.w]\ncommand = ['w']\n[services.w.health]\nhttp = 'ftp://127.0.0.1/x'\n",
            "must use http or https.",
        ),
        (
            "name = 'a'\n[services.w]\ncommand = ['w']\n[services.w.health]\nhttp = 'not-a-url'\n",
            "must be an absolute URL",
        ),
        (
            "name = 'a'\n[services.w]\ncommand = ['w']\n[services.w.health]\nhttp = 'https://example.com/health'\n",
            "must target 127.0.0.1, localhost, or ::1.",
        ),
        (
            "name = 'a'\n[services.a]\ncommand = ['a']\nport = 3000\nhost = 'app.localhost'\npath = '/api/*'\n[services.b]\ncommand = ['b']\nport = 3001\nhost = 'app.localhost'\npath = '/api/v1/*'\n",
            "overlaps another routed service",
        ),
        (
            "name = 'a'\n[services.a]\ncommand = ['a']\nport = 3000\nhost = 'app.localhost'\npath = '/api/v1'\n[services.b]\ncommand = ['b']\nport = 3001\nhost = 'app.localhost'\npath = '/api/*'\n",
            "overlaps another routed service",
        ),
        (
            "name = 'a'\n[services.a]\ncommand = ['a']\nport = 3000\nhost = 'app.localhost'\npath = '/api'\n[services.b]\ncommand = ['b']\nport = 3001\nhost = 'app.localhost'\npath = '/api'\n",
            "overlaps another routed service",
        ),
        (
            "name = 'a'\n[services.a]\ncommand = ['a']\nport = 3000\nbindHost = '::1'\n[services.b]\ncommand = ['b']\nport = 3000\nbindHost = '::'\n",
            "duplicates fixed bind port",
        ),
        (
            "name = 'a'\n[services.a]\ncommand = ['a']\nport = 3000\nprimary = true\n[services.b]\ncommand = ['b']\nport = 3001\nprimary = true\n",
            "Multiple primary services defined",
        ),
    ] {
        fs::write(&path, content).unwrap();
        let err = read_manifest(root, None).unwrap_err();
        assert!(
            err.message.contains(expected),
            "expected {expected:?} in:\n{}",
            err.message
        );
    }
}

#[test]
fn service_resolution_covers_host_expansion_overlaps_remote_and_template_errors() {
    let fixture = tempfile::tempdir().unwrap();
    let root = fixture.path();
    let path = root.join("devhost.toml");

    // Label expansion overlap detection
    fs::write(
        &path,
        r#"
name = "exp"
[services.a]
command = ["a"]
port = 3100
host = "web"
path = "/api/*"
[services.b]
command = ["b"]
port = 3101
host = "web.localhost"
path = "/api/v1"
"#,
    )
    .unwrap();
    let manifest = read_manifest(root, None).unwrap();
    assert!(
        resolve_service_ports(&manifest, &PortResolutionOptions::default())
            .unwrap_err()
            .contains("overlaps another routed service")
    );

    // Remote mode with no routed services fails
    fs::write(
        &path,
        "name = 'unrouted'\n[services.worker]\ncommand = ['w']\nport = 3100\n",
    )
    .unwrap();
    let unrouted = read_manifest(root, None).unwrap();
    assert!(
        resolve_service_ports(
            &unrouted,
            &PortResolutionOptions {
                remote_mode: true,
                domain_suffix: ".preview.example".to_owned(),
                ..PortResolutionOptions::default()
            }
        )
        .unwrap_err()
        .contains("require at least one selected service with a routed hostname")
    );

    // Unknown requested service error wording (singular, plural, no groups vs with groups)
    assert!(
        validate_requested_services(&unrouted, &["x".to_owned()])
            .unwrap_err()
            .starts_with("unknown service:")
    );
    assert!(
        validate_requested_services(&unrouted, &["x".to_owned(), "y".to_owned()])
            .unwrap_err()
            .starts_with("unknown services:")
    );

    // Preserved auto port and IPv6 service URL template resolution
    fs::write(
        &path,
        r#"
name = "v6"
[services.db]
command = ["db"]
bindHost = "::1"
port = "auto"
[services.web]
command = ["web", "{{services.db.url}}", "{{unknown.token}}"]
port = "auto"
[services.web.health]
http = "{{services.db.url}}/ok"
[services.proc]
command = ["proc"]
[services.proc.health]
process = true
"#,
    )
    .unwrap();
    let v6 = read_manifest(root, None).unwrap();
    assert_eq!(resolve_service_order(&v6).unwrap().len(), 3);
    let mut preserved = BTreeMap::new();
    preserved.insert("db".to_owned(), 49152);
    let resolved = resolve_service_ports(
        &v6,
        &PortResolutionOptions {
            preserved,
            ..PortResolutionOptions::default()
        },
    )
    .unwrap();
    assert_eq!(resolved.services["db"].port, Some(49152));
    assert_eq!(resolved.services["web"].command[1], "http://[::1]:49152");
    assert_eq!(resolved.services["web"].command[2], "{{unknown.token}}");
    assert_eq!(
        resolved.services["web"].health.url.as_deref(),
        Some("http://[::1]:49152/ok")
    );

    // Template errors: missing port, unknown property, unresolved health template
    assert!(
        interpolate_service_templates("{{services.proc.port}}", &resolved.services)
            .unwrap_err()
            .contains("does not have a port")
    );
    assert!(
        interpolate_service_templates("{{services.proc.url}}", &resolved.services)
            .unwrap_err()
            .contains("does not have a port")
    );
    assert!(
        interpolate_service_templates("{{services.db.bad}}", &resolved.services)
            .unwrap_err()
            .contains("unknown property")
    );
    assert_eq!(
        interpolate_service_templates("unclosed {{services.db.port", &resolved.services).unwrap(),
        "unclosed {{services.db.port"
    );
}
