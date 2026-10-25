package services

import (
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy/caddytest"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/devtools"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/nettest"
)

func TestServeSessionAttemptsCaddyStartAndCleansUpFailure(t *testing.T) {
	dir := t.TempDir()
	paths := caddy.CreateManagedCaddyPaths(t.TempDir())
	admin := caddytest.StartAdminServer(t)
	// The shared Caddy last ran on an admin address that no longer answers.
	runTestCaddy(t, paths, testCaddySettings(caddytest.UnusedAdminAddress(t)))
	if err := caddy.ActivateRoute(caddy.ActivateRouteOptions{Host: "other.localhost", Path: "/", ServiceName: "other", AppBindHost: "127.0.0.1", AppPort: nettest.ReservePort(t)}, "/other/devhost.toml", paths.RoutesDirectoryPath); err != nil {
		t.Fatal(err)
	}
	script := "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$0.args\"\nexit 1\n"
	if err := os.WriteFile(paths.ExecutablePath, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	_, err := StartServe(dir, "files.localhost", 0, StartStackOptions{CaddyPaths: paths, ConfigPath: writeTestSharedConfig(t, testCaddySettings(admin)), LogWriter: io.Discard})
	if err == nil {
		t.Fatal("expected failed proxy startup")
	}
	args, readErr := os.ReadFile(paths.ExecutablePath + ".args")
	if readErr != nil || !strings.HasPrefix(string(args), "start\n--pidfile\n") {
		t.Fatalf("proxy start was not attempted: %q %v; session error: %v", args, readErr, err)
	}
	assertDirectoryEntries(t, paths.StacksDirectoryPath, nil)
	assertDirectoryEntries(t, dir, nil)
	state, readErr := os.ReadDir(paths.StateDirectoryPath)
	if readErr != nil || len(state) != 1 || state[0].Name() != "caddy" {
		t.Errorf("session state left behind: %v %v", state, readErr)
	}
}

func TestServeSessionServesWithDevtoolsAndCleansUp(t *testing.T) {
	for _, mode := range []string{"directory", "port"} {
		t.Run(mode, func(t *testing.T) { testServeSession(t, mode == "port") })
	}
}

func testServeSession(t *testing.T, external bool) {
	t.Helper()
	var log strings.Builder
	dir := t.TempDir()
	port := 0
	var upstream *httptest.Server
	if external {
		port = nettest.ReservePort(t)
		listener, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
		if err != nil {
			t.Fatal(err)
		}
		upstream = httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "text/html")
			fmt.Fprint(w, "<html><body><h1>Files session</h1></body></html>")
		}))
		upstream.Listener.Close()
		upstream.Listener = listener
		upstream.Start()
		t.Cleanup(upstream.Close)
	}
	if err := os.WriteFile(filepath.Join(dir, "index.md"), []byte("# Directory session"), 0o644); err != nil {
		t.Fatal(err)
	}
	paths := caddy.CreateManagedCaddyPaths(t.TempDir())
	shared := testCaddySettings(caddytest.StartAdminServer(t))
	shared.HTTPSPort = 8443
	runTestCaddy(t, paths, shared)
	if err := caddy.ActivateRoute(caddy.ActivateRouteOptions{Host: "other.localhost", Path: "/", ServiceName: "other", AppBindHost: "127.0.0.1", AppPort: nettest.ReservePort(t)}, "/other/devhost.toml", paths.RoutesDirectoryPath); err != nil {
		t.Fatal(err)
	}
	configPath := writeTestSharedConfig(t, shared)
	originalRegister, originalUnregister, originalDocument := registerProcessSignals, unregisterProcessSignals, startDocumentInjectionServer
	defer func() {
		registerProcessSignals, unregisterProcessSignals, startDocumentInjectionServer = originalRegister, originalUnregister, originalDocument
	}()
	signals := make(chan chan<- os.Signal, 1)
	documents := make(chan *devtools.DocumentInjectionServer, 1)
	registerProcessSignals = func(ch chan<- os.Signal) { signals <- ch }
	unregisterProcessSignals = func(chan<- os.Signal) {}
	startDocumentInjectionServer = func(opts devtools.StartDocumentInjectionServerOptions) (*devtools.DocumentInjectionServer, error) {
		s, err := devtools.StartDocumentInjectionServer(opts)
		if err == nil {
			documents <- s
		}
		return s, err
	}
	type result struct {
		code int
		err  error
	}
	done := make(chan result, 1)
	go func() {
		code, err := StartServe(dir, "files.localhost", port, StartStackOptions{CaddyPaths: paths, ConfigPath: configPath, LogWriter: &log})
		done <- result{code, err}
	}()
	var signalChannel chan<- os.Signal
	select {
	case signalChannel = <-signals:
	case got := <-done:
		t.Fatalf("exited before signals: %#v", got)
	case <-time.After(10 * time.Second):
		t.Fatal("startup timed out")
	}
	t.Cleanup(func() {
		signalChannel <- syscall.SIGINT
		select {
		case got := <-done:
			if got.code != 130 || got.err != nil {
				t.Errorf("shutdown = %#v", got)
			}
			if !strings.Contains(log.String(), "https://files.localhost:8443") {
				t.Errorf("startup did not print the shared proxy URL: %s", log.String())
			}
		case <-time.After(10 * time.Second):
			t.Error("shutdown timed out")
		}
		assertDirectoryEntries(t, paths.StacksDirectoryPath, nil)
		assertDirectoryEntries(t, paths.HostClaimsDirectoryPath, nil)
		if external {
			resp, err := http.Get(upstream.URL)
			if err != nil {
				t.Errorf("external service stopped: %v", err)
			} else {
				resp.Body.Close()
			}
		}
		entriesRemaining, readErr := os.ReadDir(paths.RegistrationsDirectoryPath)
		if readErr != nil || len(entriesRemaining) != 1 {
			t.Errorf("other session's route changed: %v %v", entriesRemaining, readErr)
		}
		entries, err := os.ReadDir(dir)
		if err != nil || len(entries) != 1 {
			t.Errorf("served directory changed: %v %v", entries, err)
		}
		resp, err := http.Get("http://" + shared.AdminAddress + "/config/")
		if err != nil {
			t.Errorf("shared proxy stopped: %v", err)
		} else {
			resp.Body.Close()
		}
	})
	var document *devtools.DocumentInjectionServer
	select {
	case document = <-documents:
	case got := <-done:
		t.Fatalf("startup: %#v", got)
	case <-time.After(10 * time.Second):
		t.Fatal("no document server")
	}
	wantContent := "# Directory session"
	if external {
		wantContent = "<h1>Files session</h1>"
	}
	waitForCondition(t, 10*time.Second, func() bool {
		req, err := http.NewRequest(http.MethodGet, fmt.Sprintf("http://127.0.0.1:%d/", document.Port()), nil)
		if err != nil {
			return false
		}
		req.Host = "files.localhost"
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			return false
		}
		defer resp.Body.Close()
		body, err := io.ReadAll(resp.Body)
		return err == nil && strings.Contains(string(body), wantContent) && strings.Contains(string(body), "/__devhost__/")
	})
}
