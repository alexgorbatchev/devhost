use std::{
    error::Error,
    io::{self, Write},
    process::ExitCode,
};

use clap::{Arg, ArgAction, Command, error::ErrorKind};
use cli_command_kit::{HelpOptions, Mode, SkillSource, setup, write_skill};

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
    let mut root = setup(root, Mode::from_env(), &options)?;
    let mut stdout = io::stdout().lock();

    match root.try_get_matches_from_mut(std::env::args_os()) {
        Ok(matches) => {
            if !write_skill(&root, &matches, &options, &mut stdout)? {
                root.write_help(&mut stdout)?;
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
