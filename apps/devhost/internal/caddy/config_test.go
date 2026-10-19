package caddy

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestEnsureManagedCaddyConfig(t *testing.T) {
	t.Parallel()

	configured := ManagedCaddyGlobalSettings{AdminAddress: "127.0.0.1:23000", BindHost: "0.0.0.0", HTTPEnabled: true, HTTPPort: 8080, HTTPSPort: 4443}
	running := ManagedCaddyGlobalSettings{AdminAddress: "127.0.0.1:22000", BindHost: "127.0.0.1", HTTPPort: 80, HTTPSPort: 5443}
	tests := []struct {
		name      string
		applied   *ManagedCaddyGlobalSettings
		wantLines []string
		wantLink  string
	}{
		{
			name:      "a Caddy that has not started uses the configured settings",
			wantLines: []string{"    admin 127.0.0.1:23000", "    default_bind 0.0.0.0 [::]", "http://:8080 {", "https://:4443 {"},
			wantLink:  `href="https://api.localhost:4443/v1"`,
		},
		{
			name:      "a running Caddy keeps the settings it runs",
			applied:   &running,
			wantLines: []string{"    admin 127.0.0.1:22000", "    default_bind 127.0.0.1 [::1]", "https://:5443 {"},
			wantLink:  `href="https://api.localhost:5443/v1"`,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			paths := CreateManagedCaddyPaths(t.TempDir())
			if err := os.MkdirAll(paths.RegistrationsDirectoryPath, 0o755); err != nil {
				t.Fatal(err)
			}
			writeRegistration(t, filepath.Join(paths.RegistrationsDirectoryPath, "api.localhost_api.json"), `{"appBindHost":"127.0.0.1","host":"api.localhost","path":"/v1"}`)
			writeRouteFile(t, filepath.Join(paths.RoutesDirectoryPath, "api.localhost.caddy"))
			if tc.applied != nil {
				if err := writeAppliedManagedCaddySettings(paths, *tc.applied); err != nil {
					t.Fatal(err)
				}
			}

			if err := EnsureManagedCaddyConfig(paths, configured, "linux"); err != nil {
				t.Fatalf("EnsureManagedCaddyConfig(...) unexpected error = %v", err)
			}

			for _, directoryPath := range []string{paths.CaddyDirectoryPath, paths.RoutesDirectoryPath, paths.HostClaimsDirectoryPath, paths.PortClaimsDirectoryPath, paths.RegistrationsDirectoryPath, paths.StorageDirectoryPath} {
				if !pathExists(directoryPath) {
					t.Fatalf("EnsureManagedCaddyConfig(...) missing directory %q", directoryPath)
				}
			}
			caddyfile, err := os.ReadFile(paths.CaddyfilePath)
			if err != nil {
				t.Fatal(err)
			}
			for _, line := range tc.wantLines {
				if !strings.Contains(string(caddyfile), line) {
					t.Fatalf("Caddyfile = %q, want %q", caddyfile, line)
				}
			}
			if strings.Contains(string(caddyfile), "http://:8080") != (tc.applied == nil) {
				t.Fatalf("Caddyfile = %q, HTTP listener follows the wrong settings", caddyfile)
			}
			pageText, err := os.ReadFile(createManagedCaddyNotFoundSitePaths(paths.CaddyDirectoryPath).PagePath)
			if err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(string(pageText), tc.wantLink) {
				t.Fatalf("not-found page = %q, want %s", pageText, tc.wantLink)
			}
		})
	}
}
