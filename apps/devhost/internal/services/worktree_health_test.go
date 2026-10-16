package services

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestWorktreeHealthKeepsInvalidCheckoutDirectoriesAsArray(t *testing.T) {
	for _, kind := range []string{"missing manifest", "invalid manifest", "missing service directory"} {
		t.Run(kind, func(t *testing.T) {
			root, linked := createWorktreeRepository(t)
			path := filepath.Join(linked, "devhost.toml")
			switch kind {
			case "missing manifest":
				if err := os.Remove(path); err != nil {
					t.Fatal(err)
				}
			case "invalid manifest":
				if err := os.WriteFile(path, []byte("[services."), 0o600); err != nil {
					t.Fatal(err)
				}
			case "missing service directory":
				if err := os.RemoveAll(filepath.Join(linked, "api")); err != nil {
					t.Fatal(err)
				}
			}
			m := worktreeTestManifest(root)
			w, err := newStackWorktrees(m, t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			runtime := &stackRuntime{manifest: &m, worktrees: w}
			for _, stage := range []string{"discovery", "refresh"} {
				if stage == "refresh" {
					if err := w.refresh(); err != nil {
						t.Fatal(err)
					}
				}
				health, err := runtime.health(context.Background())
				if err != nil {
					t.Fatal(err)
				}
				found := false
				for _, entry := range health.Repositories[0].Worktrees {
					if entry.Path != linked {
						continue
					}
					found = true
					if entry.Available || entry.Reason == "" {
						t.Fatalf("%s: invalid checkout has no unavailable reason: %#v", stage, entry)
					}
					payload, err := json.Marshal(entry)
					if err != nil {
						t.Fatal(err)
					}
					var fields map[string]json.RawMessage
					if err := json.Unmarshal(payload, &fields); err != nil {
						t.Fatal(err)
					}
					if got := string(fields["directories"]); got != "[]" {
						t.Errorf("%s: unavailable checkout directories = %s, want [] for the browser health parser", stage, got)
					}
				}
				if !found {
					t.Fatalf("%s: unavailable checkout missing from health", stage)
				}
			}
		})
	}
}
