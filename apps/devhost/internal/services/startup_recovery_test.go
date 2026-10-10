package services

import (
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy/caddytest"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/devtools"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/nettest"
)

func startRecoveryStack(t *testing.T, timeout int, missingExecutable bool) (string, string, func(), *shutdownOutput) {
	t.Helper()
	paths := caddy.CreateManagedCaddyPaths(t.TempDir())
	admin := caddytest.StartAdminServer(t)
	writeFakeCaddyExecutable(t, paths.ExecutablePath)
	root := t.TempDir()
	gate := filepath.Join(root, "serve")
	port := nettest.ReservePort(t)
	command := os.Args[0]
	if missingExecutable {
		command = filepath.Join(root, "missing-command")
	}
	m := newResolvedManifest(root, admin)
	m.Devtools.Status.Enabled = false
	m.Services["web"] = ResolvedService{
		Name: "web", BindHost: "127.0.0.1", Cwd: root, Hosts: []string{"recover.localhost"}, Port: &port, PortSource: "fixed", InjectPort: true,
		Command: []string{command, "-test.run=TestStartupRecoveryServiceHelperProcess", "--"},
		Env:     map[string]string{"DEVHOST_STARTUP_RECOVERY_HELPER": "1", "SERVE_GATE": gate},
		Health:  ResolvedHealthConfig{Kind: HealthKindTCP, Host: stringPointer("127.0.0.1"), Port: &port, Interval: 10, Timeout: timeout},
	}
	originalRegister, originalUnregister := registerProcessSignals, unregisterProcessSignals
	signals := make(chan os.Signal, 1)
	registerProcessSignals = func(ch chan<- os.Signal) { go func() { ch <- <-signals }() }
	unregisterProcessSignals = func(chan<- os.Signal) {}
	t.Cleanup(func() { registerProcessSignals, unregisterProcessSignals = originalRegister, originalUnregister })
	done := make(chan error, 1)
	var output shutdownOutput
	go func() {
		_, err := StartStack(&m, []string{"web"}, StartStackOptions{CaddyPaths: paths, Environment: readCurrentEnvironment(), LogWriter: &output, ServiceStdoutWriter: &output, ServiceStderrWriter: &output, ShutdownGracePeriod: 100 * time.Millisecond})
		done <- err
	}()
	stop := sync.OnceFunc(func() {
		signals <- syscall.SIGTERM
		select {
		case err := <-done:
			if err != nil {
				t.Error(err)
			}
		case <-time.After(10 * time.Second):
			t.Error("stack did not stop")
		}
	})
	t.Cleanup(stop)
	registrationPath := filepath.Join(paths.RegistrationsDirectoryPath, "recover.localhost_web_2f.json")
	waitForCondition(t, 5*time.Second, func() bool { _, err := os.Stat(registrationPath); return err == nil })
	route := readRestartRoute(t, registrationPath)
	url := serverURL(route.DocumentInjectionPort, "/deep/link?value=1")
	return url, gate, stop, &output
}

func readStartupRecoveryPage(t *testing.T, url string) string {
	t.Helper()
	response, err := http.Get(url)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	data, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

func readStartupRecoveryState(t *testing.T, url string) devtools.RecoveryState {
	t.Helper()
	request, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("X-Devhost-Recovery", "status")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var state devtools.RecoveryState
	if err := json.NewDecoder(response.Body).Decode(&state); err != nil {
		t.Fatal(err)
	}
	return state
}

func TestStartupRecoveryRetainsTimeoutAndRestartsWithoutToolbar(t *testing.T) {
	url, gate, _, _ := startRecoveryStack(t, 2000, false)
	waitForCondition(t, 5*time.Second, func() bool {
		state := readStartupRecoveryState(t, url)
		return state.CanRestart && strings.Contains(state.Message, "did not pass its health check within 2000ms")
	})
	if page := readStartupRecoveryPage(t, url); !strings.Contains(page, "waiting for serve gate") || strings.Contains(page, "/__devhost__/inject.js") {
		t.Fatalf("timeout page = %s", page)
	}
	failedRequest, err := http.NewRequest(http.MethodPost, url, nil)
	if err != nil {
		t.Fatal(err)
	}
	failedRequest.Header.Set("X-Devhost-Recovery", "restart")
	failedRequest.Header.Set("Origin", "http://"+failedRequest.Host)
	failedResponse, err := http.DefaultClient.Do(failedRequest)
	if err != nil {
		t.Fatal(err)
	}
	failedResponse.Body.Close()
	if failedResponse.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("failed restart status = %d", failedResponse.StatusCode)
	}
	if err := os.WriteFile(gate, []byte("ready"), 0600); err != nil {
		t.Fatal(err)
	}
	request, err := http.NewRequest(http.MethodPost, url, nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("X-Devhost-Recovery", "restart")
	request.Header.Set("Origin", "http://"+request.Host)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusNoContent {
		t.Fatalf("restart status = %d", response.StatusCode)
	}
	if page := readStartupRecoveryPage(t, url); page != "application /deep/link?value=1" {
		t.Fatalf("recovered page = %s", page)
	}
}

func TestStartupPageWaitsForHealthBeforeServingApplication(t *testing.T) {
	url, gate, _, _ := startRecoveryStack(t, 60000, false)
	if page := readStartupRecoveryPage(t, url); !strings.Contains(page, "Starting web") {
		t.Fatalf("startup page = %s", page)
	}
	if err := os.WriteFile(gate, []byte("ready"), 0600); err != nil {
		t.Fatal(err)
	}
	waitForCondition(t, 5*time.Second, func() bool { return readStartupRecoveryPage(t, url) == "application /deep/link?value=1" })
}

func TestShutdownCancelsStartupHealthWait(t *testing.T) {
	url, _, stop, output := startRecoveryStack(t, 60000, false)
	if page := readStartupRecoveryPage(t, url); !strings.Contains(page, "Starting web") {
		t.Fatalf("startup page = %s", page)
	}
	waitForCondition(t, 5*time.Second, func() bool {
		return strings.Contains(output.snapshot(), "waiting for serve gate")
	})
	stop()
	for _, message := range []string{"Stopping service web...", "Stopped service web."} {
		if logs := output.snapshot(); strings.Count(logs, message) != 1 {
			t.Errorf("want exactly one %q line:\n%s", message, logs)
		}
	}
}

func TestStartupLaunchErrorRetainsRoutesForRecovery(t *testing.T) {
	url, gate, _, _ := startRecoveryStack(t, 2000, true)
	waitForCondition(t, 5*time.Second, func() bool {
		return strings.Contains(readStartupRecoveryPage(t, url), "missing-command")
	})
	if err := os.Symlink(os.Args[0], filepath.Join(filepath.Dir(gate), "missing-command")); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(gate, []byte("ready"), 0600); err != nil {
		t.Fatal(err)
	}
	request, err := http.NewRequest(http.MethodPost, url, nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("X-Devhost-Recovery", "restart")
	request.Header.Set("Origin", "http://"+request.Host)
	// Startup completes after the launch error has been retained.
	waitForCondition(t, 5*time.Second, func() bool {
		return readStartupRecoveryState(t, url).CanRestart
	})
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusNoContent || readStartupRecoveryPage(t, url) != "application /deep/link?value=1" {
		t.Fatalf("launch recovery status = %d", response.StatusCode)
	}
}

func TestStartupRecoveryServiceHelperProcess(t *testing.T) {
	if os.Getenv("DEVHOST_STARTUP_RECOVERY_HELPER") != "1" {
		return
	}
	fmtOutput := "waiting for serve gate\n"
	_, _ = io.WriteString(os.Stdout, fmtOutput)
	for {
		if _, err := os.Stat(os.Getenv("SERVE_GATE")); err == nil {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if err := http.ListenAndServe("127.0.0.1:"+os.Getenv("PORT"), http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, "application "+r.URL.RequestURI())
	})); err != nil {
		os.Exit(1)
	}
}
