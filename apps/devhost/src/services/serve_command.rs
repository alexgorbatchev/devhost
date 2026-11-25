use std::{
    collections::{BTreeMap, BTreeSet},
    path::{Path, PathBuf},
    time::Duration,
};

use super::{
    resolve::{HealthKind, ResolvedHealthConfig, ResolvedManifest, ResolvedService},
    stack::{StartStackError, StartStackOptions, start_stack},
};
use crate::{
    config,
    manifest::{DevtoolsConfig, ServiceLifecycleConfig, WorktreesConfig, is_valid_host},
};

pub fn resolve_command(
    directory: &Path,
    command: Vec<String>,
    name: &str,
    session: &str,
    timeout: Duration,
) -> Result<ResolvedManifest, String> {
    if command.is_empty() || timeout.is_zero() {
        return Err("command and positive startup timeout are required".to_owned());
    }
    let directory = std::path::absolute(directory).map_err(|error| error.to_string())?;
    let shared = config::read()?;
    let suffix_label = shared.domain_suffix.split('.').next().unwrap_or_default();
    let limit = 48usize
        .checked_sub(suffix_label.len())
        .filter(|limit| *limit > 0)
        .ok_or_else(|| "domain suffix leaves no room for command session hostnames".to_owned())?;
    let session = if session.is_empty() {
        let inferred = if name.is_empty() {
            infer_name(&directory, &command)
        } else {
            name.to_owned()
        };
        let mut label = name_label(&inferred);
        label.truncate(limit);
        let mut id = [0u8; 4];
        getrandom::fill(&mut id).map_err(|error| format!("generate session ID: {error}"))?;
        format!(
            "{}-{}",
            label.trim_end_matches('-'),
            id.iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>()
        )
    } else {
        session.to_owned()
    };
    if session.contains('.')
        || session.len() > 57usize.saturating_sub(suffix_label.len())
        || !is_valid_host(&format!("{session}-65535{}", shared.domain_suffix))
    {
        return Err(format!("invalid command session label {session:?}"));
    }
    let service = ResolvedService {
        proxy_local_origin: false,
        bind_host: String::new(),
        command,
        serve: String::new(),
        cwd: directory.clone(),
        depends_on: Vec::new(),
        env: BTreeMap::new(),
        health: ResolvedHealthConfig {
            fixed_tcp_port: false,
            host: None,
            interval_ms: 200,
            kind: HealthKind::Process,
            port: None,
            retries: 0,
            timeout_ms: timeout
                .as_millis()
                .try_into()
                .map_err(|_| "startup timeout is too large")?,
            url: None,
        },
        hosts: Vec::new(),
        inject_port: false,
        lifecycle: ServiceLifecycleConfig::default(),
        managed: true,
        name: "command".to_owned(),
        path: None,
        port: None,
        port_source: String::new(),
        watch: Vec::new(),
    };
    Ok(ResolvedManifest {
        remote: None,
        configuration: None,
        requested: Vec::new(),
        caddy: shared.caddy,
        domain_suffix: shared.domain_suffix,
        devtools: DevtoolsConfig::default(),
        worktrees: WorktreesConfig::default(),
        manifest_directory: directory,
        manifest_path: PathBuf::new(),
        name: session,
        primary_service: "command".to_owned(),
        service_order: vec!["command".to_owned()],
        services: BTreeMap::from([("command".to_owned(), service)]),
        stopped: BTreeMap::new(),
        kill_zombies: false,
    })
}

pub fn start_command(
    manifest: &mut ResolvedManifest,
    timeout: Duration,
    mut options: StartStackOptions,
) -> Result<i32, StartStackError> {
    options.serve_session = true;
    options.command_serve_timeout = Some(timeout);
    start_stack(manifest, &["command".to_owned()], options)
}

fn name_label(name: &str) -> String {
    let mut label = String::new();
    let mut separator = false;
    for ch in name.to_lowercase().chars() {
        if ch.is_ascii_lowercase() || ch.is_ascii_digit() {
            if separator && !label.is_empty() {
                label.push('-');
            }
            separator = false;
            label.push(ch);
        } else {
            separator = true;
        }
    }
    label.truncate(48);
    let label = label.trim_end_matches('-');
    if label.is_empty() {
        "app".to_owned()
    } else {
        label.to_owned()
    }
}

fn infer_name(directory: &Path, command: &[String]) -> String {
    let words = if command.len() == 3 && command[0] == "/bin/sh" && command[1] == "-c" {
        command_words(&command[2])
    } else {
        command.to_vec()
    };
    let mut repositories = BTreeSet::new();
    for (index, word) in words.iter().enumerate() {
        let word = word.trim_matches(['\'', '"']);
        if word.starts_with('-') || index > 0 && words[index - 1].starts_with('-') {
            continue;
        }
        let path = directory.join(word);
        let extension = path
            .extension()
            .and_then(|ext| ext.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        if ![
            "ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "rb", "go", "php", "sh",
        ]
        .contains(&extension.as_str())
            && !(index == 0 && word.contains('/'))
        {
            continue;
        }
        if path.is_file()
            && let Some(root) = git_root(path.parent().unwrap_or(directory))
        {
            repositories.insert(root);
        }
    }
    let root = if repositories.len() == 1 {
        repositories.into_iter().next()
    } else {
        git_root(directory)
    };
    if let Some(root) = root {
        if let Ok(remote) = super::stop::run_git_with_timeout(
            &root,
            &["remote", "get-url", "origin"],
            Duration::from_secs(1),
        ) {
            let remote = remote
                .trim()
                .strip_suffix('/')
                .unwrap_or(remote.trim())
                .rsplit(['/', ':'])
                .next()
                .unwrap_or_default();
            let remote = remote.strip_suffix(".git").unwrap_or(remote);
            if !remote.is_empty() {
                return remote.to_owned();
            }
        }
        return root
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned();
    }
    directory
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned()
}

fn git_root(directory: &Path) -> Option<std::path::PathBuf> {
    super::stop::run_git_with_timeout(
        directory,
        &["rev-parse", "--show-toplevel"],
        Duration::from_secs(1),
    )
    .ok()
    .map(|root| root.trim().into())
}

// Only name inference tokenizes shell text; execution always uses /bin/sh.
fn command_words(command: &str) -> Vec<String> {
    let mut words = Vec::new();
    let mut remaining = command;
    while !remaining.is_empty() {
        remaining = remaining.trim_start_matches([' ', '\t', '\n', '\r', '\u{c}']);
        let Some(first) = remaining.chars().next() else {
            break;
        };
        let end = if matches!(first, '\'' | '"')
            && let Some(end) = remaining[1..].find(first)
        {
            end + 2
        } else {
            remaining
                .find([' ', '\t', '\n', '\r', '\u{c}'])
                .unwrap_or(remaining.len())
        };
        words.push(remaining[..end].to_owned());
        remaining = &remaining[end..];
    }
    words
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn name_inference_words_match_quoted_tokens_and_unmatched_quotes() {
        assert_eq!(
            command_words("python3 'folder/server.py'next \"two words\" 'open tail"),
            [
                "python3",
                "'folder/server.py'",
                "next",
                "\"two words\"",
                "'open",
                "tail"
            ]
        );
    }

    #[test]
    fn inferred_names_use_entrypoint_repository_then_current_repository_then_directory() {
        let fixture = tempfile::tempdir().unwrap();
        let directory = fixture.path().join("working directory");
        let repository = fixture.path().join("entrypoint repo");
        std::fs::create_dir(&directory).unwrap();
        std::fs::create_dir(&repository).unwrap();
        super::super::stop::run_git(&repository, &["init", "--quiet"]).unwrap();
        super::super::stop::run_git(
            &repository,
            &[
                "remote",
                "add",
                "origin",
                "git@example.invalid:group/My-App.git",
            ],
        )
        .unwrap();
        let script = repository.join("server.py");
        std::fs::write(&script, "").unwrap();
        assert_eq!(
            infer_name(
                &directory,
                &["python3".to_owned(), script.to_string_lossy().into_owned()]
            ),
            "My-App"
        );
        assert_eq!(
            infer_name(
                &directory,
                &[
                    "/bin/sh".to_owned(),
                    "-c".to_owned(),
                    format!("python3 '{}'", script.display())
                ]
            ),
            "My-App"
        );
        assert_eq!(
            infer_name(
                &repository,
                &["python3".to_owned(), "missing.py".to_owned()]
            ),
            "My-App"
        );
        assert_eq!(
            infer_name(&directory, &["server".to_owned()]),
            "working directory"
        );
        assert_eq!(
            infer_name(
                &directory,
                &[
                    "python3".to_owned(),
                    "--ignore".to_owned(),
                    script.to_string_lossy().into_owned()
                ]
            ),
            "working directory"
        );
    }

    #[test]
    fn name_labels_are_bounded_ascii_dns_labels() {
        assert_eq!(name_label("__My Ünicode / App__"), "my-nicode-app");
        assert_eq!(name_label("---"), "app");
        assert_eq!(name_label(&"a".repeat(90)), "a".repeat(48));
        assert_eq!(
            command_words("python3 'a b.py' --flag \"c d\""),
            ["python3", "'a b.py'", "--flag", "\"c d\""]
        );
    }
}
