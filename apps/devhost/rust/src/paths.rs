use std::{
    env, fs,
    path::{Component, Path, PathBuf},
};

// Match Go's filepath.Clean without opening or following filesystem entries.
pub fn clean(path: &Path) -> PathBuf {
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

// Match Go's caddy.ManifestIdentity: absolute with symlinks resolved, falling back
// to resolving the parent directory when the manifest file itself was deleted.
pub fn manifest_identity(path: &Path) -> PathBuf {
    let absolute = if path.is_absolute() {
        clean(path)
    } else if let Ok(cwd) = env::current_dir() {
        clean(&cwd.join(path))
    } else {
        return clean(path);
    };
    if let Ok(resolved) = fs::canonicalize(&absolute) {
        return resolved;
    }
    if let (Some(parent), Some(name)) = (absolute.parent(), absolute.file_name())
        && let Ok(resolved_parent) = fs::canonicalize(parent)
    {
        return resolved_parent.join(name);
    }
    absolute
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manifest_identity_resolves_symlinks_including_deleted_manifests() {
        let fixture = tempfile::tempdir().unwrap();
        let real_dir = fixture.path().join("real");
        fs::create_dir(&real_dir).unwrap();
        let manifest = real_dir.join("devhost.toml");
        fs::write(&manifest, "name = 'demo'\n").unwrap();

        #[cfg(unix)]
        {
            let link_dir = fixture.path().join("link");
            std::os::unix::fs::symlink(&real_dir, &link_dir).unwrap();
            let linked_manifest = link_dir.join("devhost.toml");
            let canonical_real = fs::canonicalize(&manifest).unwrap();
            assert_eq!(manifest_identity(&linked_manifest), canonical_real);

            fs::remove_file(&manifest).unwrap();
            assert_eq!(manifest_identity(&linked_manifest), canonical_real);
        }

        let gone = fixture.path().join("missing-dir/devhost.toml");
        assert_eq!(manifest_identity(&gone), clean(&gone));
    }
}
