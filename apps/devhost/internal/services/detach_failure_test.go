package services

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"

	"golang.org/x/sys/unix"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/cliout"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/testenv"
)

const detachHelperVariable = "DEVHOST_TEST_DETACH_HELPER"
const detachHelperDirectoryVariable = "DEVHOST_TEST_DETACH_DIRECTORY"

// detachHelperLifetime ends a helper that a failed test did not stop.
const detachHelperLifetime = 30 * time.Second

// runDetachHelper stands in for the supervisor of devhost start --detach. The
// mode names what it does: "exit" exits with code 3; "register" registers the
// stack of the manifest in its directory, unregistering when it exits, and
// marks it ready once the test writes a ready file; "record" records a failed
// web service; "stop" exits on SIGTERM; "ignore" notes SIGTERM and keeps
// running, as a supervisor whose cleanup hangs. Modes combine with "+". Every
// helper exits once the test writes its release file, and says so.
func runDetachHelper(mode string) (code int) {
	directory := os.Getenv(detachHelperDirectoryVariable)
	defer func() {
		if err := writeHelperFile(directory, "exited", ""); err != nil {
			code = 7
		}
	}()
	terms := make(chan os.Signal, 1)
	signal.Notify(terms, syscall.SIGTERM)
	if err := writeHelperFile(directory, "pid", strconv.Itoa(os.Getpid())); err != nil {
		return 2
	}
	paths, err := caddy.CreateManagedCaddyPathsFromEnvironment(map[string]string{"DEVHOST_STATE_DIR": os.Getenv("DEVHOST_STATE_DIR")})
	if err != nil {
		return 8
	}
	// unready is a registered stack the test has not yet marked ready.
	unready := false
	steps := strings.Split(mode, "+")
	for _, step := range steps {
		switch step {
		case "exit":
			return 3
		case "register":
			if err := caddy.RegisterStack(caddy.RegisterStackOptions{
				LogPath:             os.Getenv(DetachedLogEnvironment),
				ManifestPath:        filepath.Join(directory, "devhost.toml"),
				StackName:           "detach-failure",
				StacksDirectoryPath: paths.StacksDirectoryPath,
			}); err != nil {
				return 9
			}
			unready = true
			if err := writeHelperFile(directory, "registered", ""); err != nil {
				return 12
			}
			defer func() {
				if err := caddy.UnregisterStack(paths.StacksDirectoryPath); err != nil {
					code = 10
				}
			}()
		case "record":
			if err := recordDetachedFailure(os.Getenv(DetachedLogEnvironment), "web"); err != nil {
				return 4
			}
		}
	}
	deadline := time.After(detachHelperLifetime)
	release := time.NewTicker(10 * time.Millisecond)
	defer release.Stop()
	for {
		select {
		case <-terms:
			if err := writeHelperFile(directory, "terminated", ""); err != nil {
				return 5
			}
			if steps[len(steps)-1] == "stop" {
				return 0
			}
		case <-release.C:
			if _, err := os.Stat(filepath.Join(directory, "release")); err == nil {
				return 0
			}
			if _, err := os.Stat(filepath.Join(directory, "ready")); err == nil && unready {
				if err := caddy.SetStackReady(paths, nil); err != nil {
					return 11
				}
				unready = false
			}
		case <-deadline:
			return 6
		}
	}
}

// writeHelperFile publishes a file whole, so the test never reads part of it.
func writeHelperFile(directory, name, content string) error {
	temporary := filepath.Join(directory, "."+name)
	if err := os.WriteFile(temporary, []byte(content), 0o600); err != nil {
		return err
	}
	return os.Rename(temporary, filepath.Join(directory, name))
}

type detachFixture struct {
	options   DetachedStartOptions
	directory string
	logPath   string
}

func newDetachFixture(t *testing.T, mode string) *detachFixture {
	t.Helper()
	state, directory := t.TempDir(), t.TempDir()
	manifest := filepath.Join(directory, "devhost.toml")
	if err := os.WriteFile(manifest, []byte("name = \"detach-failure\"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	canonical, err := filepath.EvalSymlinks(manifest)
	if err != nil {
		t.Fatal(err)
	}
	f := &detachFixture{
		directory: directory,
		logPath:   filepath.Join(state, "logs", fmt.Sprintf("stack-%x.log", sha256.Sum256([]byte(canonical)))),
		options: DetachedStartOptions{
			Manifest:  ResolvedManifest{Name: "detach-failure", ManifestPath: manifest},
			Directory: directory,
			Environment: testenv.InheritIsolation(map[string]string{
				"DEVHOST_STATE_DIR":           state,
				detachHelperVariable:          mode,
				detachHelperDirectoryVariable: directory,
			}),
			Stdout: &bytes.Buffer{},
			Stderr: &bytes.Buffer{},
		},
	}
	t.Cleanup(func() { releaseDetachHelper(t, directory) })
	return f
}

// releaseDetachHelper ends a helper the test left running and waits until it
// has exited. It never signals a PID, which another process may own by then.
func releaseDetachHelper(t *testing.T, directory string) {
	t.Helper()
	if _, err := os.Stat(filepath.Join(directory, "pid")); err != nil {
		return
	}
	if err := writeHelperFile(directory, "release", ""); err != nil {
		t.Errorf("release the helper: %v", err)
		return
	}
	deadline := time.Now().Add(10 * time.Second)
	for {
		if _, err := os.Stat(filepath.Join(directory, "exited")); err == nil {
			return
		}
		if time.Now().After(deadline) {
			t.Error("the helper did not exit after its release")
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func (f *detachFixture) waitForFile(t *testing.T, name string) string {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for {
		data, err := os.ReadFile(filepath.Join(f.directory, name))
		if err == nil {
			return string(data)
		}
		if time.Now().After(deadline) {
			t.Fatalf("helper wrote no %s", name)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func (f *detachFixture) start(ctx context.Context) <-chan error {
	result := make(chan error, 1)
	go func() { result <- StartDetachedStack(ctx, f.options) }()
	return result
}

func receiveDetachResult(t *testing.T, result <-chan error) error {
	t.Helper()
	select {
	case err := <-result:
		return err
	case <-time.After(15 * time.Second):
		t.Fatal("detached start did not return")
		return nil
	}
}

func TestDetachedStartFailureNamesItsCauseAndLog(t *testing.T) {
	tests := []struct {
		name string
		mode string
		// deadline bounds the start through its context; zero leaves the
		// manifest's startup timeout.
		deadline time.Duration
		// signals are sent once the helper runs, each after the helper has seen
		// the SIGTERM the one before caused.
		signals        []os.Signal
		cleanupTimeout time.Duration
		// want is the error before its log path. %d is the helper's PID.
		want string
	}{
		{name: "recorded service", mode: "record+exit", want: "service web did not become ready"},
		{name: "supervisor exit", mode: "exit", want: "the stack exited before it was ready (exit code 3)"},
		{name: "readiness timeout", mode: "stop", deadline: 500 * time.Millisecond, want: "the stack was not ready within"},
		{name: "signal", mode: "stop", signals: []os.Signal{syscall.SIGINT}, want: "received SIGINT (Ctrl-C) (signal 2) before the stack was ready"},
		{
			name: "cleanup timeout", mode: "record+ignore", cleanupTimeout: 300 * time.Millisecond,
			want: "service web did not become ready; the stack (PID %d) is still stopping",
		},
		{
			name: "second signal", mode: "ignore", signals: []os.Signal{syscall.SIGTERM, syscall.SIGINT},
			want: "received SIGTERM (signal 15) before the stack was ready; the stack (PID %d) is still stopping",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f := newDetachFixture(t, tt.mode)
			signals := make(chan os.Signal, 1)
			f.options.Signals, f.options.cleanupTimeout = signals, tt.cleanupTimeout
			ctx := context.Background()
			if tt.deadline > 0 {
				var cancel context.CancelFunc
				ctx, cancel = context.WithTimeout(ctx, tt.deadline)
				defer cancel()
			}
			result := f.start(ctx)
			// The helper's PID is awaited only where the test needs it: a helper
			// that the readiness timeout stops before its signal handler is in
			// place exits without writing one.
			pid := ""
			if len(tt.signals) > 0 || strings.Contains(tt.want, "%d") {
				pid = f.waitForFile(t, "pid")
			}
			for index, received := range tt.signals {
				if index > 0 {
					// The caller signaled the helper and now waits for its cleanup.
					f.waitForFile(t, "terminated")
					select {
					case err := <-result:
						t.Fatalf("returned before the second signal: %v", err)
					default:
					}
				}
				signals <- received
			}
			err := receiveDetachResult(t, result)
			want := tt.want
			if strings.Contains(want, "%d") {
				want = strings.Replace(want, "%d", pid, 1)
			}
			if err == nil || !strings.HasPrefix(err.Error(), want) || !strings.HasSuffix(err.Error(), "; full log: "+f.logPath) {
				t.Fatalf("error = %v, want %q and the log %s", err, want, f.logPath)
			}
			if strings.Contains(want, "still stopping") {
				id, err := strconv.Atoi(pid)
				if err != nil {
					t.Fatal(err)
				}
				// The helper keeps running until its release, so its PID is still its own.
				if !processExists(id) {
					t.Fatal("the caller stopped the supervisor instead of leaving its cleanup to it")
				}
			}
			if strings.HasPrefix(tt.mode, "record") {
				// A supervisor that recorded a failed service stops itself; the
				// caller has no reason to signal it.
				if _, err := os.Stat(filepath.Join(f.directory, "terminated")); !errors.Is(err, os.ErrNotExist) {
					t.Fatalf("the caller signaled a supervisor that was already stopping: %v", err)
				}
			}
			if _, err := os.Stat(detachedFailurePath(f.logPath)); !errors.Is(err, os.ErrNotExist) {
				t.Fatalf("failure record left behind: %v", err)
			}
			if !strings.Contains(f.options.Stderr.(*bytes.Buffer).String(), "Startup log tail:") {
				t.Fatalf("stderr = %s", f.options.Stderr)
			}
		})
	}
}

func TestDetachedStartLaunchErrorNamesTheLog(t *testing.T) {
	f := newDetachFixture(t, "exit")
	f.options.Directory = filepath.Join(f.directory, "missing")
	err := StartDetachedStack(context.Background(), f.options)
	if err == nil || !strings.HasPrefix(err.Error(), "the stack supervisor could not be launched: ") || !strings.HasSuffix(err.Error(), "; full log: "+f.logPath) {
		t.Fatalf("error = %v", err)
	}
}

// A failure to prepare the start names the step for a person and adds the
// system's error for an agent; nothing has been logged, so the hint points to
// the state directory.
func TestDetachedStartPreparationFailureNamesTheStep(t *testing.T) {
	tests := []struct {
		name string
		// plant makes the step fail in the fixture's state directory.
		plant func(t *testing.T, f *detachFixture)
		step  string
	}{
		{"log directory", func(t *testing.T, f *detachFixture) { writeTestFile(t, filepath.Dir(f.logPath)) }, "the stack log directory could not be created"},
		{"lock", func(t *testing.T, f *detachFixture) { mkdirTest(t, strings.TrimSuffix(f.logPath, ".log")+".lock") }, "the start lock could not be opened"},
		{"running stacks", func(t *testing.T, f *detachFixture) { writeDamagedStackRecord(t, f) }, "the running stacks could not be read"},
		{"failure record", func(t *testing.T, f *detachFixture) {
			mkdirTest(t, filepath.Join(detachedFailurePath(f.logPath), "entry"))
		}, "the failure record of the previous start could not be removed"},
		{"log", func(t *testing.T, f *detachFixture) { mkdirTest(t, f.logPath) }, "the stack log could not be opened"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f := newDetachFixture(t, "exit")
			tt.plant(t, f)
			err := StartDetachedStack(context.Background(), f.options)
			if err == nil || !strings.HasPrefix(err.Error(), tt.step+": ") || strings.Contains(err.Error(), "full log") {
				t.Fatalf("error = %v, want %q and the system's error", err, tt.step)
			}
			if _, err := os.Stat(filepath.Join(f.directory, "pid")); !errors.Is(err, os.ErrNotExist) {
				t.Fatal("a supervisor started although the start could not be prepared")
			}
			t.Setenv("AGENT", "0")
			var output bytes.Buffer
			cliout.WriteFailure(&output, err)
			state := f.options.Environment["DEVHOST_STATE_DIR"]
			want := "devhost | [ERROR] " + tt.step + "\ndevhost | [INFO] Check that you can read and write devhost's state directory, " + cliout.FoldPaths(state) + ".\n"
			if output.String() != want {
				t.Fatalf("failure lines = %q, want %q", output.String(), want)
			}
		})
	}
}

// A damaged record of another stack ends a start that is waiting for its own
// stack, and the person reads the step without the parser's error.
func TestDetachedStartFailsWhenTheRunningStacksCannotBeReadWhileWaiting(t *testing.T) {
	f := newDetachFixture(t, "stop")
	result := f.start(context.Background())
	f.waitForFile(t, "pid")
	writeDamagedStackRecord(t, f)
	err := receiveDetachResult(t, result)
	if err == nil || !strings.HasPrefix(err.Error(), "the running stacks could not be read: ") || !strings.HasSuffix(err.Error(), "; full log: "+f.logPath) {
		t.Fatalf("error = %v", err)
	}
	t.Setenv("AGENT", "0")
	var output bytes.Buffer
	cliout.WriteFailure(&output, err)
	if !strings.HasPrefix(output.String(), "devhost | [ERROR] the running stacks could not be read\n") {
		t.Fatalf("failure lines = %q", output.String())
	}
}

func writeDamagedStackRecord(t *testing.T, f *detachFixture) {
	t.Helper()
	directory := caddy.CreateManagedCaddyPaths(f.options.Environment["DEVHOST_STATE_DIR"]).StacksDirectoryPath
	if err := os.MkdirAll(directory, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, "damaged.json"), []byte("{"), 0o600); err != nil {
		t.Fatal(err)
	}
}

func mkdirTest(t *testing.T, path string) {
	t.Helper()
	if err := os.MkdirAll(path, 0o700); err != nil {
		t.Fatal(err)
	}
}

// writeTestFile writes an empty file where the start expects a directory.
func writeTestFile(t *testing.T, path string) {
	t.Helper()
	if err := os.WriteFile(path, nil, 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestDetachedStartWaitingForTheLockNamesItsCause(t *testing.T) {
	tests := []struct {
		name     string
		deadline time.Duration
		signal   os.Signal
		// canceled cancels the caller's context before the start.
		canceled bool
		want     string
	}{
		{name: "timeout", deadline: 200 * time.Millisecond, want: "another start of this manifest did not finish within "},
		{name: "signal", signal: syscall.SIGHUP, want: "received SIGHUP (signal 1) while another start of this manifest was running"},
		{name: "canceled", canceled: true, want: "the start was canceled before the stack was ready"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f := newDetachFixture(t, "exit")
			if err := os.MkdirAll(filepath.Dir(f.logPath), 0o700); err != nil {
				t.Fatal(err)
			}
			lock, err := os.OpenFile(strings.TrimSuffix(f.logPath, ".log")+".lock", os.O_CREATE|os.O_RDWR, 0o600)
			if err != nil {
				t.Fatal(err)
			}
			defer lock.Close() // Releases the lock this test holds.
			if err := unix.Flock(int(lock.Fd()), unix.LOCK_EX|unix.LOCK_NB); err != nil {
				t.Fatal(err)
			}
			signals := make(chan os.Signal, 1)
			if tt.signal != nil {
				signals <- tt.signal
			}
			f.options.Signals = signals
			ctx := context.Background()
			if tt.deadline > 0 {
				var cancel context.CancelFunc
				ctx, cancel = context.WithTimeout(ctx, tt.deadline)
				defer cancel()
			}
			if tt.canceled {
				var cancel context.CancelFunc
				ctx, cancel = context.WithCancel(ctx)
				cancel()
			}
			err = receiveDetachResult(t, f.start(ctx))
			if err == nil || !strings.HasPrefix(err.Error(), tt.want) || !strings.HasSuffix(err.Error(), "; full log: "+f.logPath) {
				t.Fatalf("error = %v, want %q and the log %s", err, tt.want, f.logPath)
			}
			if _, err := os.Stat(filepath.Join(f.directory, "pid")); !errors.Is(err, os.ErrNotExist) {
				t.Fatal("a supervisor started while another start held the lock")
			}
		})
	}
}

func TestDetachedFailureLineForAPerson(t *testing.T) {
	t.Setenv("AGENT", "0")
	logPath := filepath.Join(os.Getenv("HOME"), "state", "logs", "stack-1.log")
	tests := []struct {
		name string
		hint string
		want []string
	}{
		{"stopped", "", []string{"[ERROR] service web did not become ready", "[INFO] Read the full log in ~/state/logs/stack-1.log."}},
		{"still stopping", "Run \"devhost stack list\" to see when it has stopped.", []string{"[INFO] Read the full log in ~/state/logs/stack-1.log. Run \"devhost stack list\" to see when it has stopped."}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var output bytes.Buffer
			cliout.WriteFailure(&output, detachedFailure(errors.New("service web did not become ready"), logPath, tt.hint))
			for _, line := range tt.want {
				if !strings.Contains(output.String(), line) {
					t.Fatalf("output = %q, want %q", output.String(), line)
				}
			}
			if strings.Contains(output.String(), "full log:") {
				t.Fatalf("a person got the agent's error: %q", output.String())
			}
		})
	}
}

func TestDetachedFailureRecord(t *testing.T) {
	logPath := filepath.Join(t.TempDir(), "stack-1.log")
	path := detachedFailurePath(logPath)
	if got := readDetachedFailure(path); got != nil {
		t.Fatalf("missing record = %v", got)
	}
	if err := recordDetachedFailure(logPath, "web"); err != nil {
		t.Fatal(err)
	}
	got := readDetachedFailure(path)
	if got == nil || got.service != "web" || got.Error() != "service web did not become ready" {
		t.Fatalf("record = %v", got)
	}
	if err := os.WriteFile(path, []byte("{"), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := readDetachedFailure(path); got != nil {
		t.Fatalf("damaged record = %v", got)
	}
	if err := removeDetachedFailure(path); err != nil {
		t.Fatal(err)
	}
	if err := removeDetachedFailure(path); err != nil {
		t.Fatalf("removing a missing record: %v", err)
	}
	if err := recordDetachedFailure(filepath.Join(logPath, "missing", "stack.log"), "web"); err == nil {
		t.Fatal("recorded into a missing directory")
	}
	// The supervisor's wrapped error keeps its chain for callers that inspect it.
	health := errors.New("health check failed")
	if err := error(&serviceNotReadyError{service: "web", err: health}); !errors.Is(err, health) || err.Error() != health.Error() {
		t.Fatalf("wrapped error = %v", err)
	}
}
