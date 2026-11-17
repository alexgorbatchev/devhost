package remote

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"syscall"
	"time"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/procid"
)

const (
	startupTimeout  = 45 * time.Second
	shutdownTimeout = 5 * time.Second
)

type Lease struct {
	mu     sync.Mutex
	dir    string
	record leaseRecord
	closed bool
}

// Acquire registers this stack before starting the shared connector. It returns
// only after Chisel has authenticated and registered the assigned reverse port.
func Acquire(ctx context.Context, options Options) (*Lease, error) {
	if err := validateOptions(options); err != nil {
		return nil, err
	}
	identity, err := ownIdentity()
	if err != nil {
		return nil, err
	}
	l := &Lease{dir: directory(options.StateDirectory), record: leaseRecord{
		Owner: identity, ManifestPath: caddy.ManifestIdentity(options.ManifestPath),
	}}
	if err := l.Update(ctx, options); err != nil {
		return nil, errors.Join(err, l.Close())
	}
	return l, nil
}

// Update changes the allowed routes atomically. A failed update retains the
// previous lease, so a manifest reload can restore its previous routes.
func (l *Lease) Update(ctx context.Context, options Options) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.closed {
		return fmt.Errorf("remote preview lease is closed")
	}
	if err := validateOptions(options); err != nil {
		return err
	}
	if directory(options.StateDirectory) != l.dir || caddy.ManifestIdentity(options.ManifestPath) != l.record.ManifestPath {
		return fmt.Errorf("remote preview lease ownership cannot change")
	}
	ctx, cancel := context.WithTimeout(ctx, startupTimeout)
	defer cancel()
	previous := l.record
	next := previous
	next.Hosts = append([]string{}, options.Hosts...)
	next.Backend = options.Backend
	err := withLock(ctx, l.dir, func() error {
		leases, err := readLeases(l.dir)
		if err != nil {
			return err
		}
		settingsPath := filepath.Join(l.dir, "settings.json")
		worker, workerErr := readJSON[workerRecord](filepath.Join(l.dir, "worker.json"))
		if workerErr != nil && !errors.Is(workerErr, os.ErrNotExist) {
			return workerErr
		}
		if len(leases) > 0 || worker.Owner.alive() {
			current, err := readJSON[Settings](settingsPath)
			if err != nil {
				return err
			}
			if current != options.Settings {
				return fmt.Errorf("remote connector settings changed; stop all remote stacks before changing the machine's remote settings")
			}
		} else if err := writeJSON(settingsPath, options.Settings); err != nil {
			return err
		}
		for _, lease := range leases {
			if lease.ManifestPath == next.ManifestPath && lease.Owner == next.Owner {
				continue
			}
			for _, host := range next.Hosts {
				for _, existing := range lease.Hosts {
					if host == existing {
						return fmt.Errorf("remote preview hostname %s already belongs to another stack", host)
					}
				}
			}
		}
		return writeJSON(leasePath(l.dir, next), next)
	})
	if err == nil {
		err = ensureWorker(ctx, options.StateDirectory, len(previous.Hosts) == 0)
	}
	if err != nil {
		restore := withLock(context.Background(), l.dir, func() error {
			if len(previous.Hosts) == 0 {
				return removeFile(leasePath(l.dir, next))
			}
			return writeJSON(leasePath(l.dir, previous), previous)
		})
		return errors.Join(err, restore)
	}
	l.record = next
	return nil
}

// Close removes this stack's routes immediately, then lets the last lease's
// worker finish its transport cleanup. It leaves a concurrent new owner alone.
func (l *Lease) Close() error {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.closed {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()
	err := withLock(ctx, l.dir, func() error { return removeFile(leasePath(l.dir, l.record)) })
	if err != nil {
		return err
	}
	l.closed = true
	for {
		done := false
		err := withLock(ctx, l.dir, func() error {
			leases, err := readLeases(l.dir)
			if err != nil {
				return err
			}
			worker, err := readJSON[workerRecord](filepath.Join(l.dir, "worker.json"))
			if errors.Is(err, os.ErrNotExist) {
				done = true
				return nil
			}
			if err != nil {
				return err
			}
			done = len(leases) > 0 || !worker.Owner.alive()
			return nil
		})
		if err != nil || done {
			return err
		}
		if err := pause(ctx); err != nil {
			return fmt.Errorf("wait for remote connector cleanup: %w", err)
		}
	}
}

func ensureWorker(ctx context.Context, stateDirectory string, requireConnection bool) error {
	dir := directory(stateDirectory)
	for {
		var worker workerRecord
		err := withLock(ctx, dir, func() error {
			var err error
			worker, err = readJSON[workerRecord](filepath.Join(dir, "worker.json"))
			if err != nil && !errors.Is(err, os.ErrNotExist) {
				return err
			}
			if worker.Owner.alive() {
				return nil
			}
			worker, err = spawnWorker(stateDirectory)
			return err
		})
		if err != nil {
			return fmt.Errorf("start remote connector: %w", err)
		}
		if worker.AdminAddress != "" && !worker.Stopping {
			// A running stack can reload while its laptop is offline. The worker
			// reconnects independently; only first publication waits for the relay.
			if !requireConnection {
				return nil
			}
			return awaitReady(ctx, worker.AdminAddress)
		}
		if err := pause(ctx); err != nil {
			return fmt.Errorf("wait for remote connector startup (log: %s): %w", filepath.Join(dir, "connector.log"), err)
		}
	}
}

var workerCommand = func(stateDirectory string) (*exec.Cmd, error) {
	executable, err := os.Executable()
	if err != nil {
		return nil, err
	}
	return exec.Command(executable, "_remote-worker", "--state-dir", stateDirectory), nil
}

func spawnWorker(stateDirectory string) (workerRecord, error) {
	dir := directory(stateDirectory)
	log, err := os.OpenFile(filepath.Join(dir, "connector.log"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return workerRecord{}, err
	}
	defer log.Close() // Child owns duplicated handles after Start.
	input, err := os.Open(os.DevNull)
	if err != nil {
		return workerRecord{}, err
	}
	defer input.Close() // Child owns duplicated handle after Start.
	command, err := workerCommand(stateDirectory)
	if err != nil {
		return workerRecord{}, err
	}
	command.Stdin, command.Stdout, command.Stderr = input, log, log
	command.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	if err := command.Start(); err != nil {
		return workerRecord{}, err
	}
	go func() {
		_ = command.Wait() // The readiness request and retained log report startup failure.
	}()
	identity, err := procid.StartIdentity(command.Process.Pid)
	if err != nil {
		return workerRecord{}, fmt.Errorf("identify remote connector: %w", err)
	}
	worker := workerRecord{Owner: owner{PID: command.Process.Pid, StartIdentity: identity}}
	if err := writeJSON(filepath.Join(dir, "worker.json"), worker); err != nil {
		return workerRecord{}, err
	}
	return worker, nil
}

func awaitReady(ctx context.Context, address string) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://"+address+"/ready", nil)
	if err != nil {
		return err
	}
	transport := &http.Transport{Proxy: nil}
	defer transport.CloseIdleConnections()
	response, err := (&http.Client{Transport: transport}).Do(request)
	if err != nil {
		return fmt.Errorf("wait for authenticated remote connector: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		data, err := io.ReadAll(io.LimitReader(response.Body, 1024))
		if err != nil {
			return fmt.Errorf("read remote connector readiness: %w", err)
		}
		return fmt.Errorf("remote connector is unavailable: %s", data)
	}
	return nil
}
