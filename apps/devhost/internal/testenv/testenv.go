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
