package manifest

import (
	"os"
	"path/filepath"
	"slices"
	"testing"
)

func TestManifestInputsTrackNestedIncludesAndFailedFiles(t *testing.T) {
	dir := t.TempDir()
	root, child := filepath.Join(dir, "devhost.toml"), filepath.Join(dir, "child.toml")
	pattern := filepath.Join(dir, "services", "*", "*.toml")
	if err := os.WriteFile(root, []byte("includes = [\"child.toml\"]\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(child, []byte("includes = [\"services/*/*.toml\"]\n"), 0600); err != nil {
		t.Fatal(err)
	}
	raw, err := ReadManifest(root)
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Contains(raw.Inputs.Files, root) || !slices.Contains(raw.Inputs.Files, child) || !slices.Contains(raw.Inputs.Patterns, pattern) {
		t.Fatalf("missing manifest dependencies: %#v", raw.Inputs)
	}
	if err := os.WriteFile(child, []byte("includes = ["), 0600); err != nil {
		t.Fatal(err)
	}
	raw, err = ReadManifest(root)
	if err == nil || !slices.Contains(raw.Inputs.Files, child) {
		t.Fatalf("failed include is not watched: %#v, %v", raw.Inputs, err)
	}
}
