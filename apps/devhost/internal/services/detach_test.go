package services

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"maps"
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

// A start whose command stopped waiting leaves its stack registered but not
// ready: a failed one until the end of its cleanup, a starting one until it is
// ready. The next start waits for that stack rather than reporting it as
// running: it launches once the stack is gone, and reports it once it is ready.
func TestDetachedStartWaitsForAnEarlierStartThatHasNotSettled(t *testing.T) {
	tests := []struct {
		name string
		mode string
		// signal ends the first start; nil leaves the failure the helper records.
		signal os.Signal
		// first is the first start's error before its log path. %s is the PID.
		first string
		// settle is the file that settles the earlier stack: "release" stops it
		// and "ready" marks it ready.
		settle string
	}{
		{
			name: "stopping", mode: "register+record+ignore", settle: "release",
			first: "service web did not become ready; the stack (PID %s) is still stopping",
		},
		{
			name: "starting", mode: "register+ignore", signal: syscall.SIGINT, settle: "ready",
			first: "received SIGINT (Ctrl-C) (signal 2) before the stack was ready; the stack (PID %s) is still stopping",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f := newDetachFixture(t, tt.mode)
			signals := make(chan os.Signal, 1)
			f.options.Signals, f.options.cleanupTimeout = signals, 300*time.Millisecond
			result := f.start(context.Background())
			pid := f.waitForFile(t, "pid")
			f.waitForFile(t, "registered")
			if tt.signal != nil {
				signals <- tt.signal
			}
			err := receiveDetachResult(t, result)
			if want := strings.Replace(tt.first, "%s", pid, 1) + "; full log: " + f.logPath; err == nil || err.Error() != want {
				t.Fatalf("first start error = %v, want %q", err, want)
			}

			waiting := f.options
			waiting.Signals = nil
			waiting.Stdout = &bytes.Buffer{}
			ctx, cancel := context.WithTimeout(context.Background(), 300*time.Millisecond)
			defer cancel()
			err = StartDetachedStack(ctx, waiting)
			want := "another start of this manifest did not finish within "
			if err == nil || !strings.HasPrefix(err.Error(), want) || !strings.HasSuffix(err.Error(), "; full log: "+f.logPath) {
				t.Fatalf("start during the earlier start error = %v, want %q and the log %s; stdout %q", err, want, f.logPath, waiting.Stdout)
			}
			if got := f.waitForFile(t, "pid"); got != pid {
				t.Fatalf("a start launched supervisor PID %s beside PID %s", got, pid)
			}

			next := f.options
			next.Signals = nil
			next.Stdout = &bytes.Buffer{}
			next.Environment = maps.Clone(f.options.Environment)
			next.Environment[detachHelperVariable] = "exit"
			nextResult := make(chan error, 1)
			go func() { nextResult <- StartDetachedStack(context.Background(), next) }()
			if err := writeHelperFile(f.directory, tt.settle, ""); err != nil {
				t.Fatal(err)
			}
			err = receiveDetachResult(t, nextResult)
			if tt.settle == "ready" {
				// A plain writer records lines with the log label in brackets.
				want := fmt.Sprintf("[devhost] Already running detach-failure (PID %s).\n[devhost] Log: %s\n", pid, cliout.FoldPaths(f.logPath))
				if err != nil || next.Stdout.(*bytes.Buffer).String() != want {
					t.Fatalf("start after the earlier stack was ready = %v, stdout %q, want %q", err, next.Stdout, want)
				}
				return
			}
			if want := "the stack exited before it was ready (exit code 3); full log: " + f.logPath; err == nil || err.Error() != want {
				t.Fatalf("start after the earlier stack stopped = %v, want %q", err, want)
			}
			if got := f.waitForFile(t, "pid"); got == pid {
				t.Fatal("the start after the earlier stack stopped launched no supervisor")
			}
		})
	}
}

// The startup budget and the wait for a failed supervisor's cleanup count the
// services the start runs, not the ones it leaves stopped.
func TestDetachedTimeoutsCountTheStartedServices(t *testing.T) {
	config := readHealthManifest(t, "[services.fixed]\ncommand = ['server']\nport = 4000\nhealth = { timeout = 1000 }\n"+
		"[services.auto]\ncommand = ['server']\nport = 'auto'\nhealth = { timeout = 2000 }\n"+
		"[services.idle]\ncommand = ['server']\nport = 4001\nhealth = { timeout = 600000 }\n")
	tests := []struct {
		name      string
		requested []string
		startup   time.Duration
		cleanup   time.Duration
	}{
		// Two minutes, plus each started service's health timeout and grace
		// period, four times for an automatic port; a minute plus two grace
		// periods per started service.
		{"fixed", []string{"fixed"}, 2*time.Minute + 11*time.Second, time.Minute + 20*time.Second},
		{"automatic port", []string{"auto"}, 2*time.Minute + 4*12*time.Second, time.Minute + 20*time.Second},
		{"both", []string{"fixed", "auto"}, 2*time.Minute + 11*time.Second + 4*12*time.Second, time.Minute + 40*time.Second},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			resolved, err := ResolveRequestedServicePorts(config, tt.requested)
			if err != nil {
				t.Fatal(err)
			}
			if got := detachedStartupTimeout(resolved); got != tt.startup {
				t.Errorf("detachedStartupTimeout = %s, want %s", got, tt.startup)
			}
			if got := detachedCleanupTimeout(resolved); got != tt.cleanup {
				t.Errorf("detachedCleanupTimeout = %s, want %s", got, tt.cleanup)
			}
		})
	}
}
