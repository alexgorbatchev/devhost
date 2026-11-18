//go:build linux || darwin

package services

import (
	"os"
	"os/exec"
	"slices"
	"testing"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/procid"
)

// Shutdown reads the process table every shutdownPollInterval for each stopping service, and every read holds the
// monitor's one refresh lock. A snapshot must therefore be read in-process: starting `ps` for each one made every
// stop in a busy process wait behind the others, and took a parallel test suite past its time limit on macOS.
func TestProcessSnapshotIsReadWithoutRunningACommand(t *testing.T) {
	child := exec.Command("/bin/sleep", "60")
	if err := child.Start(); err != nil {
		t.Fatalf("start child: %v", err)
	}
	t.Cleanup(func() {
		_ = child.Process.Kill()
		_ = child.Wait()
	})
	t.Setenv("PATH", t.TempDir())

	snapshot, err := readProcessSnapshot()
	if err != nil {
		t.Fatalf("readProcessSnapshot() with no commands on PATH: %v", err)
	}
	if !slices.Contains(snapshot.childrenByParent[os.Getppid()], os.Getpid()) {
		t.Fatalf("snapshot lists %v under parent %d, want this process %d", snapshot.childrenByParent[os.Getppid()], os.Getppid(), os.Getpid())
	}
	if !slices.Contains(snapshot.childrenByParent[os.Getpid()], child.Process.Pid) {
		t.Fatalf("snapshot lists %v under this process %d, want child %d", snapshot.childrenByParent[os.Getpid()], os.Getpid(), child.Process.Pid)
	}
	for parent, children := range snapshot.childrenByParent {
		if slices.Contains(children, parent) {
			t.Fatalf("snapshot lists process %d as its own child", parent)
		}
	}
}

// The tracker records a process's start identity from a snapshot and checks it before each signal by reading that one
// process, so both readers must give a running process procid's identity.
func TestProcessReadersGiveARunningProcessItsStartIdentity(t *testing.T) {
	child := exec.Command("/bin/sleep", "60")
	if err := child.Start(); err != nil {
		t.Fatalf("start child: %v", err)
	}
	t.Cleanup(func() {
		_ = child.Process.Kill()
		_ = child.Wait()
	})
	pid := child.Process.Pid

	identity, err := procid.StartIdentity(pid)
	if err != nil {
		t.Fatalf("procid.StartIdentity(child) error = %v", err)
	}
	want := processRecord{parentPID: os.Getpid(), startIdentity: identity}

	snapshot, err := readProcessSnapshot()
	if err != nil {
		t.Fatalf("readProcessSnapshot() error = %v", err)
	}
	if listed, ok := snapshot.processes[pid]; !ok || listed != want {
		t.Fatalf("snapshot lists child %d as %+v (listed: %t), want %+v", pid, listed, ok, want)
	}
	if read, ok := readProcessRecord(pid); !ok || read != want {
		t.Fatalf("readProcessRecord(child %d) = %+v, %t, want %+v, true", pid, read, ok, want)
	}
	if !processMatches(pid, identity) {
		t.Fatalf("processMatches(child %d, %q) = false, want true", pid, identity)
	}
	if processMatches(pid, identity+" of an earlier process") {
		t.Fatalf("processMatches(child %d) = true for another identity, want false", pid)
	}
}
