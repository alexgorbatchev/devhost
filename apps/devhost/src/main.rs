use std::{
    collections::BTreeMap,
    env,
    error::Error,
    io::{self, Write},
    path::{Path, PathBuf},
    process::ExitCode,
};

use clap::{Arg, ArgAction, Command, error::ErrorKind, value_parser};
use cli_command_kit::{
    HelpOptions, Mode, QuickstartItem, SkillSource, TechInfo, setup, write_skill,
};
use devhost::{
    Failure, caddy,
    cli::boolean_arg,
    cliout, config,
    daemon::{
        client::{DetachedDaemonStartOptions, run_detached, run_foreground},
        protocol::{LaunchKind, StoredLaunchSpec},
        server::run_daemon,
    },
    machine, manifest, paths,
    services::{
        detach::{DETACHED_LOG_ENV, STACK_LOG_ENV, take_launch_metadata},
        resolve::{
            PortResolutionOptions, resolve_service_order, resolve_service_ports,
            validate_requested_services,
        },
        stack::{StartStackError, format_overlap_for_cwd},
        stop::{StopStackOptions, stop_stack},
    },
};

const VERSION: &str = match option_env!("DEVHOST_BUILD_VERSION") {
    Some(version) => version,
    None => "dev",
};

mod completion;
mod serve_cli;

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
            .subcommand(serve_cli::command())
            .subcommand(stop_command())
            .subcommand(stack_command())
            .subcommand(completion::command())
            .subcommand(
                Command::new("restart-all")
                    .about("Restart every running stack with the current executable")
                    .long_about("Restart every registered stack and serve session with the current executable.\nInstances whose launch directory was removed are stopped. A file serve session\nwhose served directory cannot be opened is left running and reported as a failure.\nOther instances are restarted."),
            ),
        mode,
        &options,
    )?;
    let completion_root = root.clone();
    root = root
        .subcommand(
            Command::new("_remote-worker").hide(true).arg(
                Arg::new("state-dir")
                    .long("state-dir")
                    .required(true)
                    .value_parser(value_parser!(PathBuf)),
            ),
        )
        .subcommand(
            Command::new("_daemon").hide(true).arg(
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
                    runtime.block_on(devhost::remote::worker::run(state))?;
                    return Ok(ExitCode::SUCCESS);
                }
                Some(("_daemon", args)) => {
                    drop(stdout);
                    let state = args
                        .get_one::<PathBuf>("state-dir")
                        .expect("required state directory");
                    return Ok(match run_daemon(state, VERSION) {
                        Ok(()) => ExitCode::SUCCESS,
                        Err(error) => write_failure(mode, error.into())?,
                    });
                }
                Some(("serve", serve_matches)) => {
                    drop(stdout);
                    return serve_cli::run(serve_matches, mode);
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
                    Some(("list", args)) => {
                        return list_stacks(None, args.get_flag("sessions"), mode, &mut stdout);
                    }
                    Some(("find", args)) => {
                        return list_stacks(
                            args.get_one::<String>("query").map(String::as_str),
                            false,
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
                        match devhost::services::restart::restart_stacks(
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
                .allow_hyphen_values(true)
                .value_name("duration")
                .help("Stop the stack after this long without traffic, e.g. 30s or 1m."),
        )
        .arg(
            Arg::new("service")
                .num_args(0..)
                .help("Services or groups; omit to start every service."),
        )
}

fn stop_command() -> Command {
    Command::new("stop")
        .args_override_self(true)
        .about("Stop the running stack for this project")
        .arg(manifest_arg())
        .arg(
            Arg::new("session")
                .long("session")
                .short('s')
                .help("Stop the named manifest-free serve session."),
        )
        .arg(
            boolean_arg("worktrees")
                .short('w')
                .help("Stop stacks in every worktree of this Git repository."),
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
    if let Err(err) = resolve_service_order(&validated) {
        return Ok(write_failure(mode, err.into())?);
    }

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
    let resolved = match resolve_service_ports(
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
        Some(raw) => match manifest::parse_idle_duration(raw) {
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
    let mut environment: BTreeMap<String, String> = devhost::environment::unicode();
    let launch = take_launch_metadata(&mut environment);
    // SAFETY: run_start runs on the main thread before spawning worker threads.
    unsafe {
        env::remove_var(DETACHED_LOG_ENV);
        env::remove_var(STACK_LOG_ENV);
    }

    let spec = StoredLaunchSpec {
        kind: LaunchKind::Manifest {
            manifest_path: resolved.manifest_path.clone(),
            requested: requested.clone(),
            debug_caddy: args.get_flag("debug"),
            local: remote_settings.is_none(),
            remote: remote_settings.is_some(),
            idle_timeout_ms: idle_timeout.map(|d| d.as_millis() as u64),
        },
        cwd: cwd.clone(),
        environment: environment.clone(),
        mode: mode.into(),
        detached: args.get_flag("detach"),
        log_path: launch.log_path.clone(),
    };

    if args.get_flag("detach") {
        let output = cliout::ServiceOutput::stdio(mode, &["devhost"]);
        return Ok(
            match run_detached(DetachedDaemonStartOptions {
                manifest: resolved,
                spec,
                state_dir,
                output,
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

    match run_foreground(&state_dir, spec, mode) {
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
    if let Some(name) = args.get_one::<String>("session") {
        if args.value_source("manifest") == Some(clap::parser::ValueSource::CommandLine)
            || args.get_flag("worktrees")
        {
            return Ok(write_failure(
                mode,
                "--session is mutually exclusive with --manifest and --worktrees"
                    .to_owned()
                    .into(),
            )?);
        }
        let result = machine::state_directory().and_then(|state| {
            devhost::services::serve_sessions::stop_session(&state.join("caddy"), name)
        });
        return Ok(match result {
            Ok(()) => ExitCode::SUCCESS,
            Err(error) => write_failure(mode, error.into())?,
        });
    }
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
        .subcommand(Command::new("info").args_override_self(true).about("Inspect a project's stack or a named serve session").arg(manifest_arg()).arg(Arg::new("session").long("session").short('s').help("Inspect the named manifest-free serve session.")))
        .subcommand(Command::new("list")
            .about("Print the PID and manifest of running stacks")
            .long_about("Print one running stack per line: PID, tab, absolute manifest path.\nUse --sessions to print PID and name for manifest-free serve sessions.\nWorks from any directory, with identical output in both modes.")
            .arg(boolean_arg("sessions").short('s').help("List manifest-free serve sessions instead of project stacks.")))
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
    sessions: bool,
    mode: Mode,
    stdout: &mut dyn Write,
) -> Result<ExitCode, Box<dyn Error>> {
    let result = (|| {
        let state = machine::state_directory()
            .map_err(|error| format!("resolve caddy paths from environment: {error}"))?;
        let caddy = paths::clean(&state.join("caddy"));
        if sessions {
            for session in devhost::services::serve_sessions::list_sessions(&caddy)? {
                writeln!(stdout, "{}\t{}", session.pid, session.name)
                    .map_err(|error| format!("write running sessions: {error}"))?;
            }
            return stdout
                .flush()
                .map_err(|error| format!("write running sessions: {error}"));
        }
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
    if let Some(name) = args.get_one::<String>("session") {
        if args.value_source("manifest") == Some(clap::parser::ValueSource::CommandLine) {
            return Ok(write_failure(
                mode,
                "--session and --manifest are mutually exclusive"
                    .to_owned()
                    .into(),
            )?);
        }
        let state = match machine::state_directory() {
            Ok(state) => state,
            Err(error) => return Ok(write_failure(mode, error.into())?),
        };
        return write_stack_info(
            devhost::services::serve_sessions::read_info(&state.join("caddy"), name),
            mode,
            stdout,
        );
    }
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
    write_stack_info(
        devhost::services::stack_info::read_stack_info(
            &paths::clean(&state.join("caddy")),
            &manifest,
        ),
        mode,
        stdout,
    )
}

fn write_stack_info(
    result: Result<devhost::services::stack_info::StackInfo, Failure>,
    mode: Mode,
    stdout: &mut dyn Write,
) -> Result<ExitCode, Box<dyn Error>> {
    match result {
        Ok(info) => {
            let output = devhost::services::stack_info::format_stack_info(
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
        match devhost::services::restart::restart_stacks(
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
    fn negative_idle_durations_accept_long_and_short_flags() {
        for flag in ["--idle-timeout", "-i"] {
            let args = start_command()
                .try_get_matches_from(["start", flag, "-1ns", "--detach", "web"])
                .unwrap();
            assert_eq!(args.get_one::<String>("idle-timeout").unwrap(), "-1ns");
            assert!(args.get_flag("detach"));
            assert_eq!(
                args.get_many::<String>("service")
                    .unwrap()
                    .collect::<Vec<_>>(),
                ["web"]
            );
        }
        assert!(
            start_command()
                .try_get_matches_from(["start", "--idle-timeout", "-1ns", "--unknown"])
                .is_err()
        );
    }

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
