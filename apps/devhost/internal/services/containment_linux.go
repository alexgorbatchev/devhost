//go:build linux

package services

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"

	"golang.org/x/sys/unix"
)

var prepareServiceContainmentOnce sync.Once
var prepareServiceContainmentError error

func prepareServiceContainment() error {
	prepareServiceContainmentOnce.Do(func() {
		if err := unix.Prctl(unix.PR_SET_CHILD_SUBREAPER, uintptr(1), 0, 0, 0); err != nil {
			prepareServiceContainmentError = fmt.Errorf("enable linux child subreaper containment: %w", err)
		}
	})

	return prepareServiceContainmentError
}

func processIsLive(pid int) bool {
	if pid <= 0 {
		return false
	}

	stat, err := readLinuxProcessStat(pid)
	if err != nil {
		return false
	}

	return stat.state != 'Z' && stat.state != 'X' && stat.state != 'x'
}

func readProcessSnapshot() (map[int][]int, error) {
	entries, err := os.ReadDir("/proc")
	if err != nil {
		return nil, fmt.Errorf("read /proc: %w", err)
	}

	childrenByParent := map[int][]int{}
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}

		pid, err := strconv.Atoi(entry.Name())
		if err != nil {
			continue
		}

		stat, err := readLinuxProcessStat(pid)
		if err != nil {
			continue
		}

		childrenByParent[stat.parentPID] = append(childrenByParent[stat.parentPID], pid)
	}

	return childrenByParent, nil
}

func collectPlatformContainmentRootPIDs(childrenByParent map[int][]int, serviceToken string) []int {
	if serviceToken == "" {
		return nil
	}

	rootPIDs := []int{}
	for _, pid := range childrenByParent[os.Getpid()] {
		value, ok := readLinuxProcessEnvironmentValue(pid, serviceContainmentTokenEnvironment)
		if !ok || value != serviceToken {
			continue
		}

		rootPIDs = append(rootPIDs, pid)
	}

	return rootPIDs
}

type linuxProcessStat struct {
	parentPID int
	state     byte
}

func readLinuxProcessStat(pid int) (linuxProcessStat, error) {
	statPath := filepath.Join("/proc", strconv.Itoa(pid), "stat")
	text, err := os.ReadFile(statPath)
	if err != nil {
		return linuxProcessStat{}, err
	}

	line := strings.TrimSpace(string(text))
	closeIndex := strings.LastIndex(line, ")")
	if closeIndex < 0 || closeIndex+2 >= len(line) {
		return linuxProcessStat{}, fmt.Errorf("parse %s: malformed stat line", statPath)
	}

	fields := strings.Fields(line[closeIndex+2:])
	if len(fields) < 2 {
		return linuxProcessStat{}, fmt.Errorf("parse %s: missing ppid field", statPath)
	}

	parentPID, err := strconv.Atoi(fields[1])
	if err != nil {
		return linuxProcessStat{}, fmt.Errorf("parse %s parent pid: %w", statPath, err)
	}

	state := byte(0)
	if len(fields[0]) > 0 {
		state = fields[0][0]
	}

	return linuxProcessStat{parentPID: parentPID, state: state}, nil
}

func readLinuxProcessEnvironmentValue(pid int, key string) (string, bool) {
	environmentPath := filepath.Join("/proc", strconv.Itoa(pid), "environ")
	text, err := os.ReadFile(environmentPath)
	if err != nil {
		return "", false
	}

	prefix := key + "="
	for _, entry := range strings.Split(string(text), "\x00") {
		if !strings.HasPrefix(entry, prefix) {
			continue
		}

		return strings.TrimPrefix(entry, prefix), true
	}

	return "", false
}
