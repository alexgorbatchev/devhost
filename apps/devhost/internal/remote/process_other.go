//go:build !linux

package remote

func processExited(pid int) bool {
	// StartIdentity performs the platform's process-existence check.
	return false
}
