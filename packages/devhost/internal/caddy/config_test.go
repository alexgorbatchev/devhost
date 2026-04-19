package caddy

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestEnsureManagedCaddyConfig(t *testing.T) {
	t.Parallel()

	paths := CreateManagedCaddyPaths(t.TempDir())
	if error := os.MkdirAll(paths.RegistrationsDirectoryPath, 0o755); error != nil {
		t.Fatalf("MkdirAll(...) error = %v", error)
	}
	writeRegistration(t, filepath.Join(paths.RegistrationsDirectoryPath, "hello.localhost_web.json"), `{"appBindHost":"127.0.0.1","host":"hello.localhost","path":"/","httpEnabled":false}`)
	writeRegistration(t, filepath.Join(paths.RegistrationsDirectoryPath, "api.localhost_api.json"), `{"appBindHost":"127.0.0.1","host":"api.localhost","path":"/v1","httpEnabled":true,"caddyAdminAddress":"127.0.0.1:22000","caddyBindHost":"0.0.0.0","caddyHttpPort":8080,"caddyHttpsPort":4443}`)
	writeRouteFile(t, filepath.Join(paths.RoutesDirectoryPath, "hello.localhost.caddy"))
	writeRouteFile(t, filepath.Join(paths.RoutesDirectoryPath, "api.localhost.caddy"))

	if error := ensureManagedCaddyConfig(paths, ManagedCaddyConfigFallback{AdminAddress: "127.0.0.1:23000", RuntimeOS: "linux"}); error != nil {
		t.Fatalf("ensureManagedCaddyConfig(...) unexpected error = %v", error)
	}

	for _, directoryPath := range []string{paths.CaddyDirectoryPath, paths.RoutesDirectoryPath, paths.HostClaimsDirectoryPath, paths.PortClaimsDirectoryPath, paths.RegistrationsDirectoryPath, paths.StorageDirectoryPath} {
		if !pathExists(directoryPath) {
			t.Fatalf("ensureManagedCaddyConfig(...) missing directory %q", directoryPath)
		}
	}

	caddyfile, error := os.ReadFile(paths.CaddyfilePath)
	if error != nil {
		t.Fatalf("ReadFile(...) error = %v", error)
	}
	caddyfileText := string(caddyfile)
	if !strings.Contains(caddyfileText, "    admin 127.0.0.1:22000") || !strings.Contains(caddyfileText, "    default_bind 0.0.0.0 [::]") {
		t.Fatalf("caddyfileText = %q, want registration settings to win", caddyfileText)
	}
	if !strings.Contains(caddyfileText, "http://:8080 {") || !strings.Contains(caddyfileText, "https://:4443 {") {
		t.Fatalf("caddyfileText = %q, want merged listener ports", caddyfileText)
	}

	sitePaths := createManagedCaddyNotFoundSitePaths(paths.CaddyDirectoryPath)
	pageText, error := os.ReadFile(sitePaths.PagePath)
	if error != nil {
		t.Fatalf("ReadFile(...) error = %v", error)
	}
	if !strings.Contains(string(pageText), `href="https://api.localhost:4443/v1"`) {
		t.Fatalf("pageText = %q, want synced not-found page", string(pageText))
	}
}

func TestEnsureManagedCaddyConfigFallbackAdminAddress(t *testing.T) {
	t.Parallel()

	paths := CreateManagedCaddyPaths(t.TempDir())
	if error := ensureManagedCaddyConfig(paths, ManagedCaddyConfigFallback{AdminAddress: "127.0.0.1:23000", RuntimeOS: "linux"}); error != nil {
		t.Fatalf("ensureManagedCaddyConfig(...) unexpected error = %v", error)
	}

	caddyfile, error := os.ReadFile(paths.CaddyfilePath)
	if error != nil {
		t.Fatalf("ReadFile(...) error = %v", error)
	}
	if !strings.Contains(string(caddyfile), "    admin 127.0.0.1:23000") {
		t.Fatalf("caddyfile = %q, want fallback admin address", string(caddyfile))
	}
}

func TestReadManagedCaddyGlobalSettingsRejectsConflicts(t *testing.T) {
	t.Parallel()

	tests := []struct {
		first     string
		name      string
		second    string
		wantError string
	}{
		{
			name:      "admin address",
			first:     `{"appBindHost":"127.0.0.1","caddyAdminAddress":"127.0.0.1:22000"}`,
			second:    `{"appBindHost":"127.0.0.1","caddyAdminAddress":"127.0.0.1:23000"}`,
			wantError: "Managed Caddy admin address is inconsistent across active stacks: 127.0.0.1:22000, 127.0.0.1:23000.",
		},
		{
			name:      "bind host",
			first:     `{"appBindHost":"127.0.0.1","caddyBindHost":"0.0.0.0"}`,
			second:    `{"appBindHost":"127.0.0.1","caddyBindHost":"127.0.0.1"}`,
			wantError: "Managed Caddy bind host is inconsistent across active stacks: 0.0.0.0, 127.0.0.1.",
		},
		{
			name:      "http port",
			first:     `{"appBindHost":"127.0.0.1","caddyHttpPort":8080}`,
			second:    `{"appBindHost":"127.0.0.1","caddyHttpPort":9090}`,
			wantError: "Managed Caddy HTTP port is inconsistent across active stacks: 8080, 9090.",
		},
		{
			name:      "https port",
			first:     `{"appBindHost":"127.0.0.1","caddyHttpsPort":4443}`,
			second:    `{"appBindHost":"127.0.0.1","caddyHttpsPort":5443}`,
			wantError: "Managed Caddy HTTPS port is inconsistent across active stacks: 4443, 5443.",
		},
	}

	for _, tt := range tests {
		tc := tt
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			paths := CreateManagedCaddyPaths(t.TempDir())
			if error := os.MkdirAll(paths.RegistrationsDirectoryPath, 0o755); error != nil {
				t.Fatalf("MkdirAll(...) error = %v", error)
			}
			writeRegistration(t, filepath.Join(paths.RegistrationsDirectoryPath, "one.json"), tc.first)
			writeRegistration(t, filepath.Join(paths.RegistrationsDirectoryPath, "two.json"), tc.second)

			_, error := readManagedCaddyGlobalSettings(paths, ManagedCaddyConfigFallback{})
			if error == nil {
				t.Fatalf("readManagedCaddyGlobalSettings(...) error = nil, want %q", tc.wantError)
			}
			if error.Error() != tc.wantError {
				t.Fatalf("readManagedCaddyGlobalSettings(...) error = %q, want %q", error.Error(), tc.wantError)
			}
		})
	}
}
