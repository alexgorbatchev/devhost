//go:build linux || darwin

package services

import (
	"os"
	"os/exec"
	"slices"
	"testing"
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

	childrenByParent, err := readProcessSnapshot()
	if err != nil {
		t.Fatalf("readProcessSnapshot() with no commands on PATH: %v", err)
	}
	if !slices.Contains(childrenByParent[os.Getppid()], os.Getpid()) {
		t.Fatalf("snapshot lists %v under parent %d, want this process %d", childrenByParent[os.Getppid()], os.Getppid(), os.Getpid())
	}
	if !slices.Contains(childrenByParent[os.Getpid()], child.Process.Pid) {
		t.Fatalf("snapshot lists %v under this process %d, want child %d", childrenByParent[os.Getpid()], os.Getpid(), child.Process.Pid)
	}
	for parent, children := range childrenByParent {
		if slices.Contains(children, parent) {
			t.Fatalf("snapshot lists process %d as its own child", parent)
		}
	}
}
