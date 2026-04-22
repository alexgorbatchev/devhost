package app

import (
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/cli"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/skill"
)

func TestRunHelpShortCircuitsInvalidArguments(t *testing.T) {
	t.Parallel()

	var stdout strings.Builder
	var stderr strings.Builder

	exitCode := Run([]string{"caddy", "restart", "--help"}, "/tmp", &stdout, &stderr)

	if exitCode != 0 {
		t.Fatalf("Run(...) exit code = %d, want 0", exitCode)
	}

	if stdout.String() != cli.HelpText {
		t.Fatalf("Run(...) stdout = %q, want %q", stdout.String(), cli.HelpText)
	}

	if stderr.String() != "" {
		t.Fatalf("Run(...) stderr = %q, want empty", stderr.String())
	}
}

func TestRunSkillPrintsEmbeddedMarkdown(t *testing.T) {
	t.Parallel()

	expectedMarkdown, error := skill.ReadMarkdown()
	if error != nil {
		t.Fatalf("ReadMarkdown(...) error = %v", error)
	}

	var stdout strings.Builder
	var stderr strings.Builder

	exitCode := Run([]string{"skill"}, "/tmp", &stdout, &stderr)

	if exitCode != 0 {
		t.Fatalf("Run(...) exit code = %d, want 0", exitCode)
	}

	if stdout.String() != expectedMarkdown {
		t.Fatalf("Run(...) stdout = %q, want %q", stdout.String(), expectedMarkdown)
	}

	if stderr.String() != "" {
		t.Fatalf("Run(...) stderr = %q, want empty", stderr.String())
	}
}

func TestRunExplicitManifestBypassesUpwardDiscovery(t *testing.T) {
	stateDirectoryPath := t.TempDir()
	t.Setenv("DEVHOST_STATE_DIR", stateDirectoryPath)

	adminAddress, stopAdminServer := startTestAdminServer(t)
	defer stopAdminServer()

	manifestDirectoryPath := t.TempDir()
	manifestPath := writeDevtoolsDisabledProcessManifest(t, manifestDirectoryPath, adminAddress)

	cwd := filepath.Join(t.TempDir(), "nested", "workspace")
	if error := os.MkdirAll(cwd, 0o755); error != nil {
		t.Fatalf("MkdirAll(...) error = %v", error)
	}

	var stdout strings.Builder
	var stderr strings.Builder

	exitCode := Run([]string{"--manifest", manifestPath}, cwd, &stdout, &stderr)

	if exitCode != 0 {
		t.Fatalf("Run(...) exit code = %d, want 0 with stderr %q", exitCode, stderr.String())
	}

	if stdout.String() != "" {
		t.Fatalf("Run(...) stdout = %q, want empty", stdout.String())
	}

	if stderr.String() != "" {
		t.Fatalf("Run(...) stderr = %q, want empty", stderr.String())
	}
}

func TestRunManifestFromEnvironmentBypassesUpwardDiscovery(t *testing.T) {
	stateDirectoryPath := t.TempDir()
	t.Setenv("DEVHOST_STATE_DIR", stateDirectoryPath)

	adminAddress, stopAdminServer := startTestAdminServer(t)
	defer stopAdminServer()

	manifestDirectoryPath := t.TempDir()
	manifestPath := writeDevtoolsDisabledProcessManifest(t, manifestDirectoryPath, adminAddress)
	t.Setenv("DEVHOST_MANIFEST", manifestPath)

	cwd := filepath.Join(t.TempDir(), "nested", "workspace")
	if error := os.MkdirAll(cwd, 0o755); error != nil {
		t.Fatalf("MkdirAll(...) error = %v", error)
	}

	var stdout strings.Builder
	var stderr strings.Builder

	exitCode := Run([]string{}, cwd, &stdout, &stderr)

	if exitCode != 0 {
		t.Fatalf("Run(...) exit code = %d, want 0 with stderr %q", exitCode, stderr.String())
	}

	if stdout.String() != "" {
		t.Fatalf("Run(...) stdout = %q, want empty", stdout.String())
	}

	if stderr.String() != "" {
		t.Fatalf("Run(...) stderr = %q, want empty", stderr.String())
	}
}

func TestRunManifestModeStartsStackWhenDevtoolsDisabled(t *testing.T) {
	stateDirectoryPath := t.TempDir()
	t.Setenv("DEVHOST_STATE_DIR", stateDirectoryPath)

	adminAddress, stopAdminServer := startTestAdminServer(t)
	defer stopAdminServer()

	manifestDirectoryPath := t.TempDir()
	manifestPath := writeDevtoolsDisabledProcessManifest(t, manifestDirectoryPath, adminAddress)

	var stdout strings.Builder
	var stderr strings.Builder

	exitCode := Run([]string{"--manifest", manifestPath}, manifestDirectoryPath, &stdout, &stderr)
	if exitCode != 0 {
		t.Fatalf("Run(...) exit code = %d, want 0 with stderr %q", exitCode, stderr.String())
	}

	if stdout.String() != "" {
		t.Fatalf("Run(...) stdout = %q, want empty", stdout.String())
	}

	if stderr.String() != "" {
		t.Fatalf("Run(...) stderr = %q, want empty", stderr.String())
	}
}

func TestRunManifestModeStartsStackWithoutExplicitManifestPath(t *testing.T) {
	stateDirectoryPath := t.TempDir()
	t.Setenv("DEVHOST_STATE_DIR", stateDirectoryPath)

	adminAddress, stopAdminServer := startTestAdminServer(t)
	defer stopAdminServer()

	manifestDirectoryPath := t.TempDir()
	_ = writeDevtoolsDisabledProcessManifest(t, manifestDirectoryPath, adminAddress)

	var stdout strings.Builder
	var stderr strings.Builder

	exitCode := Run([]string{}, manifestDirectoryPath, &stdout, &stderr)
	if exitCode != 0 {
		t.Fatalf("Run(...) exit code = %d, want 0 with stderr %q", exitCode, stderr.String())
	}

	if stdout.String() != "" {
		t.Fatalf("Run(...) stdout = %q, want empty", stdout.String())
	}

	if stderr.String() != "" {
		t.Fatalf("Run(...) stderr = %q, want empty", stderr.String())
	}
}

func TestRunManifestModeReportsExistingSameManifestFixedPortClaim(t *testing.T) {
	stateDirectoryPath := t.TempDir()
	t.Setenv("DEVHOST_STATE_DIR", stateDirectoryPath)

	adminAddress, stopAdminServer := startTestAdminServer(t)
	defer stopAdminServer()

	manifestDirectoryPath := t.TempDir()
	manifestPath := writeManifestWithAdminAddress(t, manifestDirectoryPath, adminAddress)
	paths := caddy.CreateManagedCaddyPaths(stateDirectoryPath)
	if error := caddy.EnsureManagedCaddyConfig(paths, caddy.ManagedCaddyConfigFallback{AdminAddress: adminAddress}); error != nil {
		t.Fatalf("EnsureManagedCaddyConfig(...) error = %v", error)
	}
	if error := caddy.ClaimFixedPort(caddy.ClaimFixedPortOptions{
		BindHost:                "127.0.0.1",
		ManifestPath:            manifestPath,
		Port:                    3000,
		PortClaimsDirectoryPath: paths.PortClaimsDirectoryPath,
	}); error != nil {
		t.Fatalf("ClaimFixedPort(...) error = %v", error)
	}

	var stdout strings.Builder
	var stderr strings.Builder

	exitCode := Run([]string{"--manifest", manifestPath}, manifestDirectoryPath, &stdout, &stderr)
	if exitCode != 1 {
		t.Fatalf("Run(...) exit code = %d, want 1", exitCode)
	}
	if stdout.String() != "" {
		t.Fatalf("Run(...) stdout = %q, want empty", stdout.String())
	}
	if !strings.Contains(stderr.String(), "127.0.0.1:3000 is already") || !strings.Contains(stderr.String(), "via "+manifestPath) {
		t.Fatalf("Run(...) stderr = %q, want same-directory fixed-port claim message", stderr.String())
	}
}

func TestRunPrintRootCertificateWritesRawCertificate(t *testing.T) {
	temporaryDirectoryPath := t.TempDir()
	t.Setenv("DEVHOST_STATE_DIR", temporaryDirectoryPath)
	rootCertificatePath := filepath.Join(temporaryDirectoryPath, "caddy", "storage", "pki", "authorities", "local", "root.crt")
	if error := os.MkdirAll(filepath.Dir(rootCertificatePath), 0o755); error != nil {
		t.Fatalf("MkdirAll(...) error = %v", error)
	}

	certificate := "-----BEGIN CERTIFICATE-----\nhello\n"
	if error := os.WriteFile(rootCertificatePath, []byte(certificate), 0o644); error != nil {
		t.Fatalf("WriteFile(...) error = %v", error)
	}

	var stdout strings.Builder
	var stderr strings.Builder

	exitCode := Run([]string{"caddy", "print-root-cert"}, temporaryDirectoryPath, &stdout, &stderr)
	if exitCode != 0 {
		t.Fatalf("Run(...) exit code = %d, want 0", exitCode)
	}

	if stdout.String() != certificate {
		t.Fatalf("Run(...) stdout = %q, want %q", stdout.String(), certificate)
	}

	if stderr.String() != "" {
		t.Fatalf("Run(...) stderr = %q, want empty", stderr.String())
	}
}

func TestRunTrustRemoteRejectsUnsupportedPlatform(t *testing.T) {
	t.Parallel()

	var stdout strings.Builder
	var stderr strings.Builder

	exitCode := Run([]string{"caddy", "trust-remote", "devbox"}, "/tmp", &stdout, &stderr)
	if exitCode != 1 {
		t.Fatalf("Run(...) exit code = %d, want 1", exitCode)
	}

	if stdout.String() != "" {
		t.Fatalf("Run(...) stdout = %q, want empty", stdout.String())
	}
}

func TestRunCaddyPrivilegedPortsUsesLifecyclePath(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("linux-specific privileged-ports behavior")
	}

	stateDirectoryPath := t.TempDir()
	t.Setenv("DEVHOST_STATE_DIR", stateDirectoryPath)
	managedCaddyPath := filepath.Join(stateDirectoryPath, "caddy", "caddy")
	if error := os.MkdirAll(filepath.Dir(managedCaddyPath), 0o755); error != nil {
		t.Fatalf("MkdirAll(...) error = %v", error)
	}
	if error := os.WriteFile(managedCaddyPath, []byte("#!/bin/sh\nexit 0\n"), 0o755); error != nil {
		t.Fatalf("WriteFile(...) error = %v", error)
	}

	binDirectoryPath := t.TempDir()
	argumentsPath := filepath.Join(t.TempDir(), "sudo-args.txt")
	t.Setenv("DEVHOST_TEST_ARGS_FILE", argumentsPath)
	t.Setenv("PATH", binDirectoryPath+string(os.PathListSeparator)+os.Getenv("PATH"))
	writeExecutable(t, filepath.Join(binDirectoryPath, "sudo"), strings.Join([]string{
		"#!/bin/sh",
		"printf '%s\\n' \"$@\" > \"$DEVHOST_TEST_ARGS_FILE\"",
		"exit 0",
	}, "\n"))

	var stdout strings.Builder
	var stderr strings.Builder
	exitCode := Run([]string{"caddy", "privileged-ports"}, stateDirectoryPath, &stdout, &stderr)
	if exitCode != 0 {
		t.Fatalf("Run(...) exit code = %d, want 0 with stderr %q", exitCode, stderr.String())
	}
	if stdout.String() != "" {
		t.Fatalf("Run(...) stdout = %q, want empty", stdout.String())
	}
	if !strings.Contains(stderr.String(), "[devhost] managed caddy low-port binding enabled for "+managedCaddyPath) {
		t.Fatalf("Run(...) stderr = %q, want privileged-port success log", stderr.String())
	}

	arguments, error := os.ReadFile(argumentsPath)
	if error != nil {
		t.Fatalf("ReadFile(...) error = %v", error)
	}
	if string(arguments) != strings.Join([]string{"setcap", "cap_net_bind_service=+ep", managedCaddyPath, ""}, "\n") {
		t.Fatalf("sudo arguments = %q", string(arguments))
	}
}

func TestRunCaddyStartUsesManifestAdminAddress(t *testing.T) {
	stateDirectoryPath := t.TempDir()
	t.Setenv("DEVHOST_STATE_DIR", stateDirectoryPath)

	binDirectoryPath := t.TempDir()
	argumentsPath := filepath.Join(t.TempDir(), "caddy-args.txt")
	t.Setenv("DEVHOST_TEST_ARGS_FILE", argumentsPath)
	t.Setenv("PATH", binDirectoryPath+string(os.PathListSeparator)+os.Getenv("PATH"))
	writeExecutable(t, filepath.Join(binDirectoryPath, "caddy"), strings.Join([]string{
		"#!/bin/sh",
		"printf '%s\\n' \"$@\" > \"$DEVHOST_TEST_ARGS_FILE\"",
		"exit 0",
	}, "\n"))

	manifestDirectoryPath := t.TempDir()
	adminAddress := reserveUnusedAdminAddress(t)
	manifestPath := writeManifestWithAdminAddress(t, manifestDirectoryPath, adminAddress)

	var stdout strings.Builder
	var stderr strings.Builder
	exitCode := Run([]string{"--manifest", manifestPath, "caddy", "start"}, manifestDirectoryPath, &stdout, &stderr)
	if exitCode != 0 {
		t.Fatalf("Run(...) exit code = %d, want 0 with stderr %q", exitCode, stderr.String())
	}
	if stdout.String() != "" {
		t.Fatalf("Run(...) stdout = %q, want empty", stdout.String())
	}
	if !strings.Contains(stderr.String(), "[devhost] managed caddy started with ") {
		t.Fatalf("Run(...) stderr = %q, want managed caddy start log", stderr.String())
	}

	caddyfilePath := filepath.Join(stateDirectoryPath, "caddy", "Caddyfile")
	caddyfile, error := os.ReadFile(caddyfilePath)
	if error != nil {
		t.Fatalf("ReadFile(...) error = %v", error)
	}
	if !strings.Contains(string(caddyfile), "    admin "+adminAddress) {
		t.Fatalf("Caddyfile = %q, want manifest admin address", string(caddyfile))
	}

	arguments, error := os.ReadFile(argumentsPath)
	if error != nil {
		t.Fatalf("ReadFile(...) error = %v", error)
	}
	if string(arguments) != strings.Join([]string{"start", "--pidfile", filepath.Join(stateDirectoryPath, "caddy", "caddy.pid"), "--config", caddyfilePath, "--adapter", "caddyfile", ""}, "\n") {
		t.Fatalf("caddy arguments = %q", string(arguments))
	}
}

func TestRunCaddyStopWithoutRunningProcess(t *testing.T) {
	stateDirectoryPath := t.TempDir()
	t.Setenv("DEVHOST_STATE_DIR", stateDirectoryPath)
	manifestDirectoryPath := t.TempDir()
	manifestPath := writeManifestWithAdminAddress(t, manifestDirectoryPath, reserveUnusedAdminAddress(t))

	var stdout strings.Builder
	var stderr strings.Builder
	exitCode := Run([]string{"--manifest", manifestPath, "caddy", "stop"}, stateDirectoryPath, &stdout, &stderr)
	if exitCode != 0 {
		t.Fatalf("Run(...) exit code = %d, want 0", exitCode)
	}
	if stdout.String() != "" {
		t.Fatalf("Run(...) stdout = %q, want empty", stdout.String())
	}
	if !strings.Contains(stderr.String(), "[devhost] managed caddy is not running.\n") {
		t.Fatalf("Run(...) stderr = %q, want managed caddy stop idle log", stderr.String())
	}
}

func TestRunCaddyTrustRequiresRunningManagedCaddy(t *testing.T) {
	stateDirectoryPath := t.TempDir()
	t.Setenv("DEVHOST_STATE_DIR", stateDirectoryPath)
	manifestDirectoryPath := t.TempDir()
	manifestPath := writeManifestWithAdminAddress(t, manifestDirectoryPath, reserveUnusedAdminAddress(t))

	var stdout strings.Builder
	var stderr strings.Builder
	exitCode := Run([]string{"--manifest", manifestPath, "caddy", "trust"}, stateDirectoryPath, &stdout, &stderr)
	if exitCode != 1 {
		t.Fatalf("Run(...) exit code = %d, want 1", exitCode)
	}
	if stdout.String() != "" {
		t.Fatalf("Run(...) stdout = %q, want empty", stdout.String())
	}
	wantStderr := strings.Join([]string{
		"[devhost] managed caddy trust may prompt for your password because installing a root CA into the system trust store is privileged.",
		"failed: Managed Caddy is not running. Run 'devhost caddy start' first.",
		"",
	}, "\n")
	if stderr.String() != wantStderr {
		t.Fatalf("Run(...) stderr = %q, want %q", stderr.String(), wantStderr)
	}
}

func TestRunPreservesSignalExitCodes(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("signal exit parity is only exercised on POSIX platforms")
	}

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
			adminAddress, stopAdminServer := startTestAdminServer(t)
			defer stopAdminServer()

			manifestDirectoryPath := t.TempDir()
			startTracePath := filepath.Join(t.TempDir(), "signal-start.txt")
			stopTracePath := filepath.Join(t.TempDir(), "signal-stop.txt")
			manifestPath := writeSignalProcessManifest(t, manifestDirectoryPath, adminAddress, startTracePath, stopTracePath)

			command := exec.Command(os.Args[0], "-test.run=TestRunSignalProcessHelper", "--")
			command.Env = append(os.Environ(),
				"GO_WANT_RUN_SIGNAL_HELPER=1",
				"DEVHOST_RUN_HELPER_MANIFEST="+manifestPath,
				"DEVHOST_RUN_HELPER_CWD="+manifestDirectoryPath,
				"DEVHOST_STATE_DIR="+stateDirectoryPath,
			)
			if error := command.Start(); error != nil {
				t.Fatalf("Start(...) error = %v", error)
			}

			waitForFile(t, startTracePath)

			if error := command.Process.Signal(tc.signal); error != nil {
				t.Fatalf("Signal(...) error = %v", error)
			}

			error := command.Wait()
			exitError, ok := error.(*exec.ExitError)
			if !ok {
				t.Fatalf("Wait(...) error = %v, want exit error", error)
			}
			if exitError.ExitCode() != tc.wantExitCode {
				t.Fatalf("ExitCode() = %d, want %d", exitError.ExitCode(), tc.wantExitCode)
			}

			waitForFile(t, stopTracePath)
		})
	}
}

func TestRunSignalProcessHelper(t *testing.T) {
	if os.Getenv("GO_WANT_RUN_SIGNAL_HELPER") != "1" {
		return
	}

	manifestPath := os.Getenv("DEVHOST_RUN_HELPER_MANIFEST")
	cwd := os.Getenv("DEVHOST_RUN_HELPER_CWD")
	exitCode := Run([]string{"--manifest", manifestPath}, cwd, os.Stdout, os.Stderr)
	os.Exit(exitCode)
}

func TestRunSignalServiceHelperProcess(t *testing.T) {
	if os.Getenv("GO_WANT_RUN_SIGNAL_SERVICE_HELPER") != "1" {
		return
	}

	appendRunHelperTrace(os.Getenv("DEVHOST_SIGNAL_START_TRACE_PATH"), "worker-started")
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, syscall.SIGINT, syscall.SIGHUP, syscall.SIGTERM)
	<-signals
	appendRunHelperTrace(os.Getenv("DEVHOST_SIGNAL_STOP_TRACE_PATH"), "worker-stopped")
	os.Exit(0)
}

func writeExecutable(t *testing.T, path string, text string) {
	t.Helper()
	if error := os.WriteFile(path, []byte(text), 0o755); error != nil {
		t.Fatalf("WriteFile(...) error = %v", error)
	}
}

func writeManifestWithAdminAddress(t *testing.T, directoryPath string, adminAddress string) string {
	t.Helper()
	manifestPath := filepath.Join(directoryPath, "devhost.toml")
	manifestText := strings.Join([]string{
		`name = "hello-stack"`,
		"",
		"[caddy.global]",
		`adminAddress = "` + adminAddress + `"`,
		"",
		"[services.web]",
		`command = "bun run dev"`,
		"port = 3000",
	}, "\n")
	if error := os.WriteFile(manifestPath, []byte(manifestText), 0o644); error != nil {
		t.Fatalf("WriteFile(...) error = %v", error)
	}

	return manifestPath
}

func writeSignalProcessManifest(
	t *testing.T,
	directoryPath string,
	adminAddress string,
	startTracePath string,
	stopTracePath string,
) string {
	t.Helper()

	manifestPath := filepath.Join(directoryPath, "devhost.toml")
	commandText := strings.Join([]string{
		os.Args[0],
		"-test.run=TestRunSignalServiceHelperProcess",
		"--",
	}, " ")
	manifestText := strings.Join([]string{
		`name = "hello-stack"`,
		"",
		"[caddy.global]",
		`adminAddress = "` + adminAddress + `"`,
		"",
		"[devtools.editor]",
		"enabled = false",
		"",
		"[devtools.externalToolbars]",
		"enabled = false",
		"",
		"[devtools.minimap]",
		"enabled = false",
		"",
		"[devtools.status]",
		"enabled = false",
		"",
		"[services.worker]",
		`command = "` + commandText + `"`,
		"",
		"[services.worker.env]",
		`GO_WANT_RUN_SIGNAL_SERVICE_HELPER = "1"`,
		`DEVHOST_SIGNAL_START_TRACE_PATH = "` + startTracePath + `"`,
		`DEVHOST_SIGNAL_STOP_TRACE_PATH = "` + stopTracePath + `"`,
		"",
		"[services.worker.health]",
		"process = true",
	}, "\n")
	if error := os.WriteFile(manifestPath, []byte(manifestText), 0o644); error != nil {
		t.Fatalf("WriteFile(...) error = %v", error)
	}

	return manifestPath
}

func writeDevtoolsDisabledProcessManifest(t *testing.T, directoryPath string, adminAddress string) string {
	t.Helper()

	manifestPath := filepath.Join(directoryPath, "devhost.toml")
	manifestText := strings.Join([]string{
		`name = "hello-stack"`,
		"",
		"[caddy.global]",
		`adminAddress = "` + adminAddress + `"`,
		"",
		"[devtools.editor]",
		"enabled = false",
		"",
		"[devtools.externalToolbars]",
		"enabled = false",
		"",
		"[devtools.minimap]",
		"enabled = false",
		"",
		"[devtools.status]",
		"enabled = false",
		"",
		"[services.worker]",
		`command = "/bin/sh -c exit 0"`,
		"",
		"[services.worker.health]",
		"process = true",
	}, "\n")
	if error := os.WriteFile(manifestPath, []byte(manifestText), 0o644); error != nil {
		t.Fatalf("WriteFile(...) error = %v", error)
	}

	return manifestPath
}

func reserveUnusedAdminAddress(t *testing.T) string {
	t.Helper()
	listener, error := net.Listen("tcp", "127.0.0.1:0")
	if error != nil {
		t.Fatalf("Listen(...) error = %v", error)
	}
	address := listener.Addr().String()
	if error := listener.Close(); error != nil {
		t.Fatalf("Close(...) error = %v", error)
	}

	return address
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

func waitForFile(t *testing.T, filePath string) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if _, error := os.Stat(filePath); error == nil {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}

	t.Fatalf("file %q was not created before timeout", filePath)
}

func appendRunHelperTrace(filePath string, value string) {
	file, error := os.OpenFile(filePath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if error != nil {
		panic(error)
	}
	defer file.Close()
	if _, error := file.WriteString(value + "\n"); error != nil {
		panic(error)
	}
}
