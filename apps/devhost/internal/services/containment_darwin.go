//go:build darwin

package services

import (
	"fmt"

	"golang.org/x/sys/unix"
)

func prepareServiceContainment() error {
	return nil
}

// readProcessSnapshot reads the process table in-process through the kern.proc.all sysctl, the source `ps` reads.
// Shutdown polls it often, so it must not start a command.
func readProcessSnapshot() (map[int][]int, error) {
	processes, err := unix.SysctlKinfoProcSlice("kern.proc.all")
	if err != nil {
		return nil, fmt.Errorf("read process table: %w", err)
	}

	childrenByParent := map[int][]int{}
	for _, process := range processes {
		pid := int(process.Proc.P_pid)
		// PID 0 is the kernel, which the table lists as its own child; `ps ax` leaves it out.
		if pid == 0 {
			continue
		}

		parentPID := int(process.Eproc.Ppid)
		childrenByParent[parentPID] = append(childrenByParent[parentPID], pid)
	}

	return childrenByParent, nil
}

func collectPlatformContainmentRootPIDs(_ map[int][]int, _ string) []int {
	return nil
}
