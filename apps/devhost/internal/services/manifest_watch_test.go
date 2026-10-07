package services

import (
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"testing/synctest"
	"time"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/manifest"
	"github.com/fsnotify/fsnotify"
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

func TestManifestWatcherReportsCheckAndSaveTogether(t *testing.T) {
	path := filepath.Join(t.TempDir(), "devhost.toml")
	if err := os.WriteFile(path, []byte("name = \"saved\""), 0600); err != nil {
		t.Fatal(err)
	}
	type step func(w *manifestWatcher, changes chan<- fsnotify.Event)
	check := func(w *manifestWatcher, _ chan<- fsnotify.Event) { w.check() }
	save := func(_ *manifestWatcher, changes chan<- fsnotify.Event) {
		changes <- fsnotify.Event{Name: path, Op: fsnotify.Write}
	}
	tests := []struct {
		name  string
		steps []step
	}{
		{"check alone", []step{check}},
		{"save before check", []step{save, check}},
		{"save after check", []step{check, save}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			synctest.Test(t, func(t *testing.T) {
				// Feed events directly: the fake clock cannot advance past a real watcher.
				changes := make(chan fsnotify.Event)
				w := &manifestWatcher{events: make(chan error, 1), checks: make(chan struct{}, 1), done: make(chan struct{}), inputs: manifest.Inputs{Files: []string{path}}}
				go w.run(changes, make(chan error))
				defer close(changes)
				// Take each report at once, as the stack does: a second one would
				// otherwise be dropped while the first waits in the buffer.
				var reports atomic.Int32
				go func() {
					for {
						select {
						case err := <-w.events:
							if err != nil {
								t.Error(err)
							}
							reports.Add(1)
						case <-w.done:
							return
						}
					}
				}()
				for _, step := range tt.steps {
					step(w, changes)
				}
				synctest.Wait()
				if got := reports.Load(); got != 0 {
					t.Fatalf("reported %d times before saves could settle", got)
				}
				time.Sleep(manifestDebounce)
				synctest.Wait()
				if got := reports.Load(); got != 1 {
					t.Fatalf("reported %d times once the debounce passed, want 1", got)
				}
				time.Sleep(10 * manifestDebounce)
				synctest.Wait()
				if got := reports.Load(); got != 1 {
					t.Fatalf("reported %d times in the end, want 1", got)
				}
			})
		})
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
