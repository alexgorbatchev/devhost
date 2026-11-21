//go:build darwin

package services

import (
	"fmt"

	"golang.org/x/sys/unix"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/procid"
)

func prepareServiceContainment() error {
	return nil
}

// readProcessSnapshot reads the process table in-process through the kern.proc.all sysctl, the source `ps` reads.
// Shutdown polls it often, so it must not start a command.
func readProcessSnapshot() (processSnapshot, error) {
	processes, err := unix.SysctlKinfoProcSlice("kern.proc.all")
	if err != nil {
		return processSnapshot{}, fmt.Errorf("read process table: %w", err)
	}

	snapshot := newProcessSnapshot()
	for index := range processes {
		process := &processes[index]
		pid := int(process.Proc.P_pid)
		// PID 0 is the kernel, which the table lists as its own child; `ps ax` leaves it out.
		if pid == 0 {
			continue
		}

		snapshot.add(pid, newProcessRecord(process))
	}

	return snapshot, nil
}

// readProcessRecord reads the one process that has pid, as readProcessSnapshot lists it. ok is false when no process
// has the PID or the table cannot be read.
func readProcessRecord(pid int) (processRecord, bool) {
	// The slice reader reports a PID without a process as an empty result.
	processes, err := unix.SysctlKinfoProcSlice("kern.proc.pid", pid)
	if err != nil || len(processes) == 0 {
		return processRecord{}, false
	}

	return newProcessRecord(&processes[0]), true
}

func newProcessRecord(process *unix.KinfoProc) processRecord {
	return processRecord{
		parentPID:     int(process.Eproc.Ppid),
		startIdentity: procid.StartIdentityOf(process),
		exited:        process.Proc.P_stat == darwinProcessStateZombie,
	}
}

func collectPlatformContainmentRootPIDs(_ map[int][]int, _ string) []int {
	return nil
}
