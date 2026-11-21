//go:build linux || darwin

package services

import (
	"io"
	"os"
	"os/exec"
	"testing"
	"time"
)

// startUnreapedExitedChild starts a child that exits at once and leaves it uncollected until the test ends.
func startUnreapedExitedChild(t *testing.T) int {
	t.Helper()

	cmd := exec.Command(os.Args[0], "-test.run=^$")
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatalf("StdoutPipe() error = %v", err)
	}
	if err := cmd.Start(); err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	t.Cleanup(func() {
		_ = cmd.Wait() // reap the zombie once the assertion is done
	})

	// The pipe reaches EOF when the child exits; not calling Wait keeps it unreaped.
	if _, err := io.Copy(io.Discard, stdout); err != nil {
		t.Fatalf("reading child stdout: %v", err)
	}

	return cmd.Process.Pid
}

// An exited child that its parent has not reaped yet is a zombie: kill(pid, 0) still succeeds for it, but it can no
// longer run or hold resources, so shutdown code must treat it as gone.
func TestProcessIsLiveTreatsUnreapedExitedChildAsDead(t *testing.T) {
	pid := startUnreapedExitedChild(t)

	deadline := time.Now().Add(2 * time.Second)
	for processIsLive(pid) {
		if time.Now().After(deadline) {
			t.Fatalf("processIsLive(%d) = true for an exited, unreaped child, want false", pid)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

// A zombie keeps its PID until it is collected, so the process readers still list it, as exited: the tracker drops
// it and the shutdown waits for it no longer.
func TestProcessReadersMarkAnUnreapedExitedChildAsExited(t *testing.T) {
	pid := startUnreapedExitedChild(t)

	var read processRecord
	deadline := time.Now().Add(2 * time.Second)
	for {
		var ok bool
		read, ok = readProcessRecord(pid)
		if !ok {
			t.Fatalf("readProcessRecord(%d) found no process for an unreaped child, want its zombie", pid)
		}
		if read.exited {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("readProcessRecord(%d) = %+v for an exited, unreaped child, want it marked exited", pid, read)
		}
		time.Sleep(10 * time.Millisecond)
	}

	snapshot, err := readProcessSnapshot()
	if err != nil {
		t.Fatalf("readProcessSnapshot() error = %v", err)
	}
	if listed, ok := snapshot.processes[pid]; !ok || listed != read {
		t.Fatalf("snapshot lists zombie %d as %+v (listed: %t), want %+v", pid, listed, ok, read)
	}
	if processMatches(pid, read.startIdentity) {
		t.Fatalf("processMatches(zombie %d) = true, want false", pid)
	}
}
