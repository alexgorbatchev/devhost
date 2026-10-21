package config

import (
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/BurntSushi/toml"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy"
)

func TestPath(t *testing.T) {
	t.Parallel()

	tests := []struct {
		environment map[string]string
		name        string
		want        string
		wantError   string
	}{
		{
			name:        "prefers devhost config dir",
			environment: map[string]string{"DEVHOST_CONFIG_DIR": " /tmp/devhost-config ", "XDG_CONFIG_HOME": "/tmp/xdg", "HOME": "/tmp/home"},
			want:        filepath.Join("/tmp/devhost-config", "config.toml"),
		},
		{
			name:        "falls back to xdg config home",
			environment: map[string]string{"XDG_CONFIG_HOME": " /tmp/xdg ", "HOME": "/tmp/home"},
			want:        filepath.Join("/tmp/xdg", "devhost", "config.toml"),
		},
		{
			name:        "falls back to home config",
			environment: map[string]string{"HOME": " /tmp/home "},
			want:        filepath.Join("/tmp/home", ".config", "devhost", "config.toml"),
		},
		{
			name:        "rejects missing environment home",
			environment: map[string]string{"HOME": "   ", "XDG_CONFIG_HOME": "   ", "DEVHOST_CONFIG_DIR": "   "},
			wantError:   "could not determine the devhost config directory; set DEVHOST_CONFIG_DIR, XDG_CONFIG_HOME, or HOME",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			got, err := resolvePath(tc.environment, strings.TrimSpace(tc.environment["HOME"]))
			if tc.wantError != "" {
				if err == nil || err.Error() != tc.wantError {
					t.Fatalf("resolvePath(...) error = %v, want %q", err, tc.wantError)
				}
				return
			}
			if err != nil {
				t.Fatalf("resolvePath(...) error = %v", err)
			}
			if got != tc.want {
				t.Fatalf("resolvePath(...) = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestRead(t *testing.T) {
	t.Parallel()

	defaults := caddy.DefaultManagedCaddyGlobalSettings()
	tests := []struct {
		name      string
		text      *string
		want      caddy.ManagedCaddyGlobalSettings
		wantError string
	}{
		{name: "missing file uses defaults", want: defaults},
		{name: "empty file uses defaults", text: new(""), want: defaults},
		{
			name: "caddy table overrides each setting",
			text: new("[caddy]\nadminAddress = \"127.0.0.1:22000\"\nbindHost = \"0.0.0.0\"\nhttp = true\nhttpPort = 8080\nhttpsPort = 8443\n"),
			want: caddy.ManagedCaddyGlobalSettings{AdminAddress: "127.0.0.1:22000", BindHost: "0.0.0.0", HTTPEnabled: true, HTTPPort: 8080, HTTPSPort: 8443},
		},
		{
			name: "omitted keys keep defaults",
			text: new("[caddy]\nhttpsPort = 8443\n"),
			want: caddy.ManagedCaddyGlobalSettings{AdminAddress: defaults.AdminAddress, BindHost: defaults.BindHost, HTTPPort: defaults.HTTPPort, HTTPSPort: 8443},
		},
		{name: "rejects unknown keys", text: new("name = \"x\"\n[caddy]\nport = 1\n"), wantError: "Unrecognized key: \"caddy.port\"\nUnrecognized key: \"name\""},
		{name: "rejects unsupported bind host", text: new("[caddy]\nbindHost = \"10.0.0.1\"\n"), wantError: "caddy.bindHost must be one of 127.0.0.1, 0.0.0.0, ::1, or ::."},
		{name: "rejects out of range port", text: new("[caddy]\nhttpsPort = 70000\n"), wantError: "caddy.httpsPort must be an integer between 1 and 65535."},
		{name: "rejects empty admin address", text: new("[caddy]\nadminAddress = \" \"\n"), wantError: "caddy.adminAddress must be a non-empty string."},
		{name: "rejects wrong value types", text: new("[caddy]\nhttp = \"yes\"\n"), wantError: "toml: line 2 (last key \"caddy.http\"): incompatible types"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			path := filepath.Join(t.TempDir(), "config.toml")
			if tc.text != nil {
				if err := os.WriteFile(path, []byte(*tc.text), 0o644); err != nil {
					t.Fatal(err)
				}
			}
			got, err := Read(path)
			if tc.wantError != "" {
				if err == nil || !strings.Contains(err.Error(), tc.wantError) {
					t.Fatalf("Read(...) error = %v, want it to contain %q", err, tc.wantError)
				}
				if !strings.Contains(err.Error(), path) {
					t.Fatalf("Read(...) error = %v, want it to name %s", err, path)
				}
				return
			}
			if err != nil {
				t.Fatalf("Read(...) error = %v", err)
			}
			if got.Caddy != tc.want {
				t.Fatalf("Read(...).Caddy = %#v, want %#v", got.Caddy, tc.want)
			}
		})
	}
}

func TestParseChecksContentThatIsNotSaved(t *testing.T) {
	t.Parallel()
	path := filepath.Join(t.TempDir(), "config.toml")

	got, err := Parse(path, []byte("[caddy]\nhttpsPort = 8443\n"))
	if err != nil || got.Caddy.HTTPSPort != 8443 {
		t.Fatalf("Parse(...) = %#v, %v; want httpsPort 8443", got.Caddy, err)
	}

	_, err = Parse(path, []byte("[caddy]\nhttpsPort = 0\nport = 1\n"))
	var validationError *ValidationError
	if !errors.As(err, &validationError) {
		t.Fatalf("Parse(...) error = %v, want a *ValidationError", err)
	}
	want := []string{"Unrecognized key: \"caddy.port\"", "caddy.httpsPort must be an integer between 1 and 65535."}
	if !slices.Equal(validationError.Issues, want) {
		t.Fatalf("issues = %q, want %q", validationError.Issues, want)
	}

	_, err = Parse(path, []byte("[caddy\n"))
	var parseError toml.ParseError
	if !errors.As(err, &parseError) || parseError.Position.Line != 2 {
		t.Fatalf("Parse(...) error = %v, want a TOML parse error on line 2", err)
	}
}
