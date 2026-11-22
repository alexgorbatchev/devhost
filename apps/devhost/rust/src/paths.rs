use std::path::{Component, Path, PathBuf};

// Match Go's filepath.Clean without opening or following filesystem entries.
pub(crate) fn clean(path: &Path) -> PathBuf {
    let mut result = PathBuf::new();
    for component in path.components() {
        match component {
            Component::ParentDir => match result.components().next_back() {
                Some(Component::Normal(_)) => {
                    result.pop();
                }
                Some(Component::RootDir) => {}
                _ => result.push(".."),
            },
            Component::CurDir => {}
            _ => result.push(component.as_os_str()),
        }
    }
    if result.as_os_str().is_empty() {
        result.push(".");
    }
    result
}
