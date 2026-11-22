use std::{
    io::{self, Write},
    process::{Command, ExitCode},
};

use clap::{Arg, Command as Cli};

const REVIEWED: &str = include_str!("../../reviewed-go-sha");
const MAIN: &str = "refs/heads/main";

fn main() -> ExitCode {
    let args = Cli::new("go-drift")
        .about("Report Go main and published release changes for the Rust port")
        .arg(
            Arg::new("release-tag")
                .long("release-tag")
                .value_name("TAG")
                .help(
                    "Compare a specified release tag instead of querying the latest GitHub release",
                ),
        )
        .arg(
            Arg::new("reviewed-sha")
                .long("reviewed-sha")
                .value_name("SHA")
                .default_value(REVIEWED.trim())
                .help("Compare against a different reviewed commit"),
        )
        .get_matches();

    let reviewed = args
        .get_one::<String>("reviewed-sha")
        .map_or(REVIEWED.trim(), String::as_str);
    let release = args.get_one::<String>("release-tag").map(String::as_str);
    match report(reviewed, release, &mut io::stdout().lock()) {
        Ok(false) => ExitCode::SUCCESS,
        Ok(true) => ExitCode::from(2),
        Err(error) => {
            eprintln!("go-drift: {error}");
            ExitCode::FAILURE
        }
    }
}

fn report(
    reviewed: &str,
    release_override: Option<&str>,
    output: &mut impl Write,
) -> io::Result<bool> {
    if !matches!(reviewed.len(), 40 | 64) || !reviewed.bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        return Err(io::Error::other(
            "the reviewed baseline must be a full Git SHA",
        ));
    }
    let tag = match release_override {
        Some(tag) => tag.to_owned(),
        None => run(
            "gh",
            &[
                "release",
                "view",
                "--repo",
                "alexgorbatchev/devhost",
                "--json",
                "tagName",
                "--jq",
                ".tagName",
            ],
        )?
        .trim()
        .to_owned(),
    };
    let tag_ref = format!("refs/tags/{tag}");
    let peeled = format!("{tag_ref}^{{}}");
    let refs = run("git", &["ls-remote", "origin", MAIN, &tag_ref, &peeled])?;

    let main =
        remote_sha(&refs, MAIN).ok_or_else(|| io::Error::other("origin has no main branch"))?;
    let release = remote_sha(&refs, &peeled)
        .or_else(|| remote_sha(&refs, &tag_ref))
        .ok_or_else(|| io::Error::other(format!("origin has no tag {tag}")))?;
    for sha in [reviewed, main, release] {
        if run("git", &["cat-file", "-e", &format!("{sha}^{{commit}}")]).is_err() {
            return Err(io::Error::other(format!(
                "commit {sha} is unavailable locally. Run git fetch origin main --tags and retry."
            )));
        }
    }

    writeln!(output, "Reviewed Go baseline {reviewed}")?;
    writeln!(output, "Go main {main}")?;
    writeln!(output, "Go release {tag} {release}")?;
    let main_needs_reconciliation = compare(reviewed, main, "Go main", false, output)?;
    let release_needs_reconciliation = if release == main {
        writeln!(output, "Go release points to Go main.")?;
        false
    } else {
        compare(reviewed, release, "Go release", true, output)?
    };
    Ok(main_needs_reconciliation || release_needs_reconciliation)
}

fn remote_sha<'a>(refs: &'a str, name: &str) -> Option<&'a str> {
    refs.lines()
        .filter_map(|line| line.split_once('\t'))
        .find_map(|(sha, reference)| (reference == name).then_some(sha))
}

fn compare(
    baseline: &str,
    tip: &str,
    label: &str,
    may_be_older: bool,
    output: &mut impl Write,
) -> io::Result<bool> {
    let counts = run(
        "git",
        &[
            "rev-list",
            "--left-right",
            "--count",
            &format!("{baseline}...{tip}"),
        ],
    )?;
    let (behind, ahead) = counts
        .trim_end()
        .split_once('\t')
        .ok_or_else(|| io::Error::other("unexpected git rev-list output"))?;
    let needs_reconciliation = match (behind, ahead) {
        ("0", "0") => {
            writeln!(output, "{label} matches the reviewed baseline.")?;
            false
        }
        (_, "0") => {
            writeln!(
                output,
                "{label} is behind the reviewed baseline by {behind}."
            )?;
            !may_be_older
        }
        ("0", _) => {
            writeln!(output, "{label} has {ahead} untriaged commits.")?;
            false
        }
        _ => {
            writeln!(
                output,
                "{label} diverged from the reviewed baseline ({behind} behind, {ahead} ahead). Reconcile the histories before advancing the baseline."
            )?;
            true
        }
    };

    if ahead != "0" {
        let changes = run(
            "git",
            &[
                "log",
                "--full-history",
                "-m",
                "--reverse",
                "--format=%H %s",
                "--name-status",
                &format!("{baseline}..{tip}"),
            ],
        )?;
        writeln!(output, "{}", changes.trim_end())?;
    }
    Ok(needs_reconciliation)
}

fn run(program: &str, args: &[&str]) -> io::Result<String> {
    let result = Command::new(program).args(args).output().map_err(|error| {
        io::Error::new(error.kind(), format!("could not start {program}: {error}"))
    })?;
    if !result.status.success() {
        return Err(io::Error::other(format!(
            "{program} {} failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&result.stderr).trim()
        )));
    }
    String::from_utf8(result.stdout).map_err(io::Error::other)
}
