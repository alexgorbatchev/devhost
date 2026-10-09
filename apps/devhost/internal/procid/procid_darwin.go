//go:build darwin

package procid

import (
	"fmt"

	"golang.org/x/sys/unix"
)

// StartIdentity returns a value that is the same for as long as the process
// runs and that no later process with the same PID has: the start time the
// kernel stored when it created the process, to the microsecond.
func StartIdentity(pid int) (string, error) {
	info, err := unix.SysctlKinfoProc("kern.proc.pid", pid)
	if err != nil {
		return "", fmt.Errorf("read process %d: %w", pid, err)
	}

	startTime := info.Proc.P_starttime
	return fmt.Sprintf("%d.%06d", startTime.Sec, startTime.Usec), nil
}
