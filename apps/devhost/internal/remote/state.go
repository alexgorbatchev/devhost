package remote

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"syscall"
	"time"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/procid"
	"golang.org/x/sys/unix"
)

const pollInterval = 50 * time.Millisecond

type owner struct {
	PID           int    `json:"pid"`
	StartIdentity string `json:"startIdentity"`
}

type leaseRecord struct {
	Owner        owner    `json:"owner"`
	ManifestPath string   `json:"manifestPath"`
	Hosts        []string `json:"hosts"`
	Backend      Backend  `json:"backend"`
}

type workerRecord struct {
	Owner        owner  `json:"owner"`
	AdminAddress string `json:"adminAddress,omitempty"`
	Stopping     bool   `json:"stopping,omitempty"`
}

func ownIdentity() (owner, error) {
	pid := os.Getpid()
	identity, err := procid.StartIdentity(pid)
	if err != nil {
		return owner{}, fmt.Errorf("identify remote preview owner: %w", err)
	}
	return owner{PID: pid, StartIdentity: identity}, nil
}

func (o owner) alive() bool {
	if o.PID <= 0 || o.StartIdentity == "" || processExited(o.PID) {
		return false
	}
	current, err := procid.StartIdentity(o.PID)
	if err != nil {
		// An unreadable live process retains ownership. Only an absent process
		// or a different verified start identity makes its lease stale.
		return !errors.Is(err, os.ErrNotExist) && !errors.Is(err, syscall.ESRCH)
	}
	return current == o.StartIdentity
}

func directory(stateDirectory string) string {
	return filepath.Join(stateDirectory, "remote")
}

func withLock(ctx context.Context, dir string, fn func() error) (err error) {
	if err := os.MkdirAll(filepath.Join(dir, "leases"), 0o700); err != nil {
		return fmt.Errorf("create remote preview state: %w", err)
	}
	f, err := os.OpenFile(filepath.Join(dir, "state.lock"), os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return err
	}
	defer func() { err = errors.Join(err, f.Close()) }()
	for {
		err := unix.Flock(int(f.Fd()), unix.LOCK_EX|unix.LOCK_NB)
		if err == nil {
			return fn()
		}
		if !errors.Is(err, unix.EWOULDBLOCK) && !errors.Is(err, unix.EINTR) {
			return fmt.Errorf("lock remote preview state: %w", err)
		}
		if err := pause(ctx); err != nil {
			return err
		}
	}
}

func pause(ctx context.Context) error {
	timer := time.NewTimer(pollInterval)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func writeJSON[T Settings | leaseRecord | workerRecord](path string, value T) (err error) {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(path), ".remote-*")
	if err != nil {
		return err
	}
	defer func() {
		if cleanup := os.Remove(f.Name()); cleanup != nil && !errors.Is(cleanup, os.ErrNotExist) {
			err = errors.Join(err, cleanup)
		}
	}()
	if _, err := f.Write(data); err != nil {
		return errors.Join(err, f.Close())
	}
	if err := f.Close(); err != nil {
		return err
	}
	return os.Rename(f.Name(), path)
}

func readJSON[T Settings | leaseRecord | workerRecord](path string) (T, error) {
	var value T
	data, err := os.ReadFile(path)
	if err != nil {
		return value, err
	}
	err = json.Unmarshal(data, &value)
	return value, err
}

func readLeases(dir string) ([]leaseRecord, error) {
	entries, err := os.ReadDir(filepath.Join(dir, "leases"))
	if err != nil {
		return nil, err
	}
	var leases []leaseRecord
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}
		path := filepath.Join(dir, "leases", entry.Name())
		lease, err := readJSON[leaseRecord](path)
		if err != nil {
			return nil, fmt.Errorf("read remote preview lease: %w", err)
		}
		if lease.Owner.alive() {
			leases = append(leases, lease)
		} else if err := removeFile(path); err != nil {
			return nil, err
		}
	}
	return leases, nil
}

func leasePath(dir string, record leaseRecord) string {
	sum := sha256.Sum256([]byte(fmt.Sprintf("%s\n%d\n%s", record.ManifestPath, record.Owner.PID, record.Owner.StartIdentity)))
	return filepath.Join(dir, "leases", hex.EncodeToString(sum[:])+".json")
}

func removeFile(path string) error {
	err := os.Remove(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}
