//go:build !linux && !darwin

package procid

import (
	"errors"
	"fmt"
)

// StartIdentity reports that this platform has no start identity devhost can
// read, so processes are told apart by PID alone.
func StartIdentity(pid int) (string, error) {
	return "", fmt.Errorf("read the start identity of process %d: %w", pid, errors.ErrUnsupported)
}
