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

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/procid"
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

	stat, err := procid.ReadStat(pid)
	if err != nil {
		return false
	}

	return !hasExitedState(stat.State)
}

// hasExitedState reports a process state of a process that has exited: a zombie ('Z'), or one its parent is
// collecting ('X', which kernels from 2.6.33 to 3.13 also reported as 'x').
func hasExitedState(state byte) bool {
	return state == 'Z' || state == 'X' || state == 'x'
}

func readProcessSnapshot() (processSnapshot, error) {
	entries, err := os.ReadDir("/proc")
	if err != nil {
		return processSnapshot{}, fmt.Errorf("read /proc: %w", err)
	}

	snapshot := newProcessSnapshot()
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}

		pid, err := strconv.Atoi(entry.Name())
		if err != nil {
			continue
		}

		stat, err := procid.ReadStat(pid)
		if err != nil {
			// The process exited after the directory was read.
			continue
		}

		process, err := newProcessRecord(stat)
		if err != nil {
			return processSnapshot{}, err
		}
		snapshot.add(pid, process)
	}

	return snapshot, nil
}

// readProcessRecord reads the one process that has pid, as readProcessSnapshot lists it. ok is false when no process
// has the PID or its stat line cannot be read.
func readProcessRecord(pid int) (processRecord, bool) {
	stat, err := procid.ReadStat(pid)
	if err != nil {
		return processRecord{}, false
	}

	process, err := newProcessRecord(stat)
	if err != nil {
		return processRecord{}, false
	}

	return process, true
}

func newProcessRecord(stat procid.Stat) (processRecord, error) {
	identity, err := procid.StartIdentityOf(stat)
	if err != nil {
		return processRecord{}, err
	}

	return processRecord{parentPID: stat.ParentPID, startIdentity: identity, exited: hasExitedState(stat.State)}, nil
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
