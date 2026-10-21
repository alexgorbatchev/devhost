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

// unreachableAdminConfig names an admin endpoint nothing listens on. The default one is the address of the Caddy the
// machine's own stacks share, so a test that falls back to it would reload that Caddy with the test's routes.
const unreachableAdminConfig = "[caddy]\nadminAddress = \"127.0.0.1:1\"\n"

// isolatedHomeVariable marks an environment whose home a test process already chose. A helper process that a test
// starts from the test binary inherits it, and keeps the home and devhost directories the test gave it.
const isolatedHomeVariable = "DEVHOST_TEST_HOME_ISOLATED"

// IsolateHome gives the test process a home directory of its own, so that no test reads, watches, or writes the
// devhost config file or state directory of the machine running it. HOME points at a new directory, and
// XDG_CONFIG_HOME, XDG_STATE_HOME, DEVHOST_CONFIG_DIR, and DEVHOST_STATE_DIR point inside it, so devhost finds them
// there whether it reads the process environment or an environment a test passes without them. The devhost config
// file there names an unreachable admin endpoint, so a test that does not set up its own Caddy fails instead of
// reaching the machine's. A test that needs settings writes its own file and points devhost at it. The returned
// function removes the directory.
//
// In a helper process started by a test, the directories the test passed it are kept, and the returned function
// does nothing.
func IsolateHome() (func(), error) {
	if os.Getenv(isolatedHomeVariable) == "1" {
		return func() {}, nil
	}
	home, err := os.MkdirTemp("", "devhost-home-")
	if err != nil {
		return nil, fmt.Errorf("create the test home directory: %w", err)
	}
	configHome := filepath.Join(home, ".config")
	stateHome := filepath.Join(home, ".local", "state")
	configDirectoryPath := filepath.Join(configHome, "devhost")
	if err := os.MkdirAll(configDirectoryPath, 0o700); err != nil {
		return nil, fmt.Errorf("create the test config directory: %w", err)
	}
	if err := os.WriteFile(filepath.Join(configDirectoryPath, "config.toml"), []byte(unreachableAdminConfig), 0o600); err != nil {
		return nil, fmt.Errorf("write the test config file: %w", err)
	}
	for name, value := range map[string]string{
		"HOME":               home,
		"XDG_CONFIG_HOME":    configHome,
		"XDG_STATE_HOME":     stateHome,
		"DEVHOST_CONFIG_DIR": configDirectoryPath,
		"DEVHOST_STATE_DIR":  filepath.Join(stateHome, "devhost"),
		isolatedHomeVariable: "1",
	} {
		if err := os.Setenv(name, value); err != nil {
			return nil, fmt.Errorf("isolate the test home: %w", err)
		}
	}
	return func() { _ = os.RemoveAll(home) }, nil // best-effort cleanup of the test home directory
}
