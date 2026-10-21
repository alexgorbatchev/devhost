package cliout

import (
	"os"
	"path/filepath"
	"strings"
)

// FoldPaths formats home-directory paths embedded in diagnostics. It checks
// both boundaries so sibling names and paths nested under other roots survive.
func FoldPaths(message string) string {
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return message
	}
	home = filepath.Clean(home)
	if home == string(filepath.Separator) {
		return message
	}
	var output strings.Builder
	for offset := 0; offset < len(message); {
		index := strings.Index(message[offset:], home)
		if index < 0 {
			output.WriteString(message[offset:])
			break
		}
		index += offset
		end := index + len(home)
		left := index == 0 || strings.ContainsRune(" \t\r\n\"'`=([{:", rune(message[index-1]))
		right := end == len(message) || message[end] == byte(filepath.Separator) || strings.ContainsRune(" \t\r\n\"'`:,;.)]}", rune(message[end]))
		output.WriteString(message[offset:index])
		if left && right {
			output.WriteString("~")
		} else {
			output.WriteString(home)
		}
		offset = end
	}
	return output.String()
}

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
