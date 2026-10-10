package services

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"strconv"
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

func TestCreateInjectedServiceEnvironment(t *testing.T) {
	t.Parallel()

	routedHost := "hello.xcv.lol"
	routedPath := "/"
	port := 3200

	tests := []struct {
		name     string
		manifest ResolvedManifest
		service  ResolvedService
		want     map[string]string
	}{
		{
			name: "injects routed variables and port",
			manifest: ResolvedManifest{
				ManifestPath:   "/tmp/project/devhost.toml",
				PrimaryService: "web",
				Name:           "hello-stack",
			},
			service: ResolvedService{
				BindHost:   "127.0.0.1",
				Hosts:      []string{routedHost},
				InjectPort: true,
				Name:       "web",
				Path:       &routedPath,
				Port:       &port,
			},
			want: map[string]string{
				"DEVHOST_BIND_HOST":     "127.0.0.1",
				"DEVHOST_HOST":          "hello.xcv.lol",
				"DEVHOST_PATH":          "/",
				"DEVHOST_MANIFEST_PATH": "/tmp/project/devhost.toml",
				"DEVHOST_SERVICE_NAME":  "web",
				"PORT":                  "3200",
			},
		},
		{
			name: "omits routed variables and port when unavailable",
			manifest: ResolvedManifest{
				ManifestPath:   "/tmp/project/devhost.toml",
				PrimaryService: "worker",
				Name:           "hello-stack",
			},
			service: ResolvedService{
				BindHost:   "127.0.0.1",
				InjectPort: true,
				Name:       "worker",
			},
			want: map[string]string{
				"DEVHOST_BIND_HOST":     "127.0.0.1",
				"DEVHOST_MANIFEST_PATH": "/tmp/project/devhost.toml",
				"DEVHOST_SERVICE_NAME":  "worker",
			},
		},
		{
			name: "omits port when injectPort is false",
			manifest: ResolvedManifest{
				ManifestPath:   "/tmp/project/devhost.toml",
				PrimaryService: "web",
				Name:           "hello-stack",
			},
			service: ResolvedService{
				BindHost:   "127.0.0.1",
				Hosts:      []string{routedHost},
				InjectPort: false,
				Name:       "web",
				Path:       &routedPath,
				Port:       &port,
			},
			want: map[string]string{
				"DEVHOST_BIND_HOST":     "127.0.0.1",
				"DEVHOST_HOST":          "hello.xcv.lol",
				"DEVHOST_PATH":          "/",
				"DEVHOST_MANIFEST_PATH": "/tmp/project/devhost.toml",
				"DEVHOST_SERVICE_NAME":  "web",
			},
		},
		{
			name: "injects other service ports as environment variables",
			manifest: ResolvedManifest{
				ManifestPath:   "/tmp/project/devhost.toml",
				PrimaryService: "web",
				Name:           "hello-stack",
				Services: map[string]ResolvedService{
					"web": {
						Name: "web",
						Port: &port,
					},
					"postgres-db": {
						Name: "postgres-db",
						Port: &port,
					},
				},
			},
			service: ResolvedService{
				BindHost:   "127.0.0.1",
				InjectPort: false,
				Name:       "web",
				Port:       &port,
			},
			want: map[string]string{
				"DEVHOST_BIND_HOST":        "127.0.0.1",
				"DEVHOST_MANIFEST_PATH":    "/tmp/project/devhost.toml",
				"DEVHOST_SERVICE_NAME":     "web",
				"DEVHOST_PORT_WEB":         "3200",
				"DEVHOST_PORT_POSTGRES_DB": "3200",
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := CreateInjectedServiceEnvironment(tt.manifest, tt.service)
			if !mapsEqual(got, tt.want) {
				t.Fatalf("CreateInjectedServiceEnvironment(...) = %#v, want %#v", got, tt.want)
			}
		})
	}
}

func TestWriteLogLinePrefixBehavior(t *testing.T) {
	t.Parallel()

	t.Run("uses manifest label when present", func(t *testing.T) {
		t.Parallel()

		var output strings.Builder
		writeLogLine(&output, "hello-stack", "ready")

		if output.String() != "[hello-stack] ready\n" {
			t.Fatalf("writeLogLine(...) = %q, want %q", output.String(), "[hello-stack] ready\n")
		}
	})

	t.Run("falls back to devhost label before manifest name exists", func(t *testing.T) {
		t.Parallel()

		var output strings.Builder
		writeLogLine(&output, "", "ready")

		if output.String() != "[devhost] ready\n" {
			t.Fatalf("writeLogLine(...) = %q, want %q", output.String(), "[devhost] ready\n")
		}
	})
}

func TestLogServiceURLs(t *testing.T) {
	t.Parallel()

	t.Run("prints each service URL in manifest order", func(t *testing.T) {
		t.Parallel()

		manifestValue := ResolvedManifest{
			Caddy:          manifest.CaddyConfig{Global: manifest.CaddyGlobalConfig{HTTPSPort: 443}},
			Name:           "hello-stack",
			PrimaryService: "web",
			ServiceOrder:   []string{"api", "web", "worker"},
			Services: map[string]ResolvedService{
				"api": {
					BindHost: "127.0.0.1",
					Hosts:    []string{"api.hello.localhost"},
					Name:     "api",
					Path:     stringPointer("/v1/*"),
					Port:     intPointer(4000),
				},
				"web": {
					BindHost: "127.0.0.1",
					Hosts:    []string{"hello.localhost"},
					Name:     "web",
					Path:     stringPointer("/"),
					Port:     intPointer(3000),
				},
				"worker": {
					BindHost: "127.0.0.1",
					Name:     "worker",
					Port:     intPointer(3200),
				},
			},
		}

		var output strings.Builder
		LogServiceURLs(manifestValue, &output)

		if output.String() != strings.Join([]string{
			"[hello-stack] api: https://api.hello.localhost/v1/",
			"[hello-stack] web (primary): https://hello.localhost",
			"[hello-stack] worker: http://127.0.0.1:3200",
			"",
		}, "\n") {
			t.Fatalf("LogServiceURLs(...) = %q", output.String())
		}
	})
}

func TestCollectServicesHealthIncludesUnmanagedServices(t *testing.T) {
	t.Parallel()

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("Listen(...) error = %v", err)
	}
	defer listener.Close()

	tcpAddress, ok := listener.Addr().(*net.TCPAddr)
	if !ok {
		t.Fatalf("listener.Addr() = %T, want *net.TCPAddr", listener.Addr())
	}

	port := tcpAddress.Port
	manifestValue := ResolvedManifest{
		Caddy:        manifest.CaddyConfig{Global: manifest.CaddyGlobalConfig{HTTPSPort: 443}},
		ServiceOrder: []string{"managed", "external"},
		Services: map[string]ResolvedService{
			"managed": {
				BindHost: "127.0.0.1",
				Health:   ResolvedHealthConfig{Host: stringPointer("127.0.0.1"), Kind: "tcp", Port: intPointer(port), Timeout: 500},
				Managed:  true,
				Name:     "managed",
				Port:     intPointer(port),
			},
			"external": {
				BindHost: "127.0.0.1",
				Health:   ResolvedHealthConfig{Host: stringPointer("127.0.0.1"), Kind: "tcp", Port: intPointer(port), Timeout: 500},
				Managed:  false,
				Name:     "external",
				Port:     intPointer(port),
			},
		},
	}

	health := collectServicesHealth(manifestValue, nil, nil)
	if len(health.Services) != 2 {
		t.Fatalf("health.Services length = %d, want 2", len(health.Services))
	}
	if health.Services[0].Managed != true || health.Services[0].Name != "managed" || health.Services[0].Status {
		t.Fatalf("managed service health = %#v, want managed unhealthy without started process", health.Services[0])
	}
	if health.Services[1].Managed != false || health.Services[1].Name != "external" || !health.Services[1].Status {
		t.Fatalf("external service health = %#v, want unmanaged healthy tcp status", health.Services[1])
	}
}

func TestStartStackKeepsStartupCrashUntilExplicitShutdown(t *testing.T) {
	for _, tc := range []struct {
		name             string
		worktreesEnabled bool
		inRepository     bool
	}{
		{"default", false, false},
		{"worktrees-enabled", true, false},
		{"worktrees-enabled-repository", true, true},
	} {
		t.Run(tc.name, func(t *testing.T) { testStartupCrashRecovery(t, tc.worktreesEnabled, tc.inRepository) })
	}
}

func testStartupCrashRecovery(t *testing.T, worktreesEnabled, inRepository bool) {
	t.Helper()
	stateDirectoryPath := t.TempDir()
	paths := caddy.CreateManagedCaddyPaths(stateDirectoryPath)
	adminAddress := caddytest.StartAdminServer(t)
	writeFakeCaddyExecutable(t, paths.ExecutablePath)

	projectRoot := t.TempDir()
	serviceCwd := projectRoot
	if inRepository {
		projectRoot, _ = createWorktreeRepository(t)
		serviceCwd = filepath.Join(projectRoot, "web")
	}
	servicePort := nettest.ReservePort(t)
	manifestValue := newResolvedManifest(projectRoot, adminAddress)
	manifestValue.Worktrees.Enabled = worktreesEnabled
	manifestValue.Devtools.Status.Enabled = true
	manifestValue.PrimaryService = "web"
	manifestValue.Services["web"] = ResolvedService{
		BindHost:  "127.0.0.1",
		Command:   helperCommand(),
		Cwd:       serviceCwd,
		DependsOn: []string{},
		Env: map[string]string{
			"GO_WANT_HELPER_PROCESS": "1",
			"DEVHOST_HELPER_MODE":    "exit-1",
		},
		Health:     ResolvedHealthConfig{Host: stringPointer("127.0.0.1"), Interval: 50, Kind: "tcp", Port: intPointer(servicePort), Retries: 0, Timeout: 200},
		Hosts:      []string{"cleanup.localhost"},
		InjectPort: true,
		Name:       "web",
		Path:       stringPointer("/"),
		Port:       intPointer(servicePort),
		PortSource: "fixed",
	}

	repository, err := discoverGitRepository(serviceCwd)
	if err != nil {
		t.Fatal(err)
	}
	wantGroupFailure := worktreesEnabled && repository.root != ""
	originalStart, originalRegister, originalUnregister := startDevtoolsControlServer, registerProcessSignals, unregisterProcessSignals
	defer func() {
		startDevtoolsControlServer, registerProcessSignals, unregisterProcessSignals = originalStart, originalRegister, originalUnregister
	}()
	controls := make(chan devtools.StartControlServerOptions, 1)
	signals := make(chan chan<- os.Signal, 1)
	startDevtoolsControlServer = func(options devtools.StartControlServerOptions) (*devtools.ControlServer, error) {
		server, err := devtools.StartControlServer(options)
		if err == nil {
			controls <- options
		}
		return server, err
	}
	registerProcessSignals = func(ch chan<- os.Signal) { signals <- ch }
	unregisterProcessSignals = func(chan<- os.Signal) {}
	type startupResult struct {
		exitCode int
		err      error
	}
	done := make(chan startupResult, 1)
	options := StartStackOptions{
		CaddyPaths:          paths,
		Environment:         map[string]string{"DEVHOST_STATE_DIR": stateDirectoryPath},
		LogWriter:           io.Discard,
		ServiceStdoutWriter: io.Discard,
		ServiceStderrWriter: io.Discard,
		ShutdownGracePeriod: 100 * time.Millisecond,
	}
	go func() {
		code, err := StartStack(&manifestValue, []string{"web"}, options)
		done <- startupResult{code, err}
	}()
	var signalChannel chan<- os.Signal
	select {
	case signalChannel = <-signals:
	case result := <-done:
		t.Fatalf("stack exited before registering signals: %#v", result)
	}
	stopped := false
	stop := func() {
		if stopped {
			return
		}
		stopped = true
		signalChannel <- syscall.SIGTERM
		select {
		case result := <-done:
			if result.err != nil || result.exitCode != 143 {
				t.Errorf("StartStack(...) = (%d, %v), want explicit SIGTERM shutdown", result.exitCode, result.err)
			}
		case <-time.After(5 * time.Second):
			t.Error("stack did not shut down after SIGTERM")
		}
	}
	defer stop()
	var control devtools.StartControlServerOptions
	select {
	case control = <-controls:
	case result := <-done:
		stopped = true
		t.Fatalf("stack exited before starting devtools: %#v", result)
	}
	// Recovery is observable in health, independently of whether Git groups this cwd.
	// A startup failure must leave the supervisor alive until we explicitly signal it.
	waitForCondition(t, 5*time.Second, func() bool {
		if control.RestartService(nil) != nil {
			return false
		}
		health, err := control.GetHealthResponse()
		if err != nil || len(health.Services) != 1 || health.Services[0].Status || health.Services[0].Restarting {
			return false
		}
		if wantGroupFailure {
			return len(health.Repositories) == 1 && !health.Repositories[0].Switching && health.Repositories[0].RunningPath == "" && strings.Contains(health.Repositories[0].Error, "code 1")
		}
		return len(health.Repositories) == 0 && health.Services[0].ExitCode != nil && *health.Services[0].ExitCode == 1
	})
	select {
	case result := <-done:
		stopped = true
		t.Fatalf("stack exited after startup crash without a shutdown signal: %#v", result)
	default:
	}
	stop()

	assertDirectoryEntries(t, paths.HostClaimsDirectoryPath, nil)
	assertDirectoryEntries(t, paths.PortClaimsDirectoryPath, nil)
	assertDirectoryEntries(t, paths.RegistrationsDirectoryPath, nil)
	assertRouteDirectoryEmpty(t, paths.RoutesDirectoryPath)
}

func TestStartStackHealthTimeoutReleasesClaimsOnIdleShutdown(t *testing.T) {
	statePath := t.TempDir()
	paths := caddy.CreateManagedCaddyPaths(statePath)
	admin := caddytest.StartAdminServer(t)
	// Releasing the claims reloads Caddy. Without this the reload runs whatever caddy is on PATH, or fails where
	// none is installed.
	writeFakeCaddyExecutable(t, paths.ExecutablePath)
	m := newResolvedManifest(t.TempDir(), admin)
	port := nettest.ReservePort(t)
	m.Services["web"] = ResolvedService{
		Name: "web", BindHost: "127.0.0.1", Cwd: t.TempDir(), Command: helperCommandWithMode("graceful-signal-waiter"),
		Env:    map[string]string{"GO_WANT_HELPER_PROCESS": "1", "STOP_TRACE_PATH": filepath.Join(t.TempDir(), "stopped"), "STOP_TRACE_VALUE": "stopped"},
		Health: ResolvedHealthConfig{Kind: "tcp", Host: stringPointer("127.0.0.1"), Port: intPointer(port), Interval: 10, Timeout: 100},
		Port:   intPointer(port), PortSource: "fixed", Hosts: []string{"timeout.localhost"},
	}
	var logs strings.Builder
	_, err := StartStack(&m, []string{"web"}, StartStackOptions{CaddyPaths: paths, Environment: map[string]string{"DEVHOST_STATE_DIR": statePath}, LogWriter: &logs, ServiceStdoutWriter: ioDiscard{}, ServiceStderrWriter: ioDiscard{}, ShutdownGracePeriod: 100 * time.Millisecond, IdleTimeout: 10 * time.Millisecond})
	if err != nil || !strings.Contains(logs.String(), "Service web did not pass its health check within 100ms.") {
		t.Fatalf("shutdown error = %v, logs = %s", err, logs.String())
	}
	assertDirectoryEntries(t, paths.HostClaimsDirectoryPath, nil)
	assertDirectoryEntries(t, paths.PortClaimsDirectoryPath, nil)
	assertRouteDirectoryEmpty(t, paths.RoutesDirectoryPath)
}

func TestStartStackRetriesAutoPortAndPrefixesOutput(t *testing.T) {
	stateDirectoryPath := t.TempDir()
	paths := caddy.CreateManagedCaddyPaths(stateDirectoryPath)
	adminAddress := caddytest.StartAdminServer(t)

	initialPort := nettest.ReservePort(t)
	tracePath := filepath.Join(t.TempDir(), "assigned-port.txt")
	var infoLog strings.Builder
	var stderrLog strings.Builder

	manifestValue := newResolvedManifest(t.TempDir(), adminAddress)
	manifestValue.Name = "retry-stack"
	manifestValue.PrimaryService = "web"
	manifestValue.Services["web"] = ResolvedService{
		BindHost:  "127.0.0.1",
		Command:   helperCommand(),
		Cwd:       t.TempDir(),
		DependsOn: []string{},
		Env: map[string]string{
			"GO_WANT_HELPER_PROCESS": "1",
			"DEVHOST_HELPER_MODE":    "auto-port-retry-server",
			"INITIAL_PORT":           strconv.Itoa(initialPort),
			"PORT_TRACE_PATH":        tracePath,
		},
		Health:     ResolvedHealthConfig{Host: stringPointer("127.0.0.1"), Interval: 50, Kind: "tcp", Port: intPointer(initialPort), Retries: 0, Timeout: 5000},
		InjectPort: true,
		Name:       "web",
		Port:       intPointer(initialPort),
		PortSource: "auto",
	}

	exitCode, err := startStackUntilServiceExit(t, &manifestValue, []string{"web"}, StartStackOptions{
		CaddyPaths:          paths,
		Environment:         map[string]string{"DEVHOST_STATE_DIR": stateDirectoryPath},
		LogWriter:           &infoLog,
		ServiceStdoutWriter: ioDiscard{},
		ServiceStderrWriter: &stderrLog,
		ShutdownGracePeriod: 100 * time.Millisecond,
	})
	if err != nil {
		t.Fatalf("StartStack(...) error = %v", err)
	}

	if exitCode != 143 {
		t.Fatalf("StartStack(...) exit code = %d, want 143", exitCode)
	}

	finalPort := manifestValue.Services["web"].Port
	if finalPort == nil || *finalPort == initialPort {
		t.Fatalf("final auto port = %v, want reassigned port", finalPort)
	}

	assignedPortText, err := os.ReadFile(tracePath)
	if err != nil {
		t.Fatalf("ReadFile(...) error = %v", err)
	}
	if strings.TrimSpace(string(assignedPortText)) != strconv.Itoa(*finalPort) {
		t.Fatalf("assigned port = %q, want %d", strings.TrimSpace(string(assignedPortText)), *finalPort)
	}

	if strings.TrimSpace(stderrLog.String()) != fmt.Sprintf("[web] listen EADDRINUSE: address already in use 127.0.0.1:%d", initialPort) {
		t.Fatalf("stderr = %q", stderrLog.String())
	}

	infoLines := nonEmptyLines(infoLog.String())
	wantInfo := []string{
		"[retry-stack] retrying web with a new auto port after a bind collision.",
		fmt.Sprintf("[retry-stack] web (primary): http://127.0.0.1:%d", *finalPort),
		"[retry-stack] web exited with code 0; devhost is waiting for a restart.",
		"[retry-stack] Stopping service web...",
		"[retry-stack] Stopped service web.",
		"[retry-stack] Stack stopped.",
	}
	if !stringSlicesEqual(infoLines, wantInfo) {
		t.Fatalf("info lines = %#v, want %#v", infoLines, wantInfo)
	}
}

func TestStartStackVerifiesManagedCaddyAdminBeforeServiceStartup(t *testing.T) {
	stateDirectoryPath := t.TempDir()
	paths := caddy.CreateManagedCaddyPaths(stateDirectoryPath)
	tracePath := filepath.Join(t.TempDir(), "service-start.txt")

	manifestValue := newResolvedManifest(t.TempDir(), caddytest.UnusedAdminAddress(t))
	manifestValue.PrimaryService = "web"
	manifestValue.Services["web"] = ResolvedService{
		BindHost:  "127.0.0.1",
		Command:   helperCommand(),
		Cwd:       t.TempDir(),
		DependsOn: []string{},
		Env: map[string]string{
			"GO_WANT_HELPER_PROCESS": "1",
			"DEVHOST_HELPER_MODE":    "record-start-and-wait",
			"START_TRACE_PATH":       tracePath,
			"START_TRACE_VALUE":      "web-started",
			"STOP_TRACE_PATH":        filepath.Join(t.TempDir(), "stop.txt"),
			"STOP_TRACE_VALUE":       "web-stopped",
		},
		Health:     ResolvedHealthConfig{Kind: "process"},
		InjectPort: true,
		Name:       "web",
	}

	_, err := StartStack(&manifestValue, []string{"web"}, StartStackOptions{
		CaddyPaths:          paths,
		Environment:         map[string]string{"DEVHOST_STATE_DIR": stateDirectoryPath},
		LogWriter:           ioDiscard{},
		ServiceStdoutWriter: ioDiscard{},
		ServiceStderrWriter: ioDiscard{},
		ShutdownGracePeriod: 100 * time.Millisecond,
	})
	if err == nil || !strings.Contains(err.Error(), "Caddy admin API is not available. Run 'devhost caddy start' first.") {
		t.Fatalf("StartStack(...) error = %v, want admin availability failure", err)
	}

	if _, statError := os.Stat(tracePath); !os.IsNotExist(statError) {
		t.Fatalf("service start trace stat = %v, want os.ErrNotExist", statError)
	}
}

func TestStartStackStartsServicesInDependencyOrderAndStopsOnSignalAfterChildExit(t *testing.T) {
	stateDirectoryPath := t.TempDir()
	paths := caddy.CreateManagedCaddyPaths(stateDirectoryPath)
	adminAddress := caddytest.StartAdminServer(t)

	startTracePath := filepath.Join(t.TempDir(), "start-order.txt")
	stopTracePath := filepath.Join(t.TempDir(), "stop-order.txt")
	ports := nettest.ReservePorts(t, 2)
	apiPort, webPort := ports[0], ports[1]

	orderManifest := manifest.Manifest{
		ServiceOrder: []string{"web", "api"},
		Services: map[string]manifest.ValidatedService{
			"api": {DependsOn: []string{}},
			"web": {DependsOn: []string{"api"}},
		},
	}
	serviceOrder, err := ResolveServiceOrder(orderManifest)
	if err != nil {
		t.Fatalf("ResolveServiceOrder(...) error = %v", err)
	}
	if !stringSlicesEqual(serviceOrder, []string{"api", "web"}) {
		t.Fatalf("ResolveServiceOrder(...) = %#v, want dependency-first order", serviceOrder)
	}

	manifestValue := newResolvedManifest(t.TempDir(), adminAddress)
	manifestValue.Name = "order-stack"
	manifestValue.PrimaryService = "web"
	manifestValue.Services["api"] = ResolvedService{
		BindHost:  "127.0.0.1",
		Command:   helperCommand(),
		Cwd:       t.TempDir(),
		DependsOn: []string{},
		Env: map[string]string{
			"GO_WANT_HELPER_PROCESS": "1",
			"DEVHOST_HELPER_MODE":    "record-start-serve-and-exit",
			"START_TRACE_PATH":       startTracePath,
			"START_TRACE_VALUE":      "api-start",
			"WAIT_TRACE_VALUE":       "web-start",
		},
		Health:     ResolvedHealthConfig{Host: stringPointer("127.0.0.1"), Interval: 50, Kind: "tcp", Port: intPointer(apiPort), Retries: 0, Timeout: 5000},
		InjectPort: true,
		Name:       "api",
		Port:       intPointer(apiPort),
		PortSource: "fixed",
	}
	manifestValue.Services["web"] = ResolvedService{
		BindHost:  "127.0.0.1",
		Command:   helperCommand(),
		Cwd:       t.TempDir(),
		DependsOn: []string{"api"},
		Env: map[string]string{
			"GO_WANT_HELPER_PROCESS": "1",
			"DEVHOST_HELPER_MODE":    "record-start-and-wait",
			"START_TRACE_PATH":       startTracePath,
			"START_TRACE_VALUE":      "web-start",
			"STOP_TRACE_PATH":        stopTracePath,
			"STOP_TRACE_VALUE":       "web-stop",
		},
		Health:     ResolvedHealthConfig{Kind: "process"},
		InjectPort: true,
		Name:       "web",
		Port:       intPointer(webPort),
		PortSource: "fixed",
	}

	exitCode, err := startStackUntilServiceExit(t, &manifestValue, serviceOrder, StartStackOptions{
		CaddyPaths:          paths,
		Environment:         map[string]string{"DEVHOST_STATE_DIR": stateDirectoryPath},
		LogWriter:           ioDiscard{},
		ServiceStdoutWriter: ioDiscard{},
		ServiceStderrWriter: ioDiscard{},
		ShutdownGracePeriod: 100 * time.Millisecond,
	})
	if err != nil {
		t.Fatalf("StartStack(...) error = %v", err)
	}
	if exitCode != 143 {
		t.Fatalf("StartStack(...) exit code = %d, want 143", exitCode)
	}

	startTrace, readError := os.ReadFile(startTracePath)
	if readError != nil {
		t.Fatalf("ReadFile(start trace) error = %v", readError)
	}
	if !stringSlicesEqual(nonEmptyLines(string(startTrace)), []string{"api-start", "web-start"}) {
		t.Fatalf("start trace = %#v, want api then web", nonEmptyLines(string(startTrace)))
	}

	stopTrace, readError := os.ReadFile(stopTracePath)
	if readError != nil {
		t.Fatalf("ReadFile(stop trace) error = %v", readError)
	}
	if !stringSlicesEqual(nonEmptyLines(string(stopTrace)), []string{"web-stop"}) {
		t.Fatalf("stop trace = %#v, want only web cleanup after first child exit", nonEmptyLines(string(stopTrace)))
	}
}

func TestStartStackActivatesRoutesAndCleansUpAfterShutdown(t *testing.T) {
	stateDirectoryPath := t.TempDir()
	paths := caddy.CreateManagedCaddyPaths(stateDirectoryPath)
	adminAddress := caddytest.StartAdminServer(t)
	writeFakeCaddyExecutable(t, paths.ExecutablePath)

	servicePort := nettest.ReservePort(t)
	tracePath := filepath.Join(t.TempDir(), "service-trace.txt")
	var infoLog strings.Builder

	manifestValue := newResolvedManifest(t.TempDir(), adminAddress)
	manifestValue.Name = "route-stack"
	manifestValue.PrimaryService = "web"
	manifestValue.Services["web"] = ResolvedService{
		BindHost:  "127.0.0.1",
		Command:   helperCommand(),
		Cwd:       t.TempDir(),
		DependsOn: []string{},
		Env: map[string]string{
			"GO_WANT_HELPER_PROCESS":       "1",
			"DEVHOST_HELPER_MODE":          "route-aware-http-server",
			"TRACE_PATH":                   tracePath,
			"HOST_CLAIMS_DIRECTORY_PATH":   paths.HostClaimsDirectoryPath,
			"PORT_CLAIMS_DIRECTORY_PATH":   paths.PortClaimsDirectoryPath,
			"REGISTRATIONS_DIRECTORY_PATH": paths.RegistrationsDirectoryPath,
		},
		Health:     ResolvedHealthConfig{Host: stringPointer("127.0.0.1"), Interval: 50, Kind: "tcp", Port: intPointer(servicePort), Retries: 0, Timeout: 5000},
		Hosts:      []string{"hello.localhost"},
		InjectPort: true,
		Name:       "web",
		Path:       stringPointer("/"),
		Port:       intPointer(servicePort),
		PortSource: "fixed",
	}

	exitCode, err := startStackUntilServiceExit(t, &manifestValue, []string{"web"}, StartStackOptions{
		CaddyPaths:          paths,
		Environment:         map[string]string{"DEVHOST_STATE_DIR": stateDirectoryPath},
		LogWriter:           &infoLog,
		ServiceStdoutWriter: ioDiscard{},
		ServiceStderrWriter: ioDiscard{},
		ShutdownGracePeriod: 100 * time.Millisecond,
	})
	if err != nil {
		t.Fatalf("StartStack(...) error = %v", err)
	}
	if exitCode != 143 {
		t.Fatalf("StartStack(...) exit code = %d, want 143", exitCode)
	}

	traceText, err := os.ReadFile(tracePath)
	if err != nil {
		t.Fatalf("ReadFile(...) error = %v", err)
	}
	trace := strings.TrimSpace(string(traceText))
	if trace != strings.Join([]string{
		"claims-ok",
		"route-ok",
		"DEVHOST_BIND_HOST=127.0.0.1",
		"DEVHOST_HOST=hello.localhost",
		"DEVHOST_PATH=/",
		fmt.Sprintf("DEVHOST_MANIFEST_PATH=%s", manifestValue.ManifestPath),
		"DEVHOST_SERVICE_NAME=web",
		fmt.Sprintf("PORT=%d", servicePort),
	}, "\n") {
		t.Fatalf("trace = %q", trace)
	}

	wantInfo := []string{
		"[route-stack] web (primary): https://hello.localhost",
		"[route-stack] web exited with code 0; devhost is waiting for a restart.",
		"[route-stack] Stopping service web...",
		"[route-stack] Stopped service web.",
		"[route-stack] Stack stopped.",
	}
	if lines := nonEmptyLines(infoLog.String()); !stringSlicesEqual(lines, wantInfo) {
		t.Fatalf("info lines = %#v", lines)
	}

	assertDirectoryEntries(t, paths.HostClaimsDirectoryPath, nil)
	assertDirectoryEntries(t, paths.PortClaimsDirectoryPath, nil)
	assertDirectoryEntries(t, paths.RegistrationsDirectoryPath, nil)
	assertRouteDirectoryEmpty(t, paths.RoutesDirectoryPath)
}

func TestStartStackActivatesDevtoolsRoutesForRootCompatibleServices(t *testing.T) {
	stateDirectoryPath := t.TempDir()
	paths := caddy.CreateManagedCaddyPaths(stateDirectoryPath)
	adminAddress := caddytest.StartAdminServer(t)
	writeFakeCaddyExecutable(t, paths.ExecutablePath)

	servicePort := nettest.ReservePort(t)
	tracePath := filepath.Join(t.TempDir(), "devtools-root-trace.txt")

	manifestValue := newResolvedManifest(t.TempDir(), adminAddress)
	manifestValue.Name = "devtools-root-stack"
	manifestValue.PrimaryService = "web"
	manifestValue.Devtools.Minimap.Enabled = true
	manifestValue.Devtools.Status.Enabled = true
	manifestValue.Services["web"] = ResolvedService{
		BindHost:  "127.0.0.1",
		Command:   helperCommand(),
		Cwd:       t.TempDir(),
		DependsOn: []string{},
		Env: map[string]string{
			"GO_WANT_HELPER_PROCESS":       "1",
			"DEVHOST_HELPER_MODE":          "route-aware-http-server",
			"EXPECT_DEVTOOLS_ROUTE_PORTS":  "1",
			"TRACE_PATH":                   tracePath,
			"HOST_CLAIMS_DIRECTORY_PATH":   paths.HostClaimsDirectoryPath,
			"PORT_CLAIMS_DIRECTORY_PATH":   paths.PortClaimsDirectoryPath,
			"REGISTRATIONS_DIRECTORY_PATH": paths.RegistrationsDirectoryPath,
		},
		Health:     ResolvedHealthConfig{Host: stringPointer("127.0.0.1"), Interval: 50, Kind: "tcp", Port: intPointer(servicePort), Retries: 0, Timeout: 5000},
		Hosts:      []string{"devtools-root.localhost"},
		InjectPort: true,
		Name:       "web",
		Path:       stringPointer("/"),
		Port:       intPointer(servicePort),
		PortSource: "fixed",
	}

	exitCode, err := startStackUntilServiceExit(t, &manifestValue, []string{"web"}, StartStackOptions{
		CaddyPaths:          paths,
		Environment:         map[string]string{"DEVHOST_STATE_DIR": stateDirectoryPath},
		LogWriter:           ioDiscard{},
		ServiceStdoutWriter: ioDiscard{},
		ServiceStderrWriter: ioDiscard{},
		ShutdownGracePeriod: 100 * time.Millisecond,
	})
	if err != nil {
		t.Fatalf("StartStack(...) error = %v", err)
	}
	if exitCode != 143 {
		t.Fatalf("StartStack(...) exit code = %d, want 143", exitCode)
	}

	traceText, err := os.ReadFile(tracePath)
	if err != nil {
		t.Fatalf("ReadFile(...) error = %v", err)
	}
	if !contains(nonEmptyLines(string(traceText)), "devtools-route-ok") {
		t.Fatalf("trace = %#v, want devtools-route-ok", nonEmptyLines(string(traceText)))
	}
}

func TestStartStackSkipsDocumentInjectionForNonRootRoutes(t *testing.T) {
	stateDirectoryPath := t.TempDir()
	paths := caddy.CreateManagedCaddyPaths(stateDirectoryPath)
	adminAddress := caddytest.StartAdminServer(t)
	writeFakeCaddyExecutable(t, paths.ExecutablePath)

	servicePort := nettest.ReservePort(t)
	tracePath := filepath.Join(t.TempDir(), "devtools-non-root-trace.txt")

	manifestValue := newResolvedManifest(t.TempDir(), adminAddress)
	manifestValue.Name = "devtools-non-root-stack"
	manifestValue.PrimaryService = "web"
	manifestValue.Devtools.Status.Enabled = true
	manifestValue.Services["web"] = ResolvedService{
		BindHost:  "127.0.0.1",
		Command:   helperCommand(),
		Cwd:       t.TempDir(),
		DependsOn: []string{},
		Env: map[string]string{
			"GO_WANT_HELPER_PROCESS":         "1",
			"DEVHOST_HELPER_MODE":            "route-aware-http-server",
			"EXPECT_NO_DEVTOOLS_ROUTE_PORTS": "1",
			"TRACE_PATH":                     tracePath,
			"HOST_CLAIMS_DIRECTORY_PATH":     paths.HostClaimsDirectoryPath,
			"PORT_CLAIMS_DIRECTORY_PATH":     paths.PortClaimsDirectoryPath,
			"REGISTRATIONS_DIRECTORY_PATH":   paths.RegistrationsDirectoryPath,
		},
		Health:     ResolvedHealthConfig{Host: stringPointer("127.0.0.1"), Interval: 50, Kind: "tcp", Port: intPointer(servicePort), Retries: 0, Timeout: 5000},
		Hosts:      []string{"devtools-path.localhost"},
		InjectPort: true,
		Name:       "web",
		Path:       stringPointer("/app/*"),
		Port:       intPointer(servicePort),
		PortSource: "fixed",
	}

	exitCode, err := startStackUntilServiceExit(t, &manifestValue, []string{"web"}, StartStackOptions{
		CaddyPaths:          paths,
		Environment:         map[string]string{"DEVHOST_STATE_DIR": stateDirectoryPath},
		LogWriter:           ioDiscard{},
		ServiceStdoutWriter: ioDiscard{},
		ServiceStderrWriter: ioDiscard{},
		ShutdownGracePeriod: 100 * time.Millisecond,
	})
	if err != nil {
		t.Fatalf("StartStack(...) error = %v", err)
	}
	if exitCode != 143 {
		t.Fatalf("StartStack(...) exit code = %d, want 143", exitCode)
	}

	traceText, err := os.ReadFile(tracePath)
	if err != nil {
		t.Fatalf("ReadFile(...) error = %v", err)
	}
	if !contains(nonEmptyLines(string(traceText)), "devtools-route-missing") {
		t.Fatalf("trace = %#v, want devtools-route-missing", nonEmptyLines(string(traceText)))
	}
}

func TestStartStackLeavesDevtoolsRoutesUnmountedWhenAllFeaturesAreDisabled(t *testing.T) {
	stateDirectoryPath := t.TempDir()
	paths := caddy.CreateManagedCaddyPaths(stateDirectoryPath)
	adminAddress := caddytest.StartAdminServer(t)
	writeFakeCaddyExecutable(t, paths.ExecutablePath)

	servicePort := nettest.ReservePort(t)
	tracePath := filepath.Join(t.TempDir(), "devtools-disabled-trace.txt")

	manifestValue := newResolvedManifest(t.TempDir(), adminAddress)
	manifestValue.Name = "devtools-disabled-stack"
	manifestValue.PrimaryService = "web"
	manifestValue.Devtools.Editor.Enabled = false
	manifestValue.Devtools.ExternalToolbars.Enabled = false
	manifestValue.Devtools.Minimap.Enabled = false
	manifestValue.Devtools.Status.Enabled = false
	manifestValue.Services["web"] = ResolvedService{
		BindHost:  "127.0.0.1",
		Command:   helperCommand(),
		Cwd:       t.TempDir(),
		DependsOn: []string{},
		Env: map[string]string{
			"GO_WANT_HELPER_PROCESS":         "1",
			"DEVHOST_HELPER_MODE":            "route-aware-http-server",
			"EXPECT_NO_DEVTOOLS_ROUTE_PORTS": "1",
			"TRACE_PATH":                     tracePath,
			"HOST_CLAIMS_DIRECTORY_PATH":     paths.HostClaimsDirectoryPath,
			"PORT_CLAIMS_DIRECTORY_PATH":     paths.PortClaimsDirectoryPath,
			"REGISTRATIONS_DIRECTORY_PATH":   paths.RegistrationsDirectoryPath,
		},
		Health:     ResolvedHealthConfig{Host: stringPointer("127.0.0.1"), Interval: 50, Kind: "tcp", Port: intPointer(servicePort), Retries: 0, Timeout: 5000},
		Hosts:      []string{"devtools-disabled.localhost"},
		InjectPort: true,
		Name:       "web",
		Path:       stringPointer("/"),
		Port:       intPointer(servicePort),
		PortSource: "fixed",
	}

	exitCode, err := startStackUntilServiceExit(t, &manifestValue, []string{"web"}, StartStackOptions{
		CaddyPaths:          paths,
		Environment:         map[string]string{"DEVHOST_STATE_DIR": stateDirectoryPath},
		LogWriter:           ioDiscard{},
		ServiceStdoutWriter: ioDiscard{},
		ServiceStderrWriter: ioDiscard{},
		ShutdownGracePeriod: 100 * time.Millisecond,
	})
	if err != nil {
		t.Fatalf("StartStack(...) error = %v", err)
	}
	if exitCode != 143 {
		t.Fatalf("StartStack(...) exit code = %d, want 143", exitCode)
	}

	traceText, err := os.ReadFile(tracePath)
	if err != nil {
		t.Fatalf("ReadFile(...) error = %v", err)
	}
	if !contains(nonEmptyLines(string(traceText)), "devtools-route-missing") {
		t.Fatalf("trace = %#v, want devtools-route-missing", nonEmptyLines(string(traceText)))
	}
}

func TestStartStackStopsDevtoolsServersDuringCleanup(t *testing.T) {
	stateDirectoryPath := t.TempDir()
	paths := caddy.CreateManagedCaddyPaths(stateDirectoryPath)
	adminAddress := caddytest.StartAdminServer(t)
	writeFakeCaddyExecutable(t, paths.ExecutablePath)

	originalStartControlServer := startDevtoolsControlServer
	originalStartDocumentInjectionServer := startDocumentInjectionServer
	defer func() {
		startDevtoolsControlServer = originalStartControlServer
		startDocumentInjectionServer = originalStartDocumentInjectionServer
	}()

	controlPort := 0
	documentPort := 0
	startDevtoolsControlServer = func(options devtools.StartControlServerOptions) (*devtools.ControlServer, error) {
		server, err := devtools.StartControlServer(options)
		if err == nil {
			controlPort = server.Port()
		}
		return server, err
	}
	startDocumentInjectionServer = func(options devtools.StartDocumentInjectionServerOptions) (*devtools.DocumentInjectionServer, error) {
		server, err := devtools.StartDocumentInjectionServer(options)
		if err == nil {
			documentPort = server.Port()
		}
		return server, err
	}

	servicePort := nettest.ReservePort(t)
	manifestValue := newResolvedManifest(t.TempDir(), adminAddress)
	manifestValue.Name = "cleanup-devtools-stack"
	manifestValue.PrimaryService = "web"
	manifestValue.Devtools.Minimap.Enabled = true
	manifestValue.Devtools.Status.Enabled = true
	manifestValue.Services["web"] = ResolvedService{
		BindHost:  "127.0.0.1",
		Command:   helperCommand(),
		Cwd:       t.TempDir(),
		DependsOn: []string{},
		Env: map[string]string{
			"GO_WANT_HELPER_PROCESS": "1",
			"DEVHOST_HELPER_MODE":    "serve-until-health-probe-and-exit",
		},
		Health:     ResolvedHealthConfig{Host: stringPointer("127.0.0.1"), Interval: 50, Kind: "tcp", Port: intPointer(servicePort), Retries: 0, Timeout: 5000},
		Hosts:      []string{"cleanup-devtools.localhost"},
		InjectPort: true,
		Name:       "web",
		Path:       stringPointer("/"),
		Port:       intPointer(servicePort),
		PortSource: "fixed",
	}

	exitCode, err := startStackUntilServiceExit(t, &manifestValue, []string{"web"}, StartStackOptions{
		CaddyPaths:          paths,
		Environment:         map[string]string{"DEVHOST_STATE_DIR": stateDirectoryPath},
		LogWriter:           ioDiscard{},
		ServiceStdoutWriter: ioDiscard{},
		ServiceStderrWriter: ioDiscard{},
		ShutdownGracePeriod: 100 * time.Millisecond,
	})
	if err != nil {
		t.Fatalf("StartStack(...) error = %v", err)
	}
	if exitCode != 143 {
		t.Fatalf("StartStack(...) exit code = %d, want 143", exitCode)
	}
	if controlPort == 0 {
		t.Fatal("control port = 0, want started devtools control server")
	}
	if documentPort == 0 {
		t.Fatal("document injection port = 0, want started document injection server")
	}

	waitForCondition(t, time.Second, func() bool {
		_, err := http.Get(serverURL(controlPort, "/__devhost__/inject.js"))
		return err != nil
	})
	if response, err := http.Get(serverURL(controlPort, "/__devhost__/inject.js")); err == nil {
		defer response.Body.Close()
		t.Fatalf("control server request unexpectedly succeeded with status %d", response.StatusCode)
	}

	waitForCondition(t, time.Second, func() bool {
		_, err := http.Get(serverURL(documentPort, "/"))
		return err != nil
	})
	if response, err := http.Get(serverURL(documentPort, "/")); err == nil {
		defer response.Body.Close()
		t.Fatalf("document injection server request unexpectedly succeeded with status %d", response.StatusCode)
	}
}

func TestStartStackRestartServiceDoesNotStallOnRedundantHealthLoop(t *testing.T) {
	stateDirectoryPath := t.TempDir()
	paths := caddy.CreateManagedCaddyPaths(stateDirectoryPath)
	adminAddress := caddytest.StartAdminServer(t)
	writeFakeCaddyExecutable(t, paths.ExecutablePath)

	originalStartControlServer := startDevtoolsControlServer
	originalStartDocumentInjectionServer := startDocumentInjectionServer
	originalRegisterProcessSignals := registerProcessSignals
	originalUnregisterProcessSignals := unregisterProcessSignals
	originalServiceSignalSender := serviceSignalSender
	defer func() {
		startDevtoolsControlServer = originalStartControlServer
		startDocumentInjectionServer = originalStartDocumentInjectionServer
		registerProcessSignals = originalRegisterProcessSignals
		unregisterProcessSignals = originalUnregisterProcessSignals
		serviceSignalSender = originalServiceSignalSender
	}()
	serviceSignalSender = func(cmd *exec.Cmd, sig os.Signal) {
		if cmd != nil && cmd.Process != nil {
			_ = cmd.Process.Signal(sig)
		}
	}

	var signalMu sync.Mutex
	var signalChannel chan<- os.Signal
	registerProcessSignals = func(ch chan<- os.Signal) {
		signalMu.Lock()
		defer signalMu.Unlock()
		signalChannel = ch
	}
	unregisterProcessSignals = func(ch chan<- os.Signal) {
		signalMu.Lock()
		defer signalMu.Unlock()
		signalChannel = nil
	}
	getSignalChannel := func() chan<- os.Signal {
		signalMu.Lock()
		defer signalMu.Unlock()
		return signalChannel
	}

	var restartMu sync.Mutex
	var restartService func([]string) error
	startDevtoolsControlServer = func(options devtools.StartControlServerOptions) (*devtools.ControlServer, error) {
		restartMu.Lock()
		restartService = options.RestartService
		restartMu.Unlock()
		return devtools.StartControlServer(options)
	}

	servicePort := nettest.ReservePort(t)
	stateFilePath := filepath.Join(t.TempDir(), "restart-state.txt")
	manifestValue := newResolvedManifest(t.TempDir(), adminAddress)
	manifestValue.Name = "restart-health-stack"
	manifestValue.PrimaryService = "web"
	manifestValue.Devtools.Status.Enabled = true
	manifestValue.Services["web"] = ResolvedService{
		BindHost:  "127.0.0.1",
		Command:   helperCommand(),
		Cwd:       t.TempDir(),
		DependsOn: []string{},
		Env: map[string]string{
			"GO_WANT_HELPER_PROCESS": "1",
			"DEVHOST_HELPER_MODE":    "serve-then-probe-exit-on-restart",
			"RESTART_STATE_FILE":     stateFilePath,
		},
		Health:     ResolvedHealthConfig{Host: stringPointer("127.0.0.1"), Interval: 250, Kind: "tcp", Port: intPointer(servicePort), Retries: 0, Timeout: 2000},
		Hosts:      []string{"restart-health.localhost"},
		InjectPort: true,
		Name:       "web",
		Path:       stringPointer("/"),
		Port:       intPointer(servicePort),
		PortSource: "fixed",
	}

	stackDone := make(chan struct {
		exitCode int
		err      error
	}, 1)
	go func() {
		exitCode, err := StartStack(&manifestValue, []string{"web"}, StartStackOptions{
			CaddyPaths:          paths,
			Environment:         map[string]string{"DEVHOST_STATE_DIR": stateDirectoryPath},
			LogWriter:           ioDiscard{},
			ServiceStdoutWriter: ioDiscard{},
			ServiceStderrWriter: ioDiscard{},
			ShutdownGracePeriod: 100 * time.Millisecond,
		})
		stackDone <- struct {
			exitCode int
			err      error
		}{exitCode: exitCode, err: err}
	}()

	defer func() {
		if ch := getSignalChannel(); ch != nil {
			select {
			case ch <- syscall.SIGTERM:
			default:
			}
		}
		select {
		case <-stackDone:
		case <-time.After(2 * time.Second):
		}
	}()

	waitForCondition(t, 5*time.Second, func() bool {
		restartMu.Lock()
		fn := restartService
		restartMu.Unlock()
		if fn == nil {
			return false
		}
		// Route files appear before startup completes. An empty request checks the
		// restart readiness guard without restarting or probing any service.
		return fn(nil) == nil
	})

	startTime := time.Now()
	restartDone := make(chan error, 1)
	go func() {
		restartMu.Lock()
		fn := restartService
		restartMu.Unlock()
		restartDone <- fn([]string{"web"})
	}()

	select {
	case err := <-restartDone:
		elapsed := time.Since(startTime)
		if err != nil {
			t.Fatalf("RestartService(...) error = %v, want nil", err)
		}
		if elapsed > 15*time.Second {
			t.Fatalf("RestartService took %v, want prompt completion without redundant loop stall", elapsed)
		}
	case <-time.After(20 * time.Second):
		t.Fatal("RestartService stalled on redundant health loop (exceeded 20s)")
	}
}

func TestStartStackRestartServiceFailsPromptlyWithinHealthTimeout(t *testing.T) {
	stateDirectoryPath := t.TempDir()
	paths := caddy.CreateManagedCaddyPaths(stateDirectoryPath)
	adminAddress := caddytest.StartAdminServer(t)
	writeFakeCaddyExecutable(t, paths.ExecutablePath)

	originalStartControlServer := startDevtoolsControlServer
	originalStartDocumentInjectionServer := startDocumentInjectionServer
	originalRegisterProcessSignals := registerProcessSignals
	originalUnregisterProcessSignals := unregisterProcessSignals
	originalServiceSignalSender := serviceSignalSender
	defer func() {
		startDevtoolsControlServer = originalStartControlServer
		startDocumentInjectionServer = originalStartDocumentInjectionServer
		registerProcessSignals = originalRegisterProcessSignals
		unregisterProcessSignals = originalUnregisterProcessSignals
		serviceSignalSender = originalServiceSignalSender
	}()
	serviceSignalSender = func(cmd *exec.Cmd, sig os.Signal) {
		if cmd != nil && cmd.Process != nil {
			_ = cmd.Process.Signal(sig)
		}
	}

	var signalMu sync.Mutex
	var signalChannel chan<- os.Signal
	registerProcessSignals = func(ch chan<- os.Signal) {
		signalMu.Lock()
		defer signalMu.Unlock()
		signalChannel = ch
	}
	unregisterProcessSignals = func(ch chan<- os.Signal) {
		signalMu.Lock()
		defer signalMu.Unlock()
		signalChannel = nil
	}
	getSignalChannel := func() chan<- os.Signal {
		signalMu.Lock()
		defer signalMu.Unlock()
		return signalChannel
	}

	var restartMu sync.Mutex
	var restartService func([]string) error
	startDevtoolsControlServer = func(options devtools.StartControlServerOptions) (*devtools.ControlServer, error) {
		restartMu.Lock()
		restartService = options.RestartService
		restartMu.Unlock()
		return devtools.StartControlServer(options)
	}

	servicePort := nettest.ReservePort(t)
	stateFilePath := filepath.Join(t.TempDir(), "restart-state.txt")
	manifestValue := newResolvedManifest(t.TempDir(), adminAddress)
	manifestValue.Name = "restart-fail-stack"
	manifestValue.PrimaryService = "web"
	manifestValue.Devtools.Status.Enabled = true
	manifestValue.Services["web"] = ResolvedService{
		BindHost:  "127.0.0.1",
		Command:   helperCommand(),
		Cwd:       t.TempDir(),
		DependsOn: []string{},
		Env: map[string]string{
			"GO_WANT_HELPER_PROCESS": "1",
			"DEVHOST_HELPER_MODE":    "serve-then-fail-on-restart",
			"RESTART_STATE_FILE":     stateFilePath,
		},
		Health:     ResolvedHealthConfig{Host: stringPointer("127.0.0.1"), Interval: 20, Kind: "tcp", Port: intPointer(servicePort), Retries: 0, Timeout: 100},
		Hosts:      []string{"restart-fail.localhost"},
		InjectPort: true,
		Name:       "web",
		Path:       stringPointer("/"),
		Port:       intPointer(servicePort),
		PortSource: "fixed",
	}

	stackDone := make(chan struct {
		exitCode int
		err      error
	}, 1)
	go func() {
		exitCode, err := StartStack(&manifestValue, []string{"web"}, StartStackOptions{
			CaddyPaths:          paths,
			Environment:         map[string]string{"DEVHOST_STATE_DIR": stateDirectoryPath},
			LogWriter:           ioDiscard{},
			ServiceStdoutWriter: ioDiscard{},
			ServiceStderrWriter: ioDiscard{},
			ShutdownGracePeriod: 100 * time.Millisecond,
		})
		stackDone <- struct {
			exitCode int
			err      error
		}{exitCode: exitCode, err: err}
	}()

	defer func() {
		if ch := getSignalChannel(); ch != nil {
			select {
			case ch <- syscall.SIGTERM:
			default:
			}
		}
		select {
		case <-stackDone:
		case <-time.After(2 * time.Second):
		}
	}()

	waitForCondition(t, 5*time.Second, func() bool {
		restartMu.Lock()
		fn := restartService
		restartMu.Unlock()
		if fn == nil {
			return false
		}
		_, err := os.Stat(filepath.Join(paths.RoutesDirectoryPath, "restart-fail.localhost.caddy"))
		return err == nil
	})

	startTime := time.Now()
	restartDone := make(chan error, 1)
	go func() {
		restartMu.Lock()
		fn := restartService
		restartMu.Unlock()
		restartDone <- fn([]string{"web"})
	}()

	select {
	case err := <-restartDone:
		elapsed := time.Since(startTime)
		if err == nil {
			t.Fatal("RestartService(...) error = nil, want health check failure")
		}
		if elapsed > 15*time.Second {
			t.Fatalf("RestartService took %v, want failure within 15s", elapsed)
		}
	case <-time.After(20 * time.Second):
		t.Fatal("RestartService stalled on failed health check (exceeded 20s)")
	}
}

func TestStartStackGracefulIdleTimeoutShutdown(t *testing.T) {
	stateDirectoryPath := t.TempDir()
	paths := caddy.CreateManagedCaddyPaths(stateDirectoryPath)
	adminAddress := caddytest.StartAdminServer(t)
	writeFakeCaddyExecutable(t, paths.ExecutablePath)

	servicePort := nettest.ReservePort(t)
	tracePath := filepath.Join(t.TempDir(), "service-trace.txt")

	manifestValue := newResolvedManifest(t.TempDir(), adminAddress)
	manifestValue.Name = "idle-timeout-stack"
	manifestValue.PrimaryService = "web"
	manifestValue.Devtools.Minimap.Enabled = true
	manifestValue.Devtools.Status.Enabled = true
	manifestValue.Services["web"] = ResolvedService{
		BindHost:  "127.0.0.1",
		Command:   helperCommand(),
		Cwd:       t.TempDir(),
		DependsOn: []string{},
		Env: map[string]string{
			"GO_WANT_HELPER_PROCESS":       "1",
			"DEVHOST_HELPER_MODE":          "route-aware-http-server",
			"TRACE_PATH":                   tracePath,
			"HOST_CLAIMS_DIRECTORY_PATH":   paths.HostClaimsDirectoryPath,
			"PORT_CLAIMS_DIRECTORY_PATH":   paths.PortClaimsDirectoryPath,
			"REGISTRATIONS_DIRECTORY_PATH": paths.RegistrationsDirectoryPath,
		},
		Health:     ResolvedHealthConfig{Host: stringPointer("127.0.0.1"), Interval: 50, Kind: "tcp", Port: intPointer(servicePort), Retries: 0, Timeout: 5000},
		Hosts:      []string{"idle.localhost"},
		InjectPort: true,
		Name:       "web",
		Path:       stringPointer("/"),
		Port:       intPointer(servicePort),
		PortSource: "fixed",
	}

	startOptions := StartStackOptions{
		CaddyOutputWriters:  caddy.RouteCommandOutputWriters{},
		CaddyPaths:          paths,
		Environment:         map[string]string{"DEVHOST_STATE_DIR": stateDirectoryPath},
		LogWriter:           os.Stdout,
		ServiceStdoutWriter: io.Discard,
		ServiceStderrWriter: io.Discard,
		IdleTimeout:         100 * time.Millisecond,
	}

	doneChan := make(chan struct{})
	var exitCode int
	var err error

	go func() {
		exitCode, err = StartStack(&manifestValue, []string{"web"}, startOptions)
		close(doneChan)
	}()

	select {
	case <-doneChan:
		if err != nil {
			t.Fatalf("StartStack failed with error: %v", err)
		}
		if exitCode != 0 {
			t.Fatalf("expected exit code 0, got %d", exitCode)
		}
	case <-time.After(5 * time.Second):
		buf := make([]byte, 100000)
		n := runtime.Stack(buf, true)
		t.Logf("Stack trace:\n%s", buf[:n])
		t.Fatalf("timed out waiting for automatic idle shutdown")
	}
}

func TestStartStackReturnsSignalExitCodeAndUnregistersHandlers(t *testing.T) {
	tests := []struct {
		name         string
		signal       syscall.Signal
		wantExitCode int
	}{
		{name: "sigint", signal: syscall.SIGINT, wantExitCode: 130},
		{name: "sighup", signal: syscall.SIGHUP, wantExitCode: 129},
		{name: "sigterm", signal: syscall.SIGTERM, wantExitCode: 143},
	}

	for _, tt := range tests {
		tc := tt
		t.Run(tc.name, func(t *testing.T) {
			stateDirectoryPath := t.TempDir()
			paths := caddy.CreateManagedCaddyPaths(stateDirectoryPath)
			adminAddress := caddytest.StartAdminServer(t)

			originalRegisterProcessSignals := registerProcessSignals
			originalUnregisterProcessSignals := unregisterProcessSignals
			originalServiceSignalSender := serviceSignalSender
			defer func() {
				registerProcessSignals = originalRegisterProcessSignals
				unregisterProcessSignals = originalUnregisterProcessSignals
				serviceSignalSender = originalServiceSignalSender
			}()

			var signalMu sync.Mutex
			var signalChannel chan<- os.Signal
			var stoppedSignalChannel chan<- os.Signal
			registerProcessSignals = func(ch chan<- os.Signal) {
				signalMu.Lock()
				defer signalMu.Unlock()
				signalChannel = ch
			}
			unregisterProcessSignals = func(ch chan<- os.Signal) {
				signalMu.Lock()
				defer signalMu.Unlock()
				stoppedSignalChannel = ch
			}
			getSignalChannel := func() chan<- os.Signal {
				signalMu.Lock()
				defer signalMu.Unlock()
				return signalChannel
			}
			getStoppedSignalChannel := func() chan<- os.Signal {
				signalMu.Lock()
				defer signalMu.Unlock()
				return stoppedSignalChannel
			}
			serviceSignalSender = func(command *exec.Cmd, receivedSignal os.Signal) {
				if receivedSignal == syscall.SIGTERM {
					sendSignal(command, receivedSignal)
				}
			}

			startTracePath := filepath.Join(t.TempDir(), "signal-start.txt")
			stopTracePath := filepath.Join(t.TempDir(), "signal-stop.txt")
			manifestValue := newResolvedManifest(t.TempDir(), adminAddress)
			manifestValue.Name = "signal-stack"
			manifestValue.PrimaryService = "web"
			manifestValue.Services["web"] = ResolvedService{
				BindHost:  "127.0.0.1",
				Command:   helperCommand(),
				Cwd:       t.TempDir(),
				DependsOn: []string{},
				Env: map[string]string{
					"GO_WANT_HELPER_PROCESS": "1",
					"DEVHOST_HELPER_MODE":    "record-start-and-wait",
					"START_TRACE_PATH":       startTracePath,
					"START_TRACE_VALUE":      "web-start",
					"STOP_TRACE_PATH":        stopTracePath,
					"STOP_TRACE_VALUE":       "web-stop",
				},
				Health:     ResolvedHealthConfig{Kind: "process"},
				InjectPort: true,
				Name:       "web",
			}

			resultChannel := make(chan struct {
				exitCode int
				error    error
			}, 1)
			go func() {
				exitCode, startError := StartStack(&manifestValue, []string{"web"}, StartStackOptions{
					CaddyPaths:          paths,
					Environment:         map[string]string{"DEVHOST_STATE_DIR": stateDirectoryPath},
					LogWriter:           ioDiscard{},
					ServiceStdoutWriter: ioDiscard{},
					ServiceStderrWriter: ioDiscard{},
					ShutdownGracePeriod: 100 * time.Millisecond,
				})
				resultChannel <- struct {
					exitCode int
					error    error
				}{exitCode: exitCode, error: startError}
			}()

			waitForCondition(t, 5*time.Second, func() bool {
				_, err := os.Stat(startTracePath)
				return err == nil && getSignalChannel() != nil
			})

			getSignalChannel() <- tc.signal

			result := <-resultChannel
			if result.error != nil {
				t.Fatalf("StartStack(...) error = %v", result.error)
			}
			if result.exitCode != tc.wantExitCode {
				t.Fatalf("StartStack(...) exit code = %d, want %d", result.exitCode, tc.wantExitCode)
			}
			if getStoppedSignalChannel() != getSignalChannel() {
				t.Fatalf("unregisterProcessSignals(...) channel = %p, want %p", getStoppedSignalChannel(), getSignalChannel())
			}
		})
	}
}

func TestStartStackPublishesRecoveryRoutesBeforeHealthPasses(t *testing.T) {
	stateDirectoryPath := t.TempDir()
	paths := caddy.CreateManagedCaddyPaths(stateDirectoryPath)
	adminAddress := caddytest.StartAdminServer(t)
	writeFakeCaddyExecutable(t, paths.ExecutablePath)

	servicePort := nettest.ReservePort(t)
	tracePath := filepath.Join(t.TempDir(), "route-health-trace.txt")

	manifestValue := newResolvedManifest(t.TempDir(), adminAddress)
	manifestValue.Name = "health-route-stack"
	manifestValue.PrimaryService = "web"
	manifestValue.Services["web"] = ResolvedService{
		BindHost:  "127.0.0.1",
		Command:   helperCommand(),
		Cwd:       t.TempDir(),
		DependsOn: []string{},
		Env: map[string]string{
			"GO_WANT_HELPER_PROCESS":       "1",
			"DEVHOST_HELPER_MODE":          "delayed-route-health-server",
			"TRACE_PATH":                   tracePath,
			"REGISTRATIONS_DIRECTORY_PATH": paths.RegistrationsDirectoryPath,
		},
		Health:     ResolvedHealthConfig{Host: stringPointer("127.0.0.1"), Interval: 50, Kind: "tcp", Port: intPointer(servicePort), Retries: 0, Timeout: 5000},
		Hosts:      []string{"health.localhost"},
		InjectPort: true,
		Name:       "web",
		Path:       stringPointer("/"),
		Port:       intPointer(servicePort),
		PortSource: "fixed",
	}

	exitCode, err := startStackUntilServiceExit(t, &manifestValue, []string{"web"}, StartStackOptions{
		CaddyPaths:          paths,
		Environment:         map[string]string{"DEVHOST_STATE_DIR": stateDirectoryPath},
		LogWriter:           ioDiscard{},
		ServiceStdoutWriter: ioDiscard{},
		ServiceStderrWriter: ioDiscard{},
		ShutdownGracePeriod: 100 * time.Millisecond,
	})
	if err != nil {
		t.Fatalf("StartStack(...) error = %v", err)
	}
	if exitCode != 143 {
		t.Fatalf("StartStack(...) exit code = %d, want 143", exitCode)
	}

	traceText, readError := os.ReadFile(tracePath)
	if readError != nil {
		t.Fatalf("ReadFile(...) error = %v", readError)
	}
	if !stringSlicesEqual(nonEmptyLines(string(traceText)), []string{"route-present-before-health", "route-present-after-health"}) {
		t.Fatalf("trace = %#v, want recovery route before health", nonEmptyLines(string(traceText)))
	}
}

func TestStopStartedServicesStopsRunningServicesGracefully(t *testing.T) {
	stopLogPath := filepath.Join(t.TempDir(), "stop-log.txt")
	firstReadyPath := filepath.Join(t.TempDir(), "first-ready.txt")
	secondReadyPath := filepath.Join(t.TempDir(), "second-ready.txt")

	firstService, err := startServiceProcess(newResolvedManifest(t.TempDir(), "127.0.0.1:20197"), ResolvedService{
		BindHost:   "127.0.0.1",
		Command:    helperCommand(),
		Cwd:        t.TempDir(),
		Env:        map[string]string{"GO_WANT_HELPER_PROCESS": "1", "DEVHOST_HELPER_MODE": "graceful-signal-waiter", "STOP_TRACE_PATH": stopLogPath, "STOP_TRACE_VALUE": "first", "READY_FILE_PATH": firstReadyPath},
		InjectPort: true,
		Name:       "first",
	}, processStartOptions{environment: map[string]string{}, stderrWriter: ioDiscard{}, stdoutWriter: ioDiscard{}})
	if err != nil {
		t.Fatalf("startServiceProcess(first) error = %v", err)
	}

	secondService, err := startServiceProcess(newResolvedManifest(t.TempDir(), "127.0.0.1:20197"), ResolvedService{
		BindHost:   "127.0.0.1",
		Command:    helperCommand(),
		Cwd:        t.TempDir(),
		Env:        map[string]string{"GO_WANT_HELPER_PROCESS": "1", "DEVHOST_HELPER_MODE": "graceful-signal-waiter", "STOP_TRACE_PATH": stopLogPath, "STOP_TRACE_VALUE": "second", "READY_FILE_PATH": secondReadyPath},
		InjectPort: true,
		Name:       "second",
	}, processStartOptions{environment: map[string]string{}, stderrWriter: ioDiscard{}, stdoutWriter: ioDiscard{}})
	if err != nil {
		t.Fatalf("startServiceProcess(second) error = %v", err)
	}

	waitForCondition(t, 5*time.Second, func() bool {
		_, err1 := os.Stat(firstReadyPath)
		_, err2 := os.Stat(secondReadyPath)
		return err1 == nil && err2 == nil
	})
	if err := stopStartedServices([]*startedService{firstService, secondService}, 2*time.Second, nil); err != nil {
		t.Fatalf("stopStartedServices(...) error = %v", err)
	}

	stopTrace, err := os.ReadFile(stopLogPath)
	if err != nil {
		t.Fatalf("ReadFile(...) error = %v", err)
	}
	stopLines := nonEmptyLines(string(stopTrace))
	if !contains(stopLines, "first") || !contains(stopLines, "second") {
		t.Fatalf("stop trace = %#v, want graceful shutdown for both services", stopLines)
	}
	if secondService.exitCodeValue() != 0 || firstService.exitCodeValue() != 0 {
		t.Fatalf("exit codes = (%d, %d), want graceful exits", secondService.exitCodeValue(), firstService.exitCodeValue())
	}
}

func TestStopStartedServiceStopsDescendantProcesses(t *testing.T) {
	servicePort := nettest.ReservePort(t)
	childPidPath := filepath.Join(t.TempDir(), "child.pid")
	t.Cleanup(func() {
		childPidText, err := os.ReadFile(childPidPath)
		if err != nil {
			return
		}
		childPid, err := strconv.Atoi(strings.TrimSpace(string(childPidText)))
		if err != nil {
			return
		}
		_ = syscall.Kill(childPid, syscall.SIGKILL)
	})

	startedService, err := startServiceProcess(newResolvedManifest(t.TempDir(), "127.0.0.1:20197"), ResolvedService{
		BindHost: "127.0.0.1",
		Command:  helperCommand(),
		Cwd:      t.TempDir(),
		Env: map[string]string{
			"GO_WANT_HELPER_PROCESS": "1",
			"DEVHOST_HELPER_MODE":    "spawn-child-server-and-wait",
			"CHILD_PID_PATH":         childPidPath,
			"PORT":                   strconv.Itoa(servicePort),
		},
		Health:     ResolvedHealthConfig{Kind: "process"},
		InjectPort: true,
		Name:       "web",
	}, processStartOptions{environment: map[string]string{}, stderrWriter: ioDiscard{}, stdoutWriter: ioDiscard{}})
	if err != nil {
		t.Fatalf("startServiceProcess(...) error = %v", err)
	}

	waitForCondition(t, 5*time.Second, func() bool {
		conn, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", servicePort), 50*time.Millisecond)
		if err != nil {
			return false
		}
		_ = conn.Close()
		return true
	})

	if err := stopStartedService(startedService, 100*time.Millisecond); err != nil {
		t.Fatalf("stopStartedService(...) error = %v", err)
	}

	waitForCondition(t, 5*time.Second, func() bool {
		conn, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", servicePort), 50*time.Millisecond)
		if err != nil {
			return true
		}
		_ = conn.Close()
		return false
	})
}

func TestStopStartedServiceStopsDetachedDescendantProcesses(t *testing.T) {
	servicePort := nettest.ReservePort(t)
	childPidPath := filepath.Join(t.TempDir(), "child.pid")
	t.Cleanup(func() {
		childPidText, err := os.ReadFile(childPidPath)
		if err != nil {
			return
		}
		childPid, err := strconv.Atoi(strings.TrimSpace(string(childPidText)))
		if err != nil {
			return
		}
		_ = syscall.Kill(childPid, syscall.SIGKILL)
	})

	startedService, err := startServiceProcess(newResolvedManifest(t.TempDir(), "127.0.0.1:20197"), ResolvedService{
		BindHost: "127.0.0.1",
		Command:  helperCommand(),
		Cwd:      t.TempDir(),
		Env: map[string]string{
			"GO_WANT_HELPER_PROCESS": "1",
			"DEVHOST_HELPER_MODE":    "spawn-detached-child-server-and-wait",
			"CHILD_PID_PATH":         childPidPath,
			"PORT":                   strconv.Itoa(servicePort),
		},
		Health:     ResolvedHealthConfig{Kind: "process"},
		InjectPort: true,
		Name:       "web",
	}, processStartOptions{environment: map[string]string{}, stderrWriter: ioDiscard{}, stdoutWriter: ioDiscard{}})
	if err != nil {
		t.Fatalf("startServiceProcess(...) error = %v", err)
	}

	waitForCondition(t, 5*time.Second, func() bool {
		conn, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", servicePort), 50*time.Millisecond)
		if err != nil {
			return false
		}
		_ = conn.Close()
		return true
	})

	if err := stopStartedService(startedService, 100*time.Millisecond); err != nil {
		t.Fatalf("stopStartedService(...) error = %v", err)
	}

	waitForCondition(t, 5*time.Second, func() bool {
		conn, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", servicePort), 50*time.Millisecond)
		if err != nil {
			return true
		}
		_ = conn.Close()
		return false
	})
}

func TestStopStartedServiceStopsDescendantsSpawnedDuringSignalHandling(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("linux-specific subreaper adoption test")
	}

	servicePort := nettest.ReservePort(t)
	childPidPath := filepath.Join(t.TempDir(), "child.pid")
	readyPath := filepath.Join(t.TempDir(), "ready")
	t.Cleanup(func() {
		childPidText, err := os.ReadFile(childPidPath)
		if err != nil {
			return
		}
		childPid, err := strconv.Atoi(strings.TrimSpace(string(childPidText)))
		if err != nil {
			return
		}
		_ = syscall.Kill(childPid, syscall.SIGKILL)
	})

	startedService, err := startServiceProcess(newResolvedManifest(t.TempDir(), "127.0.0.1:20197"), ResolvedService{
		BindHost: "127.0.0.1",
		Command:  helperCommand(),
		Cwd:      t.TempDir(),
		Env: map[string]string{
			"GO_WANT_HELPER_PROCESS": "1",
			"DEVHOST_HELPER_MODE":    "spawn-detached-child-server-on-term-and-exit",
			"CHILD_PID_PATH":         childPidPath,
			"READY_FILE_PATH":        readyPath,
			"PORT":                   strconv.Itoa(servicePort),
		},
		Health:     ResolvedHealthConfig{Kind: "process"},
		InjectPort: true,
		Name:       "web",
	}, processStartOptions{environment: map[string]string{}, stderrWriter: ioDiscard{}, stdoutWriter: ioDiscard{}})
	if err != nil {
		t.Fatalf("startServiceProcess(...) error = %v", err)
	}

	waitForCondition(t, 5*time.Second, func() bool {
		_, err := os.Stat(readyPath)
		return err == nil
	})

	if err := stopStartedService(startedService, 250*time.Millisecond); err != nil {
		t.Fatalf("stopStartedService(...) error = %v", err)
	}

	waitForCondition(t, 5*time.Second, func() bool {
		_, err := os.Stat(childPidPath)
		return err == nil
	})

	childPIDText, err := os.ReadFile(childPidPath)
	if err != nil {
		t.Fatal(err)
	}
	childPID, err := strconv.Atoi(strings.TrimSpace(string(childPIDText)))
	if err != nil {
		t.Fatal(err)
	}
	waitForCondition(t, 5*time.Second, func() bool { return !processExists(childPID) })

	waitForCondition(t, 5*time.Second, func() bool {
		conn, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", servicePort), 50*time.Millisecond)
		if err != nil {
			return true
		}
		_ = conn.Close()
		return false
	})
}

func TestStopStartedServiceStopsDetachedDescendantsExitedDuringStartup(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("linux-specific startup containment test")
	}

	servicePort := nettest.ReservePort(t)
	childPIDPath := filepath.Join(t.TempDir(), "child.pid")
	t.Cleanup(func() {
		childPIDText, err := os.ReadFile(childPIDPath)
		if err != nil {
			return
		}
		childPID, err := strconv.Atoi(strings.TrimSpace(string(childPIDText)))
		if err != nil {
			return
		}
		_ = syscall.Kill(childPID, syscall.SIGKILL)
		_, _ = syscall.Wait4(childPID, nil, 0, nil)
	})

	startedService, err := startServiceProcess(newResolvedManifest(t.TempDir(), "127.0.0.1:20197"), ResolvedService{
		BindHost: "127.0.0.1",
		Command:  helperCommand(),
		Cwd:      t.TempDir(),
		Env: map[string]string{
			"GO_WANT_HELPER_PROCESS": "1",
			"DEVHOST_HELPER_MODE":    "spawn-detached-child-server-and-exit",
			"CHILD_PID_PATH":         childPIDPath,
			"PORT":                   strconv.Itoa(servicePort),
		},
		Health:     ResolvedHealthConfig{Kind: "process"},
		InjectPort: true,
		Name:       "web",
	}, processStartOptions{environment: map[string]string{}, stderrWriter: ioDiscard{}, stdoutWriter: ioDiscard{}})
	if err != nil {
		t.Fatalf("startServiceProcess(...) error = %v", err)
	}

	waitForCondition(t, 5*time.Second, func() bool {
		conn, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", servicePort), 50*time.Millisecond)
		if err != nil {
			return false
		}
		_ = conn.Close()
		return true
	})

	if err := stopStartedService(startedService, 250*time.Millisecond); err != nil {
		t.Fatalf("stopStartedService(...) error = %v", err)
	}

	waitForCondition(t, 5*time.Second, func() bool {
		conn, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", servicePort), 50*time.Millisecond)
		if err != nil {
			return true
		}
		_ = conn.Close()
		return false
	})
}

func TestStopStartedServicePreservesLateExternalPortRespawns(t *testing.T) {
	servicePort := nettest.ReservePort(t)
	tempDirectory := t.TempDir()
	childPIDPath := filepath.Join(tempDirectory, "child.pid")
	triggerPath := filepath.Join(tempDirectory, "trigger")

	coordinator := exec.Command(os.Args[0], "-test.run=TestServiceHelperProcess", "--")
	coordinator.Env = append(os.Environ(),
		"GO_WANT_HELPER_PROCESS=1",
		"DEVHOST_HELPER_MODE=delayed-child-server-on-file",
		"CHILD_PID_PATH="+childPIDPath,
		"DELAY_MS=1200",
		"PORT="+strconv.Itoa(servicePort),
		"TRIGGER_PATH="+triggerPath,
	)
	coordinator.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := coordinator.Start(); err != nil {
		t.Fatalf("coordinator.Start() error = %v", err)
	}
	t.Cleanup(func() {
		if coordinator.Process != nil {
			_ = syscall.Kill(-coordinator.Process.Pid, syscall.SIGKILL)
		}
		_ = coordinator.Wait()
		childPIDText, err := os.ReadFile(childPIDPath)
		if err != nil {
			return
		}
		childPID, err := strconv.Atoi(strings.TrimSpace(string(childPIDText)))
		if err != nil {
			return
		}
		_ = syscall.Kill(childPID, syscall.SIGKILL)
	})

	startedService, err := startServiceProcess(newResolvedManifest(tempDirectory, "127.0.0.1:20197"), ResolvedService{
		BindHost: "127.0.0.1",
		Command:  helperCommand(),
		Cwd:      tempDirectory,
		Env: map[string]string{
			"GO_WANT_HELPER_PROCESS": "1",
			"DEVHOST_HELPER_MODE":    "signal-external-coordinator-and-exit-on-term",
			"TRIGGER_PATH":           triggerPath,
		},
		Health:     ResolvedHealthConfig{Kind: "process"},
		InjectPort: true,
		Name:       "web",
		Port:       &servicePort,
		PortSource: "fixed",
	}, processStartOptions{environment: map[string]string{}, stderrWriter: ioDiscard{}, stdoutWriter: ioDiscard{}})
	if err != nil {
		t.Fatalf("startServiceProcess(...) error = %v", err)
	}

	if err := stopStartedService(startedService, 4*time.Second); err != nil {
		t.Fatalf("stopStartedService(...) error = %v", err)
	}

	waitForCondition(t, 5*time.Second, func() bool {
		_, err := os.Stat(childPIDPath)
		return err == nil
	})

	waitForChildServer(t, servicePort, childPIDPath)
}

func TestStopStartedServicePassesBindHostToLateListenerReader(t *testing.T) {
	originalReadListeningProcessIDs := readListeningProcessIDs
	defer func() {
		readListeningProcessIDs = originalReadListeningProcessIDs
	}()

	servicePort := 3000
	gotBindHost := ""
	gotPort := 0
	readListeningProcessIDs = func(bindHost string, port int) []int {
		gotBindHost = bindHost
		gotPort = port
		return nil
	}

	startedService := &startedService{
		service: ResolvedService{BindHost: "127.0.0.1", Port: &servicePort},
	}
	startedService.exitMu.Lock()
	startedService.exitCode = 0
	startedService.hasExited = true
	startedService.exitMu.Unlock()
	startedService.shutdownMu.Lock()
	startedService.shutdownAt = time.Now().Add(-lateListenerPollInterval)
	startedService.shutdownWith = syscall.SIGTERM
	startedService.shutdownMu.Unlock()

	startedService.handleLateListeners()

	if gotBindHost != "127.0.0.1" || gotPort != servicePort {
		t.Fatalf("late listener lookup = (%q, %d), want (%q, %d)", gotBindHost, gotPort, "127.0.0.1", servicePort)
	}
}

func TestStopStartedServiceIgnoresUnownedListener(t *testing.T) {
	originalReadListeningProcessIDs := readListeningProcessIDs
	defer func() {
		readListeningProcessIDs = originalReadListeningProcessIDs
	}()

	servicePort := 3010
	readListeningProcessIDs = func(bindHost string, port int) []int {
		if bindHost == "127.0.0.1" && port == servicePort {
			return []int{4321}
		}

		return nil
	}

	startedService := &startedService{
		service: ResolvedService{BindHost: "127.0.0.1", Name: "web", Port: &servicePort},
		exited:  make(chan struct{}),
	}
	startedService.exitMu.Lock()
	startedService.exitCode = 0
	startedService.hasExited = true
	startedService.exitMu.Unlock()
	close(startedService.exited)
	startedService.shutdownMu.Lock()
	startedService.shutdownAt = time.Now().Add(-lateListenerPollInterval)
	startedService.shutdownWith = syscall.SIGTERM
	startedService.shutdownMu.Unlock()

	err := stopStartedService(startedService, 50*time.Millisecond)
	if err != nil {
		t.Fatalf("stopStartedService(...) = %v; unrelated listener must not prevent cleanup", err)
	}
}

func TestStopStartedServicesIgnoresUnownedListeners(t *testing.T) {
	originalReadListeningProcessIDs := readListeningProcessIDs
	defer func() {
		readListeningProcessIDs = originalReadListeningProcessIDs
	}()

	firstPort := 3011
	secondPort := 3012
	readListeningProcessIDs = func(bindHost string, port int) []int {
		switch {
		case bindHost == "127.0.0.1" && port == firstPort:
			return []int{4001}
		case bindHost == "127.0.0.1" && port == secondPort:
			return []int{4002}
		default:
			return nil
		}
	}

	newExitedService := func(name string, port int) *startedService {
		startedService := &startedService{
			service: ResolvedService{BindHost: "127.0.0.1", Name: name, Port: &port},
			exited:  make(chan struct{}),
		}
		startedService.exitMu.Lock()
		startedService.exitCode = 0
		startedService.hasExited = true
		startedService.exitMu.Unlock()
		close(startedService.exited)
		return startedService
	}

	err := stopStartedServices([]*startedService{
		newExitedService("api", firstPort),
		newExitedService("web", secondPort),
	}, 50*time.Millisecond, nil)
	if err != nil {
		t.Fatalf("stopStartedServices(...) = %v; unrelated listeners must not prevent cleanup", err)
	}
}

func TestJoinCleanupErrorAggregatesCleanupFailures(t *testing.T) {
	runError := errors.New("stack startup failed")
	cleanupError := errors.Join(
		errors.New("failed to shut down service api after SIGTERM and SIGKILL: listener still active on 127.0.0.1:3011 (pids: 4001)"),
		errors.New("failed to shut down service web after SIGTERM and SIGKILL: listener still active on 127.0.0.1:3012 (pids: 4002)"),
	)

	joinedError := joinCleanupError(runError, cleanupError)
	if joinedError == nil {
		t.Fatal("joinCleanupError(...) = nil, want joined error")
	}
	if !strings.Contains(joinedError.Error(), "stack startup failed") {
		t.Fatalf("joinCleanupError(...) error = %q, want run failure", joinedError)
	}
	if !strings.Contains(joinedError.Error(), "cleanup: failed to shut down service api after SIGTERM and SIGKILL") {
		t.Fatalf("joinCleanupError(...) error = %q, want first cleanup failure", joinedError)
	}
	if !strings.Contains(joinedError.Error(), "failed to shut down service web after SIGTERM and SIGKILL") {
		t.Fatalf("joinCleanupError(...) error = %q, want second cleanup failure", joinedError)
	}
}

func TestStopStartedServiceDoesNotWaitForZombieDescendants(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("linux-specific zombie descendant test")
	}

	childPIDPath := filepath.Join(t.TempDir(), "child.pid")
	t.Cleanup(func() {
		childPIDText, err := os.ReadFile(childPIDPath)
		if err != nil {
			return
		}
		childPID, err := strconv.Atoi(strings.TrimSpace(string(childPIDText)))
		if err != nil {
			return
		}
		_, _ = syscall.Wait4(childPID, nil, 0, nil)
	})

	startedService, err := startServiceProcess(newResolvedManifest(t.TempDir(), "127.0.0.1:20197"), ResolvedService{
		BindHost: "127.0.0.1",
		Command:  helperCommand(),
		Cwd:      t.TempDir(),
		Env: map[string]string{
			"GO_WANT_HELPER_PROCESS": "1",
			"DEVHOST_HELPER_MODE":    "spawn-detached-exit-child-on-term-and-exit",
			"CHILD_PID_PATH":         childPIDPath,
		},
		Health:     ResolvedHealthConfig{Kind: "process"},
		InjectPort: true,
		Name:       "web",
	}, processStartOptions{environment: map[string]string{}, stderrWriter: ioDiscard{}, stdoutWriter: ioDiscard{}})
	if err != nil {
		t.Fatalf("startServiceProcess(...) error = %v", err)
	}

	startTime := time.Now()
	if err := stopStartedService(startedService, 1500*time.Millisecond); err != nil {
		t.Fatalf("stopStartedService(...) error = %v", err)
	}
	elapsed := time.Since(startTime)

	if elapsed >= time.Second {
		t.Fatalf("stopStartedService(...) elapsed = %s, want less than %s", elapsed, time.Second)
	}
}

func TestReadListeningProcessIDsForBindHostSeparatesInterfaces(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("linux-specific listener discovery test")
	}

	port := nettest.ReservePort(t)
	probeIPv4, err := net.Listen("tcp4", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		t.Fatalf("Listen(tcp4) error = %v", err)
	}
	probeIPv6, err := net.Listen("tcp6", fmt.Sprintf("[::1]:%d", port))
	if err != nil {
		_ = probeIPv4.Close()
		t.Skipf("dual-stack loopback port sharing unavailable: %v", err)
	}
	_ = probeIPv4.Close()
	_ = probeIPv6.Close()

	tempDirectory := t.TempDir()
	ipv4PIDPath := filepath.Join(tempDirectory, "ipv4.pid")
	ipv6PIDPath := filepath.Join(tempDirectory, "ipv6.pid")

	startBoundListener := func(bindHost string, pidPath string) *exec.Cmd {
		command := exec.Command(os.Args[0], "-test.run=TestServiceHelperProcess", "--")
		command.Env = append(os.Environ(),
			"GO_WANT_HELPER_PROCESS=1",
			"DEVHOST_HELPER_MODE=child-http-server",
			"BIND_HOST="+bindHost,
			"CHILD_PID_PATH="+pidPath,
			"PORT="+strconv.Itoa(port),
		)
		if err := command.Start(); err != nil {
			t.Fatalf("startBoundListener(%q) error = %v", bindHost, err)
		}
		t.Cleanup(func() {
			if command.Process != nil {
				_ = command.Process.Kill()
				_, _ = command.Process.Wait()
			}
		})
		return command
	}

	startBoundListener("127.0.0.1", ipv4PIDPath)
	startBoundListener("::1", ipv6PIDPath)

	waitForCondition(t, 5*time.Second, func() bool {
		_, ipv4Error := os.Stat(ipv4PIDPath)
		_, ipv6Error := os.Stat(ipv6PIDPath)
		return ipv4Error == nil && ipv6Error == nil
	})

	ipv4PIDText, err := os.ReadFile(ipv4PIDPath)
	if err != nil {
		t.Fatalf("ReadFile(ipv4PIDPath) error = %v", err)
	}
	ipv6PIDText, err := os.ReadFile(ipv6PIDPath)
	if err != nil {
		t.Fatalf("ReadFile(ipv6PIDPath) error = %v", err)
	}
	ipv4PID, err := strconv.Atoi(strings.TrimSpace(string(ipv4PIDText)))
	if err != nil {
		t.Fatalf("Atoi(ipv4PID) error = %v", err)
	}
	ipv6PID, err := strconv.Atoi(strings.TrimSpace(string(ipv6PIDText)))
	if err != nil {
		t.Fatalf("Atoi(ipv6PID) error = %v", err)
	}

	ipv4Listeners := readListeningProcessIDsForBindHost("127.0.0.1", port)
	ipv6Listeners := readListeningProcessIDsForBindHost("::1", port)

	if !containsInt(ipv4Listeners, ipv4PID) || containsInt(ipv4Listeners, ipv6PID) {
		t.Fatalf("readListeningProcessIDsForBindHost(127.0.0.1, %d) = %v, want only pid %d", port, ipv4Listeners, ipv4PID)
	}
	if !containsInt(ipv6Listeners, ipv6PID) || containsInt(ipv6Listeners, ipv4PID) {
		t.Fatalf("readListeningProcessIDsForBindHost(::1, %d) = %v, want only pid %d", port, ipv6Listeners, ipv6PID)
	}
}

func TestStopStartedServicesSignalsInReverseOrder(t *testing.T) {
	t.Parallel()

	originalSignalSender := serviceSignalSender
	defer func() {
		serviceSignalSender = originalSignalSender
	}()

	firstService := &startedService{cmd: &exec.Cmd{}, exited: make(chan struct{})}
	secondService := &startedService{cmd: &exec.Cmd{}, exited: make(chan struct{})}

	serviceNames := map[*exec.Cmd]string{
		firstService.cmd:  "first",
		secondService.cmd: "second",
	}
	signalOrder := []string{}
	serviceSignalSender = func(command *exec.Cmd, signal os.Signal) {
		signalOrder = append(signalOrder, fmt.Sprintf("%s:%v", serviceNames[command], signal))
		if signal == syscall.Signal(15) {
			if command == firstService.cmd {
				firstService.exitMu.Lock()
				firstService.exitCode = 0
				firstService.hasExited = true
				firstService.exitMu.Unlock()
				close(firstService.exited)
			}
			if command == secondService.cmd {
				secondService.exitMu.Lock()
				secondService.exitCode = 0
				secondService.hasExited = true
				secondService.exitMu.Unlock()
				close(secondService.exited)
			}
		}
	}

	if err := stopStartedServices([]*startedService{firstService, secondService}, 100*time.Millisecond, nil); err != nil {
		t.Fatalf("stopStartedServices(...) error = %v", err)
	}

	if !stringSlicesEqual(signalOrder, []string{"second:terminated", "first:terminated"}) {
		t.Fatalf("signal order = %#v, want reverse-order SIGTERM delivery", signalOrder)
	}
	if firstService.exitCodeValue() != 0 || secondService.exitCodeValue() != 0 {
		t.Fatalf("exit codes = (%d, %d), want graceful exits", firstService.exitCodeValue(), secondService.exitCodeValue())
	}
}

func TestStopStartedServiceEscalatesToSIGKILL(t *testing.T) {
	readyPath := filepath.Join(t.TempDir(), "ready.txt")
	startedService, err := startServiceProcess(newResolvedManifest(t.TempDir(), "127.0.0.1:20197"), ResolvedService{
		BindHost:   "127.0.0.1",
		Command:    helperCommand(),
		Cwd:        t.TempDir(),
		Env:        map[string]string{"GO_WANT_HELPER_PROCESS": "1", "DEVHOST_HELPER_MODE": "ignore-term", "READY_FILE_PATH": readyPath},
		InjectPort: true,
		Name:       "worker",
	}, processStartOptions{environment: map[string]string{}, stderrWriter: ioDiscard{}, stdoutWriter: ioDiscard{}})
	if err != nil {
		t.Fatalf("startServiceProcess(...) error = %v", err)
	}

	waitForCondition(t, 5*time.Second, func() bool {
		_, err := os.Stat(readyPath)
		return err == nil
	})
	if err := stopStartedService(startedService, 50*time.Millisecond); err != nil {
		t.Fatalf("stopStartedService(...) error = %v", err)
	}
	if startedService.exitCodeValue() != -1 {
		t.Fatalf("exit code = %d, want signal exit", startedService.exitCodeValue())
	}
	if waitForExitWithinGracePeriod(startedService, 50*time.Millisecond) != true {
		t.Fatal("waitForExitWithinGracePeriod(...) = false, want true for exited process")
	}
}

func TestStartStackRunsDaemonLifecycleCommands(t *testing.T) {
	stateDirectoryPath := t.TempDir()
	paths := caddy.CreateManagedCaddyPaths(stateDirectoryPath)
	adminAddress := caddytest.StartAdminServer(t)
	writeFakeCaddyExecutable(t, paths.ExecutablePath)

	servicePort := nettest.ReservePort(t)
	tracePath := filepath.Join(t.TempDir(), "daemon-lifecycle-trace.txt")
	manifestValue := newResolvedManifest(t.TempDir(), adminAddress)
	manifestValue.PrimaryService = "api"
	manifestValue.ServiceOrder = []string{"api"}
	manifestValue.Services["api"] = ResolvedService{
		BindHost: "127.0.0.1",
		Cwd:      t.TempDir(),
		Env: map[string]string{
			"GO_WANT_HELPER_PROCESS": "1",
			"LIFECYCLE_TRACE_PATH":   tracePath,
		},
		Health: ResolvedHealthConfig{Host: stringPointer("127.0.0.1"), Interval: 50, Kind: "tcp", Port: intPointer(servicePort), Retries: 0, Timeout: 5000},
		Lifecycle: ResolvedServiceLifecycle{
			Mode:   "daemon",
			Start:  helperCommandWithMode("daemon-start-server"),
			Status: helperCommandWithMode("daemon-status"),
			Stop:   helperCommandWithMode("daemon-stop-server"),
		},
		InjectPort: true,
		Managed:    true,
		Name:       "api",
		Port:       intPointer(servicePort),
		PortSource: "fixed",
	}

	originalSignalRegistrar := registerProcessSignals
	originalSignalStopper := unregisterProcessSignals
	defer func() {
		registerProcessSignals = originalSignalRegistrar
		unregisterProcessSignals = originalSignalStopper
	}()

	signalExits := make(chan os.Signal, 1)
	registerProcessSignals = func(ch chan<- os.Signal) {
		go func() {
			receivedSignal := <-signalExits
			ch <- receivedSignal
		}()
	}
	unregisterProcessSignals = func(ch chan<- os.Signal) {}

	resultCh := make(chan struct {
		exitCode int
		error    error
	}, 1)
	go func() {
		exitCode, err := StartStack(&manifestValue, []string{"api"}, StartStackOptions{
			CaddyPaths:          paths,
			Environment:         map[string]string{"DEVHOST_STATE_DIR": stateDirectoryPath},
			LogWriter:           ioDiscard{},
			ServiceStdoutWriter: ioDiscard{},
			ServiceStderrWriter: ioDiscard{},
			ShutdownGracePeriod: 100 * time.Millisecond,
		})
		resultCh <- struct {
			exitCode int
			error    error
		}{exitCode: exitCode, error: err}
	}()

	waitForCondition(t, 5*time.Second, func() bool {
		traceText, err := os.ReadFile(tracePath)
		if err != nil {
			return false
		}
		return contains(nonEmptyLines(string(traceText)), "start")
	})

	signalExits <- syscall.SIGTERM
	result := <-resultCh
	if result.error != nil {
		t.Fatalf("StartStack(...) error = %v", result.error)
	}
	if result.exitCode != 143 {
		t.Fatalf("StartStack(...) exit code = %d, want 143", result.exitCode)
	}

	traceText, err := os.ReadFile(tracePath)
	if err != nil {
		t.Fatalf("ReadFile(...) error = %v", err)
	}
	if !stringSlicesEqual(nonEmptyLines(string(traceText)), []string{"status:stopped", "start", "status:running", "stop"}) {
		t.Fatalf("trace lines = %#v, want daemon start/status/stop sequence", nonEmptyLines(string(traceText)))
	}
	if CheckServiceHealth(manifestValue.Services["api"].Health) {
		t.Fatal("daemon-managed service remained healthy after shutdown")
	}
}

func TestCollectServicesHealthChecksDaemonLifecycleServicesWithoutForegroundProcess(t *testing.T) {
	t.Parallel()

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("Listen(...) error = %v", err)
	}
	defer listener.Close()

	tcpAddress, ok := listener.Addr().(*net.TCPAddr)
	if !ok {
		t.Fatalf("listener.Addr() = %T, want *net.TCPAddr", listener.Addr())
	}

	port := tcpAddress.Port
	manifestValue := ResolvedManifest{
		Caddy:        manifest.CaddyConfig{Global: manifest.CaddyGlobalConfig{HTTPSPort: 443}},
		ServiceOrder: []string{"daemon"},
		Services: map[string]ResolvedService{
			"daemon": {
				BindHost:  "127.0.0.1",
				Health:    ResolvedHealthConfig{Host: stringPointer("127.0.0.1"), Kind: "tcp", Port: intPointer(port), Timeout: 500},
				Lifecycle: ResolvedServiceLifecycle{Mode: "daemon", Start: []string{"docker", "compose", "up", "-d", "daemon"}, Stop: []string{"docker", "compose", "stop", "daemon"}},
				Managed:   true,
				Name:      "daemon",
				Port:      intPointer(port),
			},
		},
	}

	health := collectServicesHealth(manifestValue, nil, nil)
	if len(health.Services) != 1 {
		t.Fatalf("health.Services length = %d, want 1", len(health.Services))
	}
	if !health.Services[0].Managed || health.Services[0].Name != "daemon" || !health.Services[0].Status {
		t.Fatalf("daemon service health = %#v, want managed healthy daemon service", health.Services[0])
	}
}

func TestServiceHelperProcess(t *testing.T) {
	if os.Getenv("GO_WANT_HELPER_PROCESS") != "1" {
		return
	}

	mode := os.Getenv("DEVHOST_HELPER_MODE")
	if mode == "" && len(os.Args) > 3 {
		mode = os.Args[len(os.Args)-1]
	}

	switch mode {
	case "exit-1":
		os.Exit(1)
	case "auto-port-retry-server":
		runAutoPortRetryHelper()
	case "delayed-route-health-server":
		runDelayedRouteHealthServerHelper()
	case "record-start-serve-and-exit":
		runRecordStartServeAndExitHelper()
	case "record-start-and-wait":
		runRecordStartAndWaitHelper()
	case "stderr-around-fifo-handshake-and-exit":
		runStderrAroundFIFOHandshakeAndExitHelper()
	case "serve-until-health-probe-and-exit":
		runServeUntilHealthProbeAndExitHelper()
	case "serve-then-probe-exit-on-restart":
		runServeThenProbeExitOnRestartHelper()
	case "serve-then-fail-on-restart":
		runServeThenFailOnRestartHelper()
	case "route-aware-http-server":
		runRouteAwareHTTPServerHelper()
	case "spawn-child-server-and-wait":
		runSpawnChildServerAndWaitHelper()
	case "spawn-detached-child-server-and-wait":
		runSpawnDetachedChildServerAndWaitHelper()
	case "spawn-detached-child-server-and-exit":
		runSpawnDetachedChildServerAndExitHelper()
	case "spawn-detached-child-server-on-term-and-exit":
		runSpawnDetachedChildServerOnTermAndExitHelper()
	case "spawn-detached-exit-child-on-term-and-exit":
		runSpawnDetachedExitChildOnTermAndExitHelper()
	case "signal-external-coordinator-and-exit-on-term":
		runSignalExternalCoordinatorAndExitOnTermHelper()
	case "delayed-child-server-on-file":
		runDelayedChildServerOnFileHelper()
	case "child-http-server":
		runChildHTTPServerHelper()
	case "exit-immediately":
		os.Exit(0)
	case "graceful-signal-waiter":
		runGracefulSignalWaiterHelper()
	case "ignore-term":
		runIgnoreTermHelper()
	case "daemon-start-server":
		runDaemonStartServerHelper()
	case "daemon-status":
		runDaemonStatusHelper()
	case "daemon-stop-server":
		runDaemonStopServerHelper()
	case "stderr-then-spawn-stderr-holder-and-exit":
		runStderrThenSpawnStderrHolderAndExitHelper()
	case "wait-for-termination":
		runWaitForTerminationHelper()
	default:
		os.Exit(2)
	}
}

type ioDiscard struct{}

func (ioDiscard) Write(value []byte) (int, error) {
	return len(value), nil
}

func newResolvedManifest(manifestDirectoryPath string, adminAddress string) ResolvedManifest {
	return ResolvedManifest{
		Caddy: manifest.CaddyConfig{Global: manifest.CaddyGlobalConfig{AdminAddress: adminAddress, BindHost: "127.0.0.1", HTTP: false, HTTPPort: 80, HTTPSPort: 443}},
		Devtools: manifest.DevtoolsConfig{
			Editor:           manifest.DevtoolsEditorConfig{Enabled: false, IDE: "vscode"},
			ExternalToolbars: manifest.DevtoolsToggleConfig{Enabled: false},
			Minimap:          manifest.DevtoolsMinimapConfig{Enabled: false},
			Status:           manifest.DevtoolsStatusConfig{Enabled: false, Position: "bottom-right"},
		},
		ManifestDirectoryPath: manifestDirectoryPath,
		ManifestPath:          filepath.Join(manifestDirectoryPath, "devhost.toml"),
		Name:                  "hello-stack",
		Services:              map[string]ResolvedService{},
	}
}

func helperCommand() []string {
	return []string{os.Args[0], "-test.run=TestServiceHelperProcess", "--"}
}

func helperCommandWithMode(mode string) []string {
	return []string{os.Args[0], "-test.run=TestServiceHelperProcess", "--", mode}
}

func serverURL(port int, path string) string {
	return fmt.Sprintf("http://127.0.0.1:%d%s", port, path)
}

func waitForCondition(t *testing.T, timeout time.Duration, condition func() bool) {
	t.Helper()

	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if condition() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}

	t.Fatal("condition was not satisfied before timeout")
}

// waitForChildServer waits until the child HTTP server whose pid is recorded in pidPath answers on port. Helper
// processes discard their output, so a failure reports what is known about the child, including a listen error.
func waitForChildServer(t *testing.T, port int, pidPath string) {
	t.Helper()

	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if childServerAnswers(port) {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}

	t.Fatalf("child server does not answer on port %d: %s", port, describeChildServer(port, pidPath))
}

func childServerAnswers(port int) bool {
	client := http.Client{Timeout: 200 * time.Millisecond}
	response, err := client.Get(serverURL(port, "/"))
	if err != nil {
		return false
	}
	defer response.Body.Close()

	body, err := io.ReadAll(response.Body)
	return err == nil && string(body) == "ok"
}

func describeChildServer(port int, pidPath string) string {
	pidText, err := os.ReadFile(pidPath)
	if err != nil {
		return fmt.Sprintf("no pid file: %v", err)
	}
	pid, err := strconv.Atoi(strings.TrimSpace(string(pidText)))
	if err != nil {
		return fmt.Sprintf("unreadable pid file %q", pidText)
	}

	listenError := "none recorded"
	if text, err := os.ReadFile(childServerErrorPath(pidPath)); err == nil {
		listenError = string(text)
	}

	return fmt.Sprintf(
		"child pid %d, alive %t, listen error %q, pids listening on the port %v",
		pid, processExists(pid), listenError, readListeningProcessIDs("127.0.0.1", port),
	)
}

func childServerErrorPath(pidPath string) string {
	return pidPath + ".error"
}

func writeFakeCaddyExecutable(t *testing.T, executablePath string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(executablePath), 0o755); err != nil {
		t.Fatalf("MkdirAll(...) error = %v", err)
	}
	if err := os.WriteFile(executablePath, []byte("#!/bin/sh\nexit 0\n"), 0o755); err != nil {
		t.Fatalf("WriteFile(...) error = %v", err)
	}
}

func assertDirectoryEntries(t *testing.T, directoryPath string, want []string) {
	t.Helper()
	entries, err := os.ReadDir(directoryPath)
	if err != nil {
		t.Fatalf("ReadDir(%q) error = %v", directoryPath, err)
	}

	got := []string{}
	for _, entry := range entries {
		got = append(got, entry.Name())
	}

	if !stringSlicesEqual(got, want) {
		t.Fatalf("ReadDir(%q) = %#v, want %#v", directoryPath, got, want)
	}
}

func assertRouteDirectoryEmpty(t *testing.T, routesDirectoryPath string) {
	t.Helper()
	entries, err := os.ReadDir(routesDirectoryPath)
	if err != nil {
		t.Fatalf("ReadDir(...) error = %v", err)
	}

	files := []string{}
	for _, entry := range entries {
		if strings.HasSuffix(entry.Name(), ".caddy") {
			files = append(files, entry.Name())
		}
	}

	if len(files) != 0 {
		t.Fatalf("route files = %#v, want empty", files)
	}
}

func runAutoPortRetryHelper() {
	port, _ := strconv.Atoi(os.Getenv("PORT"))
	initialPort, _ := strconv.Atoi(os.Getenv("INITIAL_PORT"))
	tracePath := os.Getenv("PORT_TRACE_PATH")
	if port == initialPort {
		_, _ = fmt.Fprintf(os.Stderr, "listen EADDRINUSE: address already in use 127.0.0.1:%d\n", port)
		os.Exit(1)
	}

	if err := os.WriteFile(tracePath, []byte(strconv.Itoa(port)), 0o644); err != nil {
		panic(err)
	}

	// Serve until the TCP health probe connects, then exit cleanly; a fixed serving window races the probe under load.
	runServeUntilHealthProbeAndExitHelper()
}

func runDelayedRouteHealthServerHelper() {
	port, _ := strconv.Atoi(os.Getenv("PORT"))
	tracePath := os.Getenv("TRACE_PATH")
	registrationsDirectoryPath := os.Getenv("REGISTRATIONS_DIRECTORY_PATH")
	traceLines := []string{}
	if hasFiles(registrationsDirectoryPath) {
		traceLines = append(traceLines, "route-present-before-health")
	} else {
		traceLines = append(traceLines, "route-missing-before-health")
	}

	server := &http.Server{Addr: fmt.Sprintf("127.0.0.1:%d", port), Handler: http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		_, _ = writer.Write([]byte("ok"))
	})}
	go func() {
		_ = server.ListenAndServe()
	}()

	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if hasFiles(registrationsDirectoryPath) {
			traceLines = append(traceLines, "route-present-after-health")
			break
		}
		time.Sleep(25 * time.Millisecond)
	}

	if err := os.WriteFile(tracePath, []byte(strings.Join(traceLines, "\n")), 0o644); err != nil {
		panic(err)
	}

	_ = server.Close()
	os.Exit(0)
}

func runRecordStartServeAndExitHelper() {
	appendTraceLine(os.Getenv("START_TRACE_PATH"), os.Getenv("START_TRACE_VALUE"))
	port, _ := strconv.Atoi(os.Getenv("PORT"))
	server := &http.Server{Addr: fmt.Sprintf("127.0.0.1:%d", port), Handler: http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		_, _ = writer.Write([]byte("ok"))
	})}
	go func() {
		_ = server.ListenAndServe()
	}()

	waitValue := os.Getenv("WAIT_TRACE_VALUE")
	if waitValue != "" {
		tracePath := os.Getenv("START_TRACE_PATH")
		deadline := time.Now().Add(10 * time.Second)
		found := false
		for time.Now().Before(deadline) {
			data, err := os.ReadFile(tracePath)
			if err == nil && strings.Contains(string(data), waitValue) {
				found = true
				break
			}
			time.Sleep(10 * time.Millisecond)
		}
		if !found {
			panic(fmt.Sprintf("timed out waiting for trace value %q in %s", waitValue, tracePath))
		}
	}

	_ = server.Close()
	os.Exit(0)
}

// runServeUntilHealthProbeAndExitHelper exits cleanly right after the first TCP connection, which is devhost's
// health probe. Exiting on that handshake instead of a timer guarantees the service passes its health check first,
// however slowly the helper or the probe gets scheduled.
func runServeUntilHealthProbeAndExitHelper() {
	port, _ := strconv.Atoi(os.Getenv("PORT"))
	listener, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		os.Exit(1)
	}
	connection, err := listener.Accept()
	if err != nil {
		os.Exit(1)
	}
	_ = connection.Close()
	_ = listener.Close()
	os.Exit(0)
}

func runServeThenProbeExitOnRestartHelper() {
	port, _ := strconv.Atoi(os.Getenv("PORT"))
	stateFilePath := os.Getenv("RESTART_STATE_FILE")
	if _, err := os.Stat(stateFilePath); os.IsNotExist(err) {
		_ = os.WriteFile(stateFilePath, []byte("started"), 0o644)
		listener, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
		if err != nil {
			os.Exit(1)
		}
		signals := make(chan os.Signal, 1)
		signal.Notify(signals, syscall.SIGTERM)
		go func() {
			for {
				conn, err := listener.Accept()
				if err != nil {
					return
				}
				_ = conn.Close()
			}
		}()
		<-signals
		_ = listener.Close()
		os.Exit(0)
	}

	listener, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		os.Exit(1)
	}
	connection, err := listener.Accept()
	if err != nil {
		os.Exit(1)
	}
	_ = connection.Close()
	_ = listener.Close()
	os.Exit(0)
}

func runServeThenFailOnRestartHelper() {
	port, _ := strconv.Atoi(os.Getenv("PORT"))
	stateFilePath := os.Getenv("RESTART_STATE_FILE")
	if _, err := os.Stat(stateFilePath); os.IsNotExist(err) {
		_ = os.WriteFile(stateFilePath, []byte("started"), 0o644)
		listener, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
		if err != nil {
			os.Exit(1)
		}
		signals := make(chan os.Signal, 1)
		signal.Notify(signals, syscall.SIGTERM)
		go func() {
			for {
				conn, err := listener.Accept()
				if err != nil {
					return
				}
				_ = conn.Close()
			}
		}()
		<-signals
		_ = listener.Close()
		os.Exit(0)
	}

	os.Exit(1)
}

func runRecordStartAndWaitHelper() {
	appendTraceLine(os.Getenv("START_TRACE_PATH"), os.Getenv("START_TRACE_VALUE"))
	tracePath := os.Getenv("STOP_TRACE_PATH")
	traceValue := os.Getenv("STOP_TRACE_VALUE")
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, syscall.Signal(15))
	<-signals
	appendTraceLine(tracePath, traceValue)
	os.Exit(0)
}

func runRouteAwareHTTPServerHelper() {
	port, _ := strconv.Atoi(os.Getenv("PORT"))
	tracePath := os.Getenv("TRACE_PATH")
	hostClaimsDirectoryPath := os.Getenv("HOST_CLAIMS_DIRECTORY_PATH")
	portClaimsDirectoryPath := os.Getenv("PORT_CLAIMS_DIRECTORY_PATH")
	registrationsDirectoryPath := os.Getenv("REGISTRATIONS_DIRECTORY_PATH")

	claimChecks := []string{}
	if hasFiles(hostClaimsDirectoryPath) && hasFiles(portClaimsDirectoryPath) {
		claimChecks = append(claimChecks, "claims-ok")
	} else {
		claimChecks = append(claimChecks, "claims-missing")
	}

	server := &http.Server{Addr: fmt.Sprintf("127.0.0.1:%d", port), Handler: http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		_, _ = writer.Write([]byte("ok"))
	})}
	listener, err := net.Listen("tcp", server.Addr)
	if err != nil {
		panic(err)
	}
	// Early routes exist before the child starts. Keep it alive until its first
	// health probe rather than treating route registration as startup completion.
	connection, err := listener.Accept()
	if err != nil {
		panic(err)
	}
	_ = connection.Close()
	go func() {
		_ = server.Serve(listener)
	}()

	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if hasFiles(registrationsDirectoryPath) {
			claimChecks = append(claimChecks, "route-ok")
			break
		}
		time.Sleep(25 * time.Millisecond)
	}

	claimChecks = append(claimChecks,
		"DEVHOST_BIND_HOST="+os.Getenv("DEVHOST_BIND_HOST"),
		"DEVHOST_HOST="+os.Getenv("DEVHOST_HOST"),
		"DEVHOST_PATH="+os.Getenv("DEVHOST_PATH"),
		"DEVHOST_MANIFEST_PATH="+os.Getenv("DEVHOST_MANIFEST_PATH"),
		"DEVHOST_SERVICE_NAME="+os.Getenv("DEVHOST_SERVICE_NAME"),
		"PORT="+os.Getenv("PORT"),
	)
	if os.Getenv("EXPECT_DEVTOOLS_ROUTE_PORTS") == "1" {
		if registrationHasDevtoolsPorts(registrationsDirectoryPath) {
			claimChecks = append(claimChecks, "devtools-route-ok")
		} else {
			claimChecks = append(claimChecks, "devtools-route-missing")
		}
	}
	if os.Getenv("EXPECT_NO_DEVTOOLS_ROUTE_PORTS") == "1" {
		if registrationHasDevtoolsPorts(registrationsDirectoryPath) {
			claimChecks = append(claimChecks, "devtools-route-ok")
		} else {
			claimChecks = append(claimChecks, "devtools-route-missing")
		}
	}
	if err := os.WriteFile(tracePath, []byte(strings.Join(claimChecks, "\n")), 0o644); err != nil {
		panic(err)
	}

	_ = server.Close()
	os.Exit(0)
}

func runSpawnChildServerAndWaitHelper() {
	command := exec.Command(os.Args[0], "-test.run=TestServiceHelperProcess", "--")
	command.Env = append(os.Environ(),
		"GO_WANT_HELPER_PROCESS=1",
		"DEVHOST_HELPER_MODE=child-http-server",
		"CHILD_PID_PATH="+os.Getenv("CHILD_PID_PATH"),
		"PORT="+os.Getenv("PORT"),
	)
	if err := command.Start(); err != nil {
		panic(err)
	}

	select {}
}

func runSpawnDetachedChildServerAndWaitHelper() {
	command := exec.Command(os.Args[0], "-test.run=TestServiceHelperProcess", "--")
	command.Env = append(os.Environ(),
		"GO_WANT_HELPER_PROCESS=1",
		"DEVHOST_HELPER_MODE=child-http-server",
		"CHILD_PID_PATH="+os.Getenv("CHILD_PID_PATH"),
		"PORT="+os.Getenv("PORT"),
	)
	command.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := command.Start(); err != nil {
		panic(err)
	}

	select {}
}

func runSpawnDetachedChildServerAndExitHelper() {
	command := exec.Command(os.Args[0], "-test.run=TestServiceHelperProcess", "--")
	command.Env = append(os.Environ(),
		"GO_WANT_HELPER_PROCESS=1",
		"DEVHOST_HELPER_MODE=child-http-server",
		"CHILD_PID_PATH="+os.Getenv("CHILD_PID_PATH"),
		"PORT="+os.Getenv("PORT"),
	)
	command.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := command.Start(); err != nil {
		panic(err)
	}

	os.Exit(0)
}

func runSpawnDetachedChildServerOnTermAndExitHelper() {
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, syscall.Signal(15))
	if path := os.Getenv("READY_FILE_PATH"); path != "" {
		if err := os.WriteFile(path, []byte("ready"), 0o644); err != nil {
			panic(err)
		}
	}
	<-signals

	command := exec.Command(os.Args[0], "-test.run=TestServiceHelperProcess", "--")
	command.Env = append(os.Environ(),
		"GO_WANT_HELPER_PROCESS=1",
		"DEVHOST_HELPER_MODE=child-http-server",
		"CHILD_PID_PATH="+os.Getenv("CHILD_PID_PATH"),
		"PORT="+os.Getenv("PORT"),
	)
	command.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := command.Start(); err != nil {
		panic(err)
	}
	// Cleanup may terminate the child before its Go runtime reaches main.
	if err := os.WriteFile(os.Getenv("CHILD_PID_PATH"), []byte(strconv.Itoa(command.Process.Pid)), 0o644); err != nil {
		panic(err)
	}

	os.Exit(0)
}

func runSpawnDetachedExitChildOnTermAndExitHelper() {
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, syscall.Signal(15))
	<-signals

	command := exec.Command(os.Args[0], "-test.run=TestServiceHelperProcess", "--")
	command.Env = append(os.Environ(),
		"GO_WANT_HELPER_PROCESS=1",
		"DEVHOST_HELPER_MODE=exit-immediately",
		"CHILD_PID_PATH="+os.Getenv("CHILD_PID_PATH"),
	)
	command.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := command.Start(); err != nil {
		panic(err)
	}
	if err := os.WriteFile(os.Getenv("CHILD_PID_PATH"), []byte(strconv.Itoa(command.Process.Pid)), 0o644); err != nil {
		panic(err)
	}

	os.Exit(0)
}

func runSignalExternalCoordinatorAndExitOnTermHelper() {
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, syscall.Signal(15))
	<-signals

	if err := os.WriteFile(os.Getenv("TRIGGER_PATH"), []byte("go"), 0o644); err != nil {
		panic(err)
	}

	os.Exit(0)
}

func runDelayedChildServerOnFileHelper() {
	triggerPath := os.Getenv("TRIGGER_PATH")
	delayMilliseconds, _ := strconv.Atoi(os.Getenv("DELAY_MS"))
	for {
		if _, err := os.Stat(triggerPath); err == nil {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}

	time.Sleep(time.Duration(delayMilliseconds) * time.Millisecond)

	command := exec.Command(os.Args[0], "-test.run=TestServiceHelperProcess", "--")
	command.Env = append(os.Environ(),
		"GO_WANT_HELPER_PROCESS=1",
		"DEVHOST_HELPER_MODE=child-http-server",
		"CHILD_PID_PATH="+os.Getenv("CHILD_PID_PATH"),
		"PORT="+os.Getenv("PORT"),
	)
	command.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := command.Start(); err != nil {
		panic(err)
	}

	os.Exit(0)
}

func runChildHTTPServerHelper() {
	bindHost := os.Getenv("BIND_HOST")
	if bindHost == "" {
		bindHost = "127.0.0.1"
	}
	port, _ := strconv.Atoi(os.Getenv("PORT"))
	if err := os.WriteFile(os.Getenv("CHILD_PID_PATH"), []byte(strconv.Itoa(os.Getpid())), 0o644); err != nil {
		panic(err)
	}

	address := fmt.Sprintf("%s:%d", bindHost, port)
	if strings.Contains(bindHost, ":") {
		address = fmt.Sprintf("[%s]:%d", bindHost, port)
	}

	server := &http.Server{Addr: address, Handler: http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		_, _ = writer.Write([]byte("ok"))
	})}
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		// Helper output is discarded, so leave the reason where the test that started this server can read it.
		_ = os.WriteFile(childServerErrorPath(os.Getenv("CHILD_PID_PATH")), []byte(err.Error()), 0o644) // best effort; the panic below still ends the helper
		panic(err)
	}
}

func runGracefulSignalWaiterHelper() {
	tracePath := os.Getenv("STOP_TRACE_PATH")
	traceValue := os.Getenv("STOP_TRACE_VALUE")
	readyPath := os.Getenv("READY_FILE_PATH")
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, syscall.Signal(15))
	if readyPath != "" {
		if err := os.WriteFile(readyPath, []byte("ready"), 0o644); err != nil {
			panic(err)
		}
	}
	<-signals
	file, err := os.OpenFile(tracePath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		panic(err)
	}
	defer file.Close()
	if _, err := fmt.Fprintln(file, traceValue); err != nil {
		panic(err)
	}
	os.Exit(0)
}

func runIgnoreTermHelper() {
	readyPath := os.Getenv("READY_FILE_PATH")
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, syscall.Signal(15))
	if readyPath != "" {
		if err := os.WriteFile(readyPath, []byte("ready"), 0o644); err != nil {
			panic(err)
		}
	}
	go func() {
		for range signals {
		}
	}()
	select {}
}

func runDaemonStartServerHelper() {
	port, _ := strconv.Atoi(os.Getenv("PORT"))
	tracePath := os.Getenv("LIFECYCLE_TRACE_PATH")
	pidPath := tracePath + ".pid"
	appendTraceLine(tracePath, "start")
	command := exec.Command(os.Args[0], "-test.run=TestServiceHelperProcess", "--")
	command.Env = append(os.Environ(),
		"GO_WANT_HELPER_PROCESS=1",
		"DEVHOST_HELPER_MODE=child-http-server",
		"CHILD_PID_PATH="+pidPath,
		"PORT="+strconv.Itoa(port),
	)
	if err := command.Start(); err != nil {
		panic(err)
	}
}

func runDaemonStatusHelper() {
	tracePath := os.Getenv("LIFECYCLE_TRACE_PATH")
	pidPath := tracePath + ".pid"
	childPidText, err := os.ReadFile(pidPath)
	if err != nil {
		appendTraceLine(tracePath, "status:stopped")
		os.Exit(1)
	}

	childPID, err := strconv.Atoi(strings.TrimSpace(string(childPidText)))
	if err != nil {
		appendTraceLine(tracePath, "status:stopped")
		os.Exit(1)
	}

	if err := syscall.Kill(childPID, 0); err != nil {
		appendTraceLine(tracePath, "status:stopped")
		_ = os.Remove(pidPath)
		os.Exit(1)
	}

	appendTraceLine(tracePath, "status:running")
	os.Exit(0)
}

func runDaemonStopServerHelper() {
	tracePath := os.Getenv("LIFECYCLE_TRACE_PATH")
	pidPath := tracePath + ".pid"
	appendTraceLine(tracePath, "stop")
	childPidText, err := os.ReadFile(pidPath)
	if err != nil {
		return
	}

	childPID, err := strconv.Atoi(strings.TrimSpace(string(childPidText)))
	if err != nil {
		panic(err)
	}

	if err := syscall.Kill(childPID, syscall.SIGTERM); err != nil && err != syscall.ESRCH {
		panic(err)
	}
	port, err := strconv.Atoi(os.Getenv("PORT"))
	if err != nil {
		panic(err)
	}
	waitForDaemonPortToClose(port)
	_ = os.Remove(pidPath)
}

func waitForDaemonPortToClose(port int) {
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if !canConnectToPort(context.Background(), "127.0.0.1", port, minProbeTimeout) {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}

	panic(fmt.Sprintf("daemon port %d remained open after stop", port))
}

func hasFiles(directoryPath string) bool {
	entries, err := os.ReadDir(directoryPath)
	if err != nil {
		return false
	}
	return len(entries) > 0
}

func registrationHasDevtoolsPorts(directoryPath string) bool {
	entries, err := os.ReadDir(directoryPath)
	if err != nil {
		return false
	}

	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}

		text, err := os.ReadFile(filepath.Join(directoryPath, entry.Name()))
		if err != nil {
			return false
		}

		return strings.Contains(string(text), `"devtoolsControlPort":`) && strings.Contains(string(text), `"documentInjectionPort":`)
	}

	return false
}

func appendTraceLine(path string, value string) {
	file, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		panic(err)
	}
	defer file.Close()
	if _, err := fmt.Fprintln(file, value); err != nil {
		panic(err)
	}
}

func nonEmptyLines(value string) []string {
	lines := []string{}
	for _, line := range strings.Split(strings.ReplaceAll(value, "\r\n", "\n"), "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}
		lines = append(lines, trimmed)
	}
	return lines
}

func mapsEqual(left map[string]string, right map[string]string) bool {
	if len(left) != len(right) {
		return false
	}
	for key, value := range left {
		if right[key] != value {
			return false
		}
	}
	return true
}

func stringSlicesEqual(left []string, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}

func contains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}

	return false
}

func containsInt(values []int, target int) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}

	return false
}
