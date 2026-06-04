package services

import (
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
	"syscall"
	"testing"
	"time"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/devtools"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/manifest"
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
				Host:       &routedHost,
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
				Host:       &routedHost,
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
			Caddy: manifest.CaddyConfig{Global: manifest.CaddyGlobalConfig{HTTPSPort: 443}},
			Name:  "hello-stack",
			ServiceOrder: []string{"api", "web", "worker"},
			Services: map[string]ResolvedService{
				"api": {
					BindHost: "127.0.0.1",
					Host:     stringPointer("api.hello.localhost"),
					Name:     "api",
					Path:     stringPointer("/v1/*"),
					Port:     intPointer(4000),
				},
				"web": {
					BindHost: "127.0.0.1",
					Host:     stringPointer("hello.localhost"),
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
			"[hello-stack] web: https://hello.localhost",
			"[hello-stack] worker: http://127.0.0.1:3200",
			"",
		}, "\n") {
			t.Fatalf("LogServiceURLs(...) = %q", output.String())
		}
	})
}

func TestCollectServicesHealthIncludesUnmanagedServices(t *testing.T) {
	t.Parallel()

	listener, error := net.Listen("tcp", "127.0.0.1:0")
	if error != nil {
		t.Fatalf("Listen(...) error = %v", error)
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

	health := collectServicesHealth(manifestValue, nil)
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

func TestStartStackCleanupReleasesClaimsAfterStartupFailure(t *testing.T) {
	stateDirectoryPath := t.TempDir()
	paths := caddy.CreateManagedCaddyPaths(stateDirectoryPath)
	adminAddress, stopAdmin := startTestAdminServer(t)
	defer stopAdmin()
	writeFakeCaddyExecutable(t, paths.ExecutablePath)

	servicePort := mustReservePort(t)
	manifestValue := newResolvedManifest(t.TempDir(), adminAddress)
	manifestValue.PrimaryService = "web"
	manifestValue.Services["web"] = ResolvedService{
		BindHost:  "127.0.0.1",
		Command:   helperCommand(),
		Cwd:       t.TempDir(),
		DependsOn: []string{},
		Env: map[string]string{
			"GO_WANT_HELPER_PROCESS": "1",
			"DEVHOST_HELPER_MODE":    "exit-1",
		},
		Health:     ResolvedHealthConfig{Host: stringPointer("127.0.0.1"), Interval: 50, Kind: "tcp", Port: intPointer(servicePort), Retries: 0, Timeout: 200},
		Host:       stringPointer("cleanup.localhost"),
		InjectPort: true,
		Name:       "web",
		Path:       stringPointer("/"),
		Port:       intPointer(servicePort),
		PortSource: "fixed",
	}

	_, error := StartStack(&manifestValue, []string{"web"}, StartStackOptions{
		CaddyPaths:          paths,
		Environment:         map[string]string{"DEVHOST_STATE_DIR": stateDirectoryPath},
		LogWriter:           ioDiscard{},
		ServiceStdoutWriter: ioDiscard{},
		ServiceStderrWriter: ioDiscard{},
		ShutdownGracePeriod: 100 * time.Millisecond,
	})
	if error == nil || error.Error() != "Service web exited before passing its health check with code 1." {
		t.Fatalf("StartStack(...) error = %v, want startup health failure", error)
	}

	assertDirectoryEntries(t, paths.HostClaimsDirectoryPath, nil)
	assertDirectoryEntries(t, paths.PortClaimsDirectoryPath, nil)
	assertDirectoryEntries(t, paths.RegistrationsDirectoryPath, nil)
	assertRouteDirectoryEmpty(t, paths.RoutesDirectoryPath)
}

func TestStartStackRetriesAutoPortAndPrefixesOutput(t *testing.T) {
	stateDirectoryPath := t.TempDir()
	paths := caddy.CreateManagedCaddyPaths(stateDirectoryPath)
	adminAddress, stopAdmin := startTestAdminServer(t)
	defer stopAdmin()

	initialPort := mustReservePort(t)
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

	exitCode, error := StartStack(&manifestValue, []string{"web"}, StartStackOptions{
		CaddyPaths:          paths,
		Environment:         map[string]string{"DEVHOST_STATE_DIR": stateDirectoryPath},
		LogWriter:           &infoLog,
		ServiceStdoutWriter: ioDiscard{},
		ServiceStderrWriter: &stderrLog,
		ShutdownGracePeriod: 100 * time.Millisecond,
	})
	if error != nil {
		t.Fatalf("StartStack(...) error = %v", error)
	}

	if exitCode != 0 {
		t.Fatalf("StartStack(...) exit code = %d, want 0", exitCode)
	}

	finalPort := manifestValue.Services["web"].Port
	if finalPort == nil || *finalPort == initialPort {
		t.Fatalf("final auto port = %v, want reassigned port", finalPort)
	}

	assignedPortText, error := os.ReadFile(tracePath)
	if error != nil {
		t.Fatalf("ReadFile(...) error = %v", error)
	}
	if strings.TrimSpace(string(assignedPortText)) != strconv.Itoa(*finalPort) {
		t.Fatalf("assigned port = %q, want %d", strings.TrimSpace(string(assignedPortText)), *finalPort)
	}

	if strings.TrimSpace(stderrLog.String()) != fmt.Sprintf("[web] listen EADDRINUSE: address already in use 127.0.0.1:%d", initialPort) {
		t.Fatalf("stderr = %q", stderrLog.String())
	}

	infoLines := nonEmptyLines(infoLog.String())
	if len(infoLines) != 2 {
		t.Fatalf("info lines = %#v, want two lines", infoLines)
	}
	if infoLines[0] != "[retry-stack] retrying web with a new auto port after a bind collision." {
		t.Fatalf("retry log = %q", infoLines[0])
	}
	if infoLines[1] != fmt.Sprintf("[retry-stack] web: http://127.0.0.1:%d", *finalPort) {
		t.Fatalf("service URL log = %q", infoLines[1])
	}
}

func TestStartStackVerifiesManagedCaddyAdminBeforeServiceStartup(t *testing.T) {
	stateDirectoryPath := t.TempDir()
	paths := caddy.CreateManagedCaddyPaths(stateDirectoryPath)
	tracePath := filepath.Join(t.TempDir(), "service-start.txt")

	manifestValue := newResolvedManifest(t.TempDir(), reserveUnusedAdminAddress(t))
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

	_, error := StartStack(&manifestValue, []string{"web"}, StartStackOptions{
		CaddyPaths:          paths,
		Environment:         map[string]string{"DEVHOST_STATE_DIR": stateDirectoryPath},
		LogWriter:           ioDiscard{},
		ServiceStdoutWriter: ioDiscard{},
		ServiceStderrWriter: ioDiscard{},
		ShutdownGracePeriod: 100 * time.Millisecond,
	})
	if error == nil || !strings.Contains(error.Error(), "Caddy admin API is not available. Run 'devhost caddy start' first.") {
		t.Fatalf("StartStack(...) error = %v, want admin availability failure", error)
	}

	if _, statError := os.Stat(tracePath); !os.IsNotExist(statError) {
		t.Fatalf("service start trace stat = %v, want os.ErrNotExist", statError)
	}
}

func TestStartStackStartsServicesInDependencyOrderAndEndsOnFirstChildExit(t *testing.T) {
	stateDirectoryPath := t.TempDir()
	paths := caddy.CreateManagedCaddyPaths(stateDirectoryPath)
	adminAddress, stopAdmin := startTestAdminServer(t)
	defer stopAdmin()

	startTracePath := filepath.Join(t.TempDir(), "start-order.txt")
	stopTracePath := filepath.Join(t.TempDir(), "stop-order.txt")
	apiPort := mustReservePort(t)
	webPort := mustReservePort(t)

	orderManifest := manifest.Manifest{
		ServiceOrder: []string{"web", "api"},
		Services: map[string]manifest.ValidatedService{
			"api": {DependsOn: []string{}},
			"web": {DependsOn: []string{"api"}},
		},
	}
	serviceOrder, error := ResolveServiceOrder(orderManifest)
	if error != nil {
		t.Fatalf("ResolveServiceOrder(...) error = %v", error)
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
			"EXIT_DELAY_MS":          "200",
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

	exitCode, error := StartStack(&manifestValue, serviceOrder, StartStackOptions{
		CaddyPaths:          paths,
		Environment:         map[string]string{"DEVHOST_STATE_DIR": stateDirectoryPath},
		LogWriter:           ioDiscard{},
		ServiceStdoutWriter: ioDiscard{},
		ServiceStderrWriter: ioDiscard{},
		ShutdownGracePeriod: 100 * time.Millisecond,
	})
	if error != nil {
		t.Fatalf("StartStack(...) error = %v", error)
	}
	if exitCode != 0 {
		t.Fatalf("StartStack(...) exit code = %d, want 0", exitCode)
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

func TestStartStackActivatesRoutesAndCleansUpAfterExit(t *testing.T) {
	stateDirectoryPath := t.TempDir()
	paths := caddy.CreateManagedCaddyPaths(stateDirectoryPath)
	adminAddress, stopAdmin := startTestAdminServer(t)
	defer stopAdmin()
	writeFakeCaddyExecutable(t, paths.ExecutablePath)

	servicePort := mustReservePort(t)
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
		Host:       stringPointer("hello.localhost"),
		InjectPort: true,
		Name:       "web",
		Path:       stringPointer("/"),
		Port:       intPointer(servicePort),
		PortSource: "fixed",
	}

	exitCode, error := StartStack(&manifestValue, []string{"web"}, StartStackOptions{
		CaddyPaths:          paths,
		Environment:         map[string]string{"DEVHOST_STATE_DIR": stateDirectoryPath},
		LogWriter:           &infoLog,
		ServiceStdoutWriter: ioDiscard{},
		ServiceStderrWriter: ioDiscard{},
		ShutdownGracePeriod: 100 * time.Millisecond,
	})
	if error != nil {
		t.Fatalf("StartStack(...) error = %v", error)
	}
	if exitCode != 0 {
		t.Fatalf("StartStack(...) exit code = %d, want 0", exitCode)
	}

	traceText, error := os.ReadFile(tracePath)
	if error != nil {
		t.Fatalf("ReadFile(...) error = %v", error)
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

	if lines := nonEmptyLines(infoLog.String()); len(lines) != 1 || lines[0] != "[route-stack] web: https://hello.localhost" {
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
	adminAddress, stopAdmin := startTestAdminServer(t)
	defer stopAdmin()
	writeFakeCaddyExecutable(t, paths.ExecutablePath)

	servicePort := mustReservePort(t)
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
		Host:       stringPointer("devtools-root.localhost"),
		InjectPort: true,
		Name:       "web",
		Path:       stringPointer("/"),
		Port:       intPointer(servicePort),
		PortSource: "fixed",
	}

	exitCode, error := StartStack(&manifestValue, []string{"web"}, StartStackOptions{
		CaddyPaths:          paths,
		Environment:         map[string]string{"DEVHOST_STATE_DIR": stateDirectoryPath},
		LogWriter:           ioDiscard{},
		ServiceStdoutWriter: ioDiscard{},
		ServiceStderrWriter: ioDiscard{},
		ShutdownGracePeriod: 100 * time.Millisecond,
	})
	if error != nil {
		t.Fatalf("StartStack(...) error = %v", error)
	}
	if exitCode != 0 {
		t.Fatalf("StartStack(...) exit code = %d, want 0", exitCode)
	}

	traceText, error := os.ReadFile(tracePath)
	if error != nil {
		t.Fatalf("ReadFile(...) error = %v", error)
	}
	if !contains(nonEmptyLines(string(traceText)), "devtools-route-ok") {
		t.Fatalf("trace = %#v, want devtools-route-ok", nonEmptyLines(string(traceText)))
	}
}

func TestStartStackSkipsDocumentInjectionForNonRootRoutes(t *testing.T) {
	stateDirectoryPath := t.TempDir()
	paths := caddy.CreateManagedCaddyPaths(stateDirectoryPath)
	adminAddress, stopAdmin := startTestAdminServer(t)
	defer stopAdmin()
	writeFakeCaddyExecutable(t, paths.ExecutablePath)

	servicePort := mustReservePort(t)
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
		Host:       stringPointer("devtools-path.localhost"),
		InjectPort: true,
		Name:       "web",
		Path:       stringPointer("/app/*"),
		Port:       intPointer(servicePort),
		PortSource: "fixed",
	}

	exitCode, error := StartStack(&manifestValue, []string{"web"}, StartStackOptions{
		CaddyPaths:          paths,
		Environment:         map[string]string{"DEVHOST_STATE_DIR": stateDirectoryPath},
		LogWriter:           ioDiscard{},
		ServiceStdoutWriter: ioDiscard{},
		ServiceStderrWriter: ioDiscard{},
		ShutdownGracePeriod: 100 * time.Millisecond,
	})
	if error != nil {
		t.Fatalf("StartStack(...) error = %v", error)
	}
	if exitCode != 0 {
		t.Fatalf("StartStack(...) exit code = %d, want 0", exitCode)
	}

	traceText, error := os.ReadFile(tracePath)
	if error != nil {
		t.Fatalf("ReadFile(...) error = %v", error)
	}
	if !contains(nonEmptyLines(string(traceText)), "devtools-route-missing") {
		t.Fatalf("trace = %#v, want devtools-route-missing", nonEmptyLines(string(traceText)))
	}
}

func TestStartStackLeavesDevtoolsRoutesUnmountedWhenAllFeaturesAreDisabled(t *testing.T) {
	stateDirectoryPath := t.TempDir()
	paths := caddy.CreateManagedCaddyPaths(stateDirectoryPath)
	adminAddress, stopAdmin := startTestAdminServer(t)
	defer stopAdmin()
	writeFakeCaddyExecutable(t, paths.ExecutablePath)

	servicePort := mustReservePort(t)
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
		Host:       stringPointer("devtools-disabled.localhost"),
		InjectPort: true,
		Name:       "web",
		Path:       stringPointer("/"),
		Port:       intPointer(servicePort),
		PortSource: "fixed",
	}

	exitCode, error := StartStack(&manifestValue, []string{"web"}, StartStackOptions{
		CaddyPaths:          paths,
		Environment:         map[string]string{"DEVHOST_STATE_DIR": stateDirectoryPath},
		LogWriter:           ioDiscard{},
		ServiceStdoutWriter: ioDiscard{},
		ServiceStderrWriter: ioDiscard{},
		ShutdownGracePeriod: 100 * time.Millisecond,
	})
	if error != nil {
		t.Fatalf("StartStack(...) error = %v", error)
	}
	if exitCode != 0 {
		t.Fatalf("StartStack(...) exit code = %d, want 0", exitCode)
	}

	traceText, error := os.ReadFile(tracePath)
	if error != nil {
		t.Fatalf("ReadFile(...) error = %v", error)
	}
	if !contains(nonEmptyLines(string(traceText)), "devtools-route-missing") {
		t.Fatalf("trace = %#v, want devtools-route-missing", nonEmptyLines(string(traceText)))
	}
}

func TestStartStackStopsDevtoolsServersDuringCleanup(t *testing.T) {
	stateDirectoryPath := t.TempDir()
	paths := caddy.CreateManagedCaddyPaths(stateDirectoryPath)
	adminAddress, stopAdmin := startTestAdminServer(t)
	defer stopAdmin()
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
		server, error := devtools.StartControlServer(options)
		if error == nil {
			controlPort = server.Port()
		}
		return server, error
	}
	startDocumentInjectionServer = func(options devtools.StartDocumentInjectionServerOptions) (*devtools.DocumentInjectionServer, error) {
		server, error := devtools.StartDocumentInjectionServer(options)
		if error == nil {
			documentPort = server.Port()
		}
		return server, error
	}

	servicePort := mustReservePort(t)
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
			"DEVHOST_HELPER_MODE":    "record-start-serve-and-exit",
			"START_TRACE_PATH":       filepath.Join(t.TempDir(), "start.txt"),
			"START_TRACE_VALUE":      "web-start",
			"EXIT_DELAY_MS":          "50",
		},
		Health:     ResolvedHealthConfig{Host: stringPointer("127.0.0.1"), Interval: 50, Kind: "tcp", Port: intPointer(servicePort), Retries: 0, Timeout: 5000},
		Host:       stringPointer("cleanup-devtools.localhost"),
		InjectPort: true,
		Name:       "web",
		Path:       stringPointer("/"),
		Port:       intPointer(servicePort),
		PortSource: "fixed",
	}

	exitCode, error := StartStack(&manifestValue, []string{"web"}, StartStackOptions{
		CaddyPaths:          paths,
		Environment:         map[string]string{"DEVHOST_STATE_DIR": stateDirectoryPath},
		LogWriter:           ioDiscard{},
		ServiceStdoutWriter: ioDiscard{},
		ServiceStderrWriter: ioDiscard{},
		ShutdownGracePeriod: 100 * time.Millisecond,
	})
	if error != nil {
		t.Fatalf("StartStack(...) error = %v", error)
	}
	if exitCode != 0 {
		t.Fatalf("StartStack(...) exit code = %d, want 0", exitCode)
	}
	if controlPort == 0 {
		t.Fatal("control port = 0, want started devtools control server")
	}
	if documentPort == 0 {
		t.Fatal("document injection port = 0, want started document injection server")
	}

	waitForCondition(t, time.Second, func() bool {
		_, error := http.Get(serverURL(controlPort, "/__devhost__/inject.js"))
		return error != nil
	})
	if response, error := http.Get(serverURL(controlPort, "/__devhost__/inject.js")); error == nil {
		defer response.Body.Close()
		t.Fatalf("control server request unexpectedly succeeded with status %d", response.StatusCode)
	}

	waitForCondition(t, time.Second, func() bool {
		_, error := http.Get(serverURL(documentPort, "/"))
		return error != nil
	})
	if response, error := http.Get(serverURL(documentPort, "/")); error == nil {
		defer response.Body.Close()
		t.Fatalf("document injection server request unexpectedly succeeded with status %d", response.StatusCode)
	}
}

func TestStartStackGracefulIdleTimeoutShutdown(t *testing.T) {
	stateDirectoryPath := t.TempDir()
	paths := caddy.CreateManagedCaddyPaths(stateDirectoryPath)
	adminAddress, stopAdmin := startTestAdminServer(t)
	defer stopAdmin()
	writeFakeCaddyExecutable(t, paths.ExecutablePath)

	servicePort := mustReservePort(t)
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
		Host:       stringPointer("idle.localhost"),
		InjectPort: true,
		Name:       "web",
		Path:       stringPointer("/"),
		Port:       intPointer(servicePort),
		PortSource: "fixed",
	}

	startOptions := StartStackOptions{
		CaddyOutputWriters: caddy.RouteCommandOutputWriters{},
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
			adminAddress, stopAdmin := startTestAdminServer(t)
			defer stopAdmin()

			originalRegisterProcessSignals := registerProcessSignals
			originalUnregisterProcessSignals := unregisterProcessSignals
			originalServiceSignalSender := serviceSignalSender
			defer func() {
				registerProcessSignals = originalRegisterProcessSignals
				unregisterProcessSignals = originalUnregisterProcessSignals
				serviceSignalSender = originalServiceSignalSender
			}()

			var signalChannel chan<- os.Signal
			var stoppedSignalChannel chan<- os.Signal
			registerProcessSignals = func(ch chan<- os.Signal) {
				signalChannel = ch
			}
			unregisterProcessSignals = func(ch chan<- os.Signal) {
				stoppedSignalChannel = ch
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
				_, error := os.Stat(startTracePath)
				return error == nil && signalChannel != nil
			})

			signalChannel <- tc.signal

			result := <-resultChannel
			if result.error != nil {
				t.Fatalf("StartStack(...) error = %v", result.error)
			}
			if result.exitCode != tc.wantExitCode {
				t.Fatalf("StartStack(...) exit code = %d, want %d", result.exitCode, tc.wantExitCode)
			}
			if stoppedSignalChannel != signalChannel {
				t.Fatalf("unregisterProcessSignals(...) channel = %p, want %p", stoppedSignalChannel, signalChannel)
			}
		})
	}
}

func TestStartStackActivatesRoutesOnlyAfterHealthPasses(t *testing.T) {
	stateDirectoryPath := t.TempDir()
	paths := caddy.CreateManagedCaddyPaths(stateDirectoryPath)
	adminAddress, stopAdmin := startTestAdminServer(t)
	defer stopAdmin()
	writeFakeCaddyExecutable(t, paths.ExecutablePath)

	servicePort := mustReservePort(t)
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
		Host:       stringPointer("health.localhost"),
		InjectPort: true,
		Name:       "web",
		Path:       stringPointer("/"),
		Port:       intPointer(servicePort),
		PortSource: "fixed",
	}

	exitCode, error := StartStack(&manifestValue, []string{"web"}, StartStackOptions{
		CaddyPaths:          paths,
		Environment:         map[string]string{"DEVHOST_STATE_DIR": stateDirectoryPath},
		LogWriter:           ioDiscard{},
		ServiceStdoutWriter: ioDiscard{},
		ServiceStderrWriter: ioDiscard{},
		ShutdownGracePeriod: 100 * time.Millisecond,
	})
	if error != nil {
		t.Fatalf("StartStack(...) error = %v", error)
	}
	if exitCode != 0 {
		t.Fatalf("StartStack(...) exit code = %d, want 0", exitCode)
	}

	traceText, readError := os.ReadFile(tracePath)
	if readError != nil {
		t.Fatalf("ReadFile(...) error = %v", readError)
	}
	if !stringSlicesEqual(nonEmptyLines(string(traceText)), []string{"route-missing-before-health", "route-present-after-health"}) {
		t.Fatalf("trace = %#v, want route activation after health", nonEmptyLines(string(traceText)))
	}
}

func TestStopStartedServicesStopsRunningServicesGracefully(t *testing.T) {
	stopLogPath := filepath.Join(t.TempDir(), "stop-log.txt")

	firstService, error := startServiceProcess(newResolvedManifest(t.TempDir(), "127.0.0.1:20197"), ResolvedService{
		BindHost:   "127.0.0.1",
		Command:    helperCommand(),
		Cwd:        t.TempDir(),
		Env:        map[string]string{"GO_WANT_HELPER_PROCESS": "1", "DEVHOST_HELPER_MODE": "graceful-signal-waiter", "STOP_TRACE_PATH": stopLogPath, "STOP_TRACE_VALUE": "first"},
		InjectPort: true,
		Name:       "first",
	}, processStartOptions{environment: map[string]string{}, stderrWriter: ioDiscard{}, stdoutWriter: ioDiscard{}})
	if error != nil {
		t.Fatalf("startServiceProcess(first) error = %v", error)
	}

	secondService, error := startServiceProcess(newResolvedManifest(t.TempDir(), "127.0.0.1:20197"), ResolvedService{
		BindHost:   "127.0.0.1",
		Command:    helperCommand(),
		Cwd:        t.TempDir(),
		Env:        map[string]string{"GO_WANT_HELPER_PROCESS": "1", "DEVHOST_HELPER_MODE": "graceful-signal-waiter", "STOP_TRACE_PATH": stopLogPath, "STOP_TRACE_VALUE": "second"},
		InjectPort: true,
		Name:       "second",
	}, processStartOptions{environment: map[string]string{}, stderrWriter: ioDiscard{}, stdoutWriter: ioDiscard{}})
	if error != nil {
		t.Fatalf("startServiceProcess(second) error = %v", error)
	}

	time.Sleep(100 * time.Millisecond)
	if error := stopStartedServices([]*startedService{firstService, secondService}, 100*time.Millisecond); error != nil {
		t.Fatalf("stopStartedServices(...) error = %v", error)
	}

	stopTrace, error := os.ReadFile(stopLogPath)
	if error != nil {
		t.Fatalf("ReadFile(...) error = %v", error)
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
	servicePort := mustReservePort(t)
	childPidPath := filepath.Join(t.TempDir(), "child.pid")
	t.Cleanup(func() {
		childPidText, error := os.ReadFile(childPidPath)
		if error != nil {
			return
		}
		childPid, error := strconv.Atoi(strings.TrimSpace(string(childPidText)))
		if error != nil {
			return
		}
		_ = syscall.Kill(childPid, syscall.SIGKILL)
	})

	startedService, error := startServiceProcess(newResolvedManifest(t.TempDir(), "127.0.0.1:20197"), ResolvedService{
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
	if error != nil {
		t.Fatalf("startServiceProcess(...) error = %v", error)
	}

	waitForCondition(t, 5*time.Second, func() bool {
		conn, error := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", servicePort), 50*time.Millisecond)
		if error != nil {
			return false
		}
		_ = conn.Close()
		return true
	})

	if error := stopStartedService(startedService, 100*time.Millisecond); error != nil {
		t.Fatalf("stopStartedService(...) error = %v", error)
	}

	waitForCondition(t, 5*time.Second, func() bool {
		conn, error := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", servicePort), 50*time.Millisecond)
		if error != nil {
			return true
		}
		_ = conn.Close()
		return false
	})
}

func TestStopStartedServiceStopsDetachedDescendantProcesses(t *testing.T) {
	servicePort := mustReservePort(t)
	childPidPath := filepath.Join(t.TempDir(), "child.pid")
	t.Cleanup(func() {
		childPidText, error := os.ReadFile(childPidPath)
		if error != nil {
			return
		}
		childPid, error := strconv.Atoi(strings.TrimSpace(string(childPidText)))
		if error != nil {
			return
		}
		_ = syscall.Kill(childPid, syscall.SIGKILL)
	})

	startedService, error := startServiceProcess(newResolvedManifest(t.TempDir(), "127.0.0.1:20197"), ResolvedService{
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
	if error != nil {
		t.Fatalf("startServiceProcess(...) error = %v", error)
	}

	waitForCondition(t, 5*time.Second, func() bool {
		conn, error := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", servicePort), 50*time.Millisecond)
		if error != nil {
			return false
		}
		_ = conn.Close()
		return true
	})

	if error := stopStartedService(startedService, 100*time.Millisecond); error != nil {
		t.Fatalf("stopStartedService(...) error = %v", error)
	}

	waitForCondition(t, 5*time.Second, func() bool {
		conn, error := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", servicePort), 50*time.Millisecond)
		if error != nil {
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

	servicePort := mustReservePort(t)
	childPidPath := filepath.Join(t.TempDir(), "child.pid")
	t.Cleanup(func() {
		childPidText, error := os.ReadFile(childPidPath)
		if error != nil {
			return
		}
		childPid, error := strconv.Atoi(strings.TrimSpace(string(childPidText)))
		if error != nil {
			return
		}
		_ = syscall.Kill(childPid, syscall.SIGKILL)
	})

	startedService, error := startServiceProcess(newResolvedManifest(t.TempDir(), "127.0.0.1:20197"), ResolvedService{
		BindHost: "127.0.0.1",
		Command:  helperCommand(),
		Cwd:      t.TempDir(),
		Env: map[string]string{
			"GO_WANT_HELPER_PROCESS": "1",
			"DEVHOST_HELPER_MODE":    "spawn-detached-child-server-on-term-and-exit",
			"CHILD_PID_PATH":         childPidPath,
			"PORT":                   strconv.Itoa(servicePort),
		},
		Health:     ResolvedHealthConfig{Kind: "process"},
		InjectPort: true,
		Name:       "web",
	}, processStartOptions{environment: map[string]string{}, stderrWriter: ioDiscard{}, stdoutWriter: ioDiscard{}})
	if error != nil {
		t.Fatalf("startServiceProcess(...) error = %v", error)
	}

	if error := stopStartedService(startedService, 250*time.Millisecond); error != nil {
		t.Fatalf("stopStartedService(...) error = %v", error)
	}

	waitForCondition(t, 5*time.Second, func() bool {
		_, error := os.Stat(childPidPath)
		return error == nil
	})

	waitForCondition(t, 5*time.Second, func() bool {
		conn, error := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", servicePort), 50*time.Millisecond)
		if error != nil {
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

	servicePort := mustReservePort(t)
	childPIDPath := filepath.Join(t.TempDir(), "child.pid")
	t.Cleanup(func() {
		childPIDText, error := os.ReadFile(childPIDPath)
		if error != nil {
			return
		}
		childPID, error := strconv.Atoi(strings.TrimSpace(string(childPIDText)))
		if error != nil {
			return
		}
		_ = syscall.Kill(childPID, syscall.SIGKILL)
		_, _ = syscall.Wait4(childPID, nil, 0, nil)
	})

	startedService, error := startServiceProcess(newResolvedManifest(t.TempDir(), "127.0.0.1:20197"), ResolvedService{
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
	if error != nil {
		t.Fatalf("startServiceProcess(...) error = %v", error)
	}

	waitForCondition(t, 5*time.Second, func() bool {
		conn, error := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", servicePort), 50*time.Millisecond)
		if error != nil {
			return false
		}
		_ = conn.Close()
		return true
	})

	if error := stopStartedService(startedService, 250*time.Millisecond); error != nil {
		t.Fatalf("stopStartedService(...) error = %v", error)
	}

	waitForCondition(t, 5*time.Second, func() bool {
		conn, error := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", servicePort), 50*time.Millisecond)
		if error != nil {
			return true
		}
		_ = conn.Close()
		return false
	})
}

func TestStopStartedServiceStopsLateExternalPortRespawns(t *testing.T) {
	servicePort := mustReservePort(t)
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
	if error := coordinator.Start(); error != nil {
		t.Fatalf("coordinator.Start() error = %v", error)
	}
	t.Cleanup(func() {
		if coordinator.Process != nil {
			_ = syscall.Kill(-coordinator.Process.Pid, syscall.SIGKILL)
		}
		childPIDText, error := os.ReadFile(childPIDPath)
		if error != nil {
			return
		}
		childPID, error := strconv.Atoi(strings.TrimSpace(string(childPIDText)))
		if error != nil {
			return
		}
		_ = syscall.Kill(childPID, syscall.SIGKILL)
	})

	startedService, error := startServiceProcess(newResolvedManifest(tempDirectory, "127.0.0.1:20197"), ResolvedService{
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
	if error != nil {
		t.Fatalf("startServiceProcess(...) error = %v", error)
	}

	if error := stopStartedService(startedService, 4*time.Second); error != nil {
		t.Fatalf("stopStartedService(...) error = %v", error)
	}

	waitForCondition(t, 5*time.Second, func() bool {
		_, error := os.Stat(childPIDPath)
		return error == nil
	})

	waitForCondition(t, 5*time.Second, func() bool {
		conn, error := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", servicePort), 50*time.Millisecond)
		if error != nil {
			return true
		}
		_ = conn.Close()
		return false
	})
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

func TestStopStartedServiceReturnsShutdownFailureDetails(t *testing.T) {
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

	error := stopStartedService(startedService, 50*time.Millisecond)
	if error == nil {
		t.Fatal("stopStartedService(...) error = nil, want shutdown failure")
	}
	if !strings.Contains(error.Error(), "failed to shut down service web after SIGTERM and SIGKILL") {
		t.Fatalf("stopStartedService(...) error = %q, want shutdown failure summary", error)
	}
	if !strings.Contains(error.Error(), "listener still active on 127.0.0.1:3010 (pids: 4321)") {
		t.Fatalf("stopStartedService(...) error = %q, want surviving listener details", error)
	}
}

func TestStopStartedServicesAggregatesShutdownFailures(t *testing.T) {
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

	error := stopStartedServices([]*startedService{
		newExitedService("api", firstPort),
		newExitedService("web", secondPort),
	}, 50*time.Millisecond)
	if error == nil {
		t.Fatal("stopStartedServices(...) error = nil, want aggregated shutdown failure")
	}
	if !strings.Contains(error.Error(), "failed to shut down service api after SIGTERM and SIGKILL") {
		t.Fatalf("stopStartedServices(...) error = %q, want api shutdown failure", error)
	}
	if !strings.Contains(error.Error(), "failed to shut down service web after SIGTERM and SIGKILL") {
		t.Fatalf("stopStartedServices(...) error = %q, want web shutdown failure", error)
	}
	if !strings.Contains(error.Error(), "listener still active on 127.0.0.1:3011 (pids: 4001)") {
		t.Fatalf("stopStartedServices(...) error = %q, want first listener details", error)
	}
	if !strings.Contains(error.Error(), "listener still active on 127.0.0.1:3012 (pids: 4002)") {
		t.Fatalf("stopStartedServices(...) error = %q, want second listener details", error)
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
		childPIDText, error := os.ReadFile(childPIDPath)
		if error != nil {
			return
		}
		childPID, error := strconv.Atoi(strings.TrimSpace(string(childPIDText)))
		if error != nil {
			return
		}
		_, _ = syscall.Wait4(childPID, nil, 0, nil)
	})

	startedService, error := startServiceProcess(newResolvedManifest(t.TempDir(), "127.0.0.1:20197"), ResolvedService{
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
	if error != nil {
		t.Fatalf("startServiceProcess(...) error = %v", error)
	}

	startTime := time.Now()
	if error := stopStartedService(startedService, 1500*time.Millisecond); error != nil {
		t.Fatalf("stopStartedService(...) error = %v", error)
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

	probeIPv4, error := net.Listen("tcp4", "127.0.0.1:0")
	if error != nil {
		t.Fatalf("Listen(tcp4) error = %v", error)
	}
	port := probeIPv4.Addr().(*net.TCPAddr).Port
	probeIPv6, error := net.Listen("tcp6", fmt.Sprintf("[::1]:%d", port))
	if error != nil {
		_ = probeIPv4.Close()
		t.Skipf("dual-stack loopback port sharing unavailable: %v", error)
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
		if error := command.Start(); error != nil {
			t.Fatalf("startBoundListener(%q) error = %v", bindHost, error)
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

	ipv4PIDText, error := os.ReadFile(ipv4PIDPath)
	if error != nil {
		t.Fatalf("ReadFile(ipv4PIDPath) error = %v", error)
	}
	ipv6PIDText, error := os.ReadFile(ipv6PIDPath)
	if error != nil {
		t.Fatalf("ReadFile(ipv6PIDPath) error = %v", error)
	}
	ipv4PID, error := strconv.Atoi(strings.TrimSpace(string(ipv4PIDText)))
	if error != nil {
		t.Fatalf("Atoi(ipv4PID) error = %v", error)
	}
	ipv6PID, error := strconv.Atoi(strings.TrimSpace(string(ipv6PIDText)))
	if error != nil {
		t.Fatalf("Atoi(ipv6PID) error = %v", error)
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

	if error := stopStartedServices([]*startedService{firstService, secondService}, 100*time.Millisecond); error != nil {
		t.Fatalf("stopStartedServices(...) error = %v", error)
	}

	if !stringSlicesEqual(signalOrder, []string{"second:terminated", "first:terminated"}) {
		t.Fatalf("signal order = %#v, want reverse-order SIGTERM delivery", signalOrder)
	}
	if firstService.exitCodeValue() != 0 || secondService.exitCodeValue() != 0 {
		t.Fatalf("exit codes = (%d, %d), want graceful exits", firstService.exitCodeValue(), secondService.exitCodeValue())
	}
}

func TestStopStartedServiceEscalatesToSIGKILL(t *testing.T) {
	startedService, error := startServiceProcess(newResolvedManifest(t.TempDir(), "127.0.0.1:20197"), ResolvedService{
		BindHost:   "127.0.0.1",
		Command:    helperCommand(),
		Cwd:        t.TempDir(),
		Env:        map[string]string{"GO_WANT_HELPER_PROCESS": "1", "DEVHOST_HELPER_MODE": "ignore-term"},
		InjectPort: true,
		Name:       "worker",
	}, processStartOptions{environment: map[string]string{}, stderrWriter: ioDiscard{}, stdoutWriter: ioDiscard{}})
	if error != nil {
		t.Fatalf("startServiceProcess(...) error = %v", error)
	}

	time.Sleep(100 * time.Millisecond)
	if error := stopStartedService(startedService, 50*time.Millisecond); error != nil {
		t.Fatalf("stopStartedService(...) error = %v", error)
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
	adminAddress, stopAdmin := startTestAdminServer(t)
	defer stopAdmin()
	writeFakeCaddyExecutable(t, paths.ExecutablePath)

	servicePort := mustReservePort(t)
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
		traceText, error := os.ReadFile(tracePath)
		if error != nil {
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

	traceText, error := os.ReadFile(tracePath)
	if error != nil {
		t.Fatalf("ReadFile(...) error = %v", error)
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

	listener, error := net.Listen("tcp", "127.0.0.1:0")
	if error != nil {
		t.Fatalf("Listen(...) error = %v", error)
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

	health := collectServicesHealth(manifestValue, nil)
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
	case "record-start-and-exit":
		runRecordStartAndExitHelper()
	case "record-start-serve-and-exit":
		runRecordStartServeAndExitHelper()
	case "record-start-and-wait":
		runRecordStartAndWaitHelper()
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

func startTestAdminServer(t *testing.T) (string, func()) {
	t.Helper()

	listener, error := net.Listen("tcp", "127.0.0.1:0")
	if error != nil {
		t.Fatalf("Listen(...) error = %v", error)
	}

	server := &http.Server{Handler: http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.WriteHeader(http.StatusOK)
		_, _ = writer.Write([]byte("{}"))
	})}
	go func() {
		_ = server.Serve(listener)
	}()

	return listener.Addr().String(), func() {
		_ = server.Close()
		_ = listener.Close()
	}
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

func writeFakeCaddyExecutable(t *testing.T, executablePath string) {
	t.Helper()
	if error := os.MkdirAll(filepath.Dir(executablePath), 0o755); error != nil {
		t.Fatalf("MkdirAll(...) error = %v", error)
	}
	if error := os.WriteFile(executablePath, []byte("#!/bin/sh\nexit 0\n"), 0o755); error != nil {
		t.Fatalf("WriteFile(...) error = %v", error)
	}
}

func assertDirectoryEntries(t *testing.T, directoryPath string, want []string) {
	t.Helper()
	entries, error := os.ReadDir(directoryPath)
	if error != nil {
		t.Fatalf("ReadDir(%q) error = %v", directoryPath, error)
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
	entries, error := os.ReadDir(routesDirectoryPath)
	if error != nil {
		t.Fatalf("ReadDir(...) error = %v", error)
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

func mustReservePort(t *testing.T) int {
	t.Helper()
	listener, error := net.Listen("tcp", "127.0.0.1:0")
	if error != nil {
		t.Fatalf("Listen(...) error = %v", error)
	}
	defer listener.Close()
	return listener.Addr().(*net.TCPAddr).Port
}

func reserveUnusedAdminAddress(t *testing.T) string {
	t.Helper()
	return fmt.Sprintf("127.0.0.1:%d", mustReservePort(t))
}

func runAutoPortRetryHelper() {
	port, _ := strconv.Atoi(os.Getenv("PORT"))
	initialPort, _ := strconv.Atoi(os.Getenv("INITIAL_PORT"))
	tracePath := os.Getenv("PORT_TRACE_PATH")
	if port == initialPort {
		_, _ = fmt.Fprintf(os.Stderr, "listen EADDRINUSE: address already in use 127.0.0.1:%d\n", port)
		os.Exit(1)
	}

	if error := os.WriteFile(tracePath, []byte(strconv.Itoa(port)), 0o644); error != nil {
		panic(error)
	}

	server := &http.Server{Addr: fmt.Sprintf("127.0.0.1:%d", port), Handler: http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		_, _ = writer.Write([]byte("ok"))
	})}
	go func() {
		_ = server.ListenAndServe()
	}()
	time.Sleep(250 * time.Millisecond)
	_ = server.Close()
	os.Exit(0)
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

	time.Sleep(250 * time.Millisecond)
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

	if error := os.WriteFile(tracePath, []byte(strings.Join(traceLines, "\n")), 0o644); error != nil {
		panic(error)
	}

	time.Sleep(150 * time.Millisecond)
	_ = server.Close()
	os.Exit(0)
}

func runRecordStartAndExitHelper() {
	appendTraceLine(os.Getenv("START_TRACE_PATH"), os.Getenv("START_TRACE_VALUE"))
	delayMilliseconds, _ := strconv.Atoi(os.Getenv("EXIT_DELAY_MS"))
	time.Sleep(time.Duration(delayMilliseconds) * time.Millisecond)
	os.Exit(0)
}

func runRecordStartServeAndExitHelper() {
	appendTraceLine(os.Getenv("START_TRACE_PATH"), os.Getenv("START_TRACE_VALUE"))
	port, _ := strconv.Atoi(os.Getenv("PORT"))
	delayMilliseconds, _ := strconv.Atoi(os.Getenv("EXIT_DELAY_MS"))
	server := &http.Server{Addr: fmt.Sprintf("127.0.0.1:%d", port), Handler: http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		_, _ = writer.Write([]byte("ok"))
	})}
	go func() {
		_ = server.ListenAndServe()
	}()
	time.Sleep(time.Duration(delayMilliseconds) * time.Millisecond)
	_ = server.Close()
	os.Exit(0)
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
	go func() {
		_ = server.ListenAndServe()
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
	if error := os.WriteFile(tracePath, []byte(strings.Join(claimChecks, "\n")), 0o644); error != nil {
		panic(error)
	}

	time.Sleep(200 * time.Millisecond)
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
	if error := command.Start(); error != nil {
		panic(error)
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
	if error := command.Start(); error != nil {
		panic(error)
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
	if error := command.Start(); error != nil {
		panic(error)
	}

	os.Exit(0)
}

func runSpawnDetachedChildServerOnTermAndExitHelper() {
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, syscall.Signal(15))
	<-signals

	command := exec.Command(os.Args[0], "-test.run=TestServiceHelperProcess", "--")
	command.Env = append(os.Environ(),
		"GO_WANT_HELPER_PROCESS=1",
		"DEVHOST_HELPER_MODE=child-http-server",
		"CHILD_PID_PATH="+os.Getenv("CHILD_PID_PATH"),
		"PORT="+os.Getenv("PORT"),
	)
	command.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if error := command.Start(); error != nil {
		panic(error)
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
	if error := command.Start(); error != nil {
		panic(error)
	}
	if error := os.WriteFile(os.Getenv("CHILD_PID_PATH"), []byte(strconv.Itoa(command.Process.Pid)), 0o644); error != nil {
		panic(error)
	}

	os.Exit(0)
}

func runSignalExternalCoordinatorAndExitOnTermHelper() {
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, syscall.Signal(15))
	<-signals

	if error := os.WriteFile(os.Getenv("TRIGGER_PATH"), []byte("go"), 0o644); error != nil {
		panic(error)
	}

	os.Exit(0)
}

func runDelayedChildServerOnFileHelper() {
	triggerPath := os.Getenv("TRIGGER_PATH")
	delayMilliseconds, _ := strconv.Atoi(os.Getenv("DELAY_MS"))
	for {
		if _, error := os.Stat(triggerPath); error == nil {
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
	if error := command.Start(); error != nil {
		panic(error)
	}

	os.Exit(0)
}

func runChildHTTPServerHelper() {
	bindHost := os.Getenv("BIND_HOST")
	if bindHost == "" {
		bindHost = "127.0.0.1"
	}
	port, _ := strconv.Atoi(os.Getenv("PORT"))
	if error := os.WriteFile(os.Getenv("CHILD_PID_PATH"), []byte(strconv.Itoa(os.Getpid())), 0o644); error != nil {
		panic(error)
	}

	address := fmt.Sprintf("%s:%d", bindHost, port)
	if strings.Contains(bindHost, ":") {
		address = fmt.Sprintf("[%s]:%d", bindHost, port)
	}

	server := &http.Server{Addr: address, Handler: http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		_, _ = writer.Write([]byte("ok"))
	})}
	if error := server.ListenAndServe(); error != nil && error != http.ErrServerClosed {
		panic(error)
	}
}

func runGracefulSignalWaiterHelper() {
	tracePath := os.Getenv("STOP_TRACE_PATH")
	traceValue := os.Getenv("STOP_TRACE_VALUE")
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, syscall.Signal(15))
	<-signals
	file, error := os.OpenFile(tracePath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if error != nil {
		panic(error)
	}
	defer file.Close()
	if _, error := fmt.Fprintln(file, traceValue); error != nil {
		panic(error)
	}
	os.Exit(0)
}

func runIgnoreTermHelper() {
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, syscall.Signal(15))
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
	if error := command.Start(); error != nil {
		panic(error)
	}
}

func runDaemonStatusHelper() {
	tracePath := os.Getenv("LIFECYCLE_TRACE_PATH")
	pidPath := tracePath + ".pid"
	childPidText, error := os.ReadFile(pidPath)
	if error != nil {
		appendTraceLine(tracePath, "status:stopped")
		os.Exit(1)
	}

	childPID, error := strconv.Atoi(strings.TrimSpace(string(childPidText)))
	if error != nil {
		appendTraceLine(tracePath, "status:stopped")
		os.Exit(1)
	}

	if error := syscall.Kill(childPID, 0); error != nil {
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
	childPidText, error := os.ReadFile(pidPath)
	if error != nil {
		return
	}

	childPID, error := strconv.Atoi(strings.TrimSpace(string(childPidText)))
	if error != nil {
		panic(error)
	}

	if error := syscall.Kill(childPID, syscall.SIGTERM); error != nil && error != syscall.ESRCH {
		panic(error)
	}
	port, error := strconv.Atoi(os.Getenv("PORT"))
	if error != nil {
		panic(error)
	}
	waitForDaemonPortToClose(port)
	_ = os.Remove(pidPath)
}

func waitForDaemonPortToClose(port int) {
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if !canConnectToPort("127.0.0.1", port) {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}

	panic(fmt.Sprintf("daemon port %d remained open after stop", port))
}

func hasFiles(directoryPath string) bool {
	entries, error := os.ReadDir(directoryPath)
	if error != nil {
		return false
	}
	return len(entries) > 0
}

func registrationHasDevtoolsPorts(directoryPath string) bool {
	entries, error := os.ReadDir(directoryPath)
	if error != nil {
		return false
	}

	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}

		text, error := os.ReadFile(filepath.Join(directoryPath, entry.Name()))
		if error != nil {
			return false
		}

		return strings.Contains(string(text), `"devtoolsControlPort":`) && strings.Contains(string(text), `"documentInjectionPort":`)
	}

	return false
}

func appendTraceLine(path string, value string) {
	file, error := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if error != nil {
		panic(error)
	}
	defer file.Close()
	if _, error := fmt.Fprintln(file, value); error != nil {
		panic(error)
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
