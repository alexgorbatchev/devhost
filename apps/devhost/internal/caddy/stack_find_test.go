package caddy

import (
	"errors"
	"os"
	"path/filepath"
	"slices"
	"testing"
)

// A query that names a manifest file matches the stack started from that file
// through another path, which no substring of the recorded path does.
func TestFindLiveStackOwnersMatchesTheNamedManifest(t *testing.T) {
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	manifest := filepath.Join(root, "project", "devhost.toml")
	if err := os.MkdirAll(filepath.Dir(manifest), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(manifest, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	links := filepath.Join(root, "links")
	if err := os.MkdirAll(links, 0o700); err != nil {
		t.Fatal(err)
	}
	recorded := filepath.Join(links, "alias.toml")
	if err := os.Symlink(manifest, recorded); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Dir(manifest), filepath.Join(links, "linked")); err != nil {
		t.Fatal(err)
	}
	// Another file where file names are case-sensitive, and the manifest itself
	// where they are not. stop compares paths exactly in both cases, and so does
	// find.
	recased := filepath.Join(root, "Project", "devhost.toml")
	if err := os.MkdirAll(filepath.Dir(recased), 0o700); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(recased); errors.Is(err, os.ErrNotExist) {
		if err := os.WriteFile(recased, nil, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	paths := newManagedCaddyPaths(t)
	if err := RegisterStack(RegisterStackOptions{ManifestPath: recorded, StackName: "owner", StacksDirectoryPath: paths.StacksDirectoryPath}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := UnregisterStack(paths.StacksDirectoryPath); err != nil {
			t.Error(err)
		}
	})

	want := []StackOwner{{ManifestPath: recorded, PID: os.Getpid()}}
	tests := []struct {
		name, query, directory string
		want                   []StackOwner
	}{
		{"the manifest", manifest, "", want},
		{"relative to the directory", "devhost.toml", filepath.Dir(manifest), want},
		{"through a linked directory", filepath.Join(links, "linked", "devhost.toml"), "", want},
		{"a directory", filepath.Join(links, "linked"), "", nil},
		{"a missing file", filepath.Join(root, "project", "missing.toml"), "", nil},
		{"a path that differs only in case", recased, "", nil},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := FindLiveStackOwners(paths, tt.query, tt.directory)
			if err != nil || !slices.Equal(got, tt.want) {
				t.Fatalf("FindLiveStackOwners(%q, %q) = %#v, %v; want %#v", tt.query, tt.directory, got, err, tt.want)
			}
		})
	}
}
