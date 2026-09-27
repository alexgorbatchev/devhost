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

// loadDevSourceCheckout returns nil when the variable is unset, and an error
// naming the variable when it points somewhere that is not a devhost checkout.
func loadDevSourceCheckout(environment map[string]string, manifestDirectoryPath string) (*devtools.DevSourceCheckout, error) {
	sourceDirectoryPath := resolveDevSourceDirectory(environment, manifestDirectoryPath)
	if sourceDirectoryPath == "" {
		return nil, nil
	}

	checkout, err := devtools.NewDevSourceCheckout(sourceDirectoryPath)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", devSourceDirectoryEnvironmentVariable, err)
	}

	return checkout, nil
}
