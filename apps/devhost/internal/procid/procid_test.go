//go:build linux || darwin

package procid

import (
	"os"
	"os/exec"
	"testing"
	"time"
)

// startSleeper starts a process that outlives the test body.
func startSleeper(t *testing.T) *exec.Cmd {
	t.Helper()

	command := exec.Command("sleep", "60")
	if err := command.Start(); err != nil {
		t.Fatalf("start sleep: %v", err)
	}
	t.Cleanup(func() {
		_ = command.Process.Kill() // no-op once the test has ended it
		_ = command.Wait()         // reap it so it does not linger as a zombie
	})

	return command
}

func TestStartIdentityStaysWithTheProcess(t *testing.T) {
	first, err := StartIdentity(os.Getpid())
	if err != nil {
		t.Fatalf("StartIdentity(own pid) unexpected error = %v", err)
	}
	if first == "" {
		t.Fatal("StartIdentity(own pid) = \"\", want an identity")
	}

	second, err := StartIdentity(os.Getpid())
	if err != nil {
		t.Fatalf("StartIdentity(own pid) unexpected error = %v", err)
	}
	if second != first {
		t.Fatalf("StartIdentity(own pid) = %q then %q, want the same identity", first, second)
	}
}

func TestStartIdentityTellsProcessesApart(t *testing.T) {
	earlier := startSleeper(t)
	earlierIdentity, err := StartIdentity(earlier.Process.Pid)
	if err != nil {
		t.Fatalf("StartIdentity(first process) unexpected error = %v", err)
	}

	// The finest unit either platform records a start time in is a clock tick,
	// one hundredth of a second, so the second process starts a few ticks later.
	time.Sleep(50 * time.Millisecond)

	later := startSleeper(t)
	laterIdentity, err := StartIdentity(later.Process.Pid)
	if err != nil {
		t.Fatalf("StartIdentity(second process) unexpected error = %v", err)
	}

	if laterIdentity == earlierIdentity {
		t.Fatalf("StartIdentity() = %q for two processes started apart, want different identities", laterIdentity)
	}
}

func TestStartIdentityOfAnExitedProcess(t *testing.T) {
	command := exec.Command("true")
	if err := command.Run(); err != nil {
		t.Fatalf("run a process to completion: %v", err)
	}

	if identity, err := StartIdentity(command.Process.Pid); err == nil {
		t.Fatalf("StartIdentity(exited process) = %q, want an error", identity)
	}
}
