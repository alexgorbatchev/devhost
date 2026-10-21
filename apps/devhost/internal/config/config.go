// Package config reads the devhost config file: the settings one machine's
// stacks share, such as the listeners of the managed Caddy.
package config

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"github.com/BurntSushi/toml"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/choices"
)

const fileName = "config.toml"

// Config holds the settings every stack on the machine shares.
type Config struct {
	Caddy caddy.ManagedCaddyGlobalSettings
}

type fileContents struct {
	Caddy *caddyContents `toml:"caddy"`
}

type caddyContents struct {
	AdminAddress *string `toml:"adminAddress"`
	BindHost     *string `toml:"bindHost"`
	HTTP         *bool   `toml:"http"`
	HTTPPort     *int    `toml:"httpPort"`
	HTTPSPort    *int    `toml:"httpsPort"`
}

// Path returns where the devhost config file lives: config.toml in
// DEVHOST_CONFIG_DIR, else in the devhost directory of XDG_CONFIG_HOME, else in
// ~/.config/devhost on every platform, as the state directory resolves.
func Path(environment map[string]string) (string, error) {
	home := strings.TrimSpace(environment["HOME"])
	if home == "" {
		if resolved, err := os.UserHomeDir(); err == nil {
			home = strings.TrimSpace(resolved)
		}
	}

	return resolvePath(environment, home)
}

func resolvePath(environment map[string]string, home string) (string, error) {
	if dir := strings.TrimSpace(environment["DEVHOST_CONFIG_DIR"]); dir != "" {
		return filepath.Join(dir, fileName), nil
	}
	if dir := strings.TrimSpace(environment["XDG_CONFIG_HOME"]); dir != "" {
		return filepath.Join(dir, "devhost", fileName), nil
	}
	if home == "" {
		return "", errors.New("could not determine the devhost config directory; set DEVHOST_CONFIG_DIR, XDG_CONFIG_HOME, or HOME")
	}

	return filepath.Join(home, ".config", "devhost", fileName), nil
}

// Read reads and validates the config file at path. A file that does not exist
// leaves every setting at its default.
func Read(path string) (Config, error) {
	content, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return Config{Caddy: caddy.DefaultManagedCaddyGlobalSettings()}, nil
	}
	if err != nil {
		return Config{}, fmt.Errorf("read devhost config %s: %w", path, err)
	}
	return Parse(path, content)
}

// ValidationError lists every problem the settings of a config file have.
type ValidationError struct {
	Path   string
	Issues []string
}

func (e *ValidationError) Error() string {
	return fmt.Sprintf("devhost config %s is invalid:\n%s", e.Path, strings.Join(e.Issues, "\n"))
}

// Parse validates content as the config file at path, which names the file in
// errors, so content that is not saved yet can be checked.
func Parse(path string, content []byte) (Config, error) {
	result := Config{Caddy: caddy.DefaultManagedCaddyGlobalSettings()}
	var contents fileContents
	metadata, err := toml.Decode(string(content), &contents)
	if err != nil {
		return Config{}, fmt.Errorf("read devhost config %s: %w", path, err)
	}

	issues := []string{}
	for _, key := range metadata.Undecoded() {
		issues = append(issues, unrecognizedKeyPrefix+strconv.Quote(key.String()))
	}
	sort.Strings(issues)
	if contents.Caddy != nil {
		issues = append(issues, applyCaddy(*contents.Caddy, &result.Caddy)...)
	}
	if len(issues) > 0 {
		return Config{}, &ValidationError{Path: path, Issues: issues}
	}

	return result, nil
}

func applyCaddy(contents caddyContents, settings *caddy.ManagedCaddyGlobalSettings) []string {
	issues := []string{}
	if contents.AdminAddress != nil {
		if address := strings.TrimSpace(*contents.AdminAddress); address != "" {
			settings.AdminAddress = address
		} else {
			issues = append(issues, "caddy.adminAddress must be a non-empty string.")
		}
	}
	if contents.BindHost != nil {
		if caddy.IsSupportedManagedCaddyBindHost(*contents.BindHost) {
			settings.BindHost = *contents.BindHost
		} else {
			issues = append(issues, "caddy.bindHost must be one of "+choices.Format(caddy.SupportedManagedCaddyBindHosts)+".")
		}
	}
	if contents.HTTP != nil {
		settings.HTTPEnabled = *contents.HTTP
	}
	for _, port := range []struct {
		key    string
		value  *int
		target *int
	}{
		{"caddy.httpPort", contents.HTTPPort, &settings.HTTPPort},
		{"caddy.httpsPort", contents.HTTPSPort, &settings.HTTPSPort},
	} {
		if port.value == nil {
			continue
		}
		if *port.value < 1 || *port.value > 65535 {
			issues = append(issues, fmt.Sprintf("%s must be an integer between 1 and 65535.", port.key))
			continue
		}
		*port.target = *port.value
	}

	return issues
}
