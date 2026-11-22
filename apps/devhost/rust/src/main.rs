use std::{
    error::Error,
    io::{self, Write},
    path::PathBuf,
    process::ExitCode,
};

use clap::{Arg, ArgAction, Command, error::ErrorKind, value_parser};
use cli_command_kit::{HelpOptions, Mode, SkillSource, display_message, setup, write_skill};

mod machine;
mod manifest;
mod paths;

struct Failure {
    message: String,
    summary: Option<String>,
    hint: Option<&'static str>,
}

impl From<String> for Failure {
    fn from(message: String) -> Self {
        Self {
            message,
            summary: None,
            hint: None,
        }
    }
}

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
            Some(("caddy", caddy)) if caddy.subcommand_name() == Some("print-root-cert") => {
                return Ok(match machine::print_root_certificate(&mut stdout) {
                    Ok(()) => ExitCode::SUCCESS,
                    Err(message) => write_failure(mode, message.into())?,
                });
            }
            Some((name @ ("service" | "caddy"), _)) => {
                if let Some(command) = root.find_subcommand_mut(name) {
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

fn caddy_command() -> Command {
    Command::new("caddy")
        .about("Set up and control the shared HTTPS proxy")
        .subcommand(Command::new("print-root-cert").about("Print Caddy's root certificate"))
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
        && let Some(hint) = failure.hint
    {
        writeln!(stderr, "{prefix} [INFO] {hint}")?;
    }
    Ok(ExitCode::FAILURE)
}
