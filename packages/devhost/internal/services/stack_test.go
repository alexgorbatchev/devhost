package services

import (
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/alexgorbatchev/devhost/packages/devhost/internal/caddy"
	"github.com/alexgorbatchev/devhost/packages/devhost/internal/manifest"
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

func TestStartStackCleanupReleasesClaimsAfterStartupFailure(t *testing.T) {
	stateDirectoryPath := t.TempDir()
	paths := caddy.CreateManagedCaddyPaths(stateDirectoryPath)
	adminAddress, stopAdmin := startTestAdminServer(t)
	defer stopAdmin()

	manifestValue := newResolvedManifest(adminAddress)
	manifestValue.PrimaryService = "web"
	manifestValue.Services["web"] = ResolvedService{
		BindHost:   "127.0.0.1",
		Command:    helperCommand(),
		Cwd:        t.TempDir(),
		DependsOn:  []string{},
		Env: map[string]string{
			"GO_WANT_HELPER_PROCESS": "1",
			"DEVHOST_HELPER_MODE":    "exit-1",
		},
		Health: ResolvedHealthConfig{Host: stringPointer("127.0.0.1"), Interval: 50, Kind: "tcp", Port: intPointer(mustReservePort(t)), Retries: 0, Timeout: 200},
		Host:       stringPointer("cleanup.localhost"),
		InjectPort: true,
		Name:       "web",
		Path:       stringPointer("/"),
		Port:       intPointer(mustReservePort(t)),
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

	manifestValue := newResolvedManifest(adminAddress)
	manifestValue.Name = "retry-stack"
	manifestValue.PrimaryService = "web"
	manifestValue.Services["web"] = ResolvedService{
		BindHost:   "127.0.0.1",
		Command:    helperCommand(),
		Cwd:        t.TempDir(),
		DependsOn:  []string{},
		Env: map[string]string{
			"GO_WANT_HELPER_PROCESS": "1",
			"DEVHOST_HELPER_MODE":    "auto-port-retry-server",
			"INITIAL_PORT":           strconv.Itoa(initialPort),
			"PORT_TRACE_PATH":        tracePath,
		},
		Health: ResolvedHealthConfig{Host: stringPointer("127.0.0.1"), Interval: 50, Kind: "tcp", Port: intPointer(initialPort), Retries: 0, Timeout: 5000},
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

func TestStartStackActivatesRoutesAndCleansUpAfterExit(t *testing.T) {
	stateDirectoryPath := t.TempDir()
	paths := caddy.CreateManagedCaddyPaths(stateDirectoryPath)
	adminAddress, stopAdmin := startTestAdminServer(t)
	defer stopAdmin()
	writeFakeCaddyExecutable(t, paths.ExecutablePath)

	servicePort := mustReservePort(t)
	tracePath := filepath.Join(t.TempDir(), "service-trace.txt")
	var infoLog strings.Builder

	manifestValue := newResolvedManifest(adminAddress)
	manifestValue.Name = "route-stack"
	manifestValue.PrimaryService = "web"
	manifestValue.Services["web"] = ResolvedService{
		BindHost:   "127.0.0.1",
		Command:    helperCommand(),
		Cwd:        t.TempDir(),
		DependsOn:  []string{},
		Env: map[string]string{
			"GO_WANT_HELPER_PROCESS":       "1",
			"DEVHOST_HELPER_MODE":          "route-aware-http-server",
			"TRACE_PATH":                   tracePath,
			"HOST_CLAIMS_DIRECTORY_PATH":   paths.HostClaimsDirectoryPath,
			"PORT_CLAIMS_DIRECTORY_PATH":   paths.PortClaimsDirectoryPath,
			"REGISTRATIONS_DIRECTORY_PATH": paths.RegistrationsDirectoryPath,
		},
		Health: ResolvedHealthConfig{Host: stringPointer("127.0.0.1"), Interval: 50, Kind: "tcp", Port: intPointer(servicePort), Retries: 0, Timeout: 5000},
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

func TestStopStartedServicesStopsInReverseOrder(t *testing.T) {
	firstLogPath := filepath.Join(t.TempDir(), "first-stop.txt")
	secondLogPath := filepath.Join(t.TempDir(), "second-stop.txt")

	firstService, error := startServiceProcess(newResolvedManifest("127.0.0.1:20197"), ResolvedService{
		BindHost:   "127.0.0.1",
		Command:    helperCommand(),
		Cwd:        t.TempDir(),
		Env:        map[string]string{"GO_WANT_HELPER_PROCESS": "1", "DEVHOST_HELPER_MODE": "graceful-signal-waiter", "STOP_TRACE_PATH": firstLogPath, "STOP_TRACE_VALUE": "first"},
		InjectPort: true,
		Name:       "first",
	}, processStartOptions{environment: map[string]string{}, stderrWriter: ioDiscard{}, stdoutWriter: ioDiscard{}})
	if error != nil {
		t.Fatalf("startServiceProcess(first) error = %v", error)
	}

	secondService, error := startServiceProcess(newResolvedManifest("127.0.0.1:20197"), ResolvedService{
		BindHost:   "127.0.0.1",
		Command:    helperCommand(),
		Cwd:        t.TempDir(),
		Env:        map[string]string{"GO_WANT_HELPER_PROCESS": "1", "DEVHOST_HELPER_MODE": "graceful-signal-waiter", "STOP_TRACE_PATH": secondLogPath, "STOP_TRACE_VALUE": "second"},
		InjectPort: true,
		Name:       "second",
	}, processStartOptions{environment: map[string]string{}, stderrWriter: ioDiscard{}, stdoutWriter: ioDiscard{}})
	if error != nil {
		t.Fatalf("startServiceProcess(second) error = %v", error)
	}

	stopStartedServices([]*startedService{firstService, secondService}, 100*time.Millisecond)

	firstTrace, error := os.ReadFile(firstLogPath)
	if error != nil {
		t.Fatalf("ReadFile(first) error = %v", error)
	}
	secondTrace, error := os.ReadFile(secondLogPath)
	if error != nil {
		t.Fatalf("ReadFile(second) error = %v", error)
	}

	if strings.TrimSpace(string(secondTrace)) != "second" {
		t.Fatalf("second trace = %q, want second", strings.TrimSpace(string(secondTrace)))
	}
	if strings.TrimSpace(string(firstTrace)) != "first" {
		t.Fatalf("first trace = %q, want first", strings.TrimSpace(string(firstTrace)))
	}
	if secondService.exitCodeValue() != 0 || firstService.exitCodeValue() != 0 {
		t.Fatalf("exit codes = (%d, %d), want graceful exits", secondService.exitCodeValue(), firstService.exitCodeValue())
	}
}

func TestStopStartedServiceEscalatesToSIGKILL(t *testing.T) {
	startedService, error := startServiceProcess(newResolvedManifest("127.0.0.1:20197"), ResolvedService{
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

func newResolvedManifest(adminAddress string) ResolvedManifest {
	return ResolvedManifest{
		Agent: manifest.ValidatedAgent{DisplayName: "Pi", Kind: "pi"},
		Caddy: manifest.CaddyConfig{Global: manifest.CaddyGlobalConfig{AdminAddress: adminAddress, BindHost: "127.0.0.1", HTTP: false, HTTPPort: 80, HTTPSPort: 443}},
		Devtools: manifest.DevtoolsConfig{
			Editor:           manifest.DevtoolsEditorConfig{Enabled: false, IDE: "vscode"},
			ExternalToolbars: manifest.DevtoolsToggleConfig{Enabled: false},
			Minimap:          manifest.DevtoolsMinimapConfig{Enabled: false, Position: "right"},
			Status:           manifest.DevtoolsStatusConfig{Enabled: false, Position: "bottom-right"},
		},
		ManifestDirectoryPath: tTempDir(),
		ManifestPath:          filepath.Join(tTempDir(), "devhost.toml"),
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
	if error := os.WriteFile(tracePath, []byte(traceValue), 0o644); error != nil {
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

func stringPointer(value string) *string {
	copyValue := value
	return &copyValue
}

func intPointer(value int) *int {
	copyValue := value
	return &copyValue
}
