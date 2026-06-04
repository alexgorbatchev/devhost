package services

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/fsnotify/fsnotify"
)

type DirtyTracker struct {
	mu      sync.RWMutex
	isDirty map[string]bool
}

func NewDirtyTracker() *DirtyTracker {
	return &DirtyTracker{
		isDirty: make(map[string]bool),
	}
}

func (d *DirtyTracker) SetDirty(serviceName string, dirty bool) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.isDirty[serviceName] = dirty
}

func (d *DirtyTracker) IsDirty(serviceName string) bool {
	d.mu.RLock()
	defer d.mu.RUnlock()
	return d.isDirty[serviceName]
}

type WatchManager struct {
	tracker        *DirtyTracker
	watchers       map[string]*fsnotify.Watcher
	debounceTimers map[string]*time.Timer
	timersMu       sync.Mutex
	onDirty        func(string)
}

func NewWatchManager(tracker *DirtyTracker, onDirty func(string)) *WatchManager {
	return &WatchManager{
		tracker:        tracker,
		watchers:       make(map[string]*fsnotify.Watcher),
		debounceTimers: make(map[string]*time.Timer),
		onDirty:        onDirty,
	}
}

var excludedDirectories = map[string]bool{
	".git":        true,
	"node_modules": true,
	"vendor":      true,
	".next":       true,
	".tmp":        true,
	"dist":        true,
	"target":      true,
	".workspaces": true,
	".shadow":     true,
	".agents":     true,
	"build":       true,
}

func isExcludedDir(name string) bool {
	return excludedDirectories[name]
}

func watchDirectoryRecursive(watcher *fsnotify.Watcher, root string) error {
	return filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			if isExcludedDir(d.Name()) {
				return filepath.SkipDir
			}
			err := watcher.Add(path)
			if err != nil {
				if isLimitError(err) {
					logLimitWarning()
					return filepath.SkipDir
				}
				return err
			}
		}
		return nil
	})
}

var limitWarningLogged sync.Once

func logLimitWarning() {
	limitWarningLogged.Do(func() {
		fmt.Fprintln(os.Stderr, "WARNING: File watching limit reached (no space left on device or too many open files).")
		fmt.Fprintln(os.Stderr, "To increase watch limits, run: `sudo sysctl -w fs.inotify.max_user_watches=524288`")
	})
}

func isLimitError(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, syscall.ENOSPC) || errors.Is(err, syscall.EMFILE) {
		return true
	}
	errStr := err.Error()
	return containsAny(errStr, "no space left on device", "too many open files", "limit")
}

func containsAny(s string, sub ...string) bool {
	lower := strings.ToLower(s)
	for _, suffix := range sub {
		if strings.Contains(lower, suffix) {
			return true
		}
	}
	return false
}

func (wm *WatchManager) StartWatching(serviceName string, watchPaths []string, manifestDir string) error {
	if len(watchPaths) == 0 {
		return nil
	}

	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return fmt.Errorf("create fsnotify watcher: %w", err)
	}

	wm.watchers[serviceName] = watcher

	for _, p := range watchPaths {
		absPath := filepath.Clean(filepath.Join(manifestDir, p))
		info, err := os.Stat(absPath)
		if err != nil {
			fmt.Fprintf(os.Stderr, "WARNING: watch path %q for service %s does not exist\n", absPath, serviceName)
			continue
		}

		if info.IsDir() {
			err = watchDirectoryRecursive(watcher, absPath)
		} else {
			err = watcher.Add(absPath)
			if err != nil && isLimitError(err) {
				logLimitWarning()
				err = nil
			}
		}

		if err != nil {
			_ = watcher.Close()
			return fmt.Errorf("add watch path %q: %w", absPath, err)
		}
	}

	go func() {
		for {
			select {
			case event, ok := <-watcher.Events:
				if !ok {
					return
				}
				wm.handleEvent(serviceName, event)
			case err, ok := <-watcher.Errors:
				if !ok {
					return
				}
				if isLimitError(err) {
					logLimitWarning()
				} else {
					fmt.Fprintf(os.Stderr, "watcher error for service %s: %v\n", serviceName, err)
				}
			}
		}
	}()

	return nil
}

func (wm *WatchManager) handleEvent(serviceName string, event fsnotify.Event) {
	if event.Op&fsnotify.Create == fsnotify.Create {
		info, err := os.Stat(event.Name)
		if err == nil && info.IsDir() {
			if !isExcludedDir(info.Name()) {
				if watcher, ok := wm.watchers[serviceName]; ok {
					_ = watchDirectoryRecursive(watcher, event.Name)
				}
			}
		}
	}

	wm.timersMu.Lock()
	defer wm.timersMu.Unlock()

	if timer, ok := wm.debounceTimers[serviceName]; ok && timer != nil {
		timer.Stop()
	}

	wm.debounceTimers[serviceName] = time.AfterFunc(200*time.Millisecond, func() {
		wm.tracker.SetDirty(serviceName, true)
		if wm.onDirty != nil {
			wm.onDirty(serviceName)
		}
		wm.timersMu.Lock()
		delete(wm.debounceTimers, serviceName)
		wm.timersMu.Unlock()
	})
}

func (wm *WatchManager) CancelTimer(serviceName string) {
	wm.timersMu.Lock()
	defer wm.timersMu.Unlock()
	if timer, ok := wm.debounceTimers[serviceName]; ok && timer != nil {
		timer.Stop()
		delete(wm.debounceTimers, serviceName)
	}
}

func (wm *WatchManager) StopAll() {
	for _, watcher := range wm.watchers {
		_ = watcher.Close()
	}
	wm.timersMu.Lock()
	for _, timer := range wm.debounceTimers {
		if timer != nil {
			timer.Stop()
		}
	}
	wm.debounceTimers = make(map[string]*time.Timer)
	wm.timersMu.Unlock()
}
