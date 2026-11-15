package caddy

import (
	"os"
	"path/filepath"
	"testing"
)

func TestManifestIdentity(t *testing.T) {
	// The temporary directory itself can sit behind a symbolic link, as it does
	// on macOS.
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	project := filepath.Join(root, "project")
	manifest := filepath.Join(project, "devhost.toml")
	if err := os.MkdirAll(project, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(manifest, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	links := filepath.Join(root, "links")
	if err := os.MkdirAll(links, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(manifest, filepath.Join(links, "alias.toml")); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(project, filepath.Join(links, "project")); err != nil {
		t.Fatal(err)
	}
	t.Chdir(links)

	tests := []struct {
		name string
		path string
		want string
	}{
		{"manifest", manifest, manifest},
		{"file alias", filepath.Join(links, "alias.toml"), manifest},
		{"directory alias", filepath.Join(links, "project", "devhost.toml"), manifest},
		{"relative alias", "alias.toml", manifest},
		{"unclean alias", links + "/project/../project/./devhost.toml", manifest},
		{"missing file in a linked directory", filepath.Join(links, "project", "deleted.toml"), filepath.Join(project, "deleted.toml")},
		{"missing directory", filepath.Join(links, "project", "gone", "..", "missing", "devhost.toml"), filepath.Join(links, "project", "missing", "devhost.toml")},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := ManifestIdentity(tt.path); got != tt.want {
				t.Fatalf("ManifestIdentity(%q) = %q, want %q", tt.path, got, tt.want)
			}
		})
	}
}
