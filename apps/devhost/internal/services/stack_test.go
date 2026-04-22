package services

import (
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
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
	if infoLines[1] != fmt.Sprintf("[retry-stack] primary web -> http://127.0.0.1:%d", *finalPort) {
		t.Fatalf("primary log = %q", infoLines[1])
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

	if lines := nonEmptyLines(infoLog.String()); len(lines) != 1 || lines[0] != "[route-stack] primary https://hello.localhost" {
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
	stopStartedServices([]*startedService{firstService, secondService}, 100*time.Millisecond)

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

	stopStartedServices([]*startedService{firstService, secondService}, 100*time.Millisecond)

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
	stopStartedService(startedService, 50*time.Millisecond)
	if startedService.exitCodeValue() != -1 {
		t.Fatalf("exit code = %d, want signal exit", startedService.exitCodeValue())
	}
	if waitForExitWithinGracePeriod(startedService, 50*time.Millisecond) != true {
		t.Fatal("waitForExitWithinGracePeriod(...) = false, want true for exited process")
	}
}

func TestServiceHelperProcess(t *testing.T) {
	if os.Getenv("GO_WANT_HELPER_PROCESS") != "1" {
		return
	}

	switch os.Getenv("DEVHOST_HELPER_MODE") {
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
	case "graceful-signal-waiter":
		runGracefulSignalWaiterHelper()
	case "ignore-term":
		runIgnoreTermHelper()
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
		Agent: manifest.ValidatedAgent{DisplayName: "Pi", Kind: "pi"},
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
