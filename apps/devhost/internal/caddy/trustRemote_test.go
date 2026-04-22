package caddy

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"testing"
)

func TestTrustManagedCaddyRemoteCertificate(t *testing.T) {
	t.Parallel()

	certificate := []byte("-----BEGIN CERTIFICATE-----\nhello\n")
	fingerprint := sha256.Sum256(certificate)
	wantFingerprint := hex.EncodeToString(fingerprint[:])

	tests := []struct {
		name      string
		runtimeOS string
		wantError string
	}{
		{
			name:      "rejects non macos",
			runtimeOS: "linux",
			wantError: "Managed Caddy remote trust is currently supported on macOS only.",
		},
	}

	for _, tt := range tests {
		tc := tt
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			var logOutput bytes.Buffer
			_, error := TrustManagedCaddyRemoteCertificate("devbox", &logOutput, tc.runtimeOS, TrustRemoteDependencies{})
			if error == nil {
				t.Fatalf("TrustManagedCaddyRemoteCertificate(...) error = nil, want %q", tc.wantError)
			}

			if error.Error() != tc.wantError {
				t.Fatalf("TrustManagedCaddyRemoteCertificate(...) error = %q, want %q", error.Error(), tc.wantError)
			}
		})
	}

	t.Run("fetches fingerprints installs and cleans up remote certificate", func(t *testing.T) {
		t.Parallel()

		createdPath := ""
		installedPath := ""
		removedPath := ""
		var logOutput bytes.Buffer

		exitCode, error := TrustManagedCaddyRemoteCertificate("devbox", &logOutput, "darwin", TrustRemoteDependencies{
			CreateTemporaryCertificateFile: func(remoteCertificate []byte) (string, error) {
				if string(remoteCertificate) != string(certificate) {
					t.Fatalf("remote certificate = %q, want %q", string(remoteCertificate), string(certificate))
				}
				createdPath = "/tmp/devhost-remote-root.crt"
				return createdPath, nil
			},
			InstallTrustedCertificate: func(certificatePath string) error {
				installedPath = certificatePath
				return nil
			},
			RemoveTemporaryCertificateFile: func(certificatePath string) error {
				removedPath = certificatePath
				return nil
			},
			RunCommand: func(arguments []string, options RunCommandOptions) CommandResult {
				return CommandResult{Stdout: certificate, Success: true}
			},
		})

		if error != nil {
			t.Fatalf("TrustManagedCaddyRemoteCertificate(...) unexpected error = %v", error)
		}

		if exitCode != 0 {
			t.Fatalf("TrustManagedCaddyRemoteCertificate(...) exit code = %d, want 0", exitCode)
		}

		if installedPath != createdPath {
			t.Fatalf("installed path = %q, want %q", installedPath, createdPath)
		}

		if removedPath != createdPath {
			t.Fatalf("removed path = %q, want %q", removedPath, createdPath)
		}

		wantLog := "[devhost] managed caddy remote trust may prompt for your password because installing a root CA into the system trust store is privileged.\n" +
			"[devhost] managed caddy remote root sha256 from devbox: " + wantFingerprint + "\n" +
			"[devhost] managed caddy local CA from devbox trusted.\n"
		if logOutput.String() != wantLog {
			t.Fatalf("TrustManagedCaddyRemoteCertificate(...) log = %q, want %q", logOutput.String(), wantLog)
		}
	})
}

func TestReadRemoteManagedCaddyRootCertificate(t *testing.T) {
	t.Parallel()

	t.Run("runs remote print root cert command over ssh", func(t *testing.T) {
		t.Parallel()

		commands := [][]string{}
		certificate := []byte("cert")

		got, error := ReadRemoteManagedCaddyRootCertificate("devbox", TrustRemoteDependencies{
			RunCommand: func(arguments []string, options RunCommandOptions) CommandResult {
				commands = append(commands, arguments)
				return CommandResult{Stdout: certificate, Success: true}
			},
		})
		if error != nil {
			t.Fatalf("ReadRemoteManagedCaddyRootCertificate(...) unexpected error = %v", error)
		}

		if string(got) != string(certificate) {
			t.Fatalf("ReadRemoteManagedCaddyRootCertificate(...) = %q, want %q", string(got), string(certificate))
		}

		if len(commands) != 1 || len(commands[0]) != 5 || commands[0][0] != "ssh" || commands[0][1] != "devbox" || commands[0][2] != "devhost" || commands[0][3] != "caddy" || commands[0][4] != "print-root-cert" {
			t.Fatalf("ReadRemoteManagedCaddyRootCertificate(...) commands = %#v", commands)
		}
	})

	t.Run("includes remote command output on failure", func(t *testing.T) {
		t.Parallel()

		_, error := ReadRemoteManagedCaddyRootCertificate("devbox", TrustRemoteDependencies{
			RunCommand: func(arguments []string, options RunCommandOptions) CommandResult {
				return CommandResult{Stderr: []byte("ssh: Could not resolve hostname devbox"), Success: false}
			},
		})
		wantError := "Failed to fetch the managed Caddy root certificate from devbox. Check SSH access and confirm 'devhost' is installed on the remote host.\nssh: Could not resolve hostname devbox"
		if error == nil {
			t.Fatalf("ReadRemoteManagedCaddyRootCertificate(...) error = nil, want %q", wantError)
		}

		if error.Error() != wantError {
			t.Fatalf("ReadRemoteManagedCaddyRootCertificate(...) error = %q, want %q", error.Error(), wantError)
		}
	})
}

func TestInstallTrustedMacOSCertificate(t *testing.T) {
	t.Parallel()

	t.Run("uses sudo when not root", func(t *testing.T) {
		t.Parallel()

		commands := [][]string{}
		error := installTrustedMacOSCertificate("/tmp/root.crt", TrustRemoteDependencies{
			IsRootUser: func() bool {
				return false
			},
			RunCommand: func(arguments []string, options RunCommandOptions) CommandResult {
				commands = append(commands, arguments)
				return CommandResult{Success: true}
			},
		})
		if error != nil {
			t.Fatalf("installTrustedMacOSCertificate(...) unexpected error = %v", error)
		}

		want := []string{"sudo", "security", "add-trusted-cert", "-d", "-r", "trustRoot", "-k", "/Library/Keychains/System.keychain", "/tmp/root.crt"}
		if len(commands) != 1 || len(commands[0]) != len(want) {
			t.Fatalf("installTrustedMacOSCertificate(...) commands = %#v, want %#v", commands, want)
		}
	})

	t.Run("omits sudo when root", func(t *testing.T) {
		t.Parallel()

		commands := [][]string{}
		error := installTrustedMacOSCertificate("/tmp/root.crt", TrustRemoteDependencies{
			IsRootUser: func() bool {
				return true
			},
			RunCommand: func(arguments []string, options RunCommandOptions) CommandResult {
				commands = append(commands, arguments)
				return CommandResult{Success: true}
			},
			SystemKeychainPath: "/custom.keychain",
		})
		if error != nil {
			t.Fatalf("installTrustedMacOSCertificate(...) unexpected error = %v", error)
		}

		want := []string{"security", "add-trusted-cert", "-d", "-r", "trustRoot", "-k", "/custom.keychain", "/tmp/root.crt"}
		if len(commands) != 1 || len(commands[0]) != len(want) {
			t.Fatalf("installTrustedMacOSCertificate(...) commands = %#v, want %#v", commands, want)
		}
	})
}
