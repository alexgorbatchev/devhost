package services

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/cliout"
)

func TestDetachedStartRejectsUnsupportedPlatforms(t *testing.T) {
	for _, goos := range []string{"linux", "darwin"} {
		if err := checkDetachPlatform(goos); err != nil {
			t.Fatalf("checkDetachPlatform(%q) = %v, want nil", goos, err)
		}
	}
	f := newDetachFixture(t, "exit")
	f.options.goos = "windows"
	err := StartDetachedStack(context.Background(), f.options)
	if err == nil || err.Error() != "devhost start --detach runs on Linux and macOS, not windows" {
		t.Fatalf("error = %v, want the platform rejection", err)
	}
	// The rejection comes before anything is created or launched.
	for _, path := range []string{filepath.Dir(f.logPath), filepath.Join(f.directory, "pid")} {
		if _, err := os.Stat(path); !errors.Is(err, os.ErrNotExist) {
			t.Fatalf("%s exists after the rejection: %v", path, err)
		}
	}
	t.Setenv("AGENT", "0")
	var output bytes.Buffer
	cliout.WriteFailure(&output, err)
	want := "devhost | [ERROR] devhost start --detach runs on Linux and macOS, not windows\n" +
		"devhost | [INFO] Run devhost start without --detach and keep its terminal open.\n"
	if output.String() != want {
		t.Fatalf("failure line = %q, want %q", output.String(), want)
	}
}

// A second start of a manifest, through any path to that file, waits for the
// start already running instead of launching a supervisor of its own: a
// supervisor that has registered but is not ready yet can still fail.
func TestDetachedStartsOfOneManifestTakeTurns(t *testing.T) {
	first := newDetachFixture(t, "stop")
	firstSignals := make(chan os.Signal, 1)
	first.options.Signals = firstSignals
	firstResult := first.start(context.Background())
	firstReturned := false
	t.Cleanup(func() {
		// A test that fails early cancels the first start, which stops its
		// supervisor, before the fixture's cleanup removes the helper's files.
		if !firstReturned {
			firstSignals <- syscall.SIGINT
			_ = receiveDetachResult(t, firstResult) // The test already failed.
		}
	})
	// The first start holds the manifest's lock from before it launches its
	// supervisor until it returns.
	pid := first.waitForFile(t, "pid")

	alias := filepath.Join(t.TempDir(), "alias.toml")
	if err := os.Symlink(first.options.Manifest.ManifestPath, alias); err != nil {
		t.Fatal(err)
	}
	second := first.options
	second.Manifest.ManifestPath = alias
	second.Signals = nil
	second.Stdout, second.Stderr = &bytes.Buffer{}, &bytes.Buffer{}
	ctx, cancel := context.WithTimeout(context.Background(), 300*time.Millisecond)
	defer cancel()
	err := StartDetachedStack(ctx, second)
	want := "another start of this manifest did not finish within "
	if err == nil || !strings.HasPrefix(err.Error(), want) || !strings.HasSuffix(err.Error(), "; full log: "+first.logPath) {
		t.Fatalf("second start error = %v, want %q and the log %s", err, want, first.logPath)
	}
	if got := first.waitForFile(t, "pid"); got != pid {
		t.Fatalf("the second start launched supervisor PID %s beside PID %s", got, pid)
	}

	firstSignals <- syscall.SIGINT
	err = receiveDetachResult(t, firstResult)
	firstReturned = true
	if want := "received SIGINT (Ctrl-C) (signal 2) before the stack was ready; full log: " + first.logPath; err == nil || err.Error() != want {
		t.Fatalf("first start error = %v, want %q", err, want)
	}
}
