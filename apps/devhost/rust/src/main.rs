use std::{
    collections::BTreeMap,
    env,
    error::Error,
    io::{self, Write},
    path::{Path, PathBuf},
    process::ExitCode,
};

use clap::{Arg, ArgAction, Command, error::ErrorKind, value_parser};
use cli_command_kit::{HelpOptions, Mode, SkillSource, setup, write_skill};
use devhost_rust::{
    Failure, caddy, cliout, config, machine, manifest, paths,
    services::{
        resolve::{
            PortResolutionOptions, resolve_service_order, resolve_service_ports,
            validate_requested_services,
        },
        stack::{StartStackError, StartStackOptions, format_overlap_for_cwd, start_stack},
        stop::{StopStackOptions, stop_stack},
    },
};

const VERSION: &str = match option_env!("DEVHOST_BUILD_VERSION") {
    Some(version) => version,
    None => "dev",
};

fn main() -> Result<ExitCode, Box<dyn Error>> {
    let options = HelpOptions {
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
            .subcommand(stop_command()),
        mode,
        &options,
    )?;
    let mut stdout = io::stdout().lock();

    match root.try_get_matches_from_mut(std::env::args_os()) {
        Ok(matches) => match matches.subcommand() {
            Some(("start", start_matches)) => {
                drop(stdout);
                return run_start(start_matches, mode);
            }
            Some(("stop", stop_matches)) => {
                drop(stdout);
                return run_stop(stop_matches, mode);
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
        },
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
        .about("Start the services in devhost.toml")
        .arg(manifest_arg())
        .arg(
            Arg::new("debug")
                .long("debug")
                .short('d')
                .action(ArgAction::SetTrue)
                .help("Show Caddy's output while the stack runs."),
        )
        .arg(
            Arg::new("detach")
                .long("detach")
                .action(ArgAction::SetTrue)
                .help("Run in the background; wait until the stack is ready."),
        )
        .arg(
            Arg::new("local")
                .long("local")
                .short('l')
                .action(ArgAction::SetTrue)
                .help("Use local routing even when a remote relay is configured."),
        )
        .arg(
            Arg::new("remote")
                .long("remote")
                .action(ArgAction::SetTrue)
                .help("Require the configured remote preview relay."),
        )
        .arg(
            Arg::new("idle-timeout")
                .long("idle-timeout")
                .env("DEVHOST_IDLE_TIMEOUT")
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
        .about("Stop the running stack for this project")
        .arg(manifest_arg())
        .arg(
            Arg::new("worktrees")
                .long("worktrees")
                .action(ArgAction::SetTrue)
                .help("Stop stacks in every worktree of this Git repository."),
        )
}

fn manifest_arg() -> Arg {
    Arg::new("manifest")
        .long("manifest")
        .short('m')
        .env("DEVHOST_MANIFEST")
        .value_name("path")
        .value_parser(value_parser!(PathBuf))
        .help("Path to the devhost.toml file to use")
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
    if remote && !local {
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

    let mut resolved = match resolve_service_ports(
        &validated,
        &PortResolutionOptions {
            requested,
            domain_suffix: shared.domain_suffix.clone(),
            ..PortResolutionOptions::default()
        },
    ) {
        Ok(m) => m,
        Err(err) => return Ok(write_failure(mode, err.into())?),
    };

    let idle_timeout = match args.get_one::<String>("idle-timeout") {
        Some(raw) if !raw.is_empty() => match manifest::parse_go_duration(raw) {
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
        _ => None,
    };

    if args.get_flag("detach") {
        return Ok(write_failure(
            mode,
            "detached startup is not yet ported".to_owned().into(),
        )?);
    }

    let state_dir = match machine::state_directory() {
        Ok(dir) => dir,
        Err(err) => return Ok(write_failure(mode, err.into())?),
    };
    let caddy_dir = paths::clean(&state_dir.join("caddy"));
    let mut label_names: Vec<String> = vec![
        resolved.name.trim().to_owned(),
        "devhost".to_owned(),
        "caddy".to_owned(),
    ];
    label_names.extend(service_order.iter().cloned());
    let label_refs: Vec<&str> = label_names.iter().map(String::as_str).collect();
    let output = cliout::ServiceOutput::stdio(mode, &label_refs);
    let environment: BTreeMap<String, String> = env::vars().collect();

    match start_stack(
        &mut resolved,
        &service_order,
        StartStackOptions {
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
}

fn service_command() -> Command {
    Command::new("service")
        .about("Inspect the services in devhost.toml")
        .subcommand(
            Command::new("list")
                .about("Print the service names in devhost.toml")
                .arg(manifest_arg())
                .arg(
                    Arg::new("startable")
                        .long("startable")
                        .short('s')
                        .help("List only the services that start when named")
                        .action(ArgAction::SetTrue),
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
