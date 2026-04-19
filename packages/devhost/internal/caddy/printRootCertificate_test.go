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
	if error := os.MkdirAll(filepath.Dir(paths.RootCertificatePath), 0o755); error != nil {
		t.Fatalf("MkdirAll(...) error = %v", error)
	}

	certificate := []byte("-----BEGIN CERTIFICATE-----\nhello\n")
	if error := os.WriteFile(paths.RootCertificatePath, certificate, 0o644); error != nil {
		t.Fatalf("WriteFile(...) error = %v", error)
	}

	var stdout bytes.Buffer
	exitCode, error := PrintManagedCaddyRootCertificate(&stdout, paths)
	if error != nil {
		t.Fatalf("PrintManagedCaddyRootCertificate(...) unexpected error = %v", error)
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

	_, error := PrintManagedCaddyRootCertificate(&stdout, paths)
	if error == nil {
		t.Fatal("PrintManagedCaddyRootCertificate(...) error = nil, want missing root certificate error")
	}

	want := "Managed Caddy root certificate not found at " + paths.RootCertificatePath + ". Run 'devhost caddy start' first."
	if error.Error() != want {
		t.Fatalf("PrintManagedCaddyRootCertificate(...) error = %q, want %q", error.Error(), want)
	}
}
