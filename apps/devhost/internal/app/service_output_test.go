package app

import (
	"os"
	"strings"
	"testing"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy/caddytest"
)

func TestRunServiceOutputModes(t *testing.T) {
	for _, tc := range []struct{ agent, want string }{
		{"0", "worker      | abcdefghijklmnopqrstuvwxyz\n            | 0123456789\n"},
		{"1", "worker: abcdefghijklmnopqrstuvwxyz0123456789\n"},
	} {
		t.Run(tc.agent, func(t *testing.T) {
			t.Setenv("AGENT", tc.agent)
			t.Setenv("COLUMNS", "40")
			t.Setenv("DEVHOST_STATE_DIR", t.TempDir())
			directory := t.TempDir()
			path := writeDevtoolsDisabledProcessManifest(t, directory, caddytest.StartAdminServer(t))
			manifest, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			text := strings.Replace(string(manifest), `command = "/bin/sh -c exit 0"`, `command = ["/bin/sh", "-c", "echo abcdefghijklmnopqrstuvwxyz0123456789 >&2"]`, 1)
			if err := os.WriteFile(path, []byte(text), 0o644); err != nil {
				t.Fatal(err)
			}
			var stderr strings.Builder
			output, err := os.CreateTemp(t.TempDir(), "stdout")
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { output.Close() })
			stdout := &serviceExitShutdownWriter{writer: output}
			if code := Run([]string{"start", "--manifest", path}, directory, stdout, &stderr); code != 143 {
				t.Fatalf("exit = %d; stderr = %q", code, stderr.String())
			}
			if got := stderr.String(); got != tc.want {
				t.Fatalf("stderr = %q, want %q", got, tc.want)
			}
			logs, err := os.ReadFile(output.Name())
			if err != nil {
				t.Fatal(err)
			}
			wantLog := "hello-stack | Stack stopped.\n"
			if tc.agent == "1" {
				wantLog = "hello-stack: Stack stopped.\n"
			}
			if !strings.Contains(string(logs), wantLog) {
				t.Fatalf("stdout = %q, want %q", logs, wantLog)
			}
		})
	}
}
