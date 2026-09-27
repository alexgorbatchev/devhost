//go:build darwin

package services

import (
	"fmt"
	"os/exec"
	"sort"
	"strconv"
	"strings"
)

func readListeningProcessIDsForBindHost(bindHost string, port int) []int {
	if _, err := exec.LookPath("lsof"); err != nil {
		return nil
	}

	result, err := exec.Command("lsof", "-nP", fmt.Sprintf("-iTCP@%s:%d", bindHost, port), "-sTCP:LISTEN", "-Fp").Output()
	if err != nil {
		return nil
	}

	pids := []int{}
	seen := map[int]struct{}{}
	for _, line := range strings.Split(string(result), "\n") {
		if !strings.HasPrefix(line, "p") || len(line) <= 1 {
			continue
		}

		pid, err := strconv.Atoi(line[1:])
		if err != nil {
			continue
		}
		if _, ok := seen[pid]; ok {
			continue
		}

		seen[pid] = struct{}{}
		pids = append(pids, pid)
	}

	sort.Ints(pids)
	return pids
}
