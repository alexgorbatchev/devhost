use std::{
    collections::BTreeMap,
    env,
    error::Error,
    io::{self, Write},
    path::{Path, PathBuf},
    process::ExitCode,
};

use clap::builder::{PossibleValuesParser, TypedValueParser};
use clap::{Arg, ArgAction, Command, error::ErrorKind, value_parser};
use cli_command_kit::{
    HelpOptions, Mode, QuickstartItem, SkillSource, TechInfo, setup, write_skill,
};
use devhost_rust::{
    Failure, caddy, cliout, config, machine, manifest, paths,
    services::{
        detach::{
            DETACHED_LOG_ENV, DetachedStartOptions, STACK_LOG_ENV, start_detached_stack,
            take_launch_metadata,
        },
        resolve::{
            PortResolutionOptions, resolve_service_order, resolve_service_ports,
            validate_requested_services,
        },
        serve::start_serve,
        stack::{StartStackError, StartStackOptions, format_overlap_for_cwd, start_stack},
        stop::{StopStackOptions, stop_stack},
    },
};

const VERSION: &str = match option_env!("DEVHOST_BUILD_VERSION") {
    Some(version) => version,
    None => "dev",
};

mod completion;

fn main() -> Result<ExitCode, Box<dyn Error>> {
    let options = HelpOptions {
        catalog: BTreeMap::from([(
            "devhost serve".to_owned(),
            TechInfo {
                quickstart: vec![
                    QuickstartItem {
                        command: "devhost serve --domain notes.localhost".to_owned(),
                        comment: "serve the current folder".to_owned(),
                    },
                    QuickstartItem {
                        command: "devhost serve --port 3000 --domain app.localhost".to_owned(),
                        comment: "route an existing service".to_owned(),
                    },
                ],
                ..TechInfo::default()
            },
        )]),
        skill: Some(SkillSource::new("alexgorbatchev/devhost", "main")?),
        ..HelpOptions::default()
    };
    let root = Command::new("devhost")
        .bin_name("devhost")
        .about("Run your project's services behind local HTTPS hostnames")
        .version(VERSION)
        .disable_version_flag(true)
        .arg(
            Arg::new("version")
                .short('v')
                .long("version")
                .action(ArgAction::Version)
                .help("version for devhost"),
        );
    let mode = Mode::from_env();
    let mut root = setup(
        root.subcommand(caddy_command())
            .subcommand(service_command())
            .subcommand(start_command())
            .subcommand(serve_command())
            .subcommand(stop_command())
            .subcommand(stack_command())
            .subcommand(completion::command())
            .subcommand(
                Command::new("restart-all")
                    .about("Restart every running stack with the current executable"),
            ),
        mode,
        &options,
    )?;
    let completion_root = root.clone();
    root = root.subcommand(
        Command::new("_remote-worker").hide(true).arg(
            Arg::new("state-dir")
                .long("state-dir")
                .required(true)
                .value_parser(value_parser!(PathBuf)),
        ),
    );
    let mut stdout = io::stdout().lock();

    match root.try_get_matches_from_mut(std::env::args_os()) {
        Ok(matches) => {
            match matches.subcommand() {
                Some(("completion", args)) => {
                    if let Some((shell, options)) = args.subcommand() {
                        completion::write(
                            completion::shell(shell),
                            &completion_root,
                            !options.get_flag("no-descriptions"),
                            &mut stdout,
                        )?;
                    } else if let Some(command) = root.find_subcommand_mut("completion") {
                        command.write_help(&mut stdout)?;
                    }
                }
                Some(("_remote-worker", args)) => {
                    drop(stdout);
                    let state = args
                        .get_one::<PathBuf>("state-dir")
                        .expect("required state directory");
                    let runtime = tokio::runtime::Builder::new_multi_thread()
                        .worker_threads(2)
                        .enable_all()
                        .build()?;
                    runtime.block_on(devhost_rust::remote::worker::run(state))?;
                    return Ok(ExitCode::SUCCESS);
                }
                Some(("serve", serve_matches)) => {
                    drop(stdout);
                    return run_serve(serve_matches, mode);
                }
                Some(("start", start_matches)) => {
                    drop(stdout);
                    return run_start(start_matches, mode);
                }
                Some(("stop", stop_matches)) => {
                    drop(stdout);
                    return run_stop(stop_matches, mode);
                }
                Some(("stack", stack)) => match stack.subcommand() {
                    Some(("info", args)) => return run_stack_info(args, mode, &mut stdout),
                    Some(("list", _)) => return list_stacks(None, mode, &mut stdout),
                    Some(("find", args)) => {
                        return list_stacks(
                            args.get_one::<String>("query").map(String::as_str),
                            mode,
                            &mut stdout,
                        );
                    }
                    Some(("restart", args)) => {
                        drop(stdout);
                        return run_stack_restart(args, mode);
                    }
                    _ => {
                        if let Some(command) = root.find_subcommand_mut("stack") {
                            command.write_help(&mut stdout)?;
                        }
                    }
                },
                Some(("restart-all", _)) => {
                    drop(stdout);
                    let state = match machine::state_directory() {
                        Ok(state) => state,
                        Err(error) => return Ok(write_failure(mode, error.into())?),
                    };
                    let output = cliout::ServiceOutput::stdio(mode, &["devhost"]);
                    return Ok(
                        match devhost_rust::services::restart::restart_stacks(
                            None,
                            &paths::clean(&state),
                            &output,
                        ) {
                            Ok(()) => ExitCode::SUCCESS,
                            Err(error) => write_failure(mode, error.into())?,
                        },
                    );
                }
                Some(("service", service)) if service.subcommand_name() == Some("list") => {
                    let list = service.subcommand_matches("list").expect("list arguments");
                    return list_services(list, mode, &mut stdout);
                }
                Some(("caddy", caddy_matches)) => match caddy_matches.subcommand_name() {
                    Some("print-root-cert") => {
                        return Ok(match machine::print_root_certificate(&mut stdout) {
                            Ok(()) => ExitCode::SUCCESS,
                            Err(message) => write_failure(mode, message.into())?,
                        });
                    }
                    Some("start") => {
                        return Ok(finish_caddy(
                            mode,
                            caddy::start(mode, &mut io::stderr().lock(), false),
                        )?);
                    }
                    Some("stop") => {
                        return Ok(finish_caddy(
                            mode,
                            caddy::stop(mode, &mut io::stderr().lock()),
                        )?);
                    }
                    Some("trust") => {
                        return Ok(finish_caddy(
                            mode,
                            caddy::trust_ca(mode, &mut io::stderr().lock()),
                        )?);
                    }
                    Some("trust-remote") => {
                        let args = caddy_matches
                            .subcommand_matches("trust-remote")
                            .expect("trust-remote arguments");
                        let result = match args.get_one::<String>("ssh-target") {
                        Some(target) => caddy::trust_remote::trust(target, mode, &mut io::stderr().lock()),
                        None => Err("Expected an SSH target. Example: devhost caddy trust-remote devbox".to_owned().into()),
                    };
                        return Ok(finish_caddy(mode, result)?);
                    }
                    Some("download") => {
                        return Ok(finish_caddy(
                            mode,
                            caddy::download(mode, &mut io::stderr().lock()),
                        )?);
                    }
                    Some("privileged-ports") => {
                        return Ok(finish_caddy(
                            mode,
                            caddy::privileged_ports(mode, &mut io::stderr().lock()),
                        )?);
                    }
                    _ => {
                        if let Some(command) = root.find_subcommand_mut("caddy") {
                            command.write_help(&mut stdout)?;
                        }
                    }
                },
                Some(("service", _)) => {
                    if let Some(command) = root.find_subcommand_mut("service") {
                        command.write_help(&mut stdout)?;
                    }
                }
                _ => {
                    if !write_skill(&root, &matches, &options, &mut stdout)? {
                        root.write_help(&mut stdout)?;
                    }
                }
            }
        }
        Err(error) => match error.kind() {
            ErrorKind::DisplayVersion => writeln!(stdout, "{VERSION}")?,
            ErrorKind::DisplayHelp => write!(stdout, "{error}")?,
            _ => {
                error.print()?;
                return Ok(ExitCode::FAILURE);
            }
        },
    }

    stdout.flush()?;
    Ok(ExitCode::SUCCESS)
}

fn start_command() -> Command {
    Command::new("start")
        .args_override_self(true)
        .about("Start the services in devhost.toml")
        .arg(manifest_arg())
        .arg(
            boolean_arg("debug")
                .short('d')
                .help("Show Caddy's output while the stack runs."),
        )
        .arg(boolean_arg("detach").help("Run in the background; wait until the stack is ready."))
        .arg(
            boolean_arg("local")
                .short('l')
                .help("Use local routing even when a remote relay is configured."),
        )
        .arg(
            boolean_arg("remote")
                .short('r')
                .help("Require the configured remote preview relay."),
        )
        .arg(
            nonempty_env(Arg::new("idle-timeout"), "DEVHOST_IDLE_TIMEOUT")
                .long("idle-timeout")
                .short('i')
                .value_name("duration")
                .help("Stop the stack after this long without traffic, e.g. 30s or 1m."),
        )
        .arg(
            Arg::new("service")
                .num_args(0..)
                .help("Services or groups; omit to start every service."),
        )
}

fn serve_command() -> Command {
    Command::new("serve")
        .args_override_self(true)
        .about("Serve a directory or local port over HTTPS")
        .long_about("Serve files or an existing local HTTP port without a\nmanifest. Use --dir for files or --port for a service on\n127.0.0.1. With neither option, serve the current\ndirectory. --dir and --port are mutually exclusive.\n\n--domain is required; the hostname must point here.\nCaddy starts automatically if needed and stays running\nafter Ctrl+C removes this session's routes.\nAn existing service keeps running after the session stops.\n\nDirectories show index.html, index.md, README.md, or\nreadme.md, else a listing. Markdown uses GitHub styling\nwith a remembered source toggle. Hidden files and symlinks\noutside the directory are excluded.")
        .arg(Arg::new("domain").long("domain").short('d').help("Hostname to serve, e.g. notes.localhost (required)."))
        .arg(Arg::new("dir").long("dir").value_parser(value_parser!(PathBuf)).conflicts_with("port").help("Directory to serve; defaults to the current directory."))
        .arg(Arg::new("port").long("port").short('p').value_parser(value_parser!(i32)).allow_negative_numbers(true).help("Existing local HTTP service port (1-65535); exclusive with --dir."))
}

fn run_serve(args: &clap::ArgMatches, mode: Mode) -> Result<ExitCode, Box<dyn Error>> {
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
            serve_session: true,
            runtime_errors: None,
            configuration: None,
            caddy_dir: state_dir.join("caddy"),
            config_path: None,
            environment: env::vars().collect(),
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

fn stop_command() -> Command {
    Command::new("stop")
        .args_override_self(true)
        .about("Stop the running stack for this project")
        .arg(manifest_arg())
        .arg(
            boolean_arg("worktrees")
                .short('w')
                .help("Stop stacks in every worktree of this Git repository."),
        )
}

fn boolean_arg(name: &'static str) -> Arg {
    Arg::new(name)
        .long(name)
        .action(ArgAction::Set)
        .num_args(0..=1)
        .require_equals(true)
        .default_missing_value("true")
        .default_value("false")
        .value_parser(
            PossibleValuesParser::new([
                "true", "false", "1", "0", "t", "f", "T", "F", "TRUE", "FALSE", "True", "False",
            ])
            .map(|value| matches!(value.as_str(), "true" | "1" | "t" | "T" | "TRUE" | "True")),
        )
}

fn manifest_arg() -> Arg {
    nonempty_env(Arg::new("manifest"), "DEVHOST_MANIFEST")
        .long("manifest")
        .short('m')
        .value_name("path")
        .value_parser(value_parser!(PathBuf))
        .help("Path to the devhost.toml file to use")
}

fn nonempty_env(arg: Arg, name: &'static str) -> Arg {
    if env::var_os(name).is_some_and(|value| !value.is_empty()) {
        arg.env(name)
    } else {
        arg
    }
}

fn validate_manifest_flag(path: Option<&Path>) -> Result<(), Failure> {
    let Some(path) = path else {
        return Ok(());
    };
    let text = path.to_string_lossy();
    if !text.ends_with("devhost.toml") {
        return Err(Failure {
            message: format!(
                "--manifest must point to a file named devhost.toml, received: {text}"
            ),
            summary: None,
            hint: None,
        });
    }
    Ok(())
}

fn run_start(args: &clap::ArgMatches, mode: Mode) -> Result<ExitCode, Box<dyn Error>> {
    let local = args.get_flag("local");
    let remote = args.get_flag("remote");
    if local && remote {
        return Ok(write_failure(
            mode,
            "--local and --remote are mutually exclusive"
                .to_owned()
                .into(),
        )?);
    }
    let explicit_manifest = args.get_one::<PathBuf>("manifest").map(PathBuf::as_path);
    if let Err(failure) = validate_manifest_flag(explicit_manifest) {
        return Ok(write_failure(mode, failure)?);
    }
    let cwd = env::current_dir()?;
    let validated = match manifest::read_manifest(&cwd, explicit_manifest) {
        Ok(m) => m,
        Err(failure) => return Ok(write_failure(mode, failure)?),
    };
    let requested: Vec<String> = args
        .get_many::<String>("service")
        .map(|vals| vals.cloned().collect())
        .unwrap_or_default();
    if let Err(err) = validate_requested_services(&validated, &requested) {
        return Ok(write_failure(
            mode,
            Failure {
                message: err,
                summary: None,
                hint: Some("Run \"devhost service list\" to print the service names.".to_owned()),
            },
        )?);
    }
    let service_order = match resolve_service_order(&validated) {
        Ok(order) => order,
        Err(err) => return Ok(write_failure(mode, err.into())?),
    };

    let shared = match config::read() {
        Ok(cfg) => cfg,
        Err(err) => return Ok(write_failure(mode, err.into())?),
    };
    if remote && shared.remote.is_none() {
        let cfg_path = config::path()
            .map(|p| p.display().to_string())
            .unwrap_or_default();
        return Ok(write_failure(
            mode,
            Failure {
                message: format!("remote previews are not configured in {cfg_path}"),
                summary: None,
                hint: Some(
                    "Configure the [remote] table in the devhost machine config before starting with --remote."
                        .to_owned(),
                ),
            },
        )?);
    }

    let remote_settings = if local { None } else { shared.remote.clone() };
    let mut resolved = match resolve_service_ports(
        &validated,
        &PortResolutionOptions {
            requested: requested.clone(),
            domain_suffix: remote_settings.as_ref().map_or_else(
                || shared.domain_suffix.clone(),
                |settings| settings.domain_suffix.clone(),
            ),
            remote_mode: remote_settings.is_some(),
            remote: remote_settings.clone(),
            ..PortResolutionOptions::default()
        },
    ) {
        Ok(m) => m,
        Err(err) => return Ok(write_failure(mode, err.into())?),
    };

    let raw_idle_timeout = args
        .get_one::<String>("idle-timeout")
        .filter(|s| !s.is_empty())
        .cloned();
    let idle_timeout = match raw_idle_timeout.as_deref() {
        Some(raw) => match manifest::parse_go_duration(raw) {
            Ok(duration) => Some(duration),
            Err(_) => {
                return Ok(write_failure(
                    mode,
                    Failure {
                        message: format!("invalid idle-timeout: time: invalid duration {raw:?}"),
                        summary: Some(format!("the idle timeout {raw:?} is not a duration")),
                        hint: Some(
                            "Set --idle-timeout or DEVHOST_IDLE_TIMEOUT to a value such as 30s or 1m."
                                .to_owned(),
                        ),
                    },
                )?);
            }
        },
        None => None,
    };

    let state_dir = match machine::state_directory() {
        Ok(dir) => dir,
        Err(err) => return Ok(write_failure(mode, err.into())?),
    };
    let mut environment: BTreeMap<String, String> = env::vars().collect();
    let launch = take_launch_metadata(&mut environment);
    // SAFETY: run_start runs on the main thread before spawning worker threads.
    unsafe {
        env::remove_var(DETACHED_LOG_ENV);
        env::remove_var(STACK_LOG_ENV);
    }

    if args.get_flag("detach") {
        let mut child_args = vec![
            "start".to_owned(),
            "--manifest".to_owned(),
            resolved.manifest_path.to_string_lossy().into_owned(),
        ];
        if args.get_flag("debug") {
            child_args.push("--debug".to_owned());
        }
        child_args.push(
            if remote_settings.is_some() {
                "--remote"
            } else {
                "--local"
            }
            .to_owned(),
        );
        if let Some(raw) = raw_idle_timeout {
            child_args.push("--idle-timeout".to_owned());
            child_args.push(raw);
        }
        child_args.push("--".to_owned());
        child_args.extend(requested);

        let output = cliout::ServiceOutput::stdio(mode, &["devhost"]);
        return Ok(
            match start_detached_stack(DetachedStartOptions {
                manifest: resolved,
                arguments: child_args,
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
            }) {
                Ok(()) => ExitCode::SUCCESS,
                Err(failure) => write_failure(mode, failure)?,
            },
        );
    }

    let caddy_dir = paths::clean(&state_dir.join("caddy"));
    let mut label_names: Vec<String> = vec![
        resolved.name.trim().to_owned(),
        "devhost".to_owned(),
        "caddy".to_owned(),
    ];
    label_names.extend(service_order.iter().cloned());
    let label_refs: Vec<&str> = label_names.iter().map(String::as_str).collect();
    let output = cliout::ServiceOutput::stdio(mode, &label_refs);

    match start_stack(
        &mut resolved,
        &service_order,
        StartStackOptions {
            runtime_control: None,
            serve_session: false,
            runtime_errors: None,
            configuration: Some(validated),
            caddy_dir,
            config_path: None,
            environment,
            output,
            debug_caddy: args.get_flag("debug"),
            shutdown_grace_period: None,
            idle_timeout,
            install_signal_handlers: true,
            external_cancel: None,
            launch,
        },
    ) {
        Ok(code) => Ok(ExitCode::from((code & 0xff) as u8)),
        Err(StartStackError::Overlap(overlap)) => {
            let env_manifest = env::var_os("DEVHOST_MANIFEST").map(PathBuf::from);
            let message = format_overlap_for_cwd(&overlap, &cwd, env_manifest.as_deref());
            Ok(write_failure(mode, message.into())?)
        }
        Err(StartStackError::Failure(failure)) => Ok(write_failure(mode, failure)?),
    }
}

fn run_stop(args: &clap::ArgMatches, mode: Mode) -> Result<ExitCode, Box<dyn Error>> {
    let explicit_manifest = args.get_one::<PathBuf>("manifest").map(PathBuf::as_path);
    if let Err(failure) = validate_manifest_flag(explicit_manifest) {
        return Ok(write_failure(mode, failure)?);
    }
    let cwd = env::current_dir()?;
    let manifest_path = match explicit_manifest {
        Some(path) if path.is_absolute() => paths::clean(path),
        Some(path) => paths::clean(&cwd.join(path)),
        None => match manifest::resolve_path(&cwd, None) {
            Ok(path) => path,
            Err(failure) => return Ok(write_failure(mode, failure)?),
        },
    };
    let state_dir = match machine::state_directory() {
        Ok(dir) => dir,
        Err(err) => return Ok(write_failure(mode, err.into())?),
    };
    let caddy_dir = paths::clean(&state_dir.join("caddy"));
    let output = cliout::ServiceOutput::stdio(mode, &["devhost"]);
    match stop_stack(
        &StopStackOptions {
            manifest_path,
            worktrees: args.get_flag("worktrees"),
            grace_period: None,
        },
        &caddy_dir,
        &output,
    ) {
        Ok(()) => Ok(ExitCode::SUCCESS),
        Err(err) => Ok(write_failure(mode, err.into())?),
    }
}

fn stack_command() -> Command {
    Command::new("stack")
        .about("Inspect the stacks running on this machine")
        .subcommand(Command::new("info").args_override_self(true).about("Inspect the current project's running stack and service readiness").arg(manifest_arg()))
        .subcommand(Command::new("list")
            .about("Print the PID and manifest of running stacks")
            .long_about("Print one running stack per line: PID, tab, absolute manifest path.\nWorks from any directory, with identical output in both modes."))
        .subcommand(Command::new("find")
            .about("Find running stacks by hostname, URL, name, or manifest")
            .arg(Arg::new("query").required(true)))
        .subcommand(Command::new("restart")
            .args_override_self(true)
            .about("Restart the running stack for this project")
            .arg(manifest_arg())
            .arg(boolean_arg("all").short('a')
                .help("Restart the current project's whole stack.")))
}

fn list_stacks(
    query: Option<&str>,
    mode: Mode,
    stdout: &mut dyn Write,
) -> Result<ExitCode, Box<dyn Error>> {
    let result = (|| {
        let state = machine::state_directory()
            .map_err(|error| format!("resolve caddy paths from environment: {error}"))?;
        let caddy = paths::clean(&state.join("caddy"));
        let owners = match query {
            Some(query) => caddy::stacks::find_live_stack_owners(
                &caddy,
                query,
                &env::current_dir().map_err(|error| error.to_string())?,
            ),
            None => caddy::stacks::read_live_stack_owners(&caddy)
                .map_err(|error| format!("scan record directories for running stacks: {error}")),
        }?;
        for owner in owners {
            // This is the raw TSV contract consumed by stop --manifest, in both
            // output modes; retain the absolute manifest identity.
            writeln!(stdout, "{}\t{}", owner.pid, owner.manifest_path)
                .map_err(|error| format!("write running stacks: {error}"))?;
        }
        stdout
            .flush()
            .map_err(|error| format!("write running stacks: {error}"))
    })();
    Ok(match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => write_failure(mode, message.into())?,
    })
}

fn run_stack_info(
    args: &clap::ArgMatches,
    mode: Mode,
    stdout: &mut dyn Write,
) -> Result<ExitCode, Box<dyn Error>> {
    let explicit = args.get_one::<PathBuf>("manifest").map(PathBuf::as_path);
    if let Err(failure) = validate_manifest_flag(explicit) {
        return Ok(write_failure(mode, failure)?);
    }
    let cwd = env::current_dir()?;
    let manifest = match explicit {
        Some(path) => paths::clean(&cwd.join(path)),
        None => match manifest::resolve_path(&cwd, None) {
            Ok(path) => path,
            Err(mut failure) => {
                failure
                    .message
                    .push_str(" Pass --manifest <path> or set DEVHOST_MANIFEST.");
                failure.hint = Some(
                    "Run devhost from your project folder, or pass --manifest <path>.".to_owned(),
                );
                return Ok(write_failure(mode, failure)?);
            }
        },
    };
    let state = match machine::state_directory() {
        Ok(state) => state,
        Err(error) => return Ok(write_failure(mode, error.into())?),
    };
    match devhost_rust::services::stack_info::read_stack_info(
        &paths::clean(&state.join("caddy")),
        &manifest,
    ) {
        Ok(info) => {
            let output = devhost_rust::services::stack_info::format_stack_info(
                &info,
                mode,
                std::time::SystemTime::now(),
            );
            if let Err(error) = stdout
                .write_all(output.as_bytes())
                .and_then(|_| stdout.flush())
            {
                return Ok(write_failure(
                    mode,
                    format!("writing stack info: {error}").into(),
                )?);
            }
            Ok(if info.ready {
                ExitCode::SUCCESS
            } else {
                ExitCode::FAILURE
            })
        }
        Err(error) => Ok(write_failure(mode, error)?),
    }
}

fn run_stack_restart(args: &clap::ArgMatches, mode: Mode) -> Result<ExitCode, Box<dyn Error>> {
    let explicit = args.get_one::<PathBuf>("manifest").map(PathBuf::as_path);
    if let Err(failure) = validate_manifest_flag(explicit) {
        return Ok(write_failure(mode, failure)?);
    }
    if args.get_flag("all") && explicit.is_some() {
        return Ok(write_failure(
            mode,
            "--all and --manifest (or DEVHOST_MANIFEST) are mutually exclusive"
                .to_owned()
                .into(),
        )?);
    }
    let cwd = env::current_dir()?;
    let manifest = match explicit {
        Some(path) => paths::clean(&cwd.join(path)),
        None => match manifest::resolve_path(&cwd, None) {
            Ok(path) => path,
            Err(failure) => return Ok(write_failure(mode, failure)?),
        },
    };
    let state = match machine::state_directory() {
        Ok(state) => state,
        Err(error) => return Ok(write_failure(mode, error.into())?),
    };
    let output = cliout::ServiceOutput::stdio(mode, &["devhost"]);
    Ok(
        match devhost_rust::services::restart::restart_stacks(
            Some(&manifest),
            &paths::clean(&state),
            &output,
        ) {
            Ok(()) => ExitCode::SUCCESS,
            Err(error) => write_failure(mode, error.into())?,
        },
    )
}

fn finish_caddy(mode: Mode, result: Result<(), Failure>) -> io::Result<ExitCode> {
    match result {
        Ok(()) => Ok(ExitCode::SUCCESS),
        Err(failure) => write_failure(mode, failure),
    }
}

fn caddy_command() -> Command {
    Command::new("caddy")
        .about("Set up and control the shared HTTPS proxy")
        .long_about("devhost sends every stack through one shared Caddy server.\nDownload and trust it once, then start it before running\na stack.")
        .subcommand(Command::new("download").about("Download the Caddy server devhost uses"))
        .subcommand(Command::new("print-root-cert").about("Print Caddy's root certificate"))
        .subcommand(
            Command::new("privileged-ports")
                .about("Let Caddy listen on low ports without root (Linux)"),
        )
        .subcommand(Command::new("start").about("Start the shared Caddy server"))
        .subcommand(Command::new("stop").about("Stop the shared Caddy server"))
        .subcommand(
            Command::new("trust")
                .about("Trust Caddy's certificate on this machine (asks for your password)"),
        )
        .subcommand(Command::new("trust-remote")
            .about("Trust a remote machine's Caddy certificate (macOS)")
            .arg(Arg::new("ssh-target").value_name("ssh-target")))
}

fn service_command() -> Command {
    Command::new("service")
        .about("Inspect the services in devhost.toml")
        .subcommand(
            Command::new("list")
                .args_override_self(true)
                .about("Print the service names in devhost.toml")
                .arg(manifest_arg())
                .arg(
                    boolean_arg("startable")
                        .short('s')
                        .help("List only the services that start when named"),
                ),
        )
}

fn list_services(
    args: &clap::ArgMatches,
    mode: Mode,
    stdout: &mut impl Write,
) -> Result<ExitCode, Box<dyn Error>> {
    let cwd = std::env::current_dir()?;
    match manifest::service_names(
        &cwd,
        args.get_one::<PathBuf>("manifest").map(PathBuf::as_path),
        args.get_flag("startable"),
    ) {
        Ok(names) => {
            for name in names {
                writeln!(stdout, "{name}")?;
            }
            stdout.flush()?;
            Ok(ExitCode::SUCCESS)
        }
        Err(failure) => Ok(write_failure(mode, failure)?),
    }
}

fn write_failure(mode: Mode, failure: Failure) -> io::Result<ExitCode> {
    let mut stderr = io::stderr().lock();
    cliout::write_failure(mode, &mut stderr, &failure)?;
    Ok(ExitCode::FAILURE)
}

#[cfg(test)]
mod argument_tests {
    use super::*;

    #[test]
    fn short_flags_and_explicit_booleans_use_the_native_parser() {
        let args = start_command()
            .try_get_matches_from([
                "start",
                "-d=false",
                "--detach=0",
                "-l=1",
                "-r=F",
                "-i",
                "30s",
            ])
            .unwrap();
        assert!(!args.get_flag("debug"));
        assert!(!args.get_flag("detach"));
        assert!(args.get_flag("local"));
        assert!(!args.get_flag("remote"));
        assert_eq!(args.get_one::<String>("idle-timeout").unwrap(), "30s");
        let args = stop_command().try_get_matches_from(["stop", "-w"]).unwrap();
        assert!(args.get_flag("worktrees"));
        let args = stack_command()
            .try_get_matches_from(["stack", "restart", "-a=false"])
            .unwrap();
        assert!(!args.subcommand_matches("restart").unwrap().get_flag("all"));
    }
}
