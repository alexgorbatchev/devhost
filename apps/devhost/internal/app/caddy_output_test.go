package app

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy"
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
					devhostPrefix, caddyPrefix := "devhost | ", "caddy   | "
					if agent == "1" {
						devhostPrefix, caddyPrefix = "devhost: ", "caddy: "
					}
					for _, message := range []string{caddyPrefix + "started", caddyPrefix + "second line", caddyPrefix + "diagnostic", devhostPrefix + "managed caddy started with"} {
						if !strings.Contains(stderr.String(), message) {
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

func TestCaddyTrustOutput(t *testing.T) {
	t.Setenv("AGENT", "0")
	t.Setenv("COLUMNS", "1000")
	state := t.TempDir()
	t.Setenv("DEVHOST_STATE_DIR", state)
	paths, err := caddy.CreateManagedCaddyPathsFromEnvironment(map[string]string{"DEVHOST_STATE_DIR": state})
	if err != nil {
		t.Fatal(err)
	}
	caddytest.WriteUntrustedRootCertificate(t, paths.RootCertificatePath)
	if err := os.WriteFile(paths.PidFilePath, []byte("1\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	manifest := writeManifestWithAdminAddress(t, t.TempDir(), caddytest.StartAdminServer(t))
	bin := t.TempDir()
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
	promptPath := filepath.Join(t.TempDir(), "prompt")
	writeExecutable(t, filepath.Join(bin, "caddy"), strings.Join([]string{
		"#!/bin/sh",
		`printf '%s' "$SUDO_PROMPT" > '` + promptPath + `'`,
		`printf '2026/10/19 23:31:49.199\tINFO\tnot NSS security databases found\n' >&2`,
		`printf '2026/10/19 23:31:49.199\tINFO\tdefine JAVA_HOME environment variable to use the Java trust\n' >&2`,
	}, "\n")+"\n")

	var stdout, stderr strings.Builder
	if code := Run([]string{"caddy", "trust", "--manifest", manifest}, state, &stdout, &stderr); code != 0 {
		t.Fatalf("exit %d: %s", code, stderr.String())
	}
	want := "devhost | managed caddy is installing its local CA into the system trust store so browsers accept devhost HTTPS certificates. This may ask for your password.\n" +
		"devhost | managed caddy local CA trusted.\n"
	if got := stderr.String(); got != want {
		t.Fatalf("stderr = %q, want %q", got, want)
	}
	prompt, err := os.ReadFile(promptPath)
	if err != nil {
		t.Fatal(err)
	}
	if got := string(prompt); got != "caddy   | Password: " {
		t.Fatalf("sudo prompt = %q, want the caddy log prefix", got)
	}
	if stdout.Len() != 0 {
		t.Fatalf("unexpected stdout %q", stdout.String())
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
	if got := stderr.String(); got != "devhost | [ERROR] Caddy is not available.\ndevhost | [INFO] Run 'devhost caddy start' first.\n" {
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
