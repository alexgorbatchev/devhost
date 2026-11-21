//go:build !linux && !darwin

package services

import (
	"fmt"
	"os/exec"
	"strconv"
	"strings"
)

func prepareServiceContainment() error {
	return nil
}

// readProcessSnapshot reads the process table through `ps`. This platform has no start identity devhost can read
// (see internal/procid), so every record leaves it empty and the tracker tells processes apart by PID alone.
func readProcessSnapshot() (processSnapshot, error) {
	command := exec.Command("ps", "ax", "-o", "pid=", "-o", "ppid=")
	output, err := command.Output()
	if err != nil {
		return processSnapshot{}, fmt.Errorf("read process table: %w", err)
	}

	snapshot := newProcessSnapshot()
	for _, line := range strings.Split(strings.TrimSpace(string(output)), "\n") {
		fields := strings.Fields(line)
		if len(fields) != 2 {
			continue
		}

		pid, err := strconv.Atoi(fields[0])
		if err != nil {
			continue
		}
		parentPID, err := strconv.Atoi(fields[1])
		if err != nil {
			continue
		}

		snapshot.add(pid, processRecord{parentPID: parentPID})
	}

	return snapshot, nil
}

func collectPlatformContainmentRootPIDs(_ map[int][]int, _ string) []int {
	return nil
}
