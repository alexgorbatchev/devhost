package services

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"syscall"
	"time"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/cliout"
)

// stopGracePeriod is how long a stack is given to stop after SIGTERM before it
// is force-killed.
const stopGracePeriod = 15 * time.Second

// StopStack finds all running processes associated with the given manifest and stops them.
// It first attempts a clean shutdown using SIGTERM, and falls back to SIGKILL if processes
// do not stop within the 15-second grace period.
func StopStack(manifestPath string, environment map[string]string, stdout io.Writer, stderr io.Writer) error {
	return stopStack(manifestPath, environment, stopGracePeriod, stdout, stderr)
}

func stopStack(manifestPath string, environment map[string]string, gracePeriod time.Duration, stdout io.Writer, stderr io.Writer) error {
	absoluteTargetManifestPath, err := filepath.Abs(manifestPath)
	if err != nil {
		return fmt.Errorf("resolve absolute manifest path for %s: %w", manifestPath, err)
	}
	absoluteTargetManifestPath = filepath.Clean(absoluteTargetManifestPath)

	paths, err := caddy.CreateManagedCaddyPathsFromEnvironment(environment)
	if err != nil {
		return fmt.Errorf("resolve caddy paths from environment: %w", err)
	}

	owners, err := caddy.ReadLiveStackOwners(paths)
	if err != nil {
		return fmt.Errorf("scan claim directories for manifest process IDs: %w", err)
	}

	activePIDs := []int{}
	for _, owner := range owners {
		if resolveRecordedManifestPath(owner.ManifestPath) == absoluteTargetManifestPath {
			activePIDs = append(activePIDs, owner.PID)
		}
	}

	if len(activePIDs) == 0 {
		cliout.Log(stdout, "devhost", fmt.Sprintf("No active devhost stack process found for manifest: %s", absoluteTargetManifestPath))
		if len(owners) > 0 {
			// The stack the caller means may run from another manifest, such as the one
			// that holds a hostname they need.
			cliout.Log(stdout, "devhost", "Other stacks are running. Run \"devhost stack list\" to print their PIDs and manifests.")
		}
		return nil
	}

	cliout.Log(stdout, "devhost", fmt.Sprintf("Stopping %d active stack process(es) associated with manifest...", len(activePIDs)))

	for _, pid := range activePIDs {
		if err := stopProcess(pid, gracePeriod, stdout, stderr); err != nil {
			return fmt.Errorf("stop process %d: %w", pid, err)
		}
	}

	return nil
}

// resolveRecordedManifestPath returns the absolute form of the manifest path a
// stack recorded. A stack records an absolute path; one started by a devhost
// that recorded the path as it was typed is matched from the directory it was
// started in.
func resolveRecordedManifestPath(recordedPath string) string {
	absolutePath, err := filepath.Abs(recordedPath)
	if err != nil {
		return filepath.Clean(recordedPath)
	}

	return filepath.Clean(absolutePath)
}

func stopProcess(pid int, gracePeriod time.Duration, stdout io.Writer, stderr io.Writer) error {
	proc, err := os.FindProcess(pid)
	if err != nil {
		// On Unix, FindProcess always succeeds even if process doesn't exist,
		// but checking is safe.
		return fmt.Errorf("find process %d: %w", pid, err)
	}

	cliout.Log(stdout, "devhost", fmt.Sprintf("Sending SIGTERM to process %d...", pid))
	if err := proc.Signal(syscall.SIGTERM); err != nil {
		if err == os.ErrProcessDone || isNoSuchProcessError(err) {
			cliout.Log(stdout, "devhost", fmt.Sprintf("Process %d already stopped.", pid))
			return nil
		}
		return fmt.Errorf("signal process %d with SIGTERM: %w", pid, err)
	}

	pollInterval := 100 * time.Millisecond
	deadline := time.Now().Add(gracePeriod)

	for time.Now().Before(deadline) {
		if !processExists(pid) {
			cliout.Log(stdout, "devhost", fmt.Sprintf("Process %d stopped cleanly.", pid))
			return nil
		}
		time.Sleep(pollInterval)
	}

	cliout.Log(stderr, "devhost", fmt.Sprintf("Process %d did not stop in time. Sending SIGKILL...", pid))
	if err := proc.Kill(); err != nil {
		if err == os.ErrProcessDone || isNoSuchProcessError(err) {
			cliout.Log(stdout, "devhost", fmt.Sprintf("Process %d already stopped.", pid))
			return nil
		}
		return fmt.Errorf("kill process %d: %w", pid, err)
	}

	// Short wait to verify kill succeeded
	for i := 0; i < 10; i++ {
		if !processExists(pid) {
			cliout.Log(stdout, "devhost", fmt.Sprintf("Process %d terminated.", pid))
			return nil
		}
		time.Sleep(100 * time.Millisecond)
	}

	return fmt.Errorf("failed to terminate process %d after SIGKILL", pid)
}

func isNoSuchProcessError(err error) bool {
	if err == nil {
		return false
	}
	// Check standard syscall ESRCH error
	return err == syscall.ESRCH
}
