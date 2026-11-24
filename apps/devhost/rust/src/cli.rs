use std::path::PathBuf;

use clap::builder::{PossibleValuesParser, TypedValueParser};
use clap::{Arg, ArgAction, Command, value_parser};

pub fn boolean_arg(name: &'static str) -> Arg {
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

pub fn serve_command() -> Command {
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
