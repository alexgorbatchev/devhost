// Package testenv prepares the environment of a test process.
package testenv

import (
	"fmt"
	"os"
	"path/filepath"
)

// UsePhysicalTempDir points TMPDIR at the physical path of the temporary directory, so that t.TempDir() returns
// paths without symbolic links. Git and the shell report physical paths, and tests compare those with paths they
// build from t.TempDir(). On macOS the default temporary directory sits behind the /var symbolic link.
func UsePhysicalTempDir() error {
	physical, err := filepath.EvalSymlinks(os.TempDir())
	if err != nil {
		return fmt.Errorf("resolve the temporary directory: %w", err)
	}
	return os.Setenv("TMPDIR", physical)
}

// IsolateDevhostConfig points DEVHOST_CONFIG_DIR at a new empty directory, so
// that no test reads or watches the devhost config file of the machine running
// it. A test that needs settings writes its own file and points devhost at it.
// The returned function removes the directory.
func IsolateDevhostConfig() (func(), error) {
	directoryPath, err := os.MkdirTemp("", "devhost-config-")
	if err != nil {
		return nil, fmt.Errorf("create the test config directory: %w", err)
	}
	if err := os.Setenv("DEVHOST_CONFIG_DIR", directoryPath); err != nil {
		return nil, fmt.Errorf("isolate the devhost config: %w", err)
	}
	return func() { _ = os.RemoveAll(directoryPath) }, nil // best-effort cleanup of an empty directory
}
