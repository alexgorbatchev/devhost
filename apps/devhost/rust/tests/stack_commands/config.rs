use super::*;

fn configured_stop(root: &Path, content: &str) -> Output {
    fs::create_dir_all(root.join("config")).unwrap();
    fs::write(root.join("config/config.toml"), content).unwrap();
    Command::new(binary())
        .current_dir(root)
        .args(["caddy", "stop"])
        .env("AGENT", "1")
        .env("HOME", root.join("home"))
        .env_remove("USERPROFILE")
        .env("DEVHOST_STATE_DIR", root.join("state"))
        .env("DEVHOST_CONFIG_DIR", root.join("config"))
        .output()
        .unwrap()
}

#[test]
fn normalized_suffix_routes_only_selected_hosts_on_custom_http_and_https_ports() {
    let runtime = Runtime::start();
    let config = runtime.config.join("config.toml");
    let existing = fs::read_to_string(&config).unwrap();
    fs::write(
        &config,
        format!("domainSuffix = ' -Preview.Example '\n{existing}"),
    )
    .unwrap();
    let project = runtime.root.path().join("suffix-contract");
    fs::create_dir_all(project.join("public")).unwrap();
    fs::write(project.join("public/note.txt"), "configured route").unwrap();
    fs::write(
        project.join("devhost.toml"),
        "name='suffix-contract'\n[services.web]\nserve='public'\nhost='web'\n",
    )
    .unwrap();
    let mut process = super::lifecycle::launch(&runtime, &project, &[]);
    wait_until(|| {
        assert!(
            process.0.try_wait().unwrap().is_none(),
            "{}",
            fs::read_to_string(project.join("lifecycle.log")).unwrap()
        );
        read_live_stacks(&runtime.state().join("caddy"))
            .unwrap()
            .iter()
            .any(|stack| stack.name == "suffix-contract" && stack.control_port > 0)
    });
    let origin = super::control::origin(&runtime, "suffix-contract");
    super::lifecycle::ready(&origin);
    let client: ureq::Agent = ureq::Agent::config_builder()
        .proxy(None)
        .http_status_as_error(false)
        .timeout_global(Some(Duration::from_secs(5)))
        .build()
        .into();
    let url = format!("http://127.0.0.1:{}/note.txt", runtime.settings.http_port);
    let mut response = client
        .get(&url)
        .header("Host", "web-preview.example")
        .call()
        .unwrap();
    assert_eq!(response.status(), 200);
    assert_eq!(
        response.body_mut().read_to_string().unwrap(),
        "configured route"
    );
    for host in ["web.localhost", "other-preview.example"] {
        assert_eq!(
            client
                .get(&url)
                .header("Host", host)
                .call()
                .unwrap()
                .status(),
            404,
            "{host}"
        );
    }
    let authority = runtime
        .state()
        .join("caddy/storage/pki/authorities/local/root.crt");
    let mut request = Command::new("curl");
    request
        .args([
            "--silent",
            "--show-error",
            "--fail",
            "--noproxy",
            "*",
            "--connect-timeout",
            "3",
            "--max-time",
            "10",
            "--cacert",
        ])
        .arg(&authority)
        .arg("--resolve")
        .arg(format!(
            "web-preview.example:{}:127.0.0.1",
            runtime.settings.https_port
        ))
        .arg(format!(
            "https://web-preview.example:{}/note.txt",
            runtime.settings.https_port
        ));
    // Caddy obtains certificates asynchronously after accepting the routes.
    let deadline = Instant::now() + Duration::from_secs(15);
    let output = loop {
        let output = request.output().unwrap();
        if output.status.success() {
            break output;
        }
        assert!(Instant::now() < deadline, "{output:?}");
        thread::sleep(Duration::from_millis(20));
    };
    assert_eq!(output.stdout, b"configured route");
    super::lifecycle::stop(&runtime, &project, &mut process);
    let ports = [
        runtime.settings.http_port,
        runtime.settings.https_port,
        runtime
            .settings
            .admin_address
            .rsplit(':')
            .next()
            .unwrap()
            .parse()
            .unwrap(),
    ];
    drop(process);
    drop(runtime);
    for port in ports {
        let socket = socket2::Socket::new(
            socket2::Domain::IPV4,
            socket2::Type::STREAM,
            Some(socket2::Protocol::TCP),
        )
        .unwrap();
        socket.set_reuse_address(true).unwrap();
        socket
            .bind(&std::net::SocketAddrV4::new(std::net::Ipv4Addr::LOCALHOST, port).into())
            .unwrap();
        socket.listen(1).unwrap();
    }
}

#[test]
fn machine_suffix_and_listener_validation_preserves_boundaries_before_mutation() {
    let mut cases = Vec::new();
    for (suffix, valid) in [
        (".localhost", true),
        ("-preview.example", true),
        (" .Preview.Example ", true),
        ("localhost", false),
        (".", false),
        ("..localhost", false),
        (".bad_label", false),
        ("https://example.com", false),
        (".trailing.", false),
        (".-bad.example", false),
    ] {
        cases.push((
            format!("domainSuffix = {suffix:?}\n[caddy]\nadminAddress = '127.0.0.1:0'\n"),
            valid,
            "domainSuffix",
        ));
    }
    for (host, valid) in [
        ("127.0.0.1", true),
        ("0.0.0.0", true),
        ("::1", true),
        ("::", true),
        ("localhost", false),
        ("10.0.0.1", false),
        (" 127.0.0.1 ", false),
        ("", false),
    ] {
        cases.push((
            format!("[caddy]\nadminAddress = '127.0.0.1:0'\nbindHost = {host:?}\n"),
            valid,
            "caddy.bindHost",
        ));
    }
    for field in ["httpPort", "httpsPort"] {
        for (port, valid) in [
            (-1, false),
            (0, false),
            (1, true),
            (65535, true),
            (65536, false),
        ] {
            cases.push((
                format!("[caddy]\nadminAddress = '127.0.0.1:0'\n{field} = {port}\n"),
                valid,
                field,
            ));
        }
    }
    for (host, valid) in [
        ("localhost", true),
        (" Directory.Example ", true),
        ("single-label", false),
        ("https://directory.example", false),
        ("directory.example:443", false),
        ("directory.example/path", false),
        ("*.example", false),
    ] {
        cases.push((
            format!("[caddy]\nadminAddress = '127.0.0.1:0'\nstackDirectoryHost = {host:?}\n"),
            valid,
            "caddy.stackDirectoryHost",
        ));
    }
    cases.push((
        "[caddy]\nadminAddress = ' '\n".to_owned(),
        false,
        "caddy.adminAddress",
    ));
    for field in ["http", "stackDirectoryAllowRemote"] {
        cases.push((
            format!("[caddy]\nadminAddress = '127.0.0.1:0'\n{field} = 'yes'\n"),
            false,
            field,
        ));
    }
    for (content, valid, field) in cases {
        let fixture = tempfile::tempdir().unwrap();
        let output = configured_stop(fixture.path(), &content);
        assert_eq!(
            output.status.code(),
            Some(i32::from(!valid)),
            "{content}\n{output:?}"
        );
        assert!(output.stdout.is_empty(), "{content}\n{output:?}");
        let error = String::from_utf8(output.stderr).unwrap();
        if valid {
            assert_eq!(
                error, "devhost: managed caddy is not running.\n",
                "{content}"
            );
            assert!(fixture.path().join("state/caddy/Caddyfile").exists());
            assert!(!fixture.path().join("state/caddy/caddy.pid").exists());
        } else {
            assert!(error.contains(field), "{content}\n{error}");
            assert!(!fixture.path().join("state").exists(), "{content}");
        }
    }
}

#[test]
fn effective_machine_defaults_and_ordered_errors_match_the_cli_contract() {
    for http in [false, true] {
        let fixture = tempfile::tempdir().unwrap();
        let root = fixture.path();
        let content = format!(
            "[caddy]\nadminAddress = '127.0.0.1:0'\n{}",
            if http { "http = true\n" } else { "" }
        );
        let output = configured_stop(root, &content);
        assert!(output.status.success(), "{output:?}");
        let caddyfile = fs::read_to_string(root.join("state/caddy/Caddyfile")).unwrap();
        assert!(
            caddyfile.contains("default_bind 0.0.0.0 [::]"),
            "{caddyfile}"
        );
        assert!(caddyfile.contains("https:// {"), "{caddyfile}");
        assert!(!caddyfile.contains(":443"), "{caddyfile}");
        assert_eq!(caddyfile.contains("http:// {"), http, "{caddyfile}");
        let directory = fs::read_to_string(root.join("state/caddy/stack-directory.caddy")).unwrap();
        assert!(
            directory.contains("https://devhost.localhost"),
            "{directory}"
        );
        assert_eq!(
            directory.contains("http://devhost.localhost"),
            http,
            "{directory}"
        );
        assert!(
            directory.contains("@remote not remote_ip 127.0.0.0/8 ::1"),
            "{directory}"
        );
    }
    let fixture = tempfile::tempdir().unwrap();
    let output = configured_stop(
        fixture.path(),
        "zKey = true\naKey = true\ndomainSuffix = 'invalid'\n[caddy]\nzKey = true\naKey = true\nadminAddress = ''\nbindHost = 'bad'\nhttpPort = 0\nhttpsPort = 65536\nstackDirectoryHost = 'https://bad'\n",
    );
    assert_eq!(output.status.code(), Some(1), "{output:?}");
    assert!(output.stdout.is_empty(), "{output:?}");
    let errors = String::from_utf8(output.stderr).unwrap();
    let mut remaining = errors.as_str();
    for message in [
        "Unrecognized key: \"aKey\"",
        "Unrecognized key: \"caddy.aKey\"",
        "Unrecognized key: \"caddy.zKey\"",
        "Unrecognized key: \"zKey\"",
        "domainSuffix must be",
        "caddy.stackDirectoryHost must be",
        "caddy.adminAddress must be",
        "caddy.bindHost must be",
        "caddy.httpPort must be",
        "caddy.httpsPort must be",
    ] {
        let position = remaining
            .find(message)
            .unwrap_or_else(|| panic!("missing or reordered {message}: {errors}"));
        remaining = &remaining[position + message.len()..];
    }
    assert!(!fixture.path().join("state").exists());
}

#[test]
fn config_directory_precedence_and_unusable_selected_paths_do_not_fall_back() {
    let fixture = tempfile::tempdir().unwrap();
    let root = fixture.path().canonicalize().unwrap();
    for (directory, marker) in [
        ("explicit", "selectedExplicit"),
        ("xdg/devhost", "selectedXdg"),
        ("home/.config/devhost", "selectedHome"),
    ] {
        fs::create_dir_all(root.join(directory)).unwrap();
        fs::write(
            root.join(directory).join("config.toml"),
            format!("{marker}=true\n"),
        )
        .unwrap();
    }
    for (explicit, xdg, selected, marker) in [
        (
            " explicit/unused/.. ",
            "xdg",
            "explicit",
            "selectedExplicit",
        ),
        (" \t", " xdg ", "xdg/devhost", "selectedXdg"),
        ("", " ", "~/.config/devhost", "selectedHome"),
    ] {
        let output = Command::new(binary())
            .current_dir(&root)
            .args(["caddy", "stop"])
            .env("AGENT", "1")
            .env("HOME", root.join("home"))
            .env_remove("USERPROFILE")
            .env("DEVHOST_STATE_DIR", root.join("private-state"))
            .env("DEVHOST_CONFIG_DIR", explicit)
            .env("XDG_CONFIG_HOME", xdg)
            .output()
            .unwrap();
        assert_eq!(output.status.code(), Some(1), "{output:?}");
        assert!(output.stdout.is_empty(), "{output:?}");
        let error = String::from_utf8(output.stderr).unwrap();
        assert!(error.contains(marker), "{error}");
        assert!(
            error.contains(&format!("{selected}/config.toml")),
            "{error}"
        );
        assert!(!root.join("private-state").exists());
    }
    // A directory at the selected file path must report a read error, not load XDG.
    fs::create_dir_all(root.join("unusable/config.toml")).unwrap();
    let output = Command::new(binary())
        .current_dir(&root)
        .args(["caddy", "stop"])
        .env("AGENT", "1")
        .env("HOME", root.join("home"))
        .env("DEVHOST_STATE_DIR", root.join("private-state"))
        .env("DEVHOST_CONFIG_DIR", "unusable")
        .env("XDG_CONFIG_HOME", "xdg")
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(1), "{output:?}");
    let error = String::from_utf8(output.stderr).unwrap();
    assert!(error.contains("unusable/config.toml"), "{error}");
    assert!(!error.contains("selectedXdg"), "{error}");
    assert!(!root.join("private-state").exists());
}
