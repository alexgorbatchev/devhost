use super::*;

pub(super) fn command() -> Command {
    Command::new("serve")
        .args_override_self(true)
        .about("Serve a command, directory, or local port over HTTPS")
        .long_about("Launch a command and discover its HTTP listeners:\n  devhost serve \"bun start.ts\"\n  devhost serve --detach -- bun start.ts\n\nGenerated hostnames use the app name, a session ID, and\nthe machine local domain suffix. Multiple HTTP ports\nreceive port-qualified hostnames. --name overrides the\ninferred app name. Ctrl+C stops the command and its routes.\n\nServe files or an existing local HTTP port without a\nmanifest. Use --dir for files or --port for a service on\n127.0.0.1. With neither option, serve the current\ndirectory. --dir and --port are mutually exclusive.\n\nFiles and existing ports require --domain; the hostname\nmust point here.\nCaddy starts automatically if needed and stays running\nafter Ctrl+C removes this session's routes.\nAn existing service keeps running after the session stops.\n\nDirectories show index.html, index.md, README.md, or\nreadme.md, else a listing. Markdown uses GitHub styling\nwith a remembered source toggle. Hidden files and symlinks\noutside the directory are excluded.")
        .arg(Arg::new("command").num_args(0..).help("One quoted shell command, or direct arguments after --."))
        .arg(Arg::new("name").long("name").short('n').help("Override the inferred app name for command serving."))
        .arg(boolean_arg("detach").help("Start a command session in the background after HTTP readiness."))
        .arg(Arg::new("startup-timeout").long("startup-timeout").short('s').default_value("30s").help("Maximum time to wait for a command's HTTP listener."))
        .arg(Arg::new("session-id").long("session-id").hide(true))
        .arg(Arg::new("domain").long("domain").short('d').help("Hostname for files or an existing port, e.g. notes.localhost."))
        .arg(Arg::new("dir").long("dir").value_parser(value_parser!(PathBuf)).conflicts_with("port").help("Directory to serve; defaults to the current directory."))
        .arg(Arg::new("port").long("port").short('p').value_parser(value_parser!(i32)).allow_negative_numbers(true).help("Existing local HTTP service port (1-65535); exclusive with --dir."))
}

pub(super) fn run(args: &clap::ArgMatches, mode: Mode) -> Result<ExitCode, Box<dyn Error>> {
    let command: Vec<_> = args
        .get_many::<String>("command")
        .into_iter()
        .flatten()
        .cloned()
        .collect();
    if !command.is_empty() && command != [String::new()] {
        return match run_command(args, command, mode) {
            Ok(code) => Ok(code),
            Err(error) => Ok(write_failure(mode, error.to_string().into())?),
        };
    }
    for flag in ["name", "detach", "startup-timeout", "session-id"] {
        if args.value_source(flag) == Some(clap::parser::ValueSource::CommandLine) {
            return Ok(write_failure(
                mode,
                format!("--{flag} requires a command").into(),
            )?);
        }
    }
    let domain = args
        .get_one::<String>("domain")
        .map(String::as_str)
        .unwrap_or_default();
    if !manifest::is_valid_host(domain) {
        return Ok(write_failure(
            mode,
            "--domain requires a hostname without scheme, port, or path, e.g. notes.localhost"
                .to_owned()
                .into(),
        )?);
    }
    let port = match args.get_one::<i32>("port") {
        Some(port) if (1..=65535).contains(port) => Some(*port as u16),
        Some(_) => {
            return Ok(write_failure(
                mode,
                "--port must be between 1 and 65535".to_owned().into(),
            )?);
        }
        None => None,
    };
    let cwd = env::current_dir()?;
    let directory = args
        .get_one::<PathBuf>("dir")
        .map(PathBuf::as_path)
        .unwrap_or(&cwd);
    let state_dir = match machine::state_directory() {
        Ok(path) => path,
        Err(error) => return Ok(write_failure(mode, error.into())?),
    };
    let label = format!("serve-{domain}");
    let output = cliout::ServiceOutput::stdio(mode, &[&label, "serve", "devhost", "caddy"]);
    match start_serve(
        directory,
        domain,
        port,
        StartStackOptions {
            runtime_control: None,
            command_serve_timeout: None,
            serve_session: true,
            runtime_errors: None,
            configuration: None,
            caddy_dir: state_dir.join("caddy"),
            config_path: None,
            environment: devhost_rust::environment::unicode(),
            output,
            debug_caddy: false,
            shutdown_grace_period: None,
            idle_timeout: None,
            install_signal_handlers: true,
            external_cancel: None,
            launch: Default::default(),
        },
    ) {
        Ok(code) => Ok(ExitCode::from((code & 0xff) as u8)),
        Err(StartStackError::Failure(failure)) => Ok(write_failure(mode, failure)?),
        Err(StartStackError::Overlap(overlap)) => {
            Ok(write_failure(mode, overlap.default_message().into())?)
        }
    }
}

fn run_command(
    args: &clap::ArgMatches,
    mut command: Vec<String>,
    mode: Mode,
) -> Result<ExitCode, Box<dyn Error>> {
    use devhost_rust::services::serve_command::{resolve_command, start_command};
    for flag in ["dir", "port", "domain"] {
        if args.value_source(flag) == Some(clap::parser::ValueSource::CommandLine) {
            return Err(format!("command serving and --{flag} are mutually exclusive").into());
        }
    }
    let direct = env::args_os()
        .skip_while(|arg| arg != "serve")
        .any(|arg| arg == "--");
    if !direct {
        if command.len() != 1 || command[0].trim().is_empty() {
            return Err("pass one quoted command, or use -- before command arguments".into());
        }
        command = vec!["/bin/sh".to_owned(), "-c".to_owned(), command.remove(0)];
    }
    let timeout = args
        .get_one::<String>("startup-timeout")
        .and_then(|raw| manifest::parse_idle_duration(raw).ok())
        .filter(|timeout| !timeout.is_zero())
        .ok_or("--startup-timeout requires a positive duration, e.g. 30s")?;
    let session = args
        .get_one::<String>("session-id")
        .map(String::as_str)
        .unwrap_or_default();
    if !session.is_empty()
        && (session.contains('.')
            || session.len() > 57
            || !manifest::is_valid_host(&format!("{session}.localhost")))
    {
        return Err("invalid command session label".into());
    }
    let cwd = env::current_dir()?;
    let state_dir = machine::state_directory()?;
    let mut environment = devhost_rust::environment::unicode();
    let launch = take_launch_metadata(&mut environment);
    // SAFETY: command startup runs on the main thread before worker creation.
    unsafe {
        env::remove_var(DETACHED_LOG_ENV);
        env::remove_var(STACK_LOG_ENV);
    }
    let mut resolved = resolve_command(
        &cwd,
        command.clone(),
        args.get_one::<String>("name")
            .map(String::as_str)
            .unwrap_or_default(),
        session,
        timeout,
    )?;
    let output =
        cliout::ServiceOutput::stdio(mode, &[&resolved.name, "command", "devhost", "caddy"]);
    if args.get_flag("detach") {
        let mut arguments = vec![
            "serve".to_owned(),
            "--session-id".to_owned(),
            resolved.name.clone(),
            "--startup-timeout".to_owned(),
            devhost_rust::services::detach::format_go_duration(timeout),
            "--".to_owned(),
        ];
        arguments.extend(command);
        start_detached_stack(DetachedStartOptions {
            manifest: resolved,
            arguments,
            directory: cwd,
            state_dir,
            environment,
            output,
            executable: None,
            startup_timeout: None,
            cleanup_timeout: None,
            target_os: None,
            external_signal: None,
            install_signal_handlers: true,
        })
        .map_err(|failure| failure.message)?;
        return Ok(ExitCode::SUCCESS);
    }
    output.log_stdout(&resolved.name, &format!("Session: {}", resolved.name));
    output.log_stdout(
        &resolved.name,
        &format!("Stop: devhost stop --session {}", resolved.name),
    );
    match start_command(
        &mut resolved,
        timeout,
        StartStackOptions {
            command_serve_timeout: None,
            runtime_control: None,
            serve_session: true,
            runtime_errors: None,
            configuration: None,
            caddy_dir: state_dir.join("caddy"),
            config_path: None,
            environment,
            output,
            debug_caddy: false,
            shutdown_grace_period: None,
            idle_timeout: None,
            install_signal_handlers: true,
            external_cancel: None,
            launch,
        },
    ) {
        Ok(code) => Ok(ExitCode::from((code & 0xff) as u8)),
        Err(StartStackError::Failure(failure)) => Err(failure.message.into()),
        Err(StartStackError::Overlap(overlap)) => Err(overlap.default_message().into()),
    }
}
