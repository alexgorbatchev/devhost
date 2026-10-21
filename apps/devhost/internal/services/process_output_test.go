package services

import (
	"fmt"
	"os"
	"os/signal"
	"slices"
	"strconv"
	"sync"
	"syscall"
	"testing"
)

// exitGatedWriter blocks on the first line it receives until the service process has exited. The first write also
// releases the helper's handshake, so the helper writes its second line and exits while this writer is still
// blocked: the second line is guaranteed to be sitting unread in the pipe when the process exit is observed.
type exitGatedWriter struct {
	started chan *startedService
	once    sync.Once
}

func (w *exitGatedWriter) Write(p []byte) (int, error) {
	w.once.Do(func() {
		started := <-w.started
		// The helper listens for the signal before it writes its first line, so the signal cannot arrive early.
		if err := started.cmd.Process.Signal(syscall.SIGUSR1); err != nil {
			panic(fmt.Sprintf("release the helper's handshake: %v", err))
		}
		<-started.exited
	})
	return len(p), nil
}

func TestStartServiceProcessKeepsOutputWrittenBeforeExit(t *testing.T) {
	stderrWriter := &exitGatedWriter{started: make(chan *startedService, 1)}
	attemptOutput := &attemptOutputLines{}
	started, err := startServiceProcess(newResolvedManifest(t.TempDir(), "127.0.0.1:20197"), ResolvedService{
		BindHost: "127.0.0.1",
		Command:  helperCommand(),
		Cwd:      t.TempDir(),
		Env: map[string]string{
			"GO_WANT_HELPER_PROCESS": "1",
			"DEVHOST_HELPER_MODE":    "stderr-around-handshake-and-exit",
		},
		Health: ResolvedHealthConfig{Kind: "process"},
		Name:   "web",
	}, processStartOptions{
		attemptOutput: attemptOutput,
		environment:   map[string]string{},
		stderrWriter:  stderrWriter,
		stdoutWriter:  ioDiscard{},
	})
	if err != nil {
		t.Fatalf("startServiceProcess(...) error = %v", err)
	}
	stderrWriter.started <- started
	started.wait()

	want := []string{"[web] before-handshake", "[web] after-handshake"}
	if got := attemptOutput.snapshot(); !slices.Equal(got, want) {
		t.Fatalf("attempt output = %#v, want %#v", got, want)
	}
}

// runStderrAroundHandshakeAndExitHelper writes one stderr line, waits for SIGUSR1, writes a second line, and exits.
// It waits for a signal rather than for the end of a FIFO: on macOS a reader blocked on a FIFO can stay blocked after
// the last writer closes it, which hung this helper and its test until the go test deadline.
func runStderrAroundHandshakeAndExitHelper() {
	released := make(chan os.Signal, 1)
	signal.Notify(released, syscall.SIGUSR1)
	// The PID is published only once the signal is handled, so a test that reads it cannot signal too early.
	if pidPath := os.Getenv("HELPER_PID_PATH"); pidPath != "" {
		_ = os.WriteFile(pidPath, []byte(strconv.Itoa(os.Getpid())), 0o644)
	}
	_, _ = fmt.Fprintln(os.Stderr, "before-handshake")
	<-released
	_, _ = fmt.Fprintln(os.Stderr, "after-handshake")
	os.Exit(0)
}
