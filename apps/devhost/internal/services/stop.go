package services

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"syscall"
	"time"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy"
)

type claimMetadata struct {
	OwnerPID     int    `json:"ownerPid"`
	ManifestPath string `json:"manifestPath"`
}

// StopStack finds all running processes associated with the given manifest and stops them.
// It first attempts a clean shutdown using SIGTERM, and falls back to SIGKILL if processes
// do not stop within the 15-second grace period.
func StopStack(manifestPath string, environment map[string]string, stdout io.Writer, stderr io.Writer) error {
	absoluteTargetManifestPath, err := filepath.Abs(manifestPath)
	if err != nil {
		return fmt.Errorf("resolve absolute manifest path for %s: %w", manifestPath, err)
	}
	absoluteTargetManifestPath = filepath.Clean(absoluteTargetManifestPath)

	paths, err := caddy.CreateManagedCaddyPathsFromEnvironment(environment)
	if err != nil {
		return fmt.Errorf("resolve caddy paths from environment: %w", err)
	}

	pidsToStop, err := scanForManifestPIDs(paths, absoluteTargetManifestPath)
	if err != nil {
		return fmt.Errorf("scan claim directories for manifest process IDs: %w", err)
	}

	activePIDs := []int{}
	for pid := range pidsToStop {
		if processExists(pid) {
			activePIDs = append(activePIDs, pid)
		}
	}

	if len(activePIDs) == 0 {
		_, _ = fmt.Fprintf(stdout, "No active devhost stack process found for manifest: %s\n", absoluteTargetManifestPath)
		return nil
	}

	_, _ = fmt.Fprintf(stdout, "Stopping %d active stack process(es) associated with manifest...\n", len(activePIDs))

	for _, pid := range activePIDs {
		if err := stopProcess(pid, stdout, stderr); err != nil {
			return fmt.Errorf("stop process %d: %w", pid, err)
		}
	}

	return nil
}

func scanForManifestPIDs(paths caddy.Paths, targetManifestPath string) (map[int]bool, error) {
	pids := make(map[int]bool)

	dirs := []string{
		paths.HostClaimsDirectoryPath,
		paths.PortClaimsDirectoryPath,
		paths.RegistrationsDirectoryPath,
	}

	for _, dir := range dirs {
		if dir == "" {
			continue
		}

		entries, err := os.ReadDir(dir)
		if err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return nil, fmt.Errorf("read claim directory %s: %w", dir, err)
		}

		for _, entry := range entries {
			if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
				continue
			}

			filePath := filepath.Join(dir, entry.Name())
			metadata, err := readClaimMetadata(filePath)
			if err != nil {
				// If file is deleted concurrently or is invalid, log/ignore or return error.
				// Returning error is safer to maintain correctness, but concurrent deletion of stale claims is expected.
				if os.IsNotExist(err) {
					continue
				}
				return nil, fmt.Errorf("read claim metadata from %s: %w", filePath, err)
			}

			claimManifestPath, err := filepath.Abs(metadata.ManifestPath)
			if err != nil {
				claimManifestPath = filepath.Clean(metadata.ManifestPath)
			} else {
				claimManifestPath = filepath.Clean(claimManifestPath)
			}

			if claimManifestPath == targetManifestPath && metadata.OwnerPID > 0 {
				pids[metadata.OwnerPID] = true
			}
		}
	}

	return pids, nil
}

func readClaimMetadata(filePath string) (claimMetadata, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return claimMetadata{}, err
	}
	defer file.Close()

	var meta claimMetadata
	if err := json.NewDecoder(file).Decode(&meta); err != nil {
		return claimMetadata{}, err
	}

	return meta, nil
}

func stopProcess(pid int, stdout io.Writer, stderr io.Writer) error {
	proc, err := os.FindProcess(pid)
	if err != nil {
		// On Unix, FindProcess always succeeds even if process doesn't exist,
		// but checking is safe.
		return fmt.Errorf("find process %d: %w", pid, err)
	}

	_, _ = fmt.Fprintf(stdout, "Sending SIGTERM to process %d...\n", pid)
	if err := proc.Signal(syscall.SIGTERM); err != nil {
		if err == os.ErrProcessDone || isNoSuchProcessError(err) {
			_, _ = fmt.Fprintf(stdout, "Process %d already stopped.\n", pid)
			return nil
		}
		return fmt.Errorf("signal process %d with SIGTERM: %w", pid, err)
	}

	// Poll up to 15 seconds
	gracePeriod := 15 * time.Second
	pollInterval := 100 * time.Millisecond
	deadline := time.Now().Add(gracePeriod)

	for time.Now().Before(deadline) {
		if !processExists(pid) {
			_, _ = fmt.Fprintf(stdout, "Process %d stopped cleanly.\n", pid)
			return nil
		}
		time.Sleep(pollInterval)
	}

	_, _ = fmt.Fprintf(stderr, "Process %d did not stop in time. Sending SIGKILL...\n", pid)
	if err := proc.Kill(); err != nil {
		if err == os.ErrProcessDone || isNoSuchProcessError(err) {
			_, _ = fmt.Fprintf(stdout, "Process %d already stopped.\n", pid)
			return nil
		}
		return fmt.Errorf("kill process %d: %w", pid, err)
	}

	// Short wait to verify kill succeeded
	for i := 0; i < 10; i++ {
		if !processExists(pid) {
			_, _ = fmt.Fprintf(stdout, "Process %d terminated.\n", pid)
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
