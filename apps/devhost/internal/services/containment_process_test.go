//go:build linux || darwin

package services

import (
	"io"
	"os"
	"os/exec"
	"testing"
	"time"
)

// An exited child that its parent has not reaped yet is a zombie: kill(pid, 0) still succeeds for it, but it can no
// longer run or hold resources, so shutdown code must treat it as gone.
func TestProcessIsLiveTreatsUnreapedExitedChildAsDead(t *testing.T) {
	cmd := exec.Command(os.Args[0], "-test.run=^$")
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatalf("StdoutPipe() error = %v", err)
	}
	if err := cmd.Start(); err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	pid := cmd.Process.Pid
	t.Cleanup(func() {
		_ = cmd.Wait() // reap the zombie once the assertion is done
	})

	// The pipe reaches EOF when the child exits; not calling Wait keeps it unreaped.
	if _, err := io.Copy(io.Discard, stdout); err != nil {
		t.Fatalf("reading child stdout: %v", err)
	}

	deadline := time.Now().Add(2 * time.Second)
	for processIsLive(pid) {
		if time.Now().After(deadline) {
			t.Fatalf("processIsLive(%d) = true for an exited, unreaped child, want false", pid)
		}
		time.Sleep(10 * time.Millisecond)
	}
}
