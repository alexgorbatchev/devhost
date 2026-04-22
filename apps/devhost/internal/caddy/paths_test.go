package caddy

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestResolveDevhostStateDirectoryPath(t *testing.T) {
	t.Parallel()

	tests := []struct {
		environment map[string]string
		name        string
		want        string
		wantError   string
	}{
		{
			name:        "prefers devhost state dir",
			environment: map[string]string{"DEVHOST_STATE_DIR": " /tmp/devhost-state "},
			want:        "/tmp/devhost-state",
		},
		{
			name:        "preserves relative devhost state dir",
			environment: map[string]string{"DEVHOST_STATE_DIR": " .tmp/devhost-state "},
			want:        ".tmp/devhost-state",
		},
		{
			name:        "falls back to xdg state home",
			environment: map[string]string{"XDG_STATE_HOME": " /tmp/xdg-state "},
			want:        filepath.Join("/tmp/xdg-state", "devhost"),
		},
		{
			name:        "falls back to home local state",
			environment: map[string]string{"HOME": " /tmp/home "},
			want:        filepath.Join("/tmp/home", ".local", "state", "devhost"),
		},
		{
			name:        "rejects missing environment home",
			environment: map[string]string{"HOME": "   ", "XDG_STATE_HOME": "   ", "DEVHOST_STATE_DIR": "   "},
			wantError:   "Could not determine the devhost state directory. Set DEVHOST_STATE_DIR or HOME.",
		},
	}

	for _, tt := range tests {
		tc := tt
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			homeDirectoryPath := strings.TrimSpace(tc.environment["HOME"])
			got, error := resolveDevhostStateDirectoryPath(tc.environment, homeDirectoryPath)
			if tc.wantError != "" {
				if error == nil {
					t.Fatalf("ResolveDevhostStateDirectoryPath(...) error = nil, want %q", tc.wantError)
				}

				if error.Error() != tc.wantError {
					t.Fatalf("ResolveDevhostStateDirectoryPath(...) error = %q, want %q", error.Error(), tc.wantError)
				}

				return
			}

			if error != nil {
				t.Fatalf("ResolveDevhostStateDirectoryPath(...) unexpected error = %v", error)
			}

			if got != tc.want {
				t.Fatalf("ResolveDevhostStateDirectoryPath(...) = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestCreateManagedCaddyPaths(t *testing.T) {
	t.Parallel()

	paths := CreateManagedCaddyPaths("/tmp/devhost-state")

	if paths.StateDirectoryPath != "/tmp/devhost-state" {
		t.Fatalf("paths.StateDirectoryPath = %q, want %q", paths.StateDirectoryPath, "/tmp/devhost-state")
	}

	if paths.CaddyDirectoryPath != "/tmp/devhost-state/caddy" {
		t.Fatalf("paths.CaddyDirectoryPath = %q, want %q", paths.CaddyDirectoryPath, "/tmp/devhost-state/caddy")
	}

	if paths.CaddyfilePath != "/tmp/devhost-state/caddy/Caddyfile" {
		t.Fatalf("paths.CaddyfilePath = %q, want %q", paths.CaddyfilePath, "/tmp/devhost-state/caddy/Caddyfile")
	}

	if paths.HostClaimsDirectoryPath != "/tmp/devhost-state/caddy/routes/.host-claims" {
		t.Fatalf("paths.HostClaimsDirectoryPath = %q, want %q", paths.HostClaimsDirectoryPath, "/tmp/devhost-state/caddy/routes/.host-claims")
	}

	if paths.PidFilePath != "/tmp/devhost-state/caddy/caddy.pid" {
		t.Fatalf("paths.PidFilePath = %q, want %q", paths.PidFilePath, "/tmp/devhost-state/caddy/caddy.pid")
	}

	if paths.PortClaimsDirectoryPath != "/tmp/devhost-state/caddy/port-claims" {
		t.Fatalf("paths.PortClaimsDirectoryPath = %q, want %q", paths.PortClaimsDirectoryPath, "/tmp/devhost-state/caddy/port-claims")
	}

	if paths.RegistrationsDirectoryPath != "/tmp/devhost-state/caddy/routes/.registrations" {
		t.Fatalf("paths.RegistrationsDirectoryPath = %q, want %q", paths.RegistrationsDirectoryPath, "/tmp/devhost-state/caddy/routes/.registrations")
	}

	if paths.RootCertificatePath != "/tmp/devhost-state/caddy/storage/pki/authorities/local/root.crt" {
		t.Fatalf("paths.RootCertificatePath = %q, want %q", paths.RootCertificatePath, "/tmp/devhost-state/caddy/storage/pki/authorities/local/root.crt")
	}

	if paths.RoutesDirectoryPath != "/tmp/devhost-state/caddy/routes" {
		t.Fatalf("paths.RoutesDirectoryPath = %q, want %q", paths.RoutesDirectoryPath, "/tmp/devhost-state/caddy/routes")
	}

	if paths.StorageDirectoryPath != "/tmp/devhost-state/caddy/storage" {
		t.Fatalf("paths.StorageDirectoryPath = %q, want %q", paths.StorageDirectoryPath, "/tmp/devhost-state/caddy/storage")
	}
}

func TestCreateManagedCaddyPathsForRoutesDirectory(t *testing.T) {
	t.Parallel()

	paths := CreateManagedCaddyPathsForRoutesDirectory("/tmp/devhost-state/caddy/routes")
	if paths.StateDirectoryPath != "/tmp/devhost-state" {
		t.Fatalf("paths.StateDirectoryPath = %q, want %q", paths.StateDirectoryPath, "/tmp/devhost-state")
	}
}

func TestResolveManagedCaddyAdminAddress(t *testing.T) {
	t.Parallel()

	if got := ResolveManagedCaddyAdminAddress("  "); got != DefaultManagedCaddyAdminAddress {
		t.Fatalf("ResolveManagedCaddyAdminAddress(...) = %q, want %q", got, DefaultManagedCaddyAdminAddress)
	}

	if got := ResolveManagedCaddyAdminAddress(" 127.0.0.1:9999 "); got != "127.0.0.1:9999" {
		t.Fatalf("ResolveManagedCaddyAdminAddress(...) = %q, want %q", got, "127.0.0.1:9999")
	}
}

func TestCreateCaddyAdminAPIURL(t *testing.T) {
	t.Parallel()

	if got := CreateCaddyAdminAPIURL("127.0.0.1:20197"); got != "http://127.0.0.1:20197/config/" {
		t.Fatalf("CreateCaddyAdminAPIURL(...) = %q, want %q", got, "http://127.0.0.1:20197/config/")
	}
}
