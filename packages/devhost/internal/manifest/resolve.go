package manifest

import (
	"fmt"
	"os"
	"path/filepath"
)

func ResolveManifestPath(startDirectoryPath string) (string, error) {
	currentDirectoryPath, error := filepath.Abs(startDirectoryPath)
	if error != nil {
		return "", fmt.Errorf("resolve start directory: %w", error)
	}

	for {
		manifestPath := filepath.Join(currentDirectoryPath, "devhost.toml")
		if pathExists(manifestPath) {
			return manifestPath, nil
		}

		if pathExists(filepath.Join(currentDirectoryPath, ".git")) {
			break
		}

		parentDirectoryPath := filepath.Dir(currentDirectoryPath)
		if parentDirectoryPath == currentDirectoryPath {
			break
		}

		currentDirectoryPath = parentDirectoryPath
	}

	return "", fmt.Errorf("Could not find devhost.toml from %s upward.", startDirectoryPath)
}

func pathExists(path string) bool {
	_, error := os.Stat(path)
	return error == nil
}
