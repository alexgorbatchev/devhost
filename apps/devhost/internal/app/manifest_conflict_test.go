package app

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRunManifestConflictPresentation(t *testing.T) {
	// Keep the fixture's home and the canonical manifest on the same path on macOS.
	tempDir, err := filepath.EvalSymlinks(os.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("TMPDIR", tempDir)
	state := t.TempDir()
	t.Setenv("DEVHOST_STATE_DIR", state)
	t.Setenv("DEVHOST_MANIFEST", "")
	t.Setenv("COLUMNS", "0")
	_, path := startListedStack(t, state)
	root := filepath.Dir(path)
	t.Setenv("HOME", filepath.Dir(root))
	subdir := filepath.Join(root, "nested")
	if err := os.Mkdir(subdir, 0o700); err != nil {
		t.Fatal(err)
	}
	elsewhere := t.TempDir()
	for _, agent := range []string{"0", "1"} {
		t.Setenv("AGENT", agent)
		for _, tc := range []struct {
			name, cwd, env string
			explicit       bool
		}{
			{"same directory", root, "", false},
			{"descendant", subdir, "", false},
			{"elsewhere", elsewhere, "", true},
			{"environment selects owner", elsewhere, path, false},
			{"environment selects elsewhere", root, filepath.Join(elsewhere, "devhost.toml"), true},
		} {
			t.Run(agent+"/"+tc.name, func(t *testing.T) {
				t.Setenv("DEVHOST_MANIFEST", tc.env)
				var stdout, stderr strings.Builder
				if code := Run([]string{"start", "--manifest", path}, tc.cwd, &stdout, &stderr); code != 1 {
					t.Fatalf("exit = %d, stderr = %s", code, &stderr)
				}
				got := stderr.String()
				prefix := "devhost | [ERROR] "
				if agent == "1" {
					prefix = "devhost: ERR: "
				}
				normalized := strings.Join(strings.Fields(got), " ")
				if !strings.HasPrefix(normalized, prefix) {
					t.Errorf("missing prefix %q: %s", prefix, got)
				}
				if strings.Contains(got, filepath.Dir(root)+"/") || !strings.Contains(got, "~/"+filepath.Base(root)+"/devhost.toml") {
					t.Errorf("paths not folded: %s", got)
				}
				if strings.Contains(got, "devhost stop --manifest") != tc.explicit {
					t.Errorf("wrong stop command: %s", got)
				}
				if !tc.explicit && !strings.Contains(got, "devhost stop before") {
					t.Errorf("missing simple stop command: %s", got)
				}
			})
		}
	}
}
