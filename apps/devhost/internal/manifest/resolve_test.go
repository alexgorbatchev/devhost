package manifest

import (
	"os"
	"path/filepath"
	"testing"
)

func TestResolveManifestPathFindsManifestUpward(t *testing.T) {
	t.Parallel()

	repositoryRoot := t.TempDir()
	projectPath := filepath.Join(repositoryRoot, "apps", "web")
	if error := os.MkdirAll(projectPath, 0o755); error != nil {
		t.Fatalf("MkdirAll(...) error = %v", error)
	}

	manifestPath := filepath.Join(repositoryRoot, "devhost.toml")
	if error := os.WriteFile(manifestPath, []byte("name = \"hello\"\n[services.web]\ncommand = [\"bun\", \"run\", \"dev\"]\nport = 3000\n"), 0o644); error != nil {
		t.Fatalf("WriteFile(...) error = %v", error)
	}

	resolvedPath, error := ResolveManifestPath(projectPath)
	if error != nil {
		t.Fatalf("ResolveManifestPath(...) unexpected error = %v", error)
	}

	if resolvedPath != manifestPath {
		t.Fatalf("ResolveManifestPath(...) = %q, want %q", resolvedPath, manifestPath)
	}
}

func TestResolveManifestPathStopsAtDotGit(t *testing.T) {
	t.Parallel()

	repositoryRoot := t.TempDir()
	projectPath := filepath.Join(repositoryRoot, "apps", "web")
	if error := os.MkdirAll(filepath.Join(repositoryRoot, ".git"), 0o755); error != nil {
		t.Fatalf("MkdirAll(...) error = %v", error)
	}
	if error := os.MkdirAll(projectPath, 0o755); error != nil {
		t.Fatalf("MkdirAll(...) error = %v", error)
	}

	parentManifestPath := filepath.Join(filepath.Dir(repositoryRoot), "devhost.toml")
	if error := os.WriteFile(parentManifestPath, []byte("name = \"outside\"\n[services.web]\ncommand = [\"bun\", \"run\", \"dev\"]\nport = 3000\n"), 0o644); error != nil {
		t.Fatalf("WriteFile(...) error = %v", error)
	}
	t.Cleanup(func() {
		_ = os.Remove(parentManifestPath)
	})

	_, error := ResolveManifestPath(projectPath)
	if error == nil {
		t.Fatal("ResolveManifestPath(...) error = nil, want not found error")
	}

	want := "Could not find devhost.toml from " + projectPath + " upward."
	if error.Error() != want {
		t.Fatalf("ResolveManifestPath(...) error = %q, want %q", error.Error(), want)
	}
}
