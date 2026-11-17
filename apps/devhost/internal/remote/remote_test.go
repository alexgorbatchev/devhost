package remote

import (
	"context"
	"crypto/x509"
	"encoding/pem"
	"errors"
	"fmt"
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

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/nettest"
	"github.com/gorilla/websocket"
	chserver "github.com/jpillora/chisel/server"
)

const testHost = "app--laptop.preview.example.com"

func TestRemoteWorkerProcess(t *testing.T) {
	if os.Getenv("DEVHOST_TEST_REMOTE_WORKER") != "1" {
		return
	}
	if err := RunWorker(context.Background(), os.Getenv("DEVHOST_TEST_REMOTE_STATE")); err != nil {
		t.Fatal(err)
	}
}

func useWorkerProcess(t *testing.T) {
	t.Helper()
	previous := workerCommand
	workerCommand = func(stateDirectory string) (*exec.Cmd, error) {
		command := exec.Command(os.Args[0], "-test.run=^TestRemoteWorkerProcess$")
		command.Env = append(os.Environ(), "DEVHOST_TEST_REMOTE_WORKER=1", "DEVHOST_TEST_REMOTE_STATE="+stateDirectory)
		return command, nil
	}
	t.Cleanup(func() { workerCommand = previous })
}

func relay(t *testing.T, remotePort int) (*chserver.Server, string) {
	t.Helper()
	server, err := chserver.NewServer(&chserver.Config{Reverse: true, KeepAlive: time.Second})
	if err != nil {
		t.Fatal(err)
	}
	server.Info = false
	if err := server.AddUser("machine", "private-test-credential", fmt.Sprintf("^R:0\\.0\\.0\\.0:%d$", remotePort)); err != nil {
		t.Fatal(err)
	}
	port := nettest.ReservePort(t)
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(func() {
		cancel()
		if err := server.Close(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			t.Errorf("close relay: %v", err)
		}
		if err := server.Wait(); err != nil && !errors.Is(err, http.ErrServerClosed) && !errors.Is(err, context.Canceled) {
			t.Errorf("wait relay: %v", err)
		}
	})
	if err := server.StartContext(ctx, "127.0.0.1", strconv.Itoa(port)); err != nil {
		t.Fatal(err)
	}
	return server, "http://127.0.0.1:" + strconv.Itoa(port)
}

func optionsFor(t *testing.T, backendURL string) Options {
	t.Helper()
	remotePort := nettest.ReservePort(t)
	server, endpoint := relay(t, remotePort)
	dir := t.TempDir()
	credentials := filepath.Join(dir, "credentials")
	if err := os.WriteFile(credentials, []byte("machine:private-test-credential\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	return Options{
		StateDirectory: dir, ManifestPath: filepath.Join(dir, "devhost.toml"), Hosts: []string{testHost},
		Settings: Settings{ServerURL: endpoint, CredentialFile: credentials, Fingerprint: server.GetFingerprint(), RemotePort: remotePort,
			DomainSuffix: "--laptop.preview.example.com", LocalSuffix: ".localhost"},
		Backend: Backend{Scheme: "http", Address: strings.TrimPrefix(backendURL, "http://")},
	}
}

func startInlineWorker(t *testing.T, options Options) {
	t.Helper()
	identity, err := ownIdentity()
	if err != nil {
		t.Fatal(err)
	}
	dir := directory(options.StateDirectory)
	record := leaseRecord{Owner: identity, ManifestPath: caddy.ManifestIdentity(options.ManifestPath), Hosts: options.Hosts, Backend: options.Backend}
	if err := withLock(context.Background(), dir, func() error {
		if err := writeJSON(filepath.Join(dir, "settings.json"), options.Settings); err != nil {
			return err
		}
		return writeJSON(leasePath(dir, record), record)
	}); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	t.Cleanup(func() {
		cancel()
		select {
		case err := <-done:
			if err != nil && !errors.Is(err, context.Canceled) {
				t.Errorf("worker cleanup: %v", err)
			}
		case <-time.After(10 * time.Second):
			t.Error("worker did not stop")
		}
	})
	go func() { done <- RunWorker(ctx, options.StateDirectory) }()
	waitFor(t, func() bool {
		worker, err := readJSON[workerRecord](filepath.Join(dir, "worker.json"))
		return err == nil && worker.AdminAddress != ""
	})
}

func waitFor(t *testing.T, condition func() bool) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	for !condition() {
		if err := pause(ctx); err != nil {
			t.Fatal("condition did not become true:", err)
		}
	}
}

func acquire(t *testing.T, options Options) *Lease {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	lease, err := Acquire(ctx, options)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := lease.Close(); err != nil {
			t.Error(err)
		}
	})
	return lease
}

func previewRequest(t *testing.T, options Options, method, host, path string) (int, string) {
	t.Helper()
	request, err := http.NewRequest(method, fmt.Sprintf("http://127.0.0.1:%d%s", options.Settings.RemotePort, path), nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Host = host
	request.Header.Set("Origin", "https://"+host)
	request.Header.Set("X-Forwarded-For", "203.0.113.8")
	client := &http.Client{Timeout: 5 * time.Second}
	response, err := client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	return response.StatusCode, string(body)
}

func TestSharedConnectorRoutesAndRevokesIndividualStacks(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, r.Host+"|"+r.Header.Get("Origin")+"|"+r.Header.Get("X-Forwarded-Proto")+"|"+r.Header.Get("X-Forwarded-For"))
	}))
	defer backend.Close()
	options := optionsFor(t, backend.URL)
	startInlineWorker(t, options)
	first := acquire(t, options)
	workerBefore, err := readJSON[workerRecord](filepath.Join(directory(options.StateDirectory), "worker.json"))
	if err != nil {
		t.Fatal(err)
	}
	secondOptions := options
	secondOptions.ManifestPath += ".other"
	secondOptions.Hosts = []string{"other--laptop.preview.example.com"}
	second := acquire(t, secondOptions)
	workerAfter, err := readJSON[workerRecord](filepath.Join(directory(options.StateDirectory), "worker.json"))
	if err != nil || workerBefore != workerAfter {
		t.Fatalf("second stack changed shared worker: %v %v", workerAfter, err)
	}
	code, body := previewRequest(t, options, http.MethodGet, testHost, "/hello")
	if code != http.StatusOK || body != testHost+"|https://"+testHost+"|https|203.0.113.8" {
		t.Fatalf("public headers lost: %d %s", code, body)
	}
	for _, host := range []string{"unknown.example.com", testHost + ":80"} {
		if code, _ := previewRequest(t, options, http.MethodGet, host, "/"); code != http.StatusNotFound {
			t.Errorf("unowned host %q returned %d", host, code)
		}
	}
	for _, path := range []string{"/__devhost__/config/save", "/__devhost__/config/../config/save", "/__devhost__/%63onfig/save"} {
		if code, _ := previewRequest(t, options, http.MethodPost, testHost, path); code != http.StatusForbidden {
			t.Errorf("remote config write %s returned %d", path, code)
		}
	}
	if code, _ := previewRequest(t, options, http.MethodGet, testHost+":443", "/"); code != http.StatusOK {
		t.Errorf("explicit HTTPS host returned %d", code)
	}
	if err := first.Close(); err != nil {
		t.Fatal(err)
	}
	if code, _ := previewRequest(t, options, http.MethodGet, testHost, "/"); code != http.StatusNotFound {
		t.Errorf("closed lease still exposed: %d", code)
	}
	if code, _ := previewRequest(t, secondOptions, http.MethodGet, secondOptions.Hosts[0], "/"); code != http.StatusOK {
		t.Errorf("closing one stack broke another: %d", code)
	}
	if err := second.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(directory(options.StateDirectory), "worker.json")); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("final worker remains: %v", err)
	}
}

func TestDetachedWorkerStartsAndStops(t *testing.T) {
	useWorkerProcess(t)
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusNoContent) }))
	defer backend.Close()
	options := optionsFor(t, backend.URL)
	lease := acquire(t, options)
	if code, _ := previewRequest(t, options, http.MethodGet, testHost, "/"); code != http.StatusNoContent {
		t.Fatal(code)
	}
	worker, err := readJSON[workerRecord](filepath.Join(directory(options.StateDirectory), "worker.json"))
	if err != nil || worker.Owner.PID == os.Getpid() {
		t.Fatalf("worker is not a separate process: %v %v", worker, err)
	}
	if err := lease.Close(); err != nil {
		t.Fatal(err)
	}
	waitFor(t, func() bool { return !worker.Owner.alive() })
}

func TestPreviewWebSocketAndVerifiedLocalTLS(t *testing.T) {
	upgrader := websocket.Upgrader{}
	backend := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		connection, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer connection.Close()
		kind, data, err := connection.ReadMessage()
		if err == nil {
			_ = connection.WriteMessage(kind, data)
		}
	}))
	defer backend.Close()
	options := optionsFor(t, "http://"+strings.TrimPrefix(backend.URL, "https://"))
	certificate, err := x509.ParseCertificate(backend.TLS.Certificates[0].Certificate[0])
	if err != nil {
		t.Fatal(err)
	}
	options.Hosts = []string{certificate.DNSNames[0]}
	options.Backend.Scheme = "https"
	options.Backend.RootCertificatePath = filepath.Join(options.StateDirectory, "root.pem")
	if err := os.WriteFile(options.Backend.RootCertificatePath, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: certificate.Raw}), 0o600); err != nil {
		t.Fatal(err)
	}
	startInlineWorker(t, options)
	acquire(t, options)
	url := fmt.Sprintf("ws://127.0.0.1:%d/socket", options.Settings.RemotePort)
	header := http.Header{"Host": []string{options.Hosts[0]}, "Origin": []string{"https://" + options.Hosts[0]}}
	connection, response, err := websocket.DefaultDialer.Dial(url, header)
	if response != nil {
		defer response.Body.Close()
	}
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close()
	if err := connection.WriteMessage(websocket.TextMessage, []byte("remote preview")); err != nil {
		t.Fatal(err)
	}
	_, data, err := connection.ReadMessage()
	if err != nil || string(data) != "remote preview" {
		t.Fatalf("websocket echo = %q, %v", data, err)
	}
}
