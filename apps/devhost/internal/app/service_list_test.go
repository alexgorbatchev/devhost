package app

import (
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy/caddytest"
)

func writeServiceListManifest(t *testing.T) string {
	t.Helper()

	manifestPath := filepath.Join(t.TempDir(), "devhost.toml")
	manifestText := strings.Join([]string{
		`name = "slice"`,
		"",
		"[services.web]",
		`command = ["web"]`,
		"port = 3000",
		`dependsOn = ["api"]`,
		"",
		"[services.db]",
		`command = ["db"]`,
		"port = 5432",
		"alwaysStart = true",
		"",
		"[services.api]",
		`command = ["api"]`,
		"port = 4000",
		`dependsOn = ["db"]`,
	}, "\n")
	if err := os.WriteFile(manifestPath, []byte(manifestText), 0o644); err != nil {
		t.Fatalf("WriteFile(...) error = %v", err)
	}

	return manifestPath
}

func TestRunServiceListPrintsSortedNames(t *testing.T) {
	manifestPath := writeServiceListManifest(t)

	tests := []struct {
		name       string
		rawArgs    []string
		wantStdout string
	}{
		{name: "every service", rawArgs: []string{"service", "list", "--manifest", manifestPath}, wantStdout: "api\ndb\nweb\n"},
		{name: "services that start when named", rawArgs: []string{"service", "list", "--startable", "--manifest", manifestPath}, wantStdout: "api\nweb\n"},
	}

	for _, tc := range tests {
		for _, agent := range []string{"0", "1"} {
			t.Run(tc.name+" AGENT="+agent, func(t *testing.T) {
				t.Setenv("AGENT", agent)

				var stdout strings.Builder
				var stderr strings.Builder

				if exitCode := Run(tc.rawArgs, t.TempDir(), &stdout, &stderr); exitCode != 0 {
					t.Fatalf("Run(%q) exit code = %d, want 0 with stderr %q", tc.rawArgs, exitCode, stderr.String())
				}

				if stdout.String() != tc.wantStdout {
					t.Fatalf("Run(%q) stdout = %q, want %q", tc.rawArgs, stdout.String(), tc.wantStdout)
				}

				if stderr.String() != "" {
					t.Fatalf("Run(%q) stderr = %q, want empty", tc.rawArgs, stderr.String())
				}
			})
		}
	}
}

func TestRunServiceListUsesTheNearestManifest(t *testing.T) {
	manifestPath := writeServiceListManifest(t)
	nestedPath := filepath.Join(filepath.Dir(manifestPath), "apps", "web")
	if err := os.MkdirAll(nestedPath, 0o755); err != nil {
		t.Fatal(err)
	}

	var stdout strings.Builder
	var stderr strings.Builder

	if exitCode := Run([]string{"service", "list"}, nestedPath, &stdout, &stderr); exitCode != 0 {
		t.Fatalf("Run(service list) exit code = %d, want 0 with stderr %q", exitCode, stderr.String())
	}

	if want := "api\ndb\nweb\n"; stdout.String() != want {
		t.Fatalf("Run(service list) stdout = %q, want %q", stdout.String(), want)
	}
}

func TestRunServiceListReportsAWriteFailure(t *testing.T) {
	t.Setenv("AGENT", "1")
	manifestPath := writeServiceListManifest(t)

	var stderr strings.Builder

	exitCode := Run([]string{"service", "list", "--manifest", manifestPath}, t.TempDir(), closedWriter{}, &stderr)
	if exitCode != 1 {
		t.Fatalf("Run(service list) exit code = %d, want 1", exitCode)
	}

	if want := "devhost: ERR: writing service names: io: read/write on closed pipe\n"; stderr.String() != want {
		t.Fatalf("Run(service list) stderr = %q, want %q", stderr.String(), want)
	}
}

func TestRunStartsOnlyTheNamedServices(t *testing.T) {
	for _, name := range []string{"worker", "app"} {
		t.Run(name, func(t *testing.T) { testRunStartsSelection(t, name) })
	}
}

func testRunStartsSelection(t *testing.T, name string) {
	t.Helper()
	t.Setenv("AGENT", "1")
	t.Setenv("DEVHOST_STATE_DIR", t.TempDir())

	manifestDirectoryPath := t.TempDir()
	useSharedCaddyAdmin(t, caddytest.StartAdminServer(t))
	manifestPath := writeDevtoolsDisabledProcessManifest(t, manifestDirectoryPath)
	tracePath := filepath.Join(manifestDirectoryPath, "idle-started")
	idleService := strings.Join([]string{
		"",
		"",
		"[services.idle]",
		`command = ["/bin/sh", "-c", "touch ` + tracePath + `; exec sleep 30"]`,
		"",
		"[services.idle.health]",
		"process = true",
		"",
		"[groups]",
		`app = ["worker"]`,
	}, "\n")
	manifestFile, err := os.OpenFile(manifestPath, os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := manifestFile.WriteString(idleService); err != nil {
		t.Fatal(err)
	}
	if err := manifestFile.Close(); err != nil {
		t.Fatal(err)
	}

	var stdout strings.Builder
	var stderr strings.Builder

	exitCode := runUntilServiceExit(t, []string{"start", "--manifest", manifestPath, name}, manifestDirectoryPath, &stdout, &stderr)
	if exitCode != 143 {
		t.Fatalf("Run(start %s) exit code = %d, want 143 with stderr %q", name, exitCode, stderr.String())
	}

	if want := "hello-stack: not started: idle\n"; !strings.Contains(stdout.String(), want) {
		t.Fatalf("Run(start %s) stdout = %q, want it to report %q", name, stdout.String(), want)
	}

	if _, err := os.Stat(tracePath); !os.IsNotExist(err) {
		t.Fatalf("Run(start %s) started the service it was not asked for: %v", name, err)
	}
}

// closedWriter rejects every write, standing in for a pipe whose reader has gone.
type closedWriter struct{}

func (closedWriter) Write([]byte) (int, error) {
	return 0, io.ErrClosedPipe
}
