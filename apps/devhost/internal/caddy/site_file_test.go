package caddy

import (
	"os"
	"path/filepath"
	"testing"
)

func TestFailedSitePublicationRemovesTemporaryFile(t *testing.T) {
	t.Parallel()
	directory := t.TempDir()
	path := filepath.Join(directory, "index.html")
	if err := os.Mkdir(path, 0o755); err != nil {
		t.Fatal(err)
	}
	marker := filepath.Join(path, "owned")
	if err := os.WriteFile(marker, []byte("keep"), 0o600); err != nil {
		t.Fatal(err)
	}
	for _, target := range []string{path, filepath.Join(directory, "missing", "index.html")} {
		if err := writeSiteFile(target, []byte("replacement"), 0o644); err == nil {
			t.Fatal("publication unexpectedly succeeded")
		}
		content, err := os.ReadFile(marker)
		if err != nil || string(content) != "keep" {
			t.Fatalf("existing target changed; error=%v", err)
		}
		entries, err := os.ReadDir(directory)
		if err != nil || len(entries) != 1 {
			t.Fatalf("failed publication left %d entries; error=%v", len(entries), err)
		}
	}
}
