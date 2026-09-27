package caddy

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

func TestPrintManagedCaddyRootCertificateWritesRawCertificate(t *testing.T) {
	t.Parallel()

	temporaryDirectoryPath := t.TempDir()
	paths := CreateManagedCaddyPaths(temporaryDirectoryPath)
	if err := os.MkdirAll(filepath.Dir(paths.RootCertificatePath), 0o755); err != nil {
		t.Fatalf("MkdirAll(...) error = %v", err)
	}

	certificate := []byte("-----BEGIN CERTIFICATE-----\nhello\n")
	if err := os.WriteFile(paths.RootCertificatePath, certificate, 0o644); err != nil {
		t.Fatalf("WriteFile(...) error = %v", err)
	}

	var stdout bytes.Buffer
	exitCode, err := PrintManagedCaddyRootCertificate(&stdout, paths)
	if err != nil {
		t.Fatalf("PrintManagedCaddyRootCertificate(...) unexpected error = %v", err)
	}

	if exitCode != 0 {
		t.Fatalf("PrintManagedCaddyRootCertificate(...) exit code = %d, want 0", exitCode)
	}

	if stdout.String() != string(certificate) {
		t.Fatalf("PrintManagedCaddyRootCertificate(...) stdout = %q, want %q", stdout.String(), string(certificate))
	}
}

func TestPrintManagedCaddyRootCertificateExplainsMissingCertificate(t *testing.T) {
	t.Parallel()

	paths := CreateManagedCaddyPaths(t.TempDir())
	var stdout bytes.Buffer

	_, err := PrintManagedCaddyRootCertificate(&stdout, paths)
	if err == nil {
		t.Fatal("PrintManagedCaddyRootCertificate(...) error = nil, want missing root certificate error")
	}

	want := "Managed Caddy root certificate not found at " + paths.RootCertificatePath + ". Run 'devhost caddy start' first."
	if err.Error() != want {
		t.Fatalf("PrintManagedCaddyRootCertificate(...) error = %q, want %q", err.Error(), want)
	}
}
