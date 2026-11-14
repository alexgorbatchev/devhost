package manifest

import "path/filepath"

// ResolveWatchPath keeps validation and runtime watches relative to the service's
// effective cwd, including when that cwd moves to another worktree.
func ResolveWatchPath(cwd, path string) string {
	if filepath.IsAbs(path) {
		return filepath.Clean(path)
	}
	return filepath.Join(cwd, path)
}
