package caddy

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"

	"golang.org/x/sys/unix"
)

// The lock file stays in place: unlinking it could let concurrent openers lock
// different inodes. Hold it only for record mutations, never service startup.
func withStackRecordsLock(dir string, mutate func() error) (err error) {
	if err := os.MkdirAll(filepath.Dir(dir), 0o755); err != nil {
		return fmt.Errorf("create stack state directory: %w", err)
	}
	f, err := os.OpenFile(dir+".lock", os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return fmt.Errorf("open stack records lock: %w", err)
	}
	defer func() { err = errors.Join(err, f.Close()) }()
	for {
		err := unix.Flock(int(f.Fd()), unix.LOCK_EX)
		if errors.Is(err, unix.EINTR) {
			continue
		}
		if err != nil {
			return fmt.Errorf("lock stack records: %w", err)
		}
		break
	}
	return mutate()
}

func canonicalManifestFiles(files []string) ([]string, error) {
	result := make([]string, 0, len(files))
	for _, file := range files {
		if file == "" {
			continue
		}
		path, err := filepath.Abs(file)
		if err != nil {
			return nil, fmt.Errorf("resolve manifest path %s: %w", file, err)
		}
		resolved, err := filepath.EvalSymlinks(path)
		if err == nil {
			path = resolved
		} else if !errors.Is(err, os.ErrNotExist) {
			return nil, fmt.Errorf("resolve manifest path %s: %w", file, err)
		}
		result = append(result, path)
	}
	slices.Sort(result)
	return slices.Compact(result), nil
}

func checkManifestOverlap(dir string, candidate stackRecord) error {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return fmt.Errorf("read stack records: %w", err)
	}
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}
		data, err := os.ReadFile(filepath.Join(dir, entry.Name()))
		if err != nil {
			return fmt.Errorf("read stack record: %w", err)
		}
		owner, err := parseStackRecord(data)
		if err != nil {
			return fmt.Errorf("read stack record %s: %w", entry.Name(), err)
		}
		if owner.OwnerPID == candidate.OwnerPID || !routeMutationIsOwnerAlive(owner.OwnerPID, owner.OwnerStartIdentity) {
			continue
		}
		files, err := canonicalManifestFiles(append([]string{owner.ManifestPath}, owner.ManifestFiles...))
		if err != nil {
			return err
		}
		for _, file := range candidate.ManifestFiles {
			if slices.Contains(files, file) {
				return fmt.Errorf("devhost is already running with manifest %s (PID %d, stack %s, root %s); stop that stack with devhost stop --manifest %q before starting this one", file, owner.OwnerPID, owner.StackName, owner.ManifestPath, owner.ManifestPath)
			}
		}
	}
	return nil
}
