package cliout

import (
	"os"
	"path/filepath"
	"strings"
)

// DisplayPath folds only a complete home-directory prefix for display.
func DisplayPath(path string) string {
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return path
	}
	home = filepath.Clean(home)
	if path == home {
		return "~"
	}
	prefix := strings.TrimSuffix(home, string(filepath.Separator)) + string(filepath.Separator)
	if strings.HasPrefix(path, prefix) {
		return "~/" + strings.TrimPrefix(path, prefix)
	}
	return path
}

// ShellPath quotes a displayed path while leaving its tilde available for shell expansion.
func ShellPath(path string) string {
	path = DisplayPath(path)
	if path == "~" {
		return path
	}
	prefix := ""
	if strings.HasPrefix(path, "~/") {
		prefix, path = "~/", strings.TrimPrefix(path, "~/")
	}
	return prefix + "'" + strings.ReplaceAll(path, "'", "'\"'\"'") + "'"
}
