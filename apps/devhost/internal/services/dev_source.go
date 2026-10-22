package services

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/devtools"
)

// devSourceDirectoryEnvironmentVariable points devhost at its own source
// checkout so the injected devtools UI is rebuilt from source on page reload.
// It is a contributor-only switch and is never exposed as a CLI flag.
const devSourceDirectoryEnvironmentVariable = "DEVHOST_DEV_SOURCE_DIR"

// resolveDevSourceDirectory returns the absolute checkout path, or "" when the
// variable is unset. Relative paths resolve against the manifest directory so
// the result does not depend on where devhost was launched from.
func resolveDevSourceDirectory(environment map[string]string, manifestDirectoryPath string) string {
	sourceDirectoryPath := environment[devSourceDirectoryEnvironmentVariable]
	if sourceDirectoryPath == "" {
		sourceDirectoryPath = os.Getenv(devSourceDirectoryEnvironmentVariable)
	}

	if sourceDirectoryPath == "" || filepath.IsAbs(sourceDirectoryPath) {
		return sourceDirectoryPath
	}

	return filepath.Join(manifestDirectoryPath, sourceDirectoryPath)
}

// loadDevSourceCheckout prefers the variable, then the checkout a development
// build names (builtInDirectoryPath), and returns nil when neither is set. A
// variable that is not a devhost checkout is an error naming it. A built-in
// checkout that has moved or been deleted only warns: the binary keeps serving
// its embedded assets, because it runs every project's stack, not only devhost's.
func loadDevSourceCheckout(environment map[string]string, manifestDirectoryPath string, builtInDirectoryPath string) (*devtools.DevSourceCheckout, string, error) {
	sourceDirectoryPath := resolveDevSourceDirectory(environment, manifestDirectoryPath)
	if sourceDirectoryPath != "" {
		checkout, err := devtools.NewDevSourceCheckout(sourceDirectoryPath)
		if err != nil {
			return nil, "", fmt.Errorf("%s: %w", devSourceDirectoryEnvironmentVariable, err)
		}

		return checkout, "", nil
	}

	if builtInDirectoryPath == "" {
		return nil, "", nil
	}

	checkout, err := devtools.NewDevSourceCheckout(builtInDirectoryPath)
	if err != nil {
		return nil, fmt.Sprintf("This development build serves its embedded devtools assets: %v", err), nil
	}

	return checkout, "", nil
}
