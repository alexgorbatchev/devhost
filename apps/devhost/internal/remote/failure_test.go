package remote

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/nettest"
	"golang.org/x/sys/unix"
)

func minimalOptions(t *testing.T) Options {
	t.Helper()
	dir := t.TempDir()
	credentials := filepath.Join(dir, "credentials")
	if err := os.WriteFile(credentials, []byte("machine:password"), 0o600); err != nil {
		t.Fatal(err)
	}
	return Options{
		StateDirectory: dir, ManifestPath: filepath.Join(dir, "devhost.toml"),
		Hosts: []string{testHost}, Backend: Backend{Scheme: "http", Address: "127.0.0.1:8080"},
		Settings: Settings{ServerURL: "https://relay.example.com", CredentialFile: credentials, Fingerprint: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=", RemotePort: 18081},
	}
}

func TestInvalidOnboardingFailsBeforeStartingAnyWorker(t *testing.T) {
	for _, test := range []struct {
		name   string
		change func(*Options)
	}{
		{"state", func(o *Options) { o.StateDirectory = "" }},
		{"manifest", func(o *Options) { o.ManifestPath = "" }},
		{"relay", func(o *Options) { o.Settings.ServerURL = "" }},
		{"fingerprint", func(o *Options) { o.Settings.Fingerprint = "" }},
		{"port", func(o *Options) { o.Settings.RemotePort = 65536 }},
		{"hosts", func(o *Options) { o.Hosts = nil }},
		{"hostname", func(o *Options) { o.Hosts = []string{"https://app.example.com"} }},
		{"scheme", func(o *Options) { o.Backend.Scheme = "ftp" }},
		{"loopback", func(o *Options) { o.Backend.Address = "192.0.2.5:80" }},
		{"certificate", func(o *Options) { o.Backend.Scheme = "https" }},
		{"missing credentials", func(o *Options) { o.Settings.CredentialFile += ".absent" }},
	} {
		t.Run(test.name, func(t *testing.T) {
			options := minimalOptions(t)
			test.change(&options)
			if _, err := Acquire(context.Background(), options); err == nil {
				t.Fatal("invalid onboarding accepted")
			}
		})
	}
	for _, test := range []struct {
		name, content string
		mode          os.FileMode
	}{
		{"shared file", "machine:password", 0o644},
		{"missing password", "machine:", 0o600},
		{"missing user", ":password", 0o600},
		{"multiple lines", "machine:password\nother:secret", 0o600},
		{"oversized", strings.Repeat("s", 4097), 0o600},
	} {
		t.Run(test.name, func(t *testing.T) {
			options := minimalOptions(t)
			if err := os.WriteFile(options.Settings.CredentialFile, []byte(test.content), test.mode); err != nil {
				t.Fatal(err)
			}
			if err := os.Chmod(options.Settings.CredentialFile, test.mode); err != nil {
				t.Fatal(err)
			}
			if _, err := readCredentials(options.Settings.CredentialFile); err == nil {
				t.Fatal("invalid credential file accepted")
			} else if strings.Contains(err.Error(), "password") && !strings.Contains(err.Error(), "username:password") {
				t.Fatal("credential error leaked secret:", err)
			}
		})
	}
}

func TestRejectedLeaseUpdatesPreserveExistingPreview(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusNoContent) }))
	defer backend.Close()
	options := optionsFor(t, backend.URL)
	startInlineWorker(t, options)
	lease := acquire(t, options)
	for _, kind := range []string{"settings", "ownership", "invalid backend", "hostname conflict"} {
		t.Run(kind, func(t *testing.T) {
			changed := options
			switch kind {
			case "settings":
				changed.Settings.ServerURL = "https://new-relay.example.com"
			case "ownership":
				changed.ManifestPath += ".elsewhere"
			case "invalid backend":
				changed.Backend.Scheme = "file"
			case "hostname conflict":
				changed.ManifestPath += ".second"
				if other, err := Acquire(context.Background(), changed); err == nil {
					_ = other.Close()
					t.Fatal("second owner accepted the same hostname")
				}
				return
			}
			if err := lease.Update(context.Background(), changed); err == nil {
				t.Fatal("unsafe lease update accepted")
			}
		})
		if code, _ := previewRequest(t, options, http.MethodGet, testHost, "/"); code != http.StatusNoContent {
			t.Fatalf("rejected update removed the working preview: %d", code)
		}
	}
	if err := lease.Close(); err != nil {
		t.Fatal(err)
	}
	if err := lease.Update(context.Background(), options); err == nil {
		t.Fatal("closed lease was revived")
	}
}

func TestStateKeepsLiveOwnersAndPrunesReusedProcessIdentity(t *testing.T) {
	dir := directory(t.TempDir())
	identity, err := ownIdentity()
	if err != nil {
		t.Fatal(err)
	}
	stale := leaseRecord{Owner: owner{PID: identity.PID, StartIdentity: "different-process"}, ManifestPath: "stale"}
	if err := withLock(context.Background(), dir, func() error {
		if err := writeJSON(leasePath(dir, stale), stale); err != nil {
			return err
		}
		if err := os.WriteFile(filepath.Join(dir, "leases", "incomplete.tmp"), []byte("half-written"), 0o600); err != nil {
			return err
		}
		leases, err := readLeases(dir)
		if len(leases) != 0 {
			t.Errorf("stale lease retained: %v", leases)
		}
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(leasePath(dir, stale)); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("stale file retained: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "leases", "broken.json"), []byte("{"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := readLeases(dir); err == nil {
		t.Fatal("corrupt lease silently accepted")
	}
	if _, err := readLeases(filepath.Join(dir, "missing")); err == nil {
		t.Fatal("missing lease directory accepted")
	}
	if owner := (owner{PID: 1 << 30, StartIdentity: "missing"}); owner.alive() {
		t.Fatal("missing process marked alive")
	}
}

func TestStateLockCancellationAndFilesystemFailures(t *testing.T) {
	dir := directory(t.TempDir())
	if err := withLock(context.Background(), dir, func() error { return nil }); err != nil {
		t.Fatal(err)
	}
	file, err := os.OpenFile(filepath.Join(dir, "state.lock"), os.O_RDWR, 0o600)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	if err := unix.Flock(int(file.Fd()), unix.LOCK_EX); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	if err := withLock(ctx, dir, func() error { t.Error("entered a held lock"); return nil }); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("lock wait ignored cancellation: %v", err)
	}
	blocked := filepath.Join(t.TempDir(), "file")
	if err := os.WriteFile(blocked, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := withLock(context.Background(), blocked, func() error { return nil }); err == nil {
		t.Fatal("file accepted as state directory")
	}
	if err := writeJSON(filepath.Join(blocked, "settings.json"), Settings{}); err == nil {
		t.Fatal("write into nondirectory succeeded")
	}
	if err := writeJSON(t.TempDir(), Settings{}); err == nil {
		t.Fatal("record replaced a directory")
	}
}

func TestPreviewBackendFailuresStayBounded(t *testing.T) {
	options := minimalOptions(t)
	identity, err := ownIdentity()
	if err != nil {
		t.Fatal(err)
	}
	dir := directory(options.StateDirectory)
	for _, kind := range []string{"unreachable", "missing certificate", "invalid certificate", "corrupt lease"} {
		t.Run(kind, func(t *testing.T) {
			backend := options.Backend
			backend.Address = "127.0.0.1:" + strconv.Itoa(nettest.ReservePort(t))
			if strings.Contains(kind, "certificate") {
				backend.Scheme = "https"
				backend.RootCertificatePath = filepath.Join(options.StateDirectory, kind)
			}
			if kind == "invalid certificate" {
				if err := os.WriteFile(backend.RootCertificatePath, []byte("invalid"), 0o600); err != nil {
					t.Fatal(err)
				}
			}
			record := leaseRecord{Owner: identity, ManifestPath: options.ManifestPath, Hosts: options.Hosts, Backend: backend}
			if err := withLock(context.Background(), dir, func() error { return writeJSON(leasePath(dir, record), record) }); err != nil {
				t.Fatal(err)
			}
			if kind == "corrupt lease" {
				if err := os.WriteFile(leasePath(dir, record), []byte("{"), 0o600); err != nil {
					t.Fatal(err)
				}
			}
			request := httptest.NewRequest(http.MethodGet, "https://"+testHost+"/", nil)
			response := httptest.NewRecorder()
			servePreview(dir, response, request)
			want := http.StatusBadGateway
			if kind == "corrupt lease" {
				want = http.StatusServiceUnavailable
			}
			if response.Code != want {
				t.Fatalf("backend failure returned %d, want %d", response.Code, want)
			}
		})
	}
}

func TestReadinessReportsProtocolAndConnectionErrors(t *testing.T) {
	for _, kind := range []string{"unavailable", "truncated response"} {
		t.Run(kind, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if kind == "truncated response" {
					w.Header().Set("Content-Length", "30")
				}
				w.WriteHeader(http.StatusServiceUnavailable)
				_, _ = io.WriteString(w, "not ready")
			}))
			defer server.Close()
			if err := awaitReady(context.Background(), strings.TrimPrefix(server.URL, "http://")); err == nil {
				t.Fatal("failed readiness accepted")
			}
		})
	}
	if err := awaitReady(context.Background(), "%"); err == nil {
		t.Fatal("malformed readiness address accepted")
	}
	address := "127.0.0.1:" + strconv.Itoa(nettest.ReservePort(t))
	if err := awaitReady(context.Background(), address); err == nil {
		t.Fatal("absent readiness server accepted")
	}
}

func TestWorkerRejectsMissingStateAndInvalidOnboarding(t *testing.T) {
	if err := RunWorker(context.Background(), filepath.Join(t.TempDir(), "missing")); err == nil {
		t.Fatal("worker accepted missing state")
	}
	for _, kind := range []string{"settings missing", "credentials missing", "invalid server"} {
		t.Run(kind, func(t *testing.T) {
			options := minimalOptions(t)
			dir := directory(options.StateDirectory)
			if err := withLock(context.Background(), dir, func() error { return nil }); err != nil {
				t.Fatal(err)
			}
			if kind != "settings missing" {
				if kind == "credentials missing" {
					options.Settings.CredentialFile += ".absent"
				} else {
					options.Settings.ServerURL = "http://%"
				}
				if err := writeJSON(filepath.Join(dir, "settings.json"), options.Settings); err != nil {
					t.Fatal(err)
				}
			}
			if err := RunWorker(context.Background(), options.StateDirectory); err == nil {
				t.Fatal("worker accepted invalid startup state")
			}
		})
	}
}

func TestWorkerLaunchFailureReleasesUnpublishedRoutes(t *testing.T) {
	for _, kind := range []string{"command unavailable", "executable missing", "log unavailable"} {
		t.Run(kind, func(t *testing.T) {
			options := minimalOptions(t)
			previous := workerCommand
			t.Cleanup(func() { workerCommand = previous })
			workerCommand = func(string) (*exec.Cmd, error) {
				if kind == "command unavailable" {
					return nil, errors.New("worker command unavailable")
				}
				return exec.Command(filepath.Join(options.StateDirectory, "missing-executable")), nil
			}
			dir := directory(options.StateDirectory)
			if kind == "log unavailable" {
				if err := os.MkdirAll(filepath.Join(dir, "connector.log"), 0o700); err != nil {
					t.Fatal(err)
				}
			}
			if _, err := Acquire(context.Background(), options); err == nil {
				t.Fatal("failed worker launch was advertised as ready")
			}
			leases, err := readLeases(dir)
			if err != nil || len(leases) != 0 {
				t.Fatalf("failed startup retained routes: %v, %v", leases, err)
			}
		})
	}
}

func TestWorkerOwnsSingleTransportAndPrivateReadiness(t *testing.T) {
	options := optionsFor(t, "http://127.0.0.1:8080")
	startInlineWorker(t, options)
	acquire(t, options)
	if err := RunWorker(context.Background(), options.StateDirectory); err == nil {
		t.Fatal("second worker accepted the same machine")
	}
	worker, err := readJSON[workerRecord](filepath.Join(directory(options.StateDirectory), "worker.json"))
	if err != nil {
		t.Fatal(err)
	}
	for _, kind := range []string{"wrong host", "wrong method", "wrong path"} {
		t.Run(kind, func(t *testing.T) {
			method, path := http.MethodGet, "/ready"
			if kind == "wrong method" {
				method = http.MethodPost
			}
			if kind == "wrong path" {
				path = "/"
			}
			request, err := http.NewRequest(method, "http://"+worker.AdminAddress+path, nil)
			if err != nil {
				t.Fatal(err)
			}
			if kind == "wrong host" {
				request.Host = testHost
			}
			response, err := http.DefaultClient.Do(request)
			if err != nil {
				t.Fatal(err)
			}
			defer response.Body.Close()
			if response.StatusCode != http.StatusNotFound {
				t.Fatalf("private readiness accepted %s: %d", kind, response.StatusCode)
			}
		})
	}
}
