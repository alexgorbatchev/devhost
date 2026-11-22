use std::path::Path;

use toml::de::Error;

pub(super) fn parse_error(path: &Path, text: &str, error: &Error) -> String {
    let detail = describe(text, error).unwrap_or_else(|| error.to_string());
    format!("Failed to parse {}: {detail}", path.display())
}

fn describe(text: &str, error: &Error) -> Option<String> {
    let start = error.span()?.start;
    let preceding = text.get(..start)?;
    let line_number = preceding.bytes().filter(|b| *b == b'\n').count() + 1;
    let line_start = preceding.rfind('\n').map_or(0, |newline| newline + 1);
    let line = text[line_start..].split('\n').next()?.trim();
    let mut previous_headers = preceding
        .rsplit('\n')
        .skip(1)
        .zip((1..line_number).rev())
        .map(|(line, number)| (line.trim(), number))
        .filter(|(line, _)| table_name(line).is_some());

    match error.message() {
        "duplicate key" => {
            if table_name(line).is_some() {
                let (_, first) = previous_headers.find(|(header, _)| *header == line)?;
                return Some(format!(
                    "TOML table {line} is declared more than once (lines {first} and {line_number}). Merge those settings into a single table instead of repeating the header."
                ));
            }
            let key = qualified_key(line, previous_headers)?;
            Some(format!(
                "toml: line {line_number} (last key {key:?}): Key '{key}' has already been defined."
            ))
        }
        "unclosed table, expected `]`" if text.as_bytes().get(start) == Some(&b'\n') => {
            // BurntSushi counts the unexpected newline before reporting its position.
            Some(format!(
                "toml: line {}: expected '.' or ']' to end table name, but got '\\n' instead",
                line_number + 1
            ))
        }
        "invalid basic string, expected `\"`" if text.as_bytes().get(start) == Some(&b'\n') => {
            let key = qualified_key(line, previous_headers)?;
            Some(format!(
                "toml: line {line_number} (last key {key:?}): strings cannot contain newlines"
            ))
        }
        _ => None,
    }
}

fn table_name(line: &str) -> Option<&str> {
    let (name, suffix) = line.strip_prefix('[')?.split_once(']')?;
    let is_table = !name.is_empty()
        && !name.starts_with('[')
        && (suffix.is_empty()
            || (suffix.starts_with(char::is_whitespace) && suffix.trim_start().starts_with('#')));
    is_table.then_some(name)
}

fn qualified_key<'a>(
    line: &str,
    mut headers: impl Iterator<Item = (&'a str, usize)>,
) -> Option<String> {
    let (key, _) = line.split_once('=')?;
    let key = key.trim();
    let table = headers.next().and_then(|(header, _)| table_name(header));
    Some(match table {
        Some(table) => format!("{table}.{key}"),
        None => key.to_owned(),
    })
}
