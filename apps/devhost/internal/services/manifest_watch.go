package services

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/manifest"
	"github.com/fsnotify/fsnotify"
)

const manifestDebounce = 200 * time.Millisecond

type manifestWatcher struct {
	watcher  *fsnotify.Watcher
	events   chan error
	done     chan struct{}
	inputs   manifest.Inputs
	inputsMu sync.RWMutex
}

func newManifestWatcher(inputs manifest.Inputs) (*manifestWatcher, error) {
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, fmt.Errorf("watch manifest: %w", err)
	}
	w := &manifestWatcher{watcher: watcher, events: make(chan error, 1), done: make(chan struct{})}
	if err := w.update(inputs); err != nil {
		return nil, joinCleanupError(err, watcher.Close())
	}
	go w.run()
	return w, nil
}

func (w *manifestWatcher) close() error {
	err := w.watcher.Close()
	<-w.done
	return err
}

func (w *manifestWatcher) run() {
	defer close(w.done)
	var timer *time.Timer
	var elapsed <-chan time.Time
	defer func() {
		if timer != nil {
			timer.Stop()
		}
	}()
	for {
		select {
		case event, ok := <-w.watcher.Events:
			if !ok {
				return
			}
			if event.Op&(fsnotify.Write|fsnotify.Create|fsnotify.Remove|fsnotify.Rename) == 0 {
				continue
			}
			if !w.matches(event) {
				continue
			}
			if timer == nil {
				timer = time.NewTimer(manifestDebounce)
			} else {
				timer.Reset(manifestDebounce)
			}
			elapsed = timer.C
		case err, ok := <-w.watcher.Errors:
			if !ok {
				return
			}
			w.notify(fmt.Errorf("manifest watcher: %w", err))
		case <-elapsed:
			elapsed = nil
			w.notify(nil)
		}
	}
}

func (w *manifestWatcher) notify(err error) {
	select {
	case w.events <- err:
	default:
	}
}

func (w *manifestWatcher) update(inputs manifest.Inputs) error {
	directories := map[string]bool{}
	for _, file := range inputs.Files {
		addManifestWatchDirectory(directories, filepath.Dir(file))
	}
	for _, pattern := range inputs.Patterns {
		for dir := filepath.Dir(pattern); ; dir = filepath.Dir(dir) {
			matches, err := filepath.Glob(dir)
			if err != nil {
				return fmt.Errorf("watch include pattern %s: %w", pattern, err)
			}
			for _, match := range matches {
				addManifestWatchDirectory(directories, match)
			}
			if !strings.ContainsAny(dir, "*?[") {
				addManifestWatchDirectory(directories, dir)
				break
			}
		}
	}
	previous := map[string]bool{}
	for _, dir := range w.watcher.WatchList() {
		previous[dir] = true
	}
	for dir := range directories {
		if !previous[dir] {
			if err := w.watcher.Add(dir); err != nil {
				return fmt.Errorf("watch manifest directory %s: %w", dir, err)
			}
		}
	}
	for dir := range previous {
		if !directories[dir] {
			if err := w.watcher.Remove(dir); err != nil {
				return fmt.Errorf("unwatch manifest directory %s: %w", dir, err)
			}
		}
	}
	w.inputsMu.Lock()
	w.inputs = inputs
	w.inputsMu.Unlock()
	return nil
}

func (w *manifestWatcher) matches(event fsnotify.Event) bool {
	w.inputsMu.RLock()
	defer w.inputsMu.RUnlock()
	path := filepath.Clean(event.Name)
	info, statErr := os.Stat(path)
	isDirectory := statErr != nil || info.IsDir()
	if isDirectory && event.Op&(fsnotify.Create|fsnotify.Remove|fsnotify.Rename) == 0 {
		// Directory writes also describe unrelated membership changes on kqueue;
		// fsnotify reports the actual added/removed entries separately.
		return false
	}
	for _, file := range w.inputs.Files {
		if path == file {
			return true
		}
		if isDirectory {
			if _, within := pathWithin(path, file); within {
				return true
			}
		}
	}
	for _, pattern := range w.inputs.Patterns {
		if matched, _ := filepath.Match(pattern, path); matched {
			return true
		}
		if !isDirectory {
			continue
		}
		for prefix := filepath.Dir(pattern); ; prefix = filepath.Dir(prefix) {
			if matched, _ := filepath.Match(prefix, path); matched {
				return true
			}
			if !strings.ContainsAny(prefix, "*?[") {
				if _, within := pathWithin(path, prefix); within {
					return true
				}
				break
			}
		}
	}
	return false
}

func addManifestWatchDirectory(directories map[string]bool, dir string) {
	for {
		info, err := os.Stat(dir)
		if err == nil && info.IsDir() {
			directories[dir] = true
			return
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return
		}
		dir = parent
	}
}
