package caddy

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/cliout"
	"golang.org/x/sys/unix"
)

// ManifestOverlapError identifies the live stack that owns a requested input.
type ManifestOverlapError struct {
	ManifestPath string
	Owner        StackOwner
	StackName    string
}

func (e *ManifestOverlapError) Error() string {
	return e.Message("devhost stop --manifest " + cliout.ShellPath(e.Owner.ManifestPath))
}

// Message formats the conflict with a stop command resolved by the CLI.
func (e *ManifestOverlapError) Message(stopCommand string) string {
	return fmt.Sprintf("devhost is already running with manifest %s (PID %d, stack %s, root %s); stop that stack with %s before starting this one", cliout.DisplayPath(e.ManifestPath), e.Owner.PID, e.StackName, cliout.DisplayPath(e.Owner.ManifestPath), stopCommand)
}

// Hold the stack records lock only for record mutations, never service startup.
func withStackRecordsLock(dir string, mutate func() error) error {
	return withFileLock(dir+".lock", "stack records", mutate)
}

// withFileLock runs mutate while this process holds an exclusive lock on
// lockPath, which serializes it with every devhost process locking that path.
// The lock file stays in place: unlinking it could let concurrent openers lock
// different inodes. A lock is per open file, so mutate must not take the same
// lock again.
func withFileLock(lockPath string, description string, mutate func() error) (err error) {
	if err := os.MkdirAll(filepath.Dir(lockPath), 0o755); err != nil {
		return fmt.Errorf("create %s lock directory: %w", description, err)
	}
	f, err := os.OpenFile(lockPath, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return fmt.Errorf("open %s lock: %w", description, err)
	}
	defer func() { err = errors.Join(err, f.Close()) }()
	for {
		err := unix.Flock(int(f.Fd()), unix.LOCK_EX)
		if errors.Is(err, unix.EINTR) {
			continue
		}
		if err != nil {
			return fmt.Errorf("lock %s: %w", description, err)
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
	owners, err := overlappingStacks(dir, candidate.ManifestFiles, candidate.OwnerPID)
	if err != nil {
		return err
	}
	for _, owner := range owners {
		return &ManifestOverlapError{ManifestPath: owner.file, StackName: owner.record.StackName, Owner: StackOwner{PID: owner.record.OwnerPID, ManifestPath: owner.record.ManifestPath}}
	}
	return nil
}

type overlappingStack struct {
	file   string
	record stackRecord
}

func overlappingStacks(dir string, requested []string, ownPID int) ([]overlappingStack, error) {
	var result []overlappingStack
	entries, err := os.ReadDir(dir)
	if errors.Is(err, os.ErrNotExist) {
		return result, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read stack records: %w", err)
	}
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}
		data, err := os.ReadFile(filepath.Join(dir, entry.Name()))
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return nil, fmt.Errorf("read stack record: %w", err)
		}
		owner, err := parseStackRecord(data)
		if err != nil {
			return nil, fmt.Errorf("read stack record %s: %w", entry.Name(), err)
		}
		if owner.OwnerPID == ownPID || !routeMutationIsOwnerAlive(owner.OwnerPID, owner.OwnerStartIdentity) {
			continue
		}
		files, err := canonicalManifestFiles(append([]string{owner.ManifestPath}, owner.ManifestFiles...))
		if err != nil {
			return nil, err
		}
		for _, file := range requested {
			if slices.Contains(files, file) {
				result = append(result, overlappingStack{file: file, record: owner})
				break
			}
		}
	}
	return result, nil
}
