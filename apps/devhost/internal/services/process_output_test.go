package services

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"slices"
	"sync"
	"syscall"
	"testing"
)

// exitGatedWriter blocks on the first line it receives until the service process has exited. The first write also
// releases the helper's FIFO handshake, so the helper writes its second line and exits while this writer is still
// blocked: the second line is guaranteed to be sitting unread in the pipe when the process exit is observed.
type exitGatedWriter struct {
	fifoPath string
	started  chan *startedService
	once     sync.Once
}

func (w *exitGatedWriter) Write(p []byte) (int, error) {
	w.once.Do(func() {
		fifo, err := os.OpenFile(w.fifoPath, os.O_WRONLY, 0)
		if err == nil {
			_ = fifo.Close()
		}
		<-(<-w.started).exited
	})
	return len(p), nil
}

func TestStartServiceProcessKeepsOutputWrittenBeforeExit(t *testing.T) {
	fifoPath := filepath.Join(t.TempDir(), "handshake.fifo")
	if err := syscall.Mkfifo(fifoPath, 0o600); err != nil {
		t.Fatalf("Mkfifo(...) error = %v", err)
	}

	stderrWriter := &exitGatedWriter{fifoPath: fifoPath, started: make(chan *startedService, 1)}
	attemptOutput := &attemptOutputLines{}
	started, err := startServiceProcess(newResolvedManifest(t.TempDir(), "127.0.0.1:20197"), ResolvedService{
		BindHost: "127.0.0.1",
		Command:  helperCommand(),
		Cwd:      t.TempDir(),
		Env: map[string]string{
			"GO_WANT_HELPER_PROCESS": "1",
			"DEVHOST_HELPER_MODE":    "stderr-around-fifo-handshake-and-exit",
			"HANDSHAKE_FIFO_PATH":    fifoPath,
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

func runStderrAroundFIFOHandshakeAndExitHelper() {
	_, _ = fmt.Fprintln(os.Stderr, "before-handshake")
	fifo, err := os.Open(os.Getenv("HANDSHAKE_FIFO_PATH"))
	if err != nil {
		os.Exit(2)
	}
	_, _ = io.Copy(io.Discard, fifo)
	_ = fifo.Close()
	_, _ = fmt.Fprintln(os.Stderr, "after-handshake")
	os.Exit(0)
}
