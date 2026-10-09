//go:build linux

package procid

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
)

// Positions in /proc/<pid>/stat counted from the field after the command name,
// which is the third field of the line: state is field 3, the parent PID field
// 4, and the start time field 22 (proc_pid_stat(5)).
const (
	statStateIndex      = 0
	statParentPIDIndex  = 1
	statStartTicksIndex = 19
)

// Stat is what devhost reads from /proc/<pid>/stat.
type Stat struct {
	ParentPID int
	// State is the kernel's one-letter process state, such as 'R', 'S', or 'Z'.
	State byte
	// StartTicks is when the process started, in clock ticks since boot. The
	// kernel sets it once, so it does not move when the clock is adjusted.
	StartTicks uint64
}

// ReadStat reads the stat line of the process. The error of a process that does
// not exist wraps fs.ErrNotExist.
func ReadStat(pid int) (Stat, error) {
	statPath := filepath.Join("/proc", strconv.Itoa(pid), "stat")
	text, err := os.ReadFile(statPath)
	if err != nil {
		return Stat{}, err
	}

	// The command name is in parentheses and may itself hold spaces and
	// parentheses, so the fields are counted from the last closing one.
	line := strings.TrimSpace(string(text))
	closeIndex := strings.LastIndex(line, ")")
	if closeIndex < 0 || closeIndex+2 >= len(line) {
		return Stat{}, fmt.Errorf("parse %s: malformed stat line", statPath)
	}

	fields := strings.Fields(line[closeIndex+2:])
	if len(fields) <= statStartTicksIndex {
		return Stat{}, fmt.Errorf("parse %s: %d fields after the command name, want more than %d", statPath, len(fields), statStartTicksIndex)
	}

	parentPID, err := strconv.Atoi(fields[statParentPIDIndex])
	if err != nil {
		return Stat{}, fmt.Errorf("parse %s parent pid: %w", statPath, err)
	}

	startTicks, err := strconv.ParseUint(fields[statStartTicksIndex], 10, 64)
	if err != nil {
		return Stat{}, fmt.Errorf("parse %s start time: %w", statPath, err)
	}

	return Stat{ParentPID: parentPID, State: fields[statStateIndex][0], StartTicks: startTicks}, nil
}

// readBootID returns the identifier the kernel generates at each boot. Start
// ticks count from boot, so two boots can give two processes the same PID and
// the same ticks.
var readBootID = sync.OnceValues(func() (string, error) {
	text, err := os.ReadFile("/proc/sys/kernel/random/boot_id")
	if err != nil {
		return "", err
	}

	return strings.TrimSpace(string(text)), nil
})

// StartIdentity returns a value that is the same for as long as the process
// runs and that no later process with the same PID has. The error of a process
// that does not exist wraps fs.ErrNotExist.
func StartIdentity(pid int) (string, error) {
	bootID, err := readBootID()
	if err != nil {
		return "", fmt.Errorf("read boot id: %w", err)
	}

	stat, err := ReadStat(pid)
	if err != nil {
		return "", err
	}

	return bootID + ":" + strconv.FormatUint(stat.StartTicks, 10), nil
}
