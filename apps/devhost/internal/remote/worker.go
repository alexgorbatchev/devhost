package remote

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"time"

	chclient "github.com/jpillora/chisel/client"
	"golang.org/x/sys/unix"
)

const keepAlive = 25 * time.Second

// RunWorker serves the hidden connector command. A separate process keeps the
// machine's transport alive when an individual stack exits.
func RunWorker(ctx context.Context, stateDirectory string) (err error) {
	dir := directory(stateDirectory)
	lock, err := os.OpenFile(filepath.Join(dir, "worker.lock"), os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return err
	}
	defer func() { err = errors.Join(err, lock.Close()) }()
	if err := unix.Flock(int(lock.Fd()), unix.LOCK_EX|unix.LOCK_NB); err != nil {
		return fmt.Errorf("another remote connector owns this machine: %w", err)
	}
	identity, err := ownIdentity()
	if err != nil {
		return err
	}
	defer func() {
		cleanup := withLock(context.Background(), dir, func() error {
			record, readErr := readJSON[workerRecord](filepath.Join(dir, "worker.json"))
			if errors.Is(readErr, os.ErrNotExist) {
				return nil
			}
			if readErr != nil {
				return readErr
			}
			if record.Owner != identity {
				return nil
			}
			return removeFile(filepath.Join(dir, "worker.json"))
		})
		err = errors.Join(err, cleanup)
	}()
	settings, err := readJSON[Settings](filepath.Join(dir, "settings.json"))
	if err != nil {
		return err
	}
	auth, err := readCredentials(settings.CredentialFile)
	if err != nil {
		return err
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return err
	}
	defer listener.Close() // Server shutdown normally closes this first.
	_, localPort, err := net.SplitHostPort(listener.Addr().String())
	if err != nil {
		return err
	}
	client, err := chclient.NewClient(&chclient.Config{
		Server: settings.ServerURL, Auth: auth, Fingerprint: settings.Fingerprint,
		Remotes:   []string{"R:0.0.0.0:" + strconv.Itoa(settings.RemotePort) + ":127.0.0.1:" + localPort},
		KeepAlive: keepAlive, MaxRetryCount: -1, MaxRetryInterval: 10 * time.Second,
	})
	if err != nil {
		return fmt.Errorf("configure remote connector: %w", err)
	}
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	if err := client.Start(ctx); err != nil {
		return err
	}
	defer func() {
		err = errors.Join(err, client.Close())
		if waitErr := client.Wait(); waitErr != nil && !errors.Is(waitErr, context.Canceled) {
			err = errors.Join(err, waitErr)
		}
	}()
	admin, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return err
	}
	defer admin.Close() // Server shutdown normally closes this first.
	var handlers sync.WaitGroup
	proxyServer := &http.Server{ReadHeaderTimeout: 10 * time.Second, Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		handlers.Add(1)
		defer handlers.Done()
		servePreview(dir, w, r)
	})}
	adminServer := &http.Server{ReadHeaderTimeout: 5 * time.Second, Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/ready" || r.Host != admin.Addr().String() {
			http.NotFound(w, r)
			return
		}
		readyContext, cancelReady := context.WithTimeout(r.Context(), startupTimeout)
		defer cancelReady()
		for !client.Ready(readyContext) {
			// A disconnected Chisel wait group can wake before its replacement
			// SSH session is active. Keep the same bounded readiness request.
			if err := pause(readyContext); err != nil {
				http.Error(w, "relay authentication or connection did not become ready; inspect connector.log", http.StatusServiceUnavailable)
				return
			}
		}
		w.WriteHeader(http.StatusOK)
	})}
	serveErrors := make(chan error, 2)
	go func() { serveErrors <- proxyServer.Serve(listener) }()
	go func() { serveErrors <- adminServer.Serve(admin) }()
	defer func() {
		cancel()
		// Closing Chisel first also closes the hijacked preview WebSockets.
		err = errors.Join(err, client.Close(), proxyServer.Close(), adminServer.Close())
		for range 2 {
			serveErr := <-serveErrors
			if serveErr != nil && !errors.Is(serveErr, http.ErrServerClosed) {
				err = errors.Join(err, serveErr)
			}
		}
		handlers.Wait()
	}()
	worker := workerRecord{Owner: identity, AdminAddress: admin.Addr().String()}
	if err := withLock(ctx, dir, func() error { return writeJSON(filepath.Join(dir, "worker.json"), worker) }); err != nil {
		return err
	}
	ticker := time.NewTicker(250 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
			stop := false
			if err := withLock(ctx, dir, func() error {
				leases, err := readLeases(dir)
				if err != nil {
					return err
				}
				stop = len(leases) == 0
				if stop {
					worker.Stopping = true
					return writeJSON(filepath.Join(dir, "worker.json"), worker)
				}
				return nil
			}); err != nil {
				return err
			}
			if stop {
				return nil
			}
		}
	}
}
