use std::{
    error::Error,
    io::{self, Write},
    path::PathBuf,
    process::ExitCode,
};

use clap::{Arg, ArgAction, Command, error::ErrorKind, value_parser};
use cli_command_kit::{HelpOptions, Mode, SkillSource, display_message, setup, write_skill};
use devhost_rust::{Failure, caddy, machine, manifest};

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
        root.subcommand(service_command())
            .subcommand(caddy_command()),
        mode,
        &options,
    )?;
    let mut stdout = io::stdout().lock();

    match root.try_get_matches_from_mut(std::env::args_os()) {
        Ok(matches) => match matches.subcommand() {
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
                .arg(
                    Arg::new("manifest")
                        .long("manifest")
                        .short('m')
                        .env("DEVHOST_MANIFEST")
                        .value_name("path")
                        .value_parser(value_parser!(PathBuf))
                        .help("Path to the devhost.toml file to use"),
                )
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
    let (prefix, label, message) = match mode {
        Mode::Agent => ("devhost:", "ERR:", failure.message.as_str()),
        Mode::Human => (
            "devhost |",
            "[ERROR]",
            failure.summary.as_deref().unwrap_or(&failure.message),
        ),
    };
    let mut stderr = io::stderr().lock();
    for (index, line) in display_message(message).lines().enumerate() {
        if index == 0 {
            writeln!(stderr, "{prefix} {label} {line}")?;
        } else {
            writeln!(stderr, "{prefix} {line}")?;
        }
    }
    if mode == Mode::Human
        && let Some(hint) = failure.hint.as_deref()
    {
        writeln!(stderr, "{prefix} [INFO] {hint}")?;
    }
    Ok(ExitCode::FAILURE)
}
