package caddy

import "path/filepath"

// ManifestIdentity returns the path that identifies a manifest file however a
// command names it: absolute, with every symbolic link resolved. Commands that
// look up a running stack by its manifest compare these, because a stack
// records its manifest as it was named. A manifest that no longer exists, such
// as the deleted manifest of a running stack, keeps its name in its resolved
// directory, or its absolute path when the directory is gone as well.
func ManifestIdentity(path string) string {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return filepath.Clean(path)
	}
	if resolved, err := filepath.EvalSymlinks(absolute); err == nil {
		return resolved
	}
	if directory, err := filepath.EvalSymlinks(filepath.Dir(absolute)); err == nil {
		return filepath.Join(directory, filepath.Base(absolute))
	}
	return absolute
}
