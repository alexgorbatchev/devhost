use std::{
    collections::{BTreeSet, HashSet},
    env, fs, io,
    path::{Path, PathBuf},
};

use toml::{Table, Value};

use super::diagnostics;
use crate::{Failure, paths::clean};

pub(super) fn read(root: &Path) -> Result<Table, Failure> {
    let mut table = load(root, root, &mut HashSet::new())?;
    let mut missing = BTreeSet::new();
    for (_, value) in &mut table {
        interpolate(value, &mut missing);
    }
    if !missing.is_empty() {
        return Err(format!(
            "Failed to read {}: undefined environment variables: {}",
            root.display(),
            missing.into_iter().collect::<Vec<_>>().join(", ")
        )
        .into());
    }
    Ok(table)
}

fn load(path: &Path, root: &Path, visited: &mut HashSet<PathBuf>) -> Result<Table, Failure> {
    if !visited.insert(path.to_path_buf()) {
        return Ok(Table::new());
    }
    let text = fs::read_to_string(path).map_err(|error| read_error(path, root, error))?;
    let mut table = text
        .parse::<Table>()
        .map_err(|error| diagnostics::parse_error(path, &text, &error))?;
    let Some(patterns) = table.get("includes") else {
        return Ok(table);
    };
    let directory = path.parent().unwrap_or(Path::new("."));
    for pattern in include_patterns(patterns)? {
        let full_pattern = clean(&directory.join(&pattern));
        let glob_pattern = glob_pattern(&full_pattern.to_string_lossy());
        let paths = glob::glob(&glob_pattern)
            .map_err(|_| format!("invalid glob pattern {pattern:?}: syntax error in pattern"))?;
        let mut paths: Vec<_> = paths.filter_map(Result::ok).collect();
        paths.sort_unstable();
        for included in paths {
            let included = clean(&included);
            let mut child = load(&included, root, visited)?;
            if child.contains_key("annotation") {
                return Err(format!(
                    "annotation Unrecognized key in included manifest {}",
                    included.display()
                )
                .into());
            }
            merge(&mut table, &mut child, "groups", "group", path, &included)?;
            prepare_services(&mut child, root, &included);
            merge(
                &mut table, &mut child, "services", "service", path, &included,
            )?;
        }
    }
    Ok(table)
}

fn prepare_services(child: &mut Table, root: &Path, included: &Path) {
    if let Some(Value::Table(services)) = child.get_mut("services") {
        let root_dir = root.parent().unwrap_or(Path::new("."));
        let include_dir = included.parent().unwrap_or(Path::new("."));
        for (_, service) in services {
            let Value::Table(fields) = service else {
                continue;
            };
            if let Some(Value::String(serve)) = fields.get_mut("serve")
                && !serve.is_empty()
            {
                rewrite_path(serve, root_dir, include_dir);
            }
            if !fields.contains_key("serve") {
                fields
                    .entry("cwd")
                    .or_insert_with(|| Value::String(".".into()));
            }
            rewrite_cwd(service, root_dir, include_dir);
        }
    }
}

fn rewrite_cwd(value: &mut Value, root_dir: &Path, include_dir: &Path) {
    match value {
        Value::Table(fields) => {
            for (key, item) in fields {
                match item {
                    Value::String(path) if key == "cwd" => {
                        rewrite_path(path, root_dir, include_dir)
                    }
                    _ => rewrite_cwd(item, root_dir, include_dir),
                }
            }
        }
        Value::Array(items) => {
            for item in items {
                rewrite_cwd(item, root_dir, include_dir);
            }
        }
        _ => {}
    }
}

fn rewrite_path(value: &mut String, root_dir: &Path, include_dir: &Path) {
    let path = Path::new(value);
    if path.is_absolute() || value.contains("{{") {
        return;
    }
    let absolute = clean(&include_dir.join(path));
    let mut common = root_dir;
    let mut relative = PathBuf::new();
    loop {
        if let Ok(remainder) = absolute.strip_prefix(common) {
            relative.push(remainder);
            *value = clean(&relative).to_string_lossy().into_owned();
            return;
        }
        let Some(parent) = common.parent() else {
            *value = absolute.to_string_lossy().into_owned();
            return;
        };
        common = parent;
        relative.push("..");
    }
}

fn read_error(path: &Path, root: &Path, error: io::Error) -> Failure {
    let display = path.display();
    if error.kind() == io::ErrorKind::NotFound {
        return Failure {
            message: format!("read manifest {display}: open {display}: no such file or directory"),
            summary: (path == root).then(|| format!("manifest file not found: {display}")),
            hint: (path == root)
                .then_some("Check the path given with --manifest or DEVHOST_MANIFEST."),
        };
    }
    format!("read manifest {display}: {error}").into()
}

fn include_patterns(raw: &Value) -> Result<Vec<String>, String> {
    match raw {
        Value::String(pattern) => Ok(vec![pattern.clone()]),
        Value::Array(patterns) => patterns
            .iter()
            .map(|pattern| {
                pattern
                    .as_str()
                    .map(str::to_owned)
                    .ok_or_else(|| "includes must contain only strings".to_owned())
            })
            .collect(),
        _ => Err("includes must be a string or string array".to_owned()),
    }
}

fn glob_pattern(pattern: &str) -> String {
    // Go's filepath.Glob treats consecutive stars like one wildcard, including
    // when they occupy an entire path component.
    let mut output = String::with_capacity(pattern.len());
    let mut bracket = false;
    let mut characters = pattern.chars().peekable();
    while let Some(character) = characters.next() {
        match character {
            '\\' if cfg!(not(windows)) => {
                if let Some(literal) = characters.next() {
                    output.push_str(&glob::Pattern::escape(&literal.to_string()));
                } else {
                    // An incomplete escape is a syntax error in filepath.Glob.
                    output.push('[');
                }
            }
            '[' => {
                bracket = true;
                output.push(character);
                if characters.next_if_eq(&'^').is_some() {
                    output.push('!');
                }
            }
            ']' => {
                bracket = false;
                output.push(character);
            }
            '*' if !bracket => {
                output.push(character);
                while characters.next_if_eq(&'*').is_some() {}
            }
            _ => output.push(character),
        }
    }
    output
}

fn merge(
    parent: &mut Table,
    child: &mut Table,
    key: &str,
    singular: &str,
    parent_path: &Path,
    child_path: &Path,
) -> Result<(), String> {
    let Some(source) = child.remove(key) else {
        return Ok(());
    };
    let Value::Table(source) = source else {
        if key == "services" {
            return Ok(());
        }
        return Err(format!("{key} in {} must be a table", child_path.display()));
    };
    let target = parent
        .entry(key)
        .or_insert_with(|| Value::Table(Table::new()))
        .as_table_mut()
        .ok_or_else(|| format!("{key} in {} must be a table", parent_path.display()))?;
    for (name, value) in source {
        if target.contains_key(&name) {
            return Err(format!(
                "{singular} {name:?} is defined multiple times (conflict in {})",
                child_path.display()
            ));
        }
        target.insert(name, value);
    }
    Ok(())
}

fn interpolate(value: &mut Value, missing: &mut BTreeSet<String>) {
    match value {
        Value::String(text) if text.contains("{{") => *text = interpolate_text(text, missing),
        Value::Table(table) => {
            for (_, child) in table {
                interpolate(child, missing);
            }
        }
        Value::Array(items) => {
            for child in items {
                interpolate(child, missing);
            }
        }
        _ => {}
    }
}

fn interpolate_text(text: &str, missing: &mut BTreeSet<String>) -> String {
    let mut rest = text;
    let mut result = String::with_capacity(text.len());
    while let Some(start) = rest.find("{{") {
        let Some(end) = rest[start + 2..].find("}}").map(|end| end + start + 2) else {
            break;
        };
        result.push_str(&rest[..start]);
        let name = rest[start + 2..end]
            .trim()
            .strip_prefix("env.")
            .map(str::trim);
        if let Some(name) = name.filter(|name| valid_env_name(name)) {
            match env::var_os(name) {
                Some(value) => result.push_str(&value.to_string_lossy()),
                None => {
                    missing.insert(name.to_owned());
                }
            }
        } else {
            result.push_str(&rest[start..end + 2]);
        }
        rest = &rest[end + 2..];
    }
    result.push_str(rest);
    result
}

fn valid_env_name(name: &str) -> bool {
    fn is_start(byte: u8) -> bool {
        byte == b'_' || byte.is_ascii_alphabetic()
    }
    let mut bytes = name.bytes();
    bytes.next().is_some_and(is_start) && bytes.all(|byte| is_start(byte) || byte.is_ascii_digit())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_group_names_and_rebases_paths_from_included_services() {
        let fixture = tempfile::tempdir().unwrap();
        let root = fixture.path();
        fs::create_dir(root.join("parts")).unwrap();
        fs::write(root.join("devhost.toml"), "includes = 'parts/app.toml'").unwrap();
        fs::write(
            root.join("parts/app.toml"),
            "
            [services.web]
            cwd = '../frontend'
            [services.api]
            watch = ['.']
            [services.assets]
            serve = 'public'
            [services.templated]
            cwd = '{{stack.cwd}}'
            [services.api.env]
            cwd = 'cache'
            [groups]
            watch = ['web']
            ",
        )
        .unwrap();
        let manifest = read(&root.join("devhost.toml"))
            .unwrap_or_else(|failure| panic!("{}", failure.message));
        let services = &manifest["services"];
        assert_eq!(services["web"]["cwd"].as_str(), Some("frontend"));
        assert_eq!(services["api"]["cwd"].as_str(), Some("parts"));
        assert_eq!(
            services["api"]["env"]["cwd"].as_str(),
            Path::new("parts").join("cache").to_str()
        );
        assert_eq!(services["api"]["watch"][0].as_str(), Some("."));
        assert_eq!(
            services["assets"]["serve"].as_str(),
            Path::new("parts").join("public").to_str()
        );
        assert!(services["assets"].get("cwd").is_none());
        assert_eq!(services["templated"]["cwd"].as_str(), Some("{{stack.cwd}}"));
        assert_eq!(manifest["groups"]["watch"][0].as_str(), Some("web"));
    }
}
