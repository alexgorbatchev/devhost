package services

import (
	"os"
	"path/filepath"
	"testing"
	"testing/synctest"
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

func TestWatchManagerMovesServiceToAnotherCheckout(t *testing.T) {
	old, next := t.TempDir(), t.TempDir()
	tracker := NewDirtyTracker()
	events := make(chan string, 10)
	w := NewWatchManager(tracker, func(name string) { events <- name }, nil, "")
	defer w.StopAll()
	if err := w.StartWatching("web", []string{"."}, old); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(old, "queued.txt"), nil, 0o600); err != nil {
		t.Fatal(err)
	}
	w.StopWatching("web")
	tracker.SetDirty("web", false)
	if err := w.StartWatching("web", []string{"."}, next); err != nil {
		t.Fatal(err)
	}
	if w.IsWatchingPath("web", old) || !w.IsWatchingPath("web", next) {
		t.Fatal("watcher retained original checkout")
	}
	if err := os.WriteFile(filepath.Join(old, "ignored.txt"), nil, 0o600); err != nil {
		t.Fatal(err)
	}
	select {
	case <-events:
		t.Fatal("old checkout marked dirty after watcher stopped")
	case <-time.After(300 * time.Millisecond):
	}
	if err := os.WriteFile(filepath.Join(next, "source.txt"), nil, 0o600); err != nil {
		t.Fatal(err)
	}
	select {
	case <-events:
		if !tracker.IsDirty("web") {
			t.Fatal("new checkout failed to mark dirty")
		}
	case <-time.After(time.Second):
		t.Fatal("new checkout change was not observed")
	}
}

func TestWatchManagerDebounceAndDynamicDir(t *testing.T) {
	tmpDir := t.TempDir()

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

	if err := wm.StartWatching("web", []string{"src/"}, tmpDir); err != nil {
		t.Fatalf("failed to start watching: %v", err)
	}

	testFile := filepath.Join(srcDir, "app.js")
	if err := os.WriteFile(testFile, []byte("console.log(1);"), 0644); err != nil {
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
	if err := os.Mkdir(subDir, 0755); err != nil {
		t.Fatalf("failed to create components dir: %v", err)
	}

	waitForCondition(t, 5*time.Second, func() bool {
		return wm.IsWatchingPath("web", subDir)
	})

	subFile := filepath.Join(subDir, "Button.js")
	if err := os.WriteFile(subFile, []byte("export const Button = () => {};"), 0644); err != nil {
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
}

func TestWatchManagerCancelTimer(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		tracker := NewDirtyTracker()
		dirtyCh := make(chan string, 2)
		wm := NewWatchManager(tracker, func(svc string) {
			dirtyCh <- svc
		}, nil, "")
		defer wm.StopAll()

		const debounce = time.Second
		wm.SetDebounceDuration(debounce)
		// Feed events directly so cancellation cannot race with queued fsnotify events.
		wm.handleEvent("web", fsnotify.Event{Name: "app.js", Op: fsnotify.Write})
		wm.handleEvent("api", fsnotify.Event{Name: "api.go", Op: fsnotify.Write})
		if !wm.HasPendingTimer("web") {
			t.Fatal("expected pending timer before cancellation")
		}

		wm.CancelTimer("web")
		if wm.HasPendingTimer("web") {
			t.Fatal("expected pending timer to be removed after cancellation")
		}

		time.Sleep(2 * debounce)
		synctest.Wait()
		if tracker.IsDirty("web") {
			t.Fatal("expected cancelled service to remain clean past the timer deadline")
		}
		select {
		case svc := <-dirtyCh:
			if svc != "api" || !tracker.IsDirty("api") {
				t.Fatalf("dirty event = %q, want unaffected api timer to fire", svc)
			}
		default:
			t.Fatal("expected unaffected api timer to fire")
		}
		select {
		case svc := <-dirtyCh:
			t.Fatalf("unexpected dirty event for %q after cancellation", svc)
		default:
		}

		// Cancellation only removes the current timer; later changes must still mark dirty.
		wm.handleEvent("web", fsnotify.Event{Name: "app.js", Op: fsnotify.Write})
		time.Sleep(2 * debounce)
		synctest.Wait()
		if !tracker.IsDirty("web") || wm.HasPendingTimer("web") {
			t.Fatal("expected later change to mark web dirty and complete its timer")
		}
		select {
		case svc := <-dirtyCh:
			if svc != "web" {
				t.Fatalf("dirty event = %q, want web", svc)
			}
		default:
			t.Fatal("expected dirty event for later web change")
		}
	})
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
