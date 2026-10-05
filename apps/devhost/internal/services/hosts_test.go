package services

import (
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/devtools"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/manifest"
)

func TestMultipleHostMetadata(t *testing.T) {
	service := ResolvedService{Name: "web", Hosts: []string{"app.localhost", "alias.localhost"}, Path: stringPointer("/api/*"), Port: intPointer(3000)}
	value := ResolvedManifest{Name: "hosts", PrimaryService: "web", Services: map[string]ResolvedService{"web": service}, Caddy: manifest.CaddyConfig{Global: manifest.CaddyGlobalConfig{HTTPSPort: 4443}}}
	var output strings.Builder
	LogServiceURLs(value, &output)
	if want := "[hosts] web (primary): https://app.localhost:4443/api/\n[hosts] web (primary): https://alias.localhost:4443/api/\n"; output.String() != want {
		t.Fatalf("URLs = %q, want %q", output.String(), want)
	}
	env := CreateInjectedServiceEnvironment(value, service)
	if env["DEVHOST_HOST"] != "app.localhost" {
		t.Fatalf("primary host = %q", env["DEVHOST_HOST"])
	}
	ref, err := interpolateServiceTemplates("https://{{ services.web.host }}", value.Services)
	if err != nil || ref != "https://app.localhost" {
		t.Fatalf("reference = %q, error = %v", ref, err)
	}
	if hosts := collectClaimedHosts(value.Services); !slices.Equal(hosts, []string{"alias.localhost", "app.localhost"}) {
		t.Fatalf("claims = %v", hosts)
	}
	identities := collectRoutedServiceIdentities(value.Services)
	if len(identities) != 2 || identities[0].Host != "alias.localhost" || identities[1].Host != "app.localhost" || identities[0].ServiceName != "web" || identities[0].Path != "/api/*" {
		t.Fatalf("identities = %#v", identities)
	}
	response := collectServicesHealth(value, nil, nil)
	if len(response.Services) != 1 || response.Services[0].URL == nil || *response.Services[0].URL != "https://app.localhost:4443/api/" {
		t.Fatalf("health = %#v", response)
	}
}

type hostRegistration struct {
	Host                  string `json:"host"`
	ServiceName           string `json:"serviceName"`
	AppPort               int    `json:"appPort"`
	DocumentInjectionPort int    `json:"documentInjectionPort"`
	DevtoolsControlPort   int    `json:"devtoolsControlPort"`
}

func TestResolveMultipleHostPorts(t *testing.T) {
	t.Setenv("DEVHOST_TEST_ALIAS", "alias.localhost")
	for _, tc := range []struct{ name, config string }{
		{name: "fixed", config: "command = [\"server\"]\nport = 3000"},
		{name: "auto", config: "command = [\"server\"]\nport = \"auto\""},
		{name: "unmanaged", config: "managed = false\nport = 3000"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			text := "name = \"hosts\"\n[services.web]\nhost = [\"app.localhost\", \"{{ env.DEVHOST_TEST_ALIAS }}\"]\nenv = { PRIMARY = \"{{ services.web.host }}\" }\n" + tc.config
			value := resolveHostTestManifest(t, text)
			service := value.Services["web"]
			if !slices.Equal(service.Hosts, []string{"app.localhost", "alias.localhost"}) || service.Port == nil || *service.Port == 0 || service.Env["PRIMARY"] != "app.localhost" {
				t.Fatalf("resolved service = %#v", service)
			}
			if service.PortSource == "auto" {
				reassigned, _, err := ReassignAutoPort(value, "web")
				if err != nil || !slices.Equal(reassigned.Hosts, service.Hosts) || *reassigned.Port == *service.Port {
					t.Fatalf("reassigned service = %#v, error = %v", reassigned, err)
				}
			}
		})
	}
}

func resolveHostTestManifest(t *testing.T, text string) ResolvedManifest {
	t.Helper()
	path := filepath.Join(t.TempDir(), "devhost.toml")
	if err := os.WriteFile(path, []byte(text), 0o600); err != nil {
		t.Fatal(err)
	}
	raw, err := manifest.ReadManifest(path)
	if err != nil {
		t.Fatal(err)
	}
	validated, err := manifest.ValidateManifest(path, raw)
	if err != nil {
		t.Fatal(err)
	}
	resolved, err := ResolveServicePorts(validated)
	if err != nil {
		t.Fatal(err)
	}
	return resolved
}

type hostReadyWriter struct {
	ready chan struct{}
	once  sync.Once
}

func (w *hostReadyWriter) Write(p []byte) (int, error) {
	if strings.HasSuffix(string(p), "https://alias.localhost\n") {
		w.once.Do(func() { close(w.ready) })
	}
	return len(p), nil
}

func TestStartStackMultipleHosts(t *testing.T) {
	for _, tc := range []struct {
		name            string
		failSecondRoute bool
	}{
		{name: "routes and restart"},
		{name: "rolls back partial activation", failSecondRoute: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			paths := caddy.CreateManagedCaddyPaths(t.TempDir())
			admin, stopAdmin := startTestAdminServer(t)
			defer stopAdmin()
			writeFakeCaddyExecutable(t, paths.ExecutablePath)
			if tc.failSecondRoute {
				marker := filepath.Join(paths.StateDirectoryPath, "reload-failed")
				aliasRoute := filepath.Join(paths.RoutesDirectoryPath, "alias.localhost.caddy")
				script := fmt.Sprintf("#!/bin/sh\nif [ -f '%s' ] && [ ! -f '%s' ]; then\n  touch '%s'\n  exit 1\nfi\nexit 0\n", aliasRoute, marker, marker)
				if err := os.WriteFile(paths.ExecutablePath, []byte(script), 0o755); err != nil {
					t.Fatal(err)
				}
			}
			originalRegister, originalUnregister, originalControl := registerProcessSignals, unregisterProcessSignals, startDevtoolsControlServer
			defer func() {
				registerProcessSignals, unregisterProcessSignals, startDevtoolsControlServer = originalRegister, originalUnregister, originalControl
			}()
			signals := make(chan chan<- os.Signal, 1)
			registerProcessSignals = func(ch chan<- os.Signal) { signals <- ch }
			unregisterProcessSignals = func(chan<- os.Signal) {}
			controls := make(chan devtools.StartControlServerOptions, 1)
			startDevtoolsControlServer = func(options devtools.StartControlServerOptions) (*devtools.ControlServer, error) {
				server, err := devtools.StartControlServer(options)
				controls <- options
				return server, err
			}
			port := mustReservePort(t)
			trace := filepath.Join(t.TempDir(), "starts")
			text := fmt.Sprintf("name = \"hosts\"\n[caddy.global]\nadminAddress = %q\n[services.web]\ncommand = [%q, \"-test.run=TestMultipleHostBackendProcess\"]\nport = %d\nhost = [\"app.localhost\", \"alias.localhost\"]\nenv = { DEVHOST_MULTI_HOST_HELPER = \"1\", START_TRACE_PATH = %q }\n", admin, os.Args[0], port, trace)
			value := resolveHostTestManifest(t, text)
			ready := &hostReadyWriter{ready: make(chan struct{})}
			done := make(chan error, 1)
			go func() {
				_, err := StartStack(&value, []string{"web"}, StartStackOptions{CaddyPaths: paths, LogWriter: ready, ServiceStdoutWriter: ioDiscard{}, ServiceStderrWriter: ioDiscard{}, ShutdownGracePeriod: 100 * time.Millisecond})
				done <- err
			}()
			var stop chan<- os.Signal
			select {
			case stop = <-signals:
			case <-time.After(5 * time.Second):
				t.Fatal("stack did not register signals")
			}
			defer func() {
				select {
				case stop <- syscall.SIGTERM:
				default:
				}
				select {
				case <-done:
				case <-time.After(5 * time.Second):
					t.Error("stack did not stop")
				}
			}()
			if tc.failSecondRoute {
				select {
				case err := <-done:
					if err == nil {
						t.Fatal("second route did not fail")
					}
					done <- err
				case <-time.After(5 * time.Second):
					t.Fatal("partial route activation did not stop stack")
				}
			} else {
				var control devtools.StartControlServerOptions
				select {
				case control = <-controls:
				case <-time.After(5 * time.Second):
					t.Fatal("control server did not start")
				}
				select {
				case <-ready.ready:
				case <-time.After(5 * time.Second):
					t.Fatal("alias URL was not announced")
				}
				registrations := readHostRegistrations(t, paths)
				if len(registrations) != 2 {
					t.Fatalf("registrations = %#v", registrations)
				}
				for _, registration := range registrations {
					if registration.ServiceName != "web" || registration.AppPort != port || registration.DocumentInjectionPort == 0 || registration.DevtoolsControlPort == 0 {
						t.Fatalf("registration = %#v", registration)
					}
				}
				if registrations[0].DocumentInjectionPort != registrations[1].DocumentInjectionPort {
					t.Fatal("aliases created separate injection servers")
				}
				pid := assertHostBackend(t, registrations)
				starts, err := os.ReadFile(trace)
				if err != nil || len(nonEmptyLines(string(starts))) != 1 {
					t.Fatalf("starts = %q, error = %v", starts, err)
				}
				waitForCondition(t, 5*time.Second, func() bool {
					err := control.RestartService([]string{"web"})
					if err != nil && err.Error() != "devhost is still starting the stack" {
						t.Fatal(err)
					}
					return err == nil
				})
				if restartedPID := assertHostBackend(t, registrations); restartedPID == pid {
					t.Fatal("restart kept original process")
				}
				starts, err = os.ReadFile(trace)
				if err != nil || len(nonEmptyLines(string(starts))) != 2 {
					t.Fatalf("restart starts = %q, error = %v", starts, err)
				}
				stop <- syscall.SIGTERM
				select {
				case err := <-done:
					if err != nil {
						t.Fatal(err)
					}
					done <- err
				case <-time.After(5 * time.Second):
					t.Fatal("shutdown timed out")
				}
			}
			assertDirectoryEntries(t, paths.HostClaimsDirectoryPath, nil)
			assertDirectoryEntries(t, paths.PortClaimsDirectoryPath, nil)
			assertDirectoryEntries(t, paths.RegistrationsDirectoryPath, nil)
			assertRouteDirectoryEmpty(t, paths.RoutesDirectoryPath)
		})
	}
}

func readHostRegistrations(t *testing.T, paths caddy.Paths) []hostRegistration {
	t.Helper()
	entries, err := os.ReadDir(paths.RegistrationsDirectoryPath)
	if err != nil {
		t.Fatal(err)
	}
	var result []hostRegistration
	for _, entry := range entries {
		data, err := os.ReadFile(filepath.Join(paths.RegistrationsDirectoryPath, entry.Name()))
		if err != nil {
			t.Fatal(err)
		}
		var registration hostRegistration
		if err := json.Unmarshal(data, &registration); err != nil {
			t.Fatal(err)
		}
		result = append(result, registration)
	}
	return result
}

func TestStartStackAliasClaimConflictReleasesOwnClaims(t *testing.T) {
	paths := caddy.CreateManagedCaddyPaths(t.TempDir())
	admin, stopAdmin := startTestAdminServer(t)
	defer stopAdmin()
	writeFakeCaddyExecutable(t, paths.ExecutablePath)
	if err := caddy.EnsureManagedCaddyConfig(paths, caddy.ManagedCaddyConfigFallback{AdminAddress: admin}); err != nil {
		t.Fatal(err)
	}
	claim := caddy.ClaimHostOptions{Host: "z-blocked.localhost", ManifestPath: filepath.Join(t.TempDir(), "other.toml"), RegistrationsDirectoryPath: paths.RegistrationsDirectoryPath}
	if err := caddy.ClaimHost(claim); err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := caddy.ReleaseHostClaim(claim); err != nil {
			t.Error(err)
		}
	}()
	value := newResolvedManifest(t.TempDir(), admin)
	value.Services["web"] = ResolvedService{
		Name: "web", BindHost: "127.0.0.1", Hosts: []string{"app.localhost", "z-blocked.localhost"}, Path: stringPointer("/"), Port: intPointer(mustReservePort(t)), PortSource: "fixed",
	}
	_, err := StartStack(&value, []string{"web"}, StartStackOptions{CaddyPaths: paths, LogWriter: ioDiscard{}})
	if err == nil || !strings.Contains(err.Error(), "z-blocked.localhost is already claimed") {
		t.Fatalf("claim conflict error = %v", err)
	}
	assertDirectoryEntries(t, paths.HostClaimsDirectoryPath, []string{"z-blocked.localhost.json"})
	assertDirectoryEntries(t, paths.PortClaimsDirectoryPath, nil)
	assertDirectoryEntries(t, paths.RegistrationsDirectoryPath, nil)
	assertRouteDirectoryEmpty(t, paths.RoutesDirectoryPath)
}

func assertHostBackend(t *testing.T, registrations []hostRegistration) string {
	t.Helper()
	var pid string
	for _, registration := range registrations {
		request, err := http.NewRequest(http.MethodGet, serverURL(registration.DocumentInjectionPort, "/"), nil)
		if err != nil {
			t.Fatal(err)
		}
		request.Host = registration.Host
		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		body, err := io.ReadAll(response.Body)
		closeError := response.Body.Close()
		if err != nil || closeError != nil {
			t.Fatalf("read response: %v %v", err, closeError)
		}
		parts := strings.SplitN(string(body), "|", 2)
		if len(parts) != 2 || parts[1] != registration.Host+`<script type="module" src="/__devhost__/inject.js"></script>` {
			t.Fatalf("alias response = %q", body)
		}
		if pid != "" && pid != parts[0] {
			t.Fatal("aliases reached different processes")
		}
		pid = parts[0]
	}
	return pid
}

func TestMultipleHostBackendProcess(t *testing.T) {
	if os.Getenv("DEVHOST_MULTI_HOST_HELPER") != "1" {
		return
	}
	listener, err := net.Listen("tcp", net.JoinHostPort("127.0.0.1", os.Getenv("PORT")))
	if err != nil {
		t.Fatal(err)
	}
	appendTraceLine(os.Getenv("START_TRACE_PATH"), strconv.Itoa(os.Getpid()))
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		if _, err := fmt.Fprintf(w, "%d|%s", os.Getpid(), r.Header.Get("X-Forwarded-Host")); err != nil {
			t.Error(err)
		}
	})}
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, syscall.SIGTERM)
	defer signal.Stop(signals)
	go func() {
		<-signals
		if err := server.Close(); err != nil {
			t.Error(err)
		}
	}()
	if err := server.Serve(listener); err != nil && err != http.ErrServerClosed {
		t.Fatal(err)
	}
}
