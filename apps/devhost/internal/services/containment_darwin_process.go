//go:build darwin

package services

import "golang.org/x/sys/unix"

// darwinProcessStateZombie is SZOMB from the macOS SDK's <sys/proc.h>: the process exited and awaits collection by
// its parent. golang.org/x/sys/unix does not export the process state constants.
const darwinProcessStateZombie = 5

// processIsLive matches the Linux implementation: a zombie still answers kill(pid, 0) but has already exited, so it
// is not live.
func processIsLive(pid int) bool {
	if !processExistsBySignal(pid) {
		return false
	}

	info, err := unix.SysctlKinfoProc("kern.proc.pid", pid)
	if err != nil {
		// Keep the signal probe's answer: reporting a live process as dead would let shutdown skip it, while a
		// process that exited in between is caught by the next probe.
		return true
	}

	return info.Proc.P_stat != darwinProcessStateZombie
}
