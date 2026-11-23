package app

import (
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/cliout"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/devtools"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/services"
)

func TestStackInfoSubfolderDiscoveryForegroundAndToolbarOff(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("stack signal lifecycle is exercised on POSIX platforms")
	}

	stateDir := t.TempDir()
	t.Setenv("DEVHOST_STATE_DIR", stateDir)
	t.Setenv("DEVHOST_TEST_CLI", "1")
	useSharedCaddy(t, stateDir)

	projectDir := t.TempDir()
	nestedDir := filepath.Join(projectDir, "apps", "web", "src")
	includedDir := filepath.Join(projectDir, "admin")
	if err := os.MkdirAll(nestedDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(includedDir, 0o755); err != nil {
		t.Fatal(err)
	}

	webReady := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, "ok")
	}))
	t.Cleanup(webReady.Close)

	includedManifest := filepath.Join(includedDir, "devhost.toml")
	includedContent := fmt.Sprintf(`[services.worker]
command = [%q, "-test.run=TestStackInfoServiceHelper", "--"]
[services.worker.health]
process = true
[services.worker.env]
DEVHOST_INFO_HELPER_MODE = "stay"
`, os.Args[0])
	if err := os.WriteFile(includedManifest, []byte(includedContent), 0o600); err != nil {
		t.Fatal(err)
	}

	rootManifest := filepath.Join(projectDir, "devhost.toml")
	rootContent := fmt.Sprintf(`name = "Acme Shop"
includes = ["admin/devhost.toml"]

[worktrees]
enabled = false

[devtools.status]
enabled = false

[devtools.minimap]
enabled = false

[devtools.editor]
enabled = false

[devtools.externalToolbars]
enabled = false

[devtools.chat]
enabled = false

[devtools.annotations]
enabled = false

[devtools.configEditor]
enabled = false

[devtools.resources]
enabled = false

[services.web]
command = [%q, "-test.run=TestStackInfoServiceHelper", "--"]
host = "shop-info.localhost"
port = "auto"
primary = true
[services.web.health]
http = %q
interval = 20
timeout = 5000
[services.web.env]
DEVHOST_INFO_HELPER_MODE = "stay"
`, os.Args[0], webReady.URL)
	if err := os.WriteFile(rootManifest, []byte(rootContent), 0o600); err != nil {
		t.Fatal(err)
	}

	stackCmd := exec.Command(os.Args[0], "start", "--manifest", rootManifest)
	stackCmd.Dir = projectDir
	stackCmd.Env = append(os.Environ(), "DEVHOST_TEST_CLI=1", "DEVHOST_STATE_DIR="+stateDir)
	if err := stackCmd.Start(); err != nil {
		t.Fatalf("start foreground stack: %v", err)
	}
	t.Cleanup(func() {
		_ = stackCmd.Process.Signal(syscall.SIGTERM)
		_ = stackCmd.Wait()
	})

	waitForStackInfoReady(t, stateDir, rootManifest)

	// Human mode from project root and nested subfolder must describe the same stack.
	t.Setenv("AGENT", "0")
	rootHuman := runStackInfoExpectCode(t, projectDir, 0)
	subHuman := runStackInfoExpectCode(t, nestedDir, 0)
	includedHuman := runStackInfoExpectCode(t, includedDir, 0)
	for label, output := range map[string]string{"root": rootHuman, "subfolder": subHuman, "included": includedHuman} {
		for _, want := range []string{
			fmt.Sprintf("Acme Shop · running · PID %d · foreground · up ", stackCmd.Process.Pid),
			"web (primary)",
			"ready",
			"https://shop-info.localhost",
			"worker",
			"(no route)",
		} {
			if !strings.Contains(output, want) {
				t.Fatalf("%s human output missing %q:\n%s", label, want, output)
			}
		}
		if strings.Contains(output, "Log:") {
			t.Fatalf("%s foreground human output unexpectedly contains Log:\n%s", label, output)
		}
	}

	// Agent mode from project root and nested subfolder must match identically.
	t.Setenv("AGENT", "1")
	rootAgent := runStackInfoExpectCode(t, projectDir, 0)
	subAgent := runStackInfoExpectCode(t, nestedDir, 0)
	if rootAgent != subAgent {
		t.Fatalf("root and subfolder AGENT=1 outputs differ:\nroot:\n%s\nsub:\n%s", rootAgent, subAgent)
	}
	for _, want := range []string{
		fmt.Sprintf(`devhost: stack name="Acme Shop" pid=%d mode=foreground ready=true manifest=%s manifestFiles=%s,%s controlPort=`, stackCmd.Process.Pid, rootManifest, rootManifest, includedManifest),
		"createdAt=",
		"devhost: service name=web state=ready primary=true since=",
		"port=",
		"url=https://shop-info.localhost",
		"devhost: service name=worker state=ready since=",
	} {
		if !strings.Contains(rootAgent, want) {
			t.Fatalf("AGENT=1 output missing %q:\n%s", want, rootAgent)
		}
	}
	if strings.Contains(rootAgent, " log=") {
		t.Fatalf("foreground AGENT=1 output unexpectedly contains log=:\n%s", rootAgent)
	}
}

func TestStackInfoDetachedAndCrashedService(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("detached startup runs on Linux and macOS")
	}

	stateDir := t.TempDir()
	t.Setenv("DEVHOST_STATE_DIR", stateDir)
	t.Setenv("DEVHOST_TEST_CLI", "1")
	useSharedCaddy(t, stateDir)

	projectDir := t.TempDir()
	crashSignalFile := filepath.Join(projectDir, "crash.trigger")
	readyFile := filepath.Join(projectDir, "api.ready")

	manifestPath := filepath.Join(projectDir, "devhost.toml")
	manifestContent := fmt.Sprintf(`name = "Shop"

[worktrees]
enabled = false

[services.web]
command = [%q, "-test.run=TestStackInfoServiceHelper", "--"]
host = "web-crash.localhost"
port = "auto"
primary = true
[services.web.env]
DEVHOST_INFO_HELPER_MODE = "stay"

[services.api]
command = [%q, "-test.run=TestStackInfoServiceHelper", "--"]
host = "web-crash.localhost"
path = "/api/*"
port = "auto"
[services.api.env]
DEVHOST_INFO_HELPER_MODE = "crash-on-file"
DEVHOST_INFO_CRASH_FILE = %q
DEVHOST_INFO_READY_FILE = %q
`, os.Args[0], os.Args[0], crashSignalFile, readyFile)
	if err := os.WriteFile(manifestPath, []byte(manifestContent), 0o600); err != nil {
		t.Fatal(err)
	}

	t.Cleanup(func() {
		var out strings.Builder
		_ = Run([]string{"stop", "--manifest", manifestPath}, projectDir, &out, &out)
	})

	t.Setenv("AGENT", "1")
	var startOut, startErr strings.Builder
	if code := Run([]string{"start", "--detach"}, projectDir, &startOut, &startErr); code != 0 {
		t.Fatalf("start --detach exited %d:\nstdout:\n%s\nstderr:\n%s", code, startOut.String(), startErr.String())
	}
	waitForFile(t, readyFile)

	// While both services are healthy, stack info exits 0 and reports detached mode + log path.
	healthyAgent := runStackInfoExpectCode(t, projectDir, 0)
	if !strings.Contains(healthyAgent, "mode=detached ready=true") || !strings.Contains(healthyAgent, "log="+filepath.Join(stateDir, "logs")) {
		t.Fatalf("detached healthy AGENT=1 output unexpected:\n%s", healthyAgent)
	}

	t.Setenv("AGENT", "0")
	healthyHuman := runStackInfoExpectCode(t, projectDir, 0)
	if !strings.Contains(healthyHuman, "Shop · running · PID ") || !strings.Contains(healthyHuman, " · detached · ") || !strings.Contains(healthyHuman, "Log: "+cliout.DisplayPath(filepath.Join(stateDir, "logs"))) {
		t.Fatalf("detached healthy human output unexpected:\n%s", healthyHuman)
	}

	// Trigger api crash with exit code 7 and a known stderr line.
	if err := os.WriteFile(crashSignalFile, []byte("crash\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		t.Setenv("AGENT", "1")
		var out, errBuf strings.Builder
		code := Run([]string{"stack", "info"}, projectDir, &out, &errBuf)
		if code == 1 && strings.Contains(out.String(), "state=exited exitCode=7") {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}

	// Crashed state in AGENT=1 mode: exits 1, reports exited 7, ready=false, and last output line.
	t.Setenv("AGENT", "1")
	crashedAgent := runStackInfoExpectCode(t, projectDir, 1)
	for _, want := range []string{
		"mode=detached ready=false",
		"devhost: service name=web state=ready primary=true",
		"devhost: service name=api state=exited exitCode=7",
		"url=https://web-crash.localhost/api/",
		`last="fatal: lost connection to database"`,
	} {
		if !strings.Contains(crashedAgent, want) {
			t.Fatalf("crashed AGENT=1 output missing %q:\n%s", want, crashedAgent)
		}
	}

	// Crashed state in human mode: exits 1, reports degraded and exited 7.
	t.Setenv("AGENT", "0")
	crashedHuman := runStackInfoExpectCode(t, projectDir, 1)
	for _, want := range []string{
		"Shop · degraded · PID ",
		"exited 7",
		"https://web-crash.localhost/api/",
		"  └ fatal: lost connection to database",
		"Log: ",
	} {
		if !strings.Contains(crashedHuman, want) {
			t.Fatalf("crashed human output missing %q:\n%s", want, crashedHuman)
		}
	}
}

func TestStackInfoNoRunningStackAndNoManifest(t *testing.T) {
	stateDir := t.TempDir()
	t.Setenv("DEVHOST_STATE_DIR", stateDir)

	// No manifest found: must exit nonzero and mention --manifest in both modes.
	emptyDir := t.TempDir()
	for _, agent := range []string{"0", "1"} {
		t.Setenv("AGENT", agent)
		var stdout, stderr strings.Builder
		code := Run([]string{"stack", "info"}, emptyDir, &stdout, &stderr)
		if code != 1 {
			t.Fatalf("AGENT=%s no-manifest exit code = %d, want 1", agent, code)
		}
		if stdout.Len() != 0 {
			t.Fatalf("AGENT=%s no-manifest stdout = %q, want empty", agent, stdout.String())
		}
		if !strings.Contains(stderr.String(), "devhost.toml") || !strings.Contains(stderr.String(), "--manifest") {
			t.Fatalf("AGENT=%s no-manifest stderr = %q, want manifest message naming --manifest", agent, stderr.String())
		}
	}

	// Manifest exists on disk, but no stack is running: must name the manifest and exit nonzero.
	projectDir := t.TempDir()
	manifestPath := filepath.Join(projectDir, "devhost.toml")
	if err := os.WriteFile(manifestPath, []byte("name = \"idle\"\n[services.web]\ncommand = [\"true\"]\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	for _, agent := range []string{"0", "1"} {
		t.Setenv("AGENT", agent)
		var stdout, stderr strings.Builder
		code := Run([]string{"stack", "info"}, projectDir, &stdout, &stderr)
		if code != 1 {
			t.Fatalf("AGENT=%s no-stack exit code = %d, want 1", agent, code)
		}
		if stdout.Len() != 0 {
			t.Fatalf("AGENT=%s no-stack stdout = %q, want empty", agent, stdout.String())
		}
		if !strings.Contains(stderr.String(), cliout.DisplayPath(manifestPath)) {
			t.Fatalf("AGENT=%s no-stack stderr = %q, want manifest path %q", agent, stderr.String(), cliout.DisplayPath(manifestPath))
		}
	}
}

func TestFormatStackInfoAndUptime(t *testing.T) {
	t.Parallel()

	uptimeTests := []struct {
		d    time.Duration
		want string
	}{
		{-time.Second, "0s"},
		{42 * time.Second, "42s"},
		{12 * time.Minute, "12m"},
		{2 * time.Hour, "2h"},
		{2*time.Hour + 15*time.Minute, "2h 15m"},
		{48 * time.Hour, "2d"},
		{51 * time.Hour, "2d 3h"},
	}
	for _, tc := range uptimeTests {
		if got := formatUptime(tc.d); got != tc.want {
			t.Errorf("formatUptime(%v) = %q, want %q", tc.d, got, tc.want)
		}
	}

	port := 3000
	exitCode := 1
	info := services.StackInfo{
		Name:          "Acme Shop",
		PID:           8519,
		Mode:          services.StackModeDetached,
		Ready:         false,
		RunState:      services.StackRunStateDegraded,
		ManifestPath:  "/abs/devhost.toml",
		ManifestFiles: []string{"/abs/devhost.toml", "/abs/admin/devhost.toml"},
		ControlPort:   41231,
		LogPath:       "/abs/logs/stack.log",
		CreatedAt:     "2026-11-20T14:01:02Z",
		Services: []devtools.StackServiceInfo{
			{Name: "web", State: services.ServiceStateReady, Primary: true, Since: "2026-11-20T14:01:05Z", Port: &port, URLs: []string{"https://shop.localhost"}},
			{Name: "api", State: services.ServiceStateExited, ExitCode: &exitCode, Since: "2026-11-20T14:01:53Z", URLs: []string{"https://shop.localhost/api/"}, LastOutput: "boom"},
			{Name: "docs", State: services.ServiceStateNotStarted},
		},
	}

	now := time.Date(2026, 11, 20, 14, 13, 2, 0, time.UTC)
	human := formatStackInfo(info, false, now)
	for _, want := range []string{
		"Acme Shop · degraded · PID 8519 · detached · up 12m\n",
		"web (primary)  ready        https://shop.localhost\n",
		"api            exited 1     https://shop.localhost/api/\n",
		"  └ boom\n",
		"docs           not started  (no route)\n",
		"Log: /abs/logs/stack.log\n",
	} {
		if !strings.Contains(human, want) {
			t.Fatalf("human output missing %q:\n%s", want, human)
		}
	}

	agent := formatStackInfo(info, true, now)
	for _, want := range []string{
		`devhost: stack name="Acme Shop" pid=8519 mode=detached ready=false manifest=/abs/devhost.toml manifestFiles=/abs/devhost.toml,/abs/admin/devhost.toml controlPort=41231 log=/abs/logs/stack.log createdAt=2026-11-20T14:01:02Z` + "\n",
		"devhost: service name=web state=ready primary=true since=2026-11-20T14:01:05Z port=3000 url=https://shop.localhost\n",
		`devhost: service name=api state=exited exitCode=1 since=2026-11-20T14:01:53Z url=https://shop.localhost/api/ last="boom"` + "\n",
		"devhost: service name=docs state=not-started\n",
	} {
		if !strings.Contains(agent, want) {
			t.Fatalf("agent output missing %q:\n%s", want, agent)
		}
	}
}

func TestStackInfoServiceHelper(t *testing.T) {
	mode := os.Getenv("DEVHOST_INFO_HELPER_MODE")
	if mode == "" {
		return
	}
	if portText := os.Getenv("PORT"); portText != "" {
		if port, err := strconv.Atoi(portText); err == nil && port > 0 {
			if ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port)); err == nil {
				defer ln.Close()
			}
		}
	}
	switch mode {
	case "stay":
		select {}
	case "crash-on-file":
		if readyFile := os.Getenv("DEVHOST_INFO_READY_FILE"); readyFile != "" {
			_ = os.WriteFile(readyFile, []byte("ready\n"), 0o600)
		}
		trigger := os.Getenv("DEVHOST_INFO_CRASH_FILE")
		for {
			if _, err := os.Stat(trigger); err == nil {
				_, _ = fmt.Fprintln(os.Stderr, "fatal: lost connection to database")
				os.Exit(7)
			}
			time.Sleep(25 * time.Millisecond)
		}
	}
}

func waitForStackInfoReady(t *testing.T, stateDir, manifestPath string) {
	t.Helper()
	paths := caddy.CreateManagedCaddyPaths(stateDir)
	target := caddy.ManifestIdentity(manifestPath)
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		stacks, err := caddy.ReadLiveStacks(paths)
		if err == nil {
			for _, s := range stacks {
				if caddy.ManifestIdentity(s.ManifestPath) == target && s.ControlPort > 0 {
					info, err := services.ReadStackInfo(t.Context(), manifestPath, map[string]string{"DEVHOST_STATE_DIR": stateDir})
					if err == nil && info.Ready {
						return
					}
				}
			}
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for stack %s to become ready", manifestPath)
}

func runStackInfoExpectCode(t *testing.T, cwd string, wantCode int) string {
	t.Helper()
	var stdout, stderr strings.Builder
	code := Run([]string{"stack", "info"}, cwd, &stdout, &stderr)
	if code != wantCode {
		t.Fatalf("Run(stack info) in %s exited %d, want %d\nstdout:\n%s\nstderr:\n%s", cwd, code, wantCode, stdout.String(), stderr.String())
	}
	if stderr.Len() != 0 {
		t.Fatalf("Run(stack info) unexpected stderr:\n%s", stderr.String())
	}
	return stdout.String()
}
