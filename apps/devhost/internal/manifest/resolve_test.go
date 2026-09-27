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
	if err := os.MkdirAll(projectPath, 0o755); err != nil {
		t.Fatalf("MkdirAll(...) error = %v", err)
	}

	manifestPath := filepath.Join(repositoryRoot, "devhost.toml")
	if err := os.WriteFile(manifestPath, []byte("name = \"hello\"\n[services.web]\ncommand = [\"bun\", \"run\", \"dev\"]\nport = 3000\n"), 0o644); err != nil {
		t.Fatalf("WriteFile(...) error = %v", err)
	}

	resolvedPath, err := ResolveManifestPath(projectPath)
	if err != nil {
		t.Fatalf("ResolveManifestPath(...) unexpected error = %v", err)
	}

	if resolvedPath != manifestPath {
		t.Fatalf("ResolveManifestPath(...) = %q, want %q", resolvedPath, manifestPath)
	}
}

func TestResolveManifestPathStopsAtDotGit(t *testing.T) {
	t.Parallel()

	repositoryRoot := t.TempDir()
	projectPath := filepath.Join(repositoryRoot, "apps", "web")
	if err := os.MkdirAll(filepath.Join(repositoryRoot, ".git"), 0o755); err != nil {
		t.Fatalf("MkdirAll(...) error = %v", err)
	}
	if err := os.MkdirAll(projectPath, 0o755); err != nil {
		t.Fatalf("MkdirAll(...) error = %v", err)
	}

	parentManifestPath := filepath.Join(filepath.Dir(repositoryRoot), "devhost.toml")
	if err := os.WriteFile(parentManifestPath, []byte("name = \"outside\"\n[services.web]\ncommand = [\"bun\", \"run\", \"dev\"]\nport = 3000\n"), 0o644); err != nil {
		t.Fatalf("WriteFile(...) error = %v", err)
	}
	t.Cleanup(func() {
		_ = os.Remove(parentManifestPath)
	})

	_, err := ResolveManifestPath(projectPath)
	if err == nil {
		t.Fatal("ResolveManifestPath(...) error = nil, want not found error")
	}

	want := "Could not find devhost.toml from " + projectPath + " upward."
	if err.Error() != want {
		t.Fatalf("ResolveManifestPath(...) error = %q, want %q", err.Error(), want)
	}
}
