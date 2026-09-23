package services

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"
)

// reapGatedWriter blocks on the first line it receives until the command has been reaped by Cmd.Wait, which is the
// moment Cmd.StdoutPipe/StderrPipe-based readers lose their pipe. The first write also releases the helper's FIFO
// handshake, so the helper's second line is still unread in the pipe at that moment.
type reapGatedWriter struct {
	fifoPath string
	pidPath  string
	once     sync.Once
	mu       sync.Mutex
	output   strings.Builder
}

func (w *reapGatedWriter) Write(p []byte) (int, error) {
	w.once.Do(func() {
		pid := readPIDFile(w.pidPath)
		fifo, err := os.OpenFile(w.fifoPath, os.O_WRONLY, 0)
		if err == nil {
			_ = fifo.Close()
		}
		// kill(pid, 0) keeps succeeding while the exited helper is an unreaped zombie and returns ESRCH once Wait
		// has reaped it. This polls for that event rather than sleeping for a guessed duration.
		if pid > 0 {
			for !errors.Is(syscall.Kill(pid, 0), syscall.ESRCH) {
				time.Sleep(time.Millisecond)
			}
		}
	})

	w.mu.Lock()
	defer w.mu.Unlock()
	return w.output.Write(p)
}

func (w *reapGatedWriter) String() string {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.output.String()
}

func readPIDFile(path string) int {
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		text, err := os.ReadFile(path)
		if err == nil {
			if pid, err := strconv.Atoi(strings.TrimSpace(string(text))); err == nil && pid > 0 {
				return pid
			}
		}
		time.Sleep(time.Millisecond)
	}
	return -1
}

func newLifecycleCommandService(t *testing.T, env map[string]string) ResolvedService {
	t.Helper()
	serviceEnv := map[string]string{"GO_WANT_HELPER_PROCESS": "1"}
	for key, value := range env {
		serviceEnv[key] = value
	}
	return ResolvedService{BindHost: "127.0.0.1", Cwd: t.TempDir(), Env: serviceEnv, Name: "api"}
}

func TestRunServiceCommandKeepsOutputWrittenBeforeExit(t *testing.T) {
	directoryPath := t.TempDir()
	fifoPath := filepath.Join(directoryPath, "handshake.fifo")
	pidPath := filepath.Join(directoryPath, "helper.pid")
	if err := syscall.Mkfifo(fifoPath, 0o600); err != nil {
		t.Fatalf("Mkfifo(...) error = %v", err)
	}

	stderrWriter := &reapGatedWriter{fifoPath: fifoPath, pidPath: pidPath}
	service := newLifecycleCommandService(t, map[string]string{
		"DEVHOST_HELPER_MODE": "stderr-around-fifo-handshake-and-exit",
		"HANDSHAKE_FIFO_PATH": fifoPath,
		"HELPER_PID_PATH":     pidPath,
	})
	err := runServiceCommand(newResolvedManifest(t.TempDir(), "127.0.0.1:20197"), service, helperCommand(), "daemon start",
		map[string]string{}, StartStackOptions{ServiceStdoutWriter: ioDiscard{}, ServiceStderrWriter: stderrWriter}, nil)
	if err != nil {
		t.Fatalf("runServiceCommand(...) error = %v", err)
	}

	want := "[api] before-handshake\n[api] after-handshake\n"
	if got := stderrWriter.String(); got != want {
		t.Fatalf("stderr = %q, want %q", got, want)
	}
}

func TestRunServiceCommandReturnsWhenADescendantKeepsTheOutputPipeOpen(t *testing.T) {
	childPIDPath := filepath.Join(t.TempDir(), "child.pid")
	t.Cleanup(func() {
		if pid := readPIDFile(childPIDPath); pid > 0 {
			_ = syscall.Kill(pid, syscall.SIGKILL)
		}
	})

	var stderr strings.Builder
	service := newLifecycleCommandService(t, map[string]string{
		"DEVHOST_HELPER_MODE": "stderr-then-spawn-stderr-holder-and-exit",
		"CHILD_PID_PATH":      childPIDPath,
	})
	// A regression here hangs until the `go test` deadline instead of returning.
	err := runServiceCommand(newResolvedManifest(t.TempDir(), "127.0.0.1:20197"), service, helperCommand(), "daemon start",
		map[string]string{}, StartStackOptions{ServiceStdoutWriter: ioDiscard{}, ServiceStderrWriter: &stderr}, nil)
	if err != nil {
		t.Fatalf("runServiceCommand(...) error = %v, want nil for a command that exited successfully", err)
	}

	if got := stderr.String(); got != "[api] daemon starting\n" {
		t.Fatalf("stderr = %q, want the start command's own line", got)
	}
}

func runStderrThenSpawnStderrHolderAndExitHelper() {
	_, _ = fmt.Fprintln(os.Stderr, "daemon starting")
	child := exec.Command(os.Args[0], "-test.run=TestServiceHelperProcess", "--")
	child.Env = append(os.Environ(), "DEVHOST_HELPER_MODE=wait-for-termination")
	// The child inherits this process's stderr, like a daemon that keeps its launcher's output pipe open.
	child.Stderr = os.Stderr
	if err := child.Start(); err != nil {
		os.Exit(2)
	}
	if err := os.WriteFile(os.Getenv("CHILD_PID_PATH"), []byte(strconv.Itoa(child.Process.Pid)), 0o644); err != nil {
		os.Exit(2)
	}
	os.Exit(0)
}

func runWaitForTerminationHelper() {
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, syscall.SIGTERM)
	<-signals
	os.Exit(0)
}
