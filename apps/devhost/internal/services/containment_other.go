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

func readProcessSnapshot() (map[int][]int, error) {
	command := exec.Command("ps", "ax", "-o", "pid=", "-o", "ppid=")
	output, err := command.Output()
	if err != nil {
		return nil, fmt.Errorf("read process table: %w", err)
	}

	childrenByParent := map[int][]int{}
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

		childrenByParent[parentPID] = append(childrenByParent[parentPID], pid)
	}

	return childrenByParent, nil
}

func collectPlatformContainmentRootPIDs(_ map[int][]int, _ string) []int {
	return nil
}
