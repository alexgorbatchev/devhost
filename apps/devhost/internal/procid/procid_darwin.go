//go:build darwin

package procid

import (
	"fmt"
	"io/fs"

	"golang.org/x/sys/unix"
)

// StartIdentity returns a value that is the same for as long as the process
// runs and that no later process with the same PID has: the start time the
// kernel stored when it created the process, to the microsecond. The error of
// a process that does not exist wraps fs.ErrNotExist.
func StartIdentity(pid int) (string, error) {
	// The slice reader reports a PID without a process as an empty result,
	// where the single-record reader returns EIO, an error that also names
	// a failed read.
	processes, err := unix.SysctlKinfoProcSlice("kern.proc.pid", pid)
	if err != nil {
		return "", fmt.Errorf("read process %d: %w", pid, err)
	}
	if len(processes) == 0 {
		return "", fmt.Errorf("read process %d: %w", pid, fs.ErrNotExist)
	}

	return StartIdentityOf(&processes[0]), nil
}

// StartIdentityOf returns the start identity of a process the kernel already
// described, such as an entry of the kern.proc.all table, so a reader of the
// whole table gets each identity without reading every process again.
func StartIdentityOf(process *unix.KinfoProc) string {
	startTime := process.Proc.P_starttime
	return fmt.Sprintf("%d.%06d", startTime.Sec, startTime.Usec)
}
