package services

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/manifest"
)

func TestManifestWatcherRetainsInvalidEditMadeDuringStartup(t *testing.T) {
	path := filepath.Join(t.TempDir(), "devhost.toml")
	if err := os.WriteFile(path, []byte("[services.web]\ncommand = ["), 0600); err != nil {
		t.Fatal(err)
	}
	runtime := stackRuntime{manifest: &ResolvedManifest{ManifestPath: path}}
	w, err := runtime.watchManifest()
	if err != nil {
		t.Fatalf("invalid startup edit prevented watching repairs: %v", err)
	}
	defer w.close()
	if err := os.WriteFile(path, []byte("name = \"repaired\""), 0600); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-w.events:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("repair was not observed")
	}
}

func TestManifestWatcherTracksReplacementAndGlobMembership(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "devhost.toml")
	if err := os.WriteFile(path, []byte("includes = [\"services/*/*.toml\"]\n"), 0600); err != nil {
		t.Fatal(err)
	}
	raw, err := manifest.ReadManifest(path)
	if err != nil {
		t.Fatal(err)
	}
	w, err := newManifestWatcher(raw.Inputs)
	if err != nil {
		t.Fatal(err)
	}
	defer w.close()
	changed := func() {
		t.Helper()
		select {
		case err := <-w.events:
			if err != nil {
				t.Fatal(err)
			}
		case <-time.After(3 * time.Second):
			t.Fatal("manifest change was not observed")
		}
		raw, err := manifest.ReadManifest(path)
		if err != nil {
			t.Fatal(err)
		}
		if err := w.update(raw.Inputs); err != nil {
			t.Fatal(err)
		}
	}
	temporary := filepath.Join(dir, "replacement")
	if err := os.WriteFile(temporary, []byte("includes = [\"services/*/*.toml\"]\nname = \"next\"\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(temporary, path); err != nil {
		t.Fatal(err)
	}
	changed()
	if err := os.MkdirAll(filepath.Join(dir, "services", "api"), 0755); err != nil {
		t.Fatal(err)
	}
	changed()
	child := filepath.Join(dir, "services", "api", "service.toml")
	if err := os.WriteFile(child, []byte("[services.api]\ncommand = [\"serve\"]\nhealth.process = true\n"), 0600); err != nil {
		t.Fatal(err)
	}
	changed()
	if err := os.Remove(child); err != nil {
		t.Fatal(err)
	}
	changed()
	if err := os.WriteFile(path, []byte("includes = [\"services/*/*.toml\"]\n"), 0600); err != nil {
		t.Fatal(err)
	}
	changed()
}

func TestManifestWatcherIgnoresUnrelatedWritesDuringSave(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "devhost.toml")
	if err := os.WriteFile(path, []byte("name = \"original\""), 0600); err != nil {
		t.Fatal(err)
	}
	raw, err := manifest.ReadManifest(path)
	if err != nil {
		t.Fatal(err)
	}
	w, err := newManifestWatcher(raw.Inputs)
	if err != nil {
		t.Fatal(err)
	}
	defer w.close()
	noise := filepath.Join(dir, "server.log")
	if err := os.WriteFile(noise, nil, 0600); err != nil {
		t.Fatal(err)
	}
	select {
	case <-w.events:
		t.Fatal("unrelated file creation triggered a reload")
	case <-time.After(2 * manifestDebounce):
	}
	if err := os.WriteFile(path, []byte("name = \"replacement\""), 0600); err != nil {
		t.Fatal(err)
	}
	ticker := time.NewTicker(manifestDebounce / 4)
	defer ticker.Stop()
	deadline := time.NewTimer(5 * manifestDebounce)
	defer deadline.Stop()
	for {
		select {
		case err := <-w.events:
			if err != nil {
				t.Fatal(err)
			}
			return
		case <-ticker.C:
			if err := os.WriteFile(noise, []byte(time.Now().String()), 0600); err != nil {
				t.Fatal(err)
			}
		case <-deadline.C:
			t.Fatal("unrelated writes postponed the manifest save")
		}
	}
}
