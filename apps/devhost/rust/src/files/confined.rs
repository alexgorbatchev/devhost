use std::{
    fs::File,
    path::{Path, PathBuf},
    sync::Arc,
};

use cap_std::{
    ambient_authority,
    fs::{Dir, OpenOptions, OpenOptionsExt},
};

const MAX_SYMLINK_DEPTH: usize = 40;

#[derive(Debug, Clone)]
pub(super) struct ConfinedRoot {
    directory: Arc<Dir>,
    path: PathBuf,
}

impl ConfinedRoot {
    pub fn open(path: &Path) -> Result<Self, String> {
        let path = std::fs::canonicalize(path)
            .map_err(|err| format!("resolve served directory: {err}"))?;
        let directory = Dir::open_ambient_dir(&path, ambient_authority())
            .map_err(|err| format!("open served directory: {err}"))?;
        Ok(Self {
            directory: Arc::new(directory),
            path,
        })
    }

    pub fn open_file(&self, name: &str) -> Option<File> {
        let resolved = self.resolve(name)?;
        let mut options = OpenOptions::new();
        options.read(true).custom_flags(libc::O_NONBLOCK);
        // Keep confinement independent of the visibility walk: names and links
        // can change between checking them and opening the descriptor.
        let file = self
            .directory
            .open_with(resolved, &options)
            .ok()?
            .into_std();
        let metadata = file.metadata().ok()?;
        (metadata.is_file() || metadata.is_dir()).then_some(file)
    }

    fn resolve(&self, name: &str) -> Option<PathBuf> {
        if name != "."
            && (name.is_empty()
                || name
                    .split('/')
                    .any(|part| part.is_empty() || part.starts_with('.')))
        {
            return None;
        }
        if name.contains('\0') {
            return None;
        }
        let mut pending: Vec<String> = name.split('/').map(str::to_owned).collect();
        let mut resolved = PathBuf::new();
        let mut index = 0;
        let mut links = 0;
        while index < pending.len() {
            let part = pending[index].clone();
            index += 1;
            match part.as_str() {
                "" | "." => continue,
                ".." => {
                    if !resolved.pop() {
                        return None;
                    }
                    continue;
                }
                _ if part.starts_with('.') => return None,
                _ => {}
            }
            let candidate = resolved.join(&part);
            let metadata = self.directory.symlink_metadata(&candidate).ok()?;
            if metadata.file_type().is_symlink() {
                links += 1;
                if links > MAX_SYMLINK_DEPTH {
                    return None;
                }
                let target = self.directory.read_link_contents(&candidate).ok()?;
                let target = if target.is_absolute() {
                    resolved.clear();
                    target.strip_prefix(&self.path).ok()?.to_path_buf()
                } else {
                    target
                };
                // Preserve link/.. order instead of lexically cleaning it.
                let mut remaining: Vec<String> =
                    target.to_str()?.split('/').map(str::to_owned).collect();
                remaining.extend(pending.drain(index..));
                pending = remaining;
                index = 0;
            } else {
                if index < pending.len() && !metadata.is_dir() {
                    return None;
                }
                resolved.push(part);
            }
        }
        if resolved.as_os_str().is_empty() {
            resolved.push(".");
        }
        Some(resolved)
    }
}
