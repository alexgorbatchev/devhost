package app

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"testing"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy/caddytest"
)

// startListedStack starts a stack in another process, the way a second terminal
// would, and returns the absolute path of its manifest once its service runs.
// The stack is given its manifest as a path relative to its working directory.
// Its one service has no hostname and no port, so the stack holds no claim and
// is known only by the record every stack keeps of itself.
func startListedStack(t *testing.T, stateDirectoryPath string) (*exec.Cmd, string) {
	t.Helper()

	manifestDirectoryPath := t.TempDir()
	startTracePath := filepath.Join(t.TempDir(), "started.txt")
	stopTracePath := filepath.Join(t.TempDir(), "stopped.txt")
	manifestPath := writeSignalProcessManifest(t, manifestDirectoryPath, caddytest.StartAdminServer(t), startTracePath, stopTracePath)

	command := exec.Command(os.Args[0], "-test.run=TestRunSignalProcessHelper", "--")
	command.Dir = manifestDirectoryPath
	command.Env = append(os.Environ(),
		"GO_WANT_RUN_SIGNAL_HELPER=1",
		"DEVHOST_RUN_HELPER_MANIFEST="+filepath.Base(manifestPath),
		"DEVHOST_RUN_HELPER_CWD="+manifestDirectoryPath,
		"DEVHOST_STATE_DIR="+stateDirectoryPath,
	)
	if err := command.Start(); err != nil {
		t.Fatalf("Start(...) error = %v", err)
	}
	t.Cleanup(func() {
		// SIGTERM, so the stack stops its service before it exits; a no-op once the
		// stack has been stopped.
		_ = command.Process.Signal(syscall.SIGTERM)
		_ = command.Wait() // reap the stack so it does not linger as a zombie
	})

	waitForFile(t, startTracePath)

	return command, manifestPath
}

func runStackList(t *testing.T, cwd string) string {
	t.Helper()

	var stdout strings.Builder
	var stderr strings.Builder

	if exitCode := Run([]string{"stack", "list"}, cwd, &stdout, &stderr); exitCode != 0 {
		t.Fatalf("Run(stack list) exit code = %d, want 0 with stderr %q", exitCode, stderr.String())
	}

	if stderr.String() != "" {
		t.Fatalf("Run(stack list) stderr = %q, want empty", stderr.String())
	}

	return stdout.String()
}

func TestRunStackListPrintsThePIDAndTheManifestStopTakes(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("stopping a stack by signal is only exercised on POSIX platforms")
	}

	stateDirectoryPath := t.TempDir()
	t.Setenv("DEVHOST_STATE_DIR", stateDirectoryPath)

	stack, manifestPath := startListedStack(t, stateDirectoryPath)

	// Listed and stopped from a directory unrelated to the stack: the printed path
	// has to name the manifest by itself.
	elsewherePath := t.TempDir()

	for _, agent := range []string{"0", "1"} {
		t.Setenv("AGENT", agent)

		// One line per stack: the PID, a tab, and the manifest path to the end of
		// the line, so the path may hold spaces.
		if got, want := runStackList(t, elsewherePath), strconv.Itoa(stack.Process.Pid)+"\t"+manifestPath+"\n"; got != want {
			t.Fatalf("AGENT=%s Run(stack list) stdout = %q, want %q", agent, got, want)
		}
	}

	_, listedManifestPath, _ := strings.Cut(strings.TrimSuffix(runStackList(t, elsewherePath), "\n"), "\t")

	var stopStdout strings.Builder
	var stopStderr strings.Builder
	if exitCode := Run([]string{"stop", "--manifest", listedManifestPath}, elsewherePath, &stopStdout, &stopStderr); exitCode != 0 {
		t.Fatalf("Run(stop) exit code = %d, want 0 with stderr %q", exitCode, stopStderr.String())
	}

	// The stack ends with the exit code of the SIGTERM that stop sent it.
	err := stack.Wait()
	exitError, ok := err.(*exec.ExitError)
	if !ok || exitError.ExitCode() != 143 {
		t.Fatalf("stack Wait(...) error = %v, want exit code 143 after stop with stdout %q", err, stopStdout.String())
	}

	if got := runStackList(t, elsewherePath); got != "" {
		t.Fatalf("Run(stack list) stdout after stop = %q, want empty", got)
	}
}

func TestRunStackListPrintsNothingWithoutStacks(t *testing.T) {
	t.Setenv("DEVHOST_STATE_DIR", t.TempDir())

	for _, agent := range []string{"0", "1"} {
		t.Setenv("AGENT", agent)

		if got := runStackList(t, t.TempDir()); got != "" {
			t.Fatalf("AGENT=%s Run(stack list) stdout = %q, want empty", agent, got)
		}
	}
}

func TestRunStackListReportsAWriteFailure(t *testing.T) {
	t.Setenv("AGENT", "1")

	stateDirectoryPath := t.TempDir()
	t.Setenv("DEVHOST_STATE_DIR", stateDirectoryPath)

	startListedStack(t, stateDirectoryPath)

	var stderr strings.Builder

	exitCode := Run([]string{"stack", "list"}, t.TempDir(), closedWriter{}, &stderr)
	if exitCode != 1 {
		t.Fatalf("Run(stack list) exit code = %d, want 1", exitCode)
	}

	if want := "ERR: writing running stacks: io: read/write on closed pipe\n"; stderr.String() != want {
		t.Fatalf("Run(stack list) stderr = %q, want %q", stderr.String(), want)
	}
}
