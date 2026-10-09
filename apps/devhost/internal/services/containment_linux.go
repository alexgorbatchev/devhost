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

	return stat.State != 'Z' && stat.State != 'X' && stat.State != 'x'
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

		stat, err := procid.ReadStat(pid)
		if err != nil {
			continue
		}

		childrenByParent[stat.ParentPID] = append(childrenByParent[stat.ParentPID], pid)
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
