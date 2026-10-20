package app

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy/caddytest"
)

func TestCaddyCommandOutput(t *testing.T) {
	for _, agent := range []string{"0", "1"} {
		for _, failed := range []bool{false, true} {
			name := agent + "/success"
			if failed {
				name = agent + "/permission-denied"
			}
			t.Run(name, func(t *testing.T) {
				t.Setenv("AGENT", agent)
				t.Setenv("COLUMNS", "1000")
				state := t.TempDir()
				t.Setenv("DEVHOST_STATE_DIR", state)
				manifest := writeManifestWithAdminAddress(t, t.TempDir(), caddytest.UnusedAdminAddress(t))
				bin := t.TempDir()
				t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
				script := "#!/bin/sh\nprintf 'started\\nsecond line'\nprintf 'diagnostic\\n' >&2\n"
				if failed {
					script = "#!/bin/sh\nprintf 'listen tcp 127.0.0.1:443: bind: permission denied\\n' >&2\nexit 1\n"
				}
				writeExecutable(t, filepath.Join(bin, "caddy"), script)
				var stdout, stderr strings.Builder
				code := Run([]string{"caddy", "start", "--manifest", manifest}, state, &stdout, &stderr)
				if failed {
					hint := "devhost caddy privileged-ports"
					if runtime.GOOS == "darwin" {
						hint = "Use wildcard listeners"
					}
					if code != 1 || !strings.Contains(stderr.String(), hint) {
						t.Fatalf("exit %d, stderr %q", code, stderr.String())
					}
					if agent == "0" && strings.Contains(stderr.String(), "listen tcp") {
						t.Fatalf("handled error leaked: %q", stderr.String())
					}
				} else {
					if code != 0 {
						t.Fatalf("exit %d: %s", code, stderr.String())
					}
					prefix := "devhost | "
					if agent == "1" {
						prefix = "devhost: "
					}
					for _, message := range []string{"started", "second line", "diagnostic", "managed caddy started with"} {
						if !strings.Contains(stderr.String(), prefix+message) {
							t.Errorf("missing prefixed %q in %q", message, stderr.String())
						}
					}
				}
				if stdout.Len() != 0 {
					t.Fatalf("unexpected stdout %q", stdout.String())
				}
			})
		}
	}
}

func TestCaddyUnavailableHumanMessage(t *testing.T) {
	t.Setenv("AGENT", "0")
	t.Setenv("DEVHOST_STATE_DIR", t.TempDir())
	manifest := writeDevtoolsDisabledProcessManifest(t, t.TempDir(), caddytest.UnusedAdminAddress(t))
	var stdout, stderr strings.Builder
	if code := Run([]string{"start", "--manifest", manifest}, filepath.Dir(manifest), &stdout, &stderr); code != 1 {
		t.Fatalf("exit %d", code)
	}
	if got := stderr.String(); got != "[ERROR] Caddy is not available.\n[INFO] Run 'devhost caddy start' first.\n" {
		t.Fatalf("stderr = %q", got)
	}
	t.Setenv("AGENT", "1")
	stdout.Reset()
	stderr.Reset()
	if code := Run([]string{"start", "--manifest", manifest}, filepath.Dir(manifest), &stdout, &stderr); code != 1 {
		t.Fatalf("exit %d", code)
	}
	if !strings.Contains(stderr.String(), "connection refused") || !strings.Contains(stderr.String(), "devhost caddy start") {
		t.Fatalf("agent diagnostics missing: %q", stderr.String())
	}
}
