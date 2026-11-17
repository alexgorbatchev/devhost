package remote

import (
	"context"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/nettest"
)

// A TCP interruption exercises Chisel's real reconnect path while preserving
// the relay key, reverse-port assignment, and public hostname.
func TestConnectorReconnectsAndReloadsWhileDisconnected(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	defer backend.Close()
	options := optionsFor(t, backend.URL)
	proxy := startFaultProxy(t, strings.TrimPrefix(options.Settings.ServerURL, "http://"))
	options.Settings.ServerURL = "http://" + proxy.listener.Addr().String()
	startInlineWorker(t, options)
	lease := acquire(t, options)
	before := proxy.connections.Load()
	proxy.drop()
	updated := options
	updated.Hosts = []string{"reloaded--laptop.preview.example.com"}
	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()
	if err := lease.Update(ctx, updated); err != nil {
		t.Fatal("local reload waited for the disconnected transport:", err)
	}
	waitFor(t, func() bool { return proxy.connections.Load() > before })
	worker, err := readJSON[workerRecord](filepath.Join(directory(options.StateDirectory), "worker.json"))
	if err != nil {
		t.Fatal(err)
	}
	ready, cancelReady := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelReady()
	if err := awaitReady(ready, worker.AdminAddress); err != nil {
		t.Fatal(err)
	}
	if code, _ := previewRequest(t, updated, http.MethodGet, updated.Hosts[0], "/"); code != http.StatusNoContent {
		t.Fatal("preview did not reconnect:", code)
	}
	if code, _ := previewRequest(t, options, http.MethodGet, testHost, "/"); code != http.StatusNotFound {
		t.Fatal("old hostname survived reload:", code)
	}
}

func TestConnectorRejectsCredentialsFingerprintAndListenerACL(t *testing.T) {
	for _, kind := range []string{"credentials", "fingerprint", "listener"} {
		t.Run(kind, func(t *testing.T) {
			backend := httptest.NewServer(http.NotFoundHandler())
			defer backend.Close()
			options := optionsFor(t, backend.URL)
			switch kind {
			case "credentials":
				if err := os.WriteFile(options.Settings.CredentialFile, []byte("machine:wrong-password"), 0o600); err != nil {
					t.Fatal(err)
				}
			case "fingerprint":
				options.Settings.Fingerprint = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
			case "listener":
				options.Settings.RemotePort = nettest.ReservePort(t)
			}
			startInlineWorker(t, options)
			ctx, cancel := context.WithTimeout(context.Background(), 300*time.Millisecond)
			defer cancel()
			if lease, err := Acquire(ctx, options); err == nil {
				_ = lease.Close()
				t.Fatal("unauthorized connector became ready")
			}
			if err := withLock(context.Background(), directory(options.StateDirectory), func() error {
				leases, err := readLeases(directory(options.StateDirectory))
				if len(leases) != 0 {
					t.Errorf("failed startup retained %d leases", len(leases))
				}
				return err
			}); err != nil {
				t.Fatal(err)
			}
		})
	}
}

type faultProxy struct {
	listener    net.Listener
	mu          sync.Mutex
	active      map[net.Conn]bool
	connections atomic.Int64
	wg          sync.WaitGroup
}

func startFaultProxy(t *testing.T, upstream string) *faultProxy {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	p := &faultProxy{listener: listener, active: make(map[net.Conn]bool)}
	done := make(chan struct{})
	t.Cleanup(func() {
		_ = listener.Close()
		<-done
		p.drop()
		p.wg.Wait()
	})
	go func() {
		defer close(done)
		for {
			connection, err := listener.Accept()
			if err != nil {
				return
			}
			p.wg.Add(1)
			go func() {
				defer p.wg.Done()
				defer connection.Close()
				backend, err := net.DialTimeout("tcp", upstream, time.Second)
				if err != nil {
					return
				}
				defer backend.Close()
				p.mu.Lock()
				p.active[connection], p.active[backend] = true, true
				p.mu.Unlock()
				p.connections.Add(1)
				copied := make(chan struct{})
				go func() {
					_, _ = io.Copy(connection, backend)
					_ = connection.Close()
					close(copied)
				}()
				_, _ = io.Copy(backend, connection)
				_ = backend.Close()
				<-copied
				p.mu.Lock()
				delete(p.active, connection)
				delete(p.active, backend)
				p.mu.Unlock()
			}()
		}
	}()
	return p
}

func (p *faultProxy) drop() {
	p.mu.Lock()
	defer p.mu.Unlock()
	for connection := range p.active {
		_ = connection.Close()
	}
}
