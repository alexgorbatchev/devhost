package manifest

import (
	"fmt"
	"os"
	"path/filepath"
)

func ResolveManifestPath(startDirectoryPath string) (string, error) {
	currentDirectoryPath, err := filepath.Abs(startDirectoryPath)
	if err != nil {
		return "", fmt.Errorf("resolve start directory: %w", err)
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
	_, err := os.Stat(path)
	return err == nil
}
