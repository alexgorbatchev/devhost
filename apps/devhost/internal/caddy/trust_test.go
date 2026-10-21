package caddy

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy/caddytest"
)

func TestReadRootCertificateTrust(t *testing.T) {
	t.Parallel()

	directory := t.TempDir()
	untrusted := filepath.Join(directory, "untrusted.crt")
	caddytest.WriteUntrustedRootCertificate(t, untrusted)
	invalid := filepath.Join(directory, "invalid.crt")
	if err := os.WriteFile(invalid, []byte("not a certificate"), 0o644); err != nil {
		t.Fatal(err)
	}

	for _, tc := range []struct {
		name    string
		path    string
		want    RootCertificateTrust
		wantErr bool
	}{
		{name: "missing", path: filepath.Join(directory, "missing.crt"), want: RootCertificateMissing},
		{name: "untrusted", path: untrusted, want: RootCertificateUntrusted},
		{name: "invalid", path: invalid, wantErr: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			got, err := ReadRootCertificateTrust(tc.path)
			if (err != nil) != tc.wantErr {
				t.Fatalf("ReadRootCertificateTrust(%q) error = %v, wantErr %v", tc.path, err, tc.wantErr)
			}
			if got != tc.want {
				t.Fatalf("ReadRootCertificateTrust(%q) = %v, want %v", tc.path, got, tc.want)
			}
		})
	}
}

// Caddy installs its root CA on every configuration load while the CA is
// untrusted, so each route reload would ask for a password again.
func TestNativeManagedCaddyfileLeavesTrustInstallationToDevhost(t *testing.T) {
	executable, err := exec.LookPath("caddy")
	if err != nil {
		t.Skip("native Caddy is unavailable")
	}
	paths := CreateManagedCaddyPaths(t.TempDir())
	settings := DefaultManagedCaddyGlobalSettings()
	settings.AdminAddress = caddytest.UnusedAdminAddress(t)
	if err := EnsureManagedCaddyConfig(paths, settings, runtime.GOOS); err != nil {
		t.Fatal(err)
	}
	result := RunCommand([]string{executable, "adapt", "--config", paths.CaddyfilePath, "--adapter", "caddyfile"}, RunCommandOptions{WorkingDir: paths.CaddyDirectoryPath})
	if !result.Success {
		t.Fatalf("caddy adapt failed: %s", result.Stderr)
	}
	var config struct {
		Apps struct {
			PKI struct {
				CertificateAuthorities map[string]struct {
					InstallTrust *bool `json:"install_trust"`
				} `json:"certificate_authorities"`
			} `json:"pki"`
		} `json:"apps"`
	}
	if err := json.Unmarshal(result.Stdout, &config); err != nil {
		t.Fatalf("parse adapted config: %v\n%s", err, result.Stdout)
	}
	authorities := config.Apps.PKI.CertificateAuthorities
	if len(authorities) == 0 {
		t.Fatalf("adapted config has no certificate authority: %s", result.Stdout)
	}
	for id, authority := range authorities {
		if authority.InstallTrust == nil || *authority.InstallTrust {
			t.Fatalf("certificate authority %q installs its own trust: %s", id, result.Stdout)
		}
	}
}
