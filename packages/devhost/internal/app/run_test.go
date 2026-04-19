package app

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/alexgorbatchev/devhost/packages/devhost/internal/cli"
)

func TestRunHelpShortCircuitsInvalidArguments(t *testing.T) {
	t.Parallel()

	var stdout strings.Builder
	var stderr strings.Builder

	exitCode := Run([]string{"caddy", "restart", "--help"}, "/tmp", &stdout, &stderr)

	if exitCode != 0 {
		t.Fatalf("Run(...) exit code = %d, want 0", exitCode)
	}

	if stdout.String() != cli.HelpText {
		t.Fatalf("Run(...) stdout = %q, want %q", stdout.String(), cli.HelpText)
	}

	if stderr.String() != "" {
		t.Fatalf("Run(...) stderr = %q, want empty", stderr.String())
	}
}

func TestRunExplicitManifestBypassesUpwardDiscovery(t *testing.T) {
	t.Parallel()

	manifestDirectoryPath := t.TempDir()
	manifestPath := filepath.Join(manifestDirectoryPath, "devhost.toml")
	manifestText := strings.Join([]string{
		`name = "hello-stack"`,
		"",
		"[services.web]",
		`command = "bun run dev"`,
		"port = 3000",
	}, "\n")
	if error := os.WriteFile(manifestPath, []byte(manifestText), 0o644); error != nil {
		t.Fatalf("WriteFile(...) error = %v", error)
	}

	cwd := filepath.Join(t.TempDir(), "nested", "workspace")
	if error := os.MkdirAll(cwd, 0o755); error != nil {
		t.Fatalf("MkdirAll(...) error = %v", error)
	}

	var stdout strings.Builder
	var stderr strings.Builder

	exitCode := Run([]string{"--manifest", manifestPath}, cwd, &stdout, &stderr)

	if exitCode != 1 {
		t.Fatalf("Run(...) exit code = %d, want 1", exitCode)
	}

	if stdout.String() != "" {
		t.Fatalf("Run(...) stdout = %q, want empty", stdout.String())
	}

	wantStderr := "failed: manifest mode is not implemented yet in the Go rewrite.\n"
	if stderr.String() != wantStderr {
		t.Fatalf("Run(...) stderr = %q, want %q", stderr.String(), wantStderr)
	}
}

func TestRunPrintRootCertificateWritesRawCertificate(t *testing.T) {
	temporaryDirectoryPath := t.TempDir()
	t.Setenv("DEVHOST_STATE_DIR", temporaryDirectoryPath)
	rootCertificatePath := filepath.Join(temporaryDirectoryPath, "caddy", "storage", "pki", "authorities", "local", "root.crt")
	if error := os.MkdirAll(filepath.Dir(rootCertificatePath), 0o755); error != nil {
		t.Fatalf("MkdirAll(...) error = %v", error)
	}

	certificate := "-----BEGIN CERTIFICATE-----\nhello\n"
	if error := os.WriteFile(rootCertificatePath, []byte(certificate), 0o644); error != nil {
		t.Fatalf("WriteFile(...) error = %v", error)
	}

	var stdout strings.Builder
	var stderr strings.Builder

	exitCode := Run([]string{"caddy", "print-root-cert"}, temporaryDirectoryPath, &stdout, &stderr)
	if exitCode != 0 {
		t.Fatalf("Run(...) exit code = %d, want 0", exitCode)
	}

	if stdout.String() != certificate {
		t.Fatalf("Run(...) stdout = %q, want %q", stdout.String(), certificate)
	}

	if stderr.String() != "" {
		t.Fatalf("Run(...) stderr = %q, want empty", stderr.String())
	}
}
