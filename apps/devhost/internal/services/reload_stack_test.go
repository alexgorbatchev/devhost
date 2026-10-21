package services

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy/caddytest"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/devtools"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/manifest"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/nettest"
)

type reloadLogs struct {
	mu   sync.Mutex
	text strings.Builder
}

func (l *reloadLogs) Write(data []byte) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.text.Write(data)
}
func (l *reloadLogs) contains(text string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	return strings.Contains(l.text.String(), text)
}
func (l *reloadLogs) count(text string) int {
	l.mu.Lock()
	defer l.mu.Unlock()
	return strings.Count(l.text.String(), text)
}

type reloadStackFixture struct {
	path        string
	header      string
	configPath  string
	paths       caddy.Paths
	control     devtools.StartControlServerOptions
	controlPort int
	logs        *reloadLogs
	signalStop  func()
	stop        func()
}

func startReloadStack(t *testing.T, body string) *reloadStackFixture {
	t.Helper()
	return startReloadStackConfiguration(t, body, false)
}

func startReloadStackConfiguration(t *testing.T, body string, worktreesEnabled bool) *reloadStackFixture {
	t.Helper()
	return startReloadStackRequested(t, body, worktreesEnabled, nil)
}

// startReloadStackRequested starts the stack the way `devhost start <requested...>` does.
func startReloadStackRequested(t *testing.T, body string, worktreesEnabled bool, requested []string) *reloadStackFixture {
	t.Helper()
	root, state := t.TempDir(), t.TempDir()
	admin := caddytest.StartAdminServer(t)
	f := &reloadStackFixture{path: filepath.Join(root, "devhost.toml"), paths: caddy.CreateManagedCaddyPaths(state), logs: &reloadLogs{}}
	f.header = fmt.Sprintf("name = \"reload\"\n[worktrees]\nenabled = %t\n", worktreesEnabled)
	f.configPath = writeTestSharedConfig(t, testCaddySettings(admin))
	f.write(t, body)
	raw, err := manifest.ReadManifest(f.path)
	if err != nil {
		t.Fatal(err)
	}
	configured, err := manifest.ValidateManifest(f.path, raw)
	if err != nil {
		t.Fatal(err)
	}
	order, err := ResolveServiceOrder(configured)
	if err != nil {
		t.Fatal(err)
	}
	m, err := ResolveRequestedServicePorts(configured, requested)
	if err != nil {
		t.Fatal(err)
	}
	writeFakeCaddyExecutable(t, f.paths.ExecutablePath)
	originalStart, originalRegister, originalUnregister := startDevtoolsControlServer, registerProcessSignals, unregisterProcessSignals
	t.Cleanup(func() {
		startDevtoolsControlServer, registerProcessSignals, unregisterProcessSignals = originalStart, originalRegister, originalUnregister
	})
	controls := make(chan devtools.StartControlServerOptions, 1)
	ports := make(chan int, 1)
	signals := make(chan chan<- os.Signal, 1)
	startDevtoolsControlServer = func(options devtools.StartControlServerOptions) (*devtools.ControlServer, error) {
		s, err := devtools.StartControlServer(options)
		if err == nil {
			controls <- options
			ports <- s.Port()
		}
		return s, err
	}
	registerProcessSignals = func(ch chan<- os.Signal) { signals <- ch }
	unregisterProcessSignals = func(chan<- os.Signal) {}
	done := make(chan error, 1)
	go func() {
		_, err := StartStack(&m, order, StartStackOptions{Configuration: &configured, CaddyPaths: f.paths, ConfigPath: f.configPath, Environment: readCurrentEnvironment(), LogWriter: f.logs, ServiceStdoutWriter: io.Discard, ServiceStderrWriter: io.Discard, ShutdownGracePeriod: 100 * time.Millisecond})
		done <- err
	}()
	var ch chan<- os.Signal
	select {
	case ch = <-signals:
	case err := <-done:
		t.Fatalf("startup: %v", err)
	case <-time.After(5 * time.Second):
		t.Fatal("startup timed out")
	}
	f.signalStop = sync.OnceFunc(func() { ch <- syscall.SIGTERM })
	f.stop = sync.OnceFunc(func() {
		writeFakeCaddyExecutable(t, f.paths.ExecutablePath)
		f.signalStop()
		select {
		case err := <-done:
			if err != nil {
				t.Error(err)
			}
		case <-time.After(10 * time.Second):
			t.Error("shutdown timed out")
		}
	})
	t.Cleanup(f.stop)
	select {
	case f.control = <-controls:
		f.controlPort = <-ports
	case err := <-done:
		t.Fatalf("startup: %v", err)
	case <-time.After(5 * time.Second):
		t.Fatal("control startup timed out")
	}
	waitForCondition(t, stackChangeTimeout, func() bool { return f.control.RestartService(nil) == nil })
	return f
}

func (f *reloadStackFixture) write(t *testing.T, body string) {
	t.Helper()
	if err := os.WriteFile(f.path, []byte(f.header+body), 0600); err != nil {
		t.Fatal(err)
	}
}

// readInjectedConfig reads the configuration the stack's pages load.
func readInjectedConfig(t *testing.T, f *reloadStackFixture) map[string]json.RawMessage {
	t.Helper()
	response, err := http.Get(fmt.Sprintf("http://127.0.0.1:%d/__devhost__/config.json", f.controlPort))
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var config map[string]json.RawMessage
	if err := json.NewDecoder(response.Body).Decode(&config); err != nil {
		t.Fatal(err)
	}
	return config
}

// readInjectedRoutes reads the routes the stack's pages know.
func readInjectedRoutes(t *testing.T, f *reloadStackFixture) []devtools.RoutedServiceIdentity {
	t.Helper()
	var routes []devtools.RoutedServiceIdentity
	if err := json.Unmarshal(readInjectedConfig(t, f)["routedServices"], &routes); err != nil {
		t.Fatal(err)
	}
	return routes
}

func reloadServiceBody(name, value, host string) string {
	return fmt.Sprintf("\n[services.%s]\ncommand = [%q, \"-test.run=TestReloadServiceHelperProcess\", \"--\"]\nport = \"auto\"\nhost = %q\n[services.%s.env]\nDEVHOST_RELOAD_HELPER = \"1\"\nVALUE = %q\n", name, os.Args[0], host, name, value)
}

func TestManifestReloadChangesEnvironmentAndPreservesAutoPort(t *testing.T) {
	f := startReloadStack(t, reloadServiceBody("web", "original", "reload.localhost"))
	path := filepath.Join(f.paths.RegistrationsDirectoryPath, "reload.localhost_web_2f.json")
	original := readRestartRoute(t, path)
	assertRestartResponse(t, serverURL(original.AppPort, "/"), "original")
	f.write(t, reloadServiceBody("web", "replacement", "reload.localhost"))
	waitForCondition(t, stackChangeTimeout, func() bool { return f.logs.contains("configuration reloaded") })
	if !f.logs.contains("configuration reloaded: devhost.toml") {
		t.Fatal("reload log omitted the root manifest")
	}
	next := readRestartRoute(t, path)
	if next.AppPort != original.AppPort || next.DocumentInjectionPort != original.DocumentInjectionPort || next.DevtoolsControlPort != f.controlPort {
		t.Fatalf("reload replaced ports: %#v -> %#v", original, next)
	}
	assertRestartResponse(t, serverURL(next.AppPort, "/"), "replacement")
}

func TestManifestReloadRenamesTheRunningStack(t *testing.T) {
	body := reloadServiceBody("web", "original", "reload.localhost")
	f := startReloadStack(t, body)
	route := readRestartRoute(t, filepath.Join(f.paths.RegistrationsDirectoryPath, "reload.localhost_web_2f.json"))
	pid := reloadPID(t, route.AppPort)
	f.header = strings.Replace(f.header, `name = "reload"`, `name = "renamed"`, 1)
	f.write(t, body)
	waitForCondition(t, stackChangeTimeout, func() bool { return f.logs.contains("[renamed] configuration reloaded") })
	if reloadPID(t, route.AppPort) != pid {
		t.Fatal("renaming the stack restarted its service")
	}
	if renamed := readRestartRoute(t, filepath.Join(f.paths.RegistrationsDirectoryPath, "reload.localhost_web_2f.json")); renamed.AppPort != route.AppPort {
		t.Fatalf("renaming the stack moved its route: %#v -> %#v", route, renamed)
	}
	f.stop()
	for _, line := range []string{"[renamed] Stopping service web...", "[renamed] Stopped service web.", "[renamed] Stack stopped."} {
		if !f.logs.contains(line) {
			t.Errorf("shutdown logs lack %q", line)
		}
	}
	if f.logs.contains("[reload] Stopping service") {
		t.Error("shutdown kept the name the stack started with")
	}
}

func TestManifestReloadRejectsInvalidEditsAndAppliesDevtoolsAndAnnotationEdits(t *testing.T) {
	body := reloadServiceBody("web", "original", "reload.localhost")
	f := startReloadStack(t, body)
	route := readRestartRoute(t, filepath.Join(f.paths.RegistrationsDirectoryPath, "reload.localhost_web_2f.json"))
	pid := reloadPID(t, route.AppPort)
	f.write(t, "\n[services.web]\ncommand = [")
	waitForCondition(t, stackChangeTimeout, func() bool { return f.logs.contains("configuration reload rejected") })
	if reloadPID(t, route.AppPort) != pid {
		t.Fatal("invalid edit restarted the service")
	}
	// Devtools and annotation settings apply without restarting services.
	f.write(t, "\n[devtools.shortcuts]\nrestartServices = \"ctrl+r\"\n[devtools.minimap]\nenabled = false\n[annotation]\nagent = \"pi\"\n"+body)
	waitForCondition(t, stackChangeTimeout, func() bool { return f.logs.contains("configuration reloaded") })
	if reloadPID(t, route.AppPort) != pid {
		t.Fatal("a devtools edit restarted the service")
	}
	config := readInjectedConfig(t, f)
	if string(config["restartServicesShortcut"]) != `"ctrl+r"` || string(config["minimapEnabled"]) != "false" || !strings.Contains(string(config["annotationActions"]), `"id":"agent"`) {
		t.Fatalf("pages were not given the edited settings: %s, %s, %s", config["restartServicesShortcut"], config["minimapEnabled"], config["annotationActions"])
	}
	f.write(t, reloadServiceBody("web", "repaired", "reload.localhost"))
	waitForCondition(t, stackChangeTimeout, func() bool { return f.logs.count("configuration reloaded") == 2 })
	assertRestartResponse(t, serverURL(route.AppPort, "/"), "repaired")
}

func TestManifestReloadRestoresPreviousServicesAfterFailedLaunch(t *testing.T) {
	f := startReloadStack(t, reloadServiceBody("web", "original", "reload.localhost"))
	route := readRestartRoute(t, filepath.Join(f.paths.RegistrationsDirectoryPath, "reload.localhost_web_2f.json"))
	f.write(t, reloadServiceBody("web", "fail", "reload.localhost"))
	waitForCondition(t, stackChangeTimeout, func() bool { return f.logs.contains("configuration reload rejected") })
	assertRestartResponse(t, serverURL(route.DocumentInjectionPort, "/"), "original")
	health, err := f.control.GetHealthResponse()
	if err != nil || !health.Services[0].Status || health.Services[0].Restarting {
		t.Fatalf("rollback left recovery pending: %#v, %v", health, err)
	}
	f.write(t, reloadServiceBody("web", "recovered", "reload.localhost"))
	waitForCondition(t, stackChangeTimeout, func() bool { return f.logs.contains("configuration reloaded") })
	assertRestartResponse(t, serverURL(route.AppPort, "/"), "recovered")
}

func TestManifestReloadReconcilesIncludesServicesRoutesAndClaims(t *testing.T) {
	body := reloadServiceBody("web", "original", "reload.localhost")
	f := startReloadStack(t, body)
	original := readRestartRoute(t, filepath.Join(f.paths.RegistrationsDirectoryPath, "reload.localhost_web_2f.json"))
	f.header = "includes = [\"services/*/*.toml\"]\n" + f.header
	f.write(t, body)
	dir := filepath.Join(filepath.Dir(f.path), "services", "worker")
	if err := os.MkdirAll(dir, 0755); err != nil {
		t.Fatal(err)
	}
	child := filepath.Join(dir, "worker.toml")
	port := nettest.ReservePort(t)
	worker := strings.ReplaceAll(reloadServiceBody("worker", "worker", "worker.localhost"), "port = \"auto\"", fmt.Sprintf("port = %d", port))
	if err := os.WriteFile(child, []byte(worker), 0600); err != nil {
		t.Fatal(err)
	}
	waitForCondition(t, stackChangeTimeout, func() bool { return f.logs.count("configuration reloaded") == 1 })
	if !f.logs.contains("configuration reloaded: devhost.toml, " + filepath.Join("services", "worker", "worker.toml")) {
		t.Fatal("reload log omitted the included manifest")
	}
	workerRoute := readRestartRoute(t, filepath.Join(f.paths.RegistrationsDirectoryPath, "worker.localhost_worker_2f.json"))
	assertRestartResponse(t, serverURL(port, "/"), "worker")
	if old := readRestartRoute(t, filepath.Join(f.paths.RegistrationsDirectoryPath, "reload.localhost_web_2f.json")); old.AppPort != original.AppPort {
		t.Fatal("adding a service reassigned an existing auto port")
	}
	if err := os.Remove(child); err != nil {
		t.Fatal(err)
	}
	waitForCondition(t, stackChangeTimeout, func() bool { return f.logs.count("configuration reloaded") == 2 })
	if f.logs.count("configuration reloaded: devhost.toml\n") != 1 {
		t.Fatal("reload log retained the deleted include")
	}
	if canConnectToPort(context.Background(), "127.0.0.1", port, minProbeTimeout) || canConnectToPort(context.Background(), "127.0.0.1", workerRoute.DocumentInjectionPort, minProbeTimeout) {
		t.Fatal("removed service retained its listeners")
	}
	if _, err := os.Stat(filepath.Join(f.paths.RegistrationsDirectoryPath, "worker.localhost_worker_2f.json")); !os.IsNotExist(err) {
		t.Fatalf("removed route remains: %v", err)
	}
	waitForCondition(t, time.Second, func() bool { ports, _ := os.ReadDir(f.paths.PortClaimsDirectoryPath); return len(ports) == 0 })
	f.write(t, reloadServiceBody("web", "moved", "new.localhost"))
	waitForCondition(t, stackChangeTimeout, func() bool { return f.logs.count("configuration reloaded") == 3 })
	if _, err := os.Stat(filepath.Join(f.paths.RegistrationsDirectoryPath, "reload.localhost_web_2f.json")); !os.IsNotExist(err) {
		t.Fatalf("obsolete alias remains: %v", err)
	}
	assertRestartResponse(t, serverURL(original.DocumentInjectionPort, "/"), "moved")
	health, err := f.control.GetHealthResponse()
	if routes := readInjectedRoutes(t, f); err != nil || len(health.Services) != 1 || len(routes) != 1 || routes[0].Host != "new.localhost" {
		t.Fatalf("health retained removed services or routes: %#v, %#v, %v", health, routes, err)
	}
}

func TestManifestReloadRestoresRoutesAfterCaddyRejectsReplacement(t *testing.T) {
	f := startReloadStack(t, reloadServiceBody("web", "original", "reload.localhost"))
	path := filepath.Join(f.paths.RegistrationsDirectoryPath, "reload.localhost_web_2f.json")
	original := readRestartRoute(t, path)
	marker := filepath.Join(f.paths.StateDirectoryPath, "rejected")
	script := fmt.Sprintf("#!/bin/sh\nif [ ! -e %q ]; then touch %q; echo 'replacement rejected' >&2; exit 1; fi\nexit 0\n", marker, marker)
	if err := os.WriteFile(f.paths.ExecutablePath, []byte(script), 0755); err != nil {
		t.Fatal(err)
	}
	f.write(t, reloadServiceBody("web", "replacement", "new.localhost"))
	waitForCondition(t, stackChangeTimeout, func() bool { return f.logs.contains("configuration reload rejected") })
	assertRestartResponse(t, serverURL(original.DocumentInjectionPort, "/"), "original")
	if restored := readRestartRoute(t, path); restored.AppPort != original.AppPort {
		t.Fatalf("route rollback changed port: %#v", restored)
	}
	if _, err := os.Stat(filepath.Join(f.paths.RegistrationsDirectoryPath, "new.localhost_web_2f.json")); !os.IsNotExist(err) {
		t.Fatalf("failed alias remained: %v", err)
	}
	writeFakeCaddyExecutable(t, f.paths.ExecutablePath)
	f.write(t, reloadServiceBody("web", "recovered", "new.localhost"))
	waitForCondition(t, stackChangeTimeout, func() bool { return f.logs.contains("configuration reloaded") })
	assertRestartResponse(t, serverURL(original.DocumentInjectionPort, "/"), "recovered")
}

func TestManifestReloadShutdownInterruptsReplacementHealth(t *testing.T) {
	f := startReloadStack(t, reloadServiceBody("web", "original", "reload.localhost"))
	route := readRestartRoute(t, filepath.Join(f.paths.RegistrationsDirectoryPath, "reload.localhost_web_2f.json"))
	body := strings.Replace(reloadServiceBody("web", "replacement", "reload.localhost"), "port = \"auto\"", fmt.Sprintf("port = %d", route.AppPort), 1)
	body = strings.Replace(body, "[services.web.env]", fmt.Sprintf("[services.web.health]\nhttp = %q\ntimeout = 5000\ninterval = 2000\n[services.web.env]", serverURL(route.AppPort, "/health")), 1)
	body += "HEALTH_STATUS = \"503\"\n"
	f.write(t, body)
	waitForCondition(t, stackChangeTimeout, func() bool {
		response, err := http.Get(serverURL(route.AppPort, "/health"))
		if err != nil {
			return false
		}
		defer response.Body.Close()
		return response.StatusCode == http.StatusServiceUnavailable
	})
	f.signalStop()
	waitForCondition(t, time.Second, func() bool {
		return !canConnectToPort(context.Background(), "127.0.0.1", route.AppPort, minProbeTimeout)
	})
	f.stop()
}

func reloadPID(t *testing.T, port int) int {
	t.Helper()
	response, err := http.Get(serverURL(port, "/pid"))
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var pid int
	if err := json.NewDecoder(response.Body).Decode(&pid); err != nil {
		t.Fatal(err)
	}
	return pid
}

func TestReloadServiceHelperProcess(t *testing.T) {
	if os.Getenv("DEVHOST_RELOAD_HELPER") != "1" {
		return
	}
	if os.Getenv("VALUE") == "fail" {
		os.Exit(7)
	}
	if marker := os.Getenv("COLLISION_MARKER"); marker != "" {
		if _, err := os.Stat(marker); os.IsNotExist(err) {
			_ = os.WriteFile(marker, nil, 0600)
			_, _ = fmt.Fprintln(os.Stderr, "bind: address already in use")
			os.Exit(2)
		}
	}
	if _, err := os.Stat("fail"); err == nil {
		os.Exit(7)
	}
	host := "127.0.0.1"
	if path := os.Getenv("BIND_HOST_FILE"); path != "" {
		value, err := os.ReadFile(path)
		if err != nil {
			_, _ = fmt.Fprintln(os.Stderr, err)
			os.Exit(2)
		}
		host = string(value)
	}
	listener, err := net.Listen("tcp", net.JoinHostPort(host, os.Getenv("PORT")))
	if err != nil {
		_, _ = fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}
	ch := make(chan os.Signal, 1)
	signal.Notify(ch, syscall.SIGTERM, syscall.SIGINT)
	go func() {
		_ = http.Serve(listener, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/checkout-only" {
				if _, err := os.Stat("route-ready"); err != nil {
					http.NotFound(w, r)
					return
				}
			}
			if r.URL.Path == "/health" && os.Getenv("HEALTH_STATUS") == "503" {
				w.WriteHeader(http.StatusServiceUnavailable)
				return
			}
			if r.URL.Path == "/pid" {
				_ = json.NewEncoder(w).Encode(os.Getpid())
				return
			}
			if r.URL.Path == "/env" {
				_ = json.NewEncoder(w).Encode(map[string]string{"WEB": os.Getenv("DEVHOST_PORT_WEB"), "REFERENCE": os.Getenv("REFERENCE")})
				return
			}
			if r.URL.Path == "/page" {
				w.Header().Set("content-type", "text/html; charset=utf-8")
				_, _ = io.WriteString(w, "<html><body>"+os.Getenv("VALUE")+"</body></html>")
				return
			}
			if r.URL.Path == "/cwd" {
				cwd, _ := os.Getwd()
				_, _ = io.WriteString(w, cwd)
				return
			}
			_, _ = io.WriteString(w, os.Getenv("VALUE"))
		}))
	}()
	<-ch
	_ = listener.Close()
	os.Exit(0)
}
