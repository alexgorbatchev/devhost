package services

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/fsnotify/fsnotify"
)

func TestDirtyTracker(t *testing.T) {
	tracker := NewDirtyTracker()
	if tracker.IsDirty("web") {
		t.Fatal("expected web to not be dirty initially")
	}

	tracker.SetDirty("web", true)
	if !tracker.IsDirty("web") {
		t.Fatal("expected web to be dirty")
	}

	tracker.SetDirty("web", false)
	if tracker.IsDirty("web") {
		t.Fatal("expected web to be clean again")
	}
}

func TestWatchManagerDebounceAndDynamicDir(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "devhost-watch-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	srcDir := filepath.Join(tmpDir, "src")
	if err := os.Mkdir(srcDir, 0755); err != nil {
		t.Fatalf("failed to create src dir: %v", err)
	}

	tracker := NewDirtyTracker()
	dirtyCh := make(chan string, 10)
	wm := NewWatchManager(tracker, func(svc string) {
		dirtyCh <- svc
	}, nil, "")
	defer wm.StopAll()

	err = wm.StartWatching("web", []string{"src/"}, tmpDir)
	if err != nil {
		t.Fatalf("failed to start watching: %v", err)
	}

	testFile := filepath.Join(srcDir, "app.js")
	err = os.WriteFile(testFile, []byte("console.log(1);"), 0644)
	if err != nil {
		t.Fatalf("failed to write app.js: %v", err)
	}

	select {
	case svc := <-dirtyCh:
		if svc != "web" {
			t.Fatalf("expected dirty service 'web', got %q", svc)
		}
		if !tracker.IsDirty("web") {
			t.Fatal("expected tracker to know web is dirty")
		}
	case <-time.After(1 * time.Second):
		t.Fatal("timeout waiting for watch event")
	}

	tracker.SetDirty("web", false)

	subDir := filepath.Join(srcDir, "components")
	err = os.Mkdir(subDir, 0755)
	if err != nil {
		t.Fatalf("failed to create components dir: %v", err)
	}

	waitForCondition(t, 5*time.Second, func() bool {
		return wm.IsWatchingPath("web", subDir)
	})

	subFile := filepath.Join(subDir, "Button.js")
	err = os.WriteFile(subFile, []byte("export const Button = () => {};"), 0644)
	if err != nil {
		t.Fatalf("failed to write subFile: %v", err)
	}

	select {
	case svc := <-dirtyCh:
		if svc != "web" {
			t.Fatalf("expected dirty service 'web', got %q", svc)
		}
		if !tracker.IsDirty("web") {
			t.Fatal("expected tracker to know web is dirty")
		}
	case <-time.After(1 * time.Second):
		t.Fatal("timeout waiting for dynamic subfolder event")
	}

	tracker.SetDirty("web", false)
	wm.SetDebounceDuration(1 * time.Hour)

	testFile2 := filepath.Join(srcDir, "app2.js")
	err = os.WriteFile(testFile2, []byte("console.log(2);"), 0644)
	if err != nil {
		t.Fatalf("failed to write app2.js: %v", err)
	}

	// Wait until background fsnotify loop processes event and creates the debounce timer
	waitForCondition(t, 5*time.Second, func() bool {
		return wm.HasPendingTimer("web")
	})

	wm.CancelTimer("web")

	select {
	case svc := <-dirtyCh:
		t.Fatalf("unexpected dirty event fired for %q after cancellation", svc)
	case <-time.After(100 * time.Millisecond):
		if tracker.IsDirty("web") {
			t.Fatal("expected web to remain clean since timer was cancelled")
		}
	}
	if wm.HasPendingTimer("web") {
		t.Fatal("expected web pending timer to be removed after cancellation")
	}
}

func TestWatchManagerDebounceTimerNotDeletedByPriorTimer(t *testing.T) {
	tracker := NewDirtyTracker()
	firstFired := make(chan struct{})
	holdFirst := make(chan struct{})
	wm := NewWatchManager(tracker, func(svc string) {
		select {
		case <-firstFired:
		default:
			close(firstFired)
			<-holdFirst
		}
	}, nil, "")
	defer wm.StopAll()

	wm.SetDebounceDuration(5 * time.Millisecond)
	wm.handleEvent("web", fsnotify.Event{Name: "foo.js", Op: fsnotify.Write})

	select {
	case <-firstFired:
	case <-time.After(1 * time.Second):
		t.Fatal("timeout waiting for first timer callback to fire")
	}

	wm.SetDebounceDuration(1 * time.Hour)
	wm.handleEvent("web", fsnotify.Event{Name: "foo2.js", Op: fsnotify.Write})

	timerDone := make(chan struct{}, 1)
	wm.onTimerDone = func(svc string) {
		select {
		case timerDone <- struct{}{}:
		default:
		}
	}
	close(holdFirst)
	select {
	case <-timerDone:
	case <-time.After(5 * time.Second):
		t.Fatal("timeout waiting for timer cleanup")
	}
	if !wm.HasPendingTimer("web") {
		t.Fatal("expected pending timer for web to remain present after first timer completed")
	}
}

