package caddy

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"testing"
	"time"
)

func TestCreateRouteRegistrationText(t *testing.T) {
	withRouteMutationTestHooks(t, routeMutationTestHooks{
		now:       time.Date(2026, time.April, 19, 12, 34, 56, 0, time.UTC),
		processID: 4321,
	})

	got := createRouteRegistrationText(ActivateRouteOptions{
		AppBindHost: "127.0.0.1",
		AppPort:     3000,
		Host:        "hello.localhost",
		Path:        "/*",
		ServiceName: "web",
	}, "/tmp/project/devhost.toml")
	want := strings.Join([]string{
		"{",
		`  "appBindHost": "127.0.0.1",`,
		`  "appPort": 3000,`,
		`  "createdAt": "2026-04-19T12:34:56.000Z",`,
		`  "host": "hello.localhost",`,
		`  "manifestPath": "/tmp/project/devhost.toml",`,
		`  "ownerPid": 4321,`,
		`  "path": "/",`,
		`  "serviceName": "web"`,
		"}",
	}, "\n")
	if got != want {
		t.Fatalf("createRouteRegistrationText(...) = %q, want %q", got, want)
	}

	got = createRouteRegistrationText(ActivateRouteOptions{
		AppBindHost:           "127.0.0.1",
		AppPort:               3000,
		CaddyAdminAddress:     "127.0.0.1:22000",
		CaddyBindHost:         "0.0.0.0",
		CaddyHTTPPort:         8080,
		CaddyHTTPSPort:        4443,
		DevtoolsControlPort:   4100,
		DocumentInjectionPort: 4200,
		Host:                  "hello.localhost",
		HTTPEnabled:           true,
		Path:                  "/",
		ServiceName:           "web",
	}, "/tmp/project/devhost.toml")
	want = strings.Join([]string{
		"{",
		`  "appBindHost": "127.0.0.1",`,
		`  "appPort": 3000,`,
		`  "createdAt": "2026-04-19T12:34:56.000Z",`,
		`  "host": "hello.localhost",`,
		`  "manifestPath": "/tmp/project/devhost.toml",`,
		`  "ownerPid": 4321,`,
		`  "path": "/",`,
		`  "serviceName": "web",`,
		`  "devtoolsControlPort": 4100,`,
		`  "documentInjectionPort": 4200,`,
		`  "httpEnabled": true,`,
		`  "caddyAdminAddress": "127.0.0.1:22000",`,
		`  "caddyBindHost": "0.0.0.0",`,
		`  "caddyHttpPort": 8080,`,
		`  "caddyHttpsPort": 4443`,
		"}",
	}, "\n")
	if got != want {
		t.Fatalf("createRouteRegistrationText(...) with optionals = %q, want %q", got, want)
	}
}

func TestFixedPortClaims(t *testing.T) {
	withRouteMutationTestHooks(t, routeMutationTestHooks{
		now:       time.Date(2026, time.April, 19, 12, 34, 56, 0, time.UTC),
		processID: 4321,
	})

	paths := newManagedCaddyPaths(t)
	claimOptions := ClaimFixedPortOptions{
		BindHost:                "127.0.0.1",
		ManifestPath:            "/tmp/project/devhost.toml",
		Port:                    3000,
		PortClaimsDirectoryPath: paths.PortClaimsDirectoryPath,
	}
	if err := ClaimFixedPort(claimOptions); err != nil {
		t.Fatalf("ClaimFixedPort(...) unexpected error = %v", err)
	}

	claimPath := filepath.Join(paths.PortClaimsDirectoryPath, "ipv4_3000.json")
	claimText, err := os.ReadFile(claimPath)
	if err != nil {
		t.Fatalf("ReadFile(...) error = %v", err)
	}
	want := strings.Join([]string{
		"{",
		`  "bindHost": "127.0.0.1",`,
		`  "createdAt": "2026-04-19T12:34:56.000Z",`,
		`  "manifestPath": "/tmp/project/devhost.toml",`,
		`  "ownerPid": 4321,`,
		`  "port": 3000`,
		"}",
	}, "\n")
	if string(claimText) != want {
		t.Fatalf("fixed port claim text = %q, want %q", string(claimText), want)
	}

	writeRegistration(t, claimPath, strings.ReplaceAll(string(claimText), `"ownerPid": 4321`, `"ownerPid": 999999`))
	if err := CleanupStaleFixedPortClaims(paths.PortClaimsDirectoryPath); err != nil {
		t.Fatalf("CleanupStaleFixedPortClaims(...) unexpected error = %v", err)
	}
	if _, err := os.Stat(claimPath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("stat stale fixed port claim error = %v, want not-exist", err)
	}

	if err := ClaimFixedPort(claimOptions); err != nil {
		t.Fatalf("ClaimFixedPort(...) after stale cleanup unexpected error = %v", err)
	}
	if err := ClaimFixedPort(claimOptions); err == nil || !strings.Contains(err.Error(), "127.0.0.1:3000 is already in use by `bun dev` via /tmp/project/devhost.toml.") {
		t.Fatalf("ClaimFixedPort(...) same-manifest error = %v", err)
	}
	if err := ClaimFixedPort(ClaimFixedPortOptions{
		BindHost:                "0.0.0.0",
		ManifestPath:            "/tmp/other/devhost.toml",
		Port:                    3000,
		PortClaimsDirectoryPath: paths.PortClaimsDirectoryPath,
	}); err == nil || !strings.Contains(err.Error(), "0.0.0.0:3000 is already in use by `bun dev` via /tmp/project/devhost.toml.") {
		t.Fatalf("ClaimFixedPort(...) overlapping error = %v", err)
	}

	if err := ReleaseFixedPortClaim(ClaimFixedPortOptions{
		BindHost:                "127.0.0.1",
		ManifestPath:            "/tmp/other/devhost.toml",
		Port:                    3000,
		PortClaimsDirectoryPath: paths.PortClaimsDirectoryPath,
	}); err != nil {
		t.Fatalf("ReleaseFixedPortClaim(...) wrong manifest unexpected error = %v", err)
	}
	if _, err := os.Stat(claimPath); err != nil {
		t.Fatalf("stat fixed port claim after ignored release error = %v", err)
	}

	if err := ReleaseFixedPortClaim(claimOptions); err != nil {
		t.Fatalf("ReleaseFixedPortClaim(...) unexpected error = %v", err)
	}
	if _, err := os.Stat(claimPath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("stat released fixed port claim error = %v, want not-exist", err)
	}
}

func TestNormalizeProcessArgs(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{name: "empty", input: "", want: ""},
		{name: "plain command", input: "bun dev", want: "bun dev"},
		{name: "absolute executable path", input: "/home/alex/.dotfiles/.generated/binaries/bun/current/bun src/server.ts", want: "bun src/server.ts"},
		{name: "relative executable path", input: "./node_modules/.bin/next dev", want: "next dev"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := normalizeProcessArgs(tt.input)
			if got != tt.want {
				t.Fatalf("normalizeProcessArgs(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestClaimHost(t *testing.T) {
	withRouteMutationTestHooks(t, routeMutationTestHooks{
		now:       time.Date(2026, time.April, 19, 12, 34, 56, 0, time.UTC),
		processID: 4321,
	})

	paths := newManagedCaddyPaths(t)
	claimOptions := ClaimHostOptions{
		Host:                       "hello.localhost",
		ManifestPath:               "/tmp/project/devhost.toml",
		RegistrationsDirectoryPath: paths.RegistrationsDirectoryPath,
	}
	if err := ClaimHost(claimOptions); err != nil {
		t.Fatalf("ClaimHost(...) unexpected error = %v", err)
	}
	if err := ClaimHost(claimOptions); err != nil {
		t.Fatalf("ClaimHost(...) same manifest unexpected error = %v", err)
	}

	claimPath := filepath.Join(paths.HostClaimsDirectoryPath, "hello.localhost.json")
	claimText, err := os.ReadFile(claimPath)
	if err != nil {
		t.Fatalf("ReadFile(...) error = %v", err)
	}
	want := strings.Join([]string{
		"{",
		`  "createdAt": "2026-04-19T12:34:56.000Z",`,
		`  "host": "hello.localhost",`,
		`  "manifestPath": "/tmp/project/devhost.toml",`,
		`  "ownerPid": 4321`,
		"}",
	}, "\n")
	if string(claimText) != want {
		t.Fatalf("host claim text = %q, want %q", string(claimText), want)
	}

	writeRegistration(t, filepath.Join(paths.RegistrationsDirectoryPath, "hello.localhost_api_2f6170692f2a.json"), strings.Join([]string{
		"{",
		`  "appBindHost": "127.0.0.1",`,
		`  "appPort": 4000,`,
		`  "createdAt": "2026-04-19T12:34:56.000Z",`,
		`  "host": "hello.localhost",`,
		`  "manifestPath": "/tmp/other/devhost.toml",`,
		`  "ownerPid": 4321,`,
		`  "path": "/api/*",`,
		`  "serviceName": "api"`,
		"}",
	}, "\n"))
	if err := ClaimHost(ClaimHostOptions{
		Host:                       "hello.localhost",
		ManifestPath:               "/tmp/project/devhost.toml",
		RegistrationsDirectoryPath: paths.RegistrationsDirectoryPath,
	}); err == nil || !strings.Contains(err.Error(), "hello.localhost is already claimed by PID 4321 from /tmp/other/devhost.toml.") {
		t.Fatalf("ClaimHost(...) live registration error = %v", err)
	}

	if err := removeIfExists(filepath.Join(paths.RegistrationsDirectoryPath, "hello.localhost_api_2f6170692f2a.json")); err != nil {
		t.Fatalf("removeIfExists(...) error = %v", err)
	}
	writeRegistration(t, filepath.Join(paths.RegistrationsDirectoryPath, "hello.localhost_legacy_2f.json"), strings.Join([]string{
		"{",
		`  "createdAt": "2026-04-19T12:34:56.000Z",`,
		`  "host": "hello.localhost",`,
		`  "ownerPid": 4321,`,
		`  "port": 3000`,
		"}",
	}, "\n"))
	if err := ClaimHost(ClaimHostOptions{
		Host:                       "hello.localhost",
		ManifestPath:               "/tmp/project/devhost.toml",
		RegistrationsDirectoryPath: paths.RegistrationsDirectoryPath,
	}); err == nil || !strings.Contains(err.Error(), "hello.localhost is already claimed by PID 4321 on port 3000.") {
		t.Fatalf("ClaimHost(...) legacy registration error = %v", err)
	}

	if err := ReleaseHostClaim(ClaimHostOptions{
		Host:                       "hello.localhost",
		ManifestPath:               "/tmp/other/devhost.toml",
		RegistrationsDirectoryPath: paths.RegistrationsDirectoryPath,
	}); err != nil {
		t.Fatalf("ReleaseHostClaim(...) wrong manifest unexpected error = %v", err)
	}
	if _, err := os.Stat(claimPath); err != nil {
		t.Fatalf("stat host claim after ignored release error = %v", err)
	}

	if err := ReleaseHostClaim(claimOptions); err != nil {
		t.Fatalf("ReleaseHostClaim(...) unexpected error = %v", err)
	}
	if _, err := os.Stat(claimPath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("stat released host claim error = %v, want not-exist", err)
	}
}

func TestClaimHostKillZombies(t *testing.T) {
	zombie := startZombieProcess(t)
	withRouteMutationTestHooks(t, routeMutationTestHooks{
		now:       time.Date(2026, time.April, 19, 12, 34, 56, 0, time.UTC),
		processID: 4321,
		processAlive: func(pid int) bool {
			return pid == 4321 || pid == zombie.pid
		},
	})

	paths := newManagedCaddyPaths(t)

	// Write a registration claimed by another PID but same manifest
	writeRegistration(t, filepath.Join(paths.RegistrationsDirectoryPath, "hello.localhost_api_2f6170692f2a.json"), strings.Join([]string{
		"{",
		`  "appBindHost": "127.0.0.1",`,
		`  "appPort": 4000,`,
		`  "createdAt": "2026-04-19T12:34:56.000Z",`,
		`  "host": "hello.localhost",`,
		`  "manifestPath": "/tmp/project/devhost.toml",`,
		fmt.Sprintf(`  "ownerPid": %d,`, zombie.pid), // Another process, which this test owns.
		`  "path": "/api/*",`,
		`  "serviceName": "api"`,
		"}",
	}, "\n"))

	var buf bytes.Buffer

	// Try to claim the host without KillZombies (should fail)
	if err := ClaimHost(ClaimHostOptions{
		Host:                       "hello.localhost",
		ManifestPath:               "/tmp/project/devhost.toml",
		RegistrationsDirectoryPath: paths.RegistrationsDirectoryPath,
		KillZombies:                false,
		LogWriter:                  &buf,
	}); err == nil || !strings.Contains(err.Error(), fmt.Sprintf("hello.localhost is already claimed by PID %d", zombie.pid)) {
		t.Fatalf("ClaimHost(...) without KillZombies expected failure, got = %v", err)
	}

	// Try to claim with KillZombies (should succeed and log)
	if err := ClaimHost(ClaimHostOptions{
		Host:                       "hello.localhost",
		ManifestPath:               "/tmp/project/devhost.toml",
		RegistrationsDirectoryPath: paths.RegistrationsDirectoryPath,
		KillZombies:                true,
		LogWriter:                  &buf,
	}); err != nil {
		t.Fatalf("ClaimHost(...) with KillZombies unexpected error = %v", err)
	}

	if !strings.Contains(buf.String(), fmt.Sprintf("Killing zombie PID %d claiming hello.localhost", zombie.pid)) {
		t.Fatalf("ClaimHost(...) did not log expected zombie killing message: %q", buf.String())
	}
	zombie.assertKilled(t)
}

func TestClaimFixedPortKillZombies(t *testing.T) {
	zombie := startZombieProcess(t)
	withRouteMutationTestHooks(t, routeMutationTestHooks{
		now:       time.Date(2026, time.April, 19, 12, 34, 56, 0, time.UTC),
		processID: 4321,
		processAlive: func(pid int) bool {
			return pid == 4321 || pid == zombie.pid
		},
	})

	paths := newManagedCaddyPaths(t)

	// Write an existing port claim with another PID but same manifest
	claimPath := filepath.Join(paths.PortClaimsDirectoryPath, "ipv4_3000.json")
	claimText := strings.Join([]string{
		"{",
		`  "bindHost": "127.0.0.1",`,
		`  "createdAt": "2026-04-19T12:34:56.000Z",`,
		`  "manifestPath": "/tmp/project/devhost.toml",`,
		fmt.Sprintf(`  "ownerPid": %d,`, zombie.pid),
		`  "port": 3000`,
		"}",
	}, "\n")
	if err := os.WriteFile(claimPath, []byte(claimText), 0644); err != nil {
		t.Fatalf("failed to write existing port claim: %v", err)
	}

	var buf bytes.Buffer

	// Try to claim the port without KillZombies (should fail)
	if err := ClaimFixedPort(ClaimFixedPortOptions{
		BindHost:                "127.0.0.1",
		ManifestPath:            "/tmp/project/devhost.toml",
		Port:                    3000,
		PortClaimsDirectoryPath: paths.PortClaimsDirectoryPath,
		KillZombies:             false,
		LogWriter:               &buf,
	}); err == nil {
		t.Fatalf("ClaimFixedPort(...) without KillZombies expected failure")
	}

	// Try to claim with KillZombies (should succeed and log)
	if err := ClaimFixedPort(ClaimFixedPortOptions{
		BindHost:                "127.0.0.1",
		ManifestPath:            "/tmp/project/devhost.toml",
		Port:                    3000,
		PortClaimsDirectoryPath: paths.PortClaimsDirectoryPath,
		KillZombies:             true,
		LogWriter:               &buf,
	}); err != nil {
		t.Fatalf("ClaimFixedPort(...) with KillZombies unexpected error = %v", err)
	}

	if !strings.Contains(buf.String(), fmt.Sprintf("Killing zombie PID %d claiming port 3000", zombie.pid)) {
		t.Fatalf("ClaimFixedPort(...) did not log expected zombie killing message: %q", buf.String())
	}
	zombie.assertKilled(t)
}

// zombieProcess is a process the test started. Claims written under its PID let the zombie path kill a real
// process; a made-up PID would have it kill whatever process holds that number on the machine running the test.
type zombieProcess struct {
	exited chan error
	pid    int
}

func startZombieProcess(t *testing.T) *zombieProcess {
	t.Helper()

	command := exec.Command("sleep", "300")
	if err := command.Start(); err != nil {
		t.Fatalf("start zombie process: %v", err)
	}
	zombie := &zombieProcess{exited: make(chan error, 1), pid: command.Process.Pid}
	go func() {
		zombie.exited <- command.Wait()
	}()
	t.Cleanup(func() {
		_ = command.Process.Kill()
	})
	return zombie
}

func (z *zombieProcess) assertKilled(t *testing.T) {
	t.Helper()

	select {
	case err := <-z.exited:
		var exitError *exec.ExitError
		if !errors.As(err, &exitError) {
			t.Fatalf("zombie process exit = %v, want a kill", err)
		}
		status, ok := exitError.Sys().(syscall.WaitStatus)
		if !ok || !status.Signaled() || status.Signal() != syscall.SIGKILL {
			t.Fatalf("zombie process exit = %v, want SIGKILL", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("zombie process was not killed")
	}
}

func TestCreateManagedCaddyReloadErrorMessage(t *testing.T) {
	if got := CreateManagedCaddyReloadErrorMessage([]byte{}, []byte{}); got != "Caddy reload failed. Is Caddy already running?" {
		t.Fatalf("CreateManagedCaddyReloadErrorMessage(...) = %q, want %q", got, "Caddy reload failed. Is Caddy already running?")
	}

	got := CreateManagedCaddyReloadErrorMessage([]byte("stdout line\n"), []byte("stderr line\n"))
	want := "Caddy reload failed. Is Caddy already running?\nstderr line\nstdout line"
	if got != want {
		t.Fatalf("CreateManagedCaddyReloadErrorMessage(...) = %q, want %q", got, want)
	}
}

func TestResolveProxyHost(t *testing.T) {
	tests := []struct {
		bindHost string
		want     string
	}{
		{bindHost: "127.0.0.1", want: "127.0.0.1"},
		{bindHost: "0.0.0.0", want: "127.0.0.1"},
		{bindHost: "::1", want: "::1"},
		{bindHost: "::", want: "::1"},
	}
	for _, tt := range tests {
		got, err := ResolveProxyHost(tt.bindHost)
		if err != nil {
			t.Fatalf("ResolveProxyHost(%q) unexpected error = %v", tt.bindHost, err)
		}
		if got != tt.want {
			t.Fatalf("ResolveProxyHost(%q) = %q, want %q", tt.bindHost, got, tt.want)
		}
	}

	if got := FormatProxyAddress("127.0.0.1", 3000); got != "127.0.0.1:3000" {
		t.Fatalf("FormatProxyAddress(...) = %q, want %q", got, "127.0.0.1:3000")
	}
	if got := FormatProxyAddress("::1", 3000); got != "[::1]:3000" {
		t.Fatalf("FormatProxyAddress(...) = %q, want %q", got, "[::1]:3000")
	}
	if _, err := ResolveProxyHost("192.168.1.10"); err == nil || err.Error() != "Unsupported bind host: 192.168.1.10" {
		t.Fatalf("ResolveProxyHost(...) error = %v, want %q", err, "Unsupported bind host: 192.168.1.10")
	}
}

func TestRenderHostRouteSnippet(t *testing.T) {
	registrations := []routeRegistration{
		mustParseRouteRegistration(t, createRouteRegistrationText(ActivateRouteOptions{
			AppBindHost: "127.0.0.1",
			AppPort:     3001,
			Host:        "hello.localhost",
			Path:        "/api/*",
			ServiceName: "api",
		}, "/tmp/project/devhost.toml")),
		mustParseRouteRegistration(t, createRouteRegistrationText(ActivateRouteOptions{
			AppBindHost:           "127.0.0.1",
			AppPort:               3000,
			DevtoolsControlPort:   4100,
			DocumentInjectionPort: 4200,
			Host:                  "hello.localhost",
			Path:                  "/",
			ServiceName:           "web",
		}, "/tmp/project/devhost.toml")),
		mustParseRouteRegistration(t, createRouteRegistrationText(ActivateRouteOptions{
			AppBindHost: "127.0.0.1",
			AppPort:     3002,
			Host:        "hello.localhost",
			Path:        "/api/users",
			ServiceName: "users",
		}, "/tmp/project/devhost.toml")),
		mustParseRouteRegistration(t, createRouteRegistrationText(ActivateRouteOptions{
			AppBindHost: "127.0.0.1",
			AppPort:     3003,
			Host:        "hello.localhost",
			Path:        "/api/users",
			ServiceName: "accounts",
		}, "/tmp/project/devhost.toml")),
	}

	snippet, err := renderHostRouteSnippet(registrations, true, 8080, 4443, t.TempDir())
	if err != nil {
		t.Fatalf("renderHostRouteSnippet(...) unexpected error = %v", err)
	}
	if !strings.Contains(snippet, "http://hello.localhost:8080 {") || !strings.Contains(snippet, "https://hello.localhost:4443 {") {
		t.Fatalf("renderHostRouteSnippet(...) ports output = %q", snippet)
	}
	if !strings.Contains(snippet, "tls internal") {
		t.Fatalf("renderHostRouteSnippet(...) missing internal tls = %q", snippet)
	}
	if !strings.Contains(snippet, "@devhost_control path /__devhost__/*") || !strings.Contains(snippet, "@devhost_document header Sec-Fetch-Dest document") {
		t.Fatalf("renderHostRouteSnippet(...) missing devtools handlers = %q", snippet)
	}
	if !strings.Contains(snippet, "reverse_proxy 127.0.0.1:3000") {
		t.Fatalf("renderHostRouteSnippet(...) missing root reverse proxy = %q", snippet)
	}

	missingRootSnippet, err := renderHostRouteSnippet([]routeRegistration{mustParseRouteRegistration(t, createRouteRegistrationText(ActivateRouteOptions{
		AppBindHost: "127.0.0.1",
		AppPort:     3001,
		Host:        "hello.localhost",
		Path:        "/api/*",
		ServiceName: "api",
	}, "/tmp/project/devhost.toml"))}, false, 0, 0, t.TempDir())
	if err != nil {
		t.Fatalf("renderHostRouteSnippet(...) missing-root unexpected error = %v", err)
	}
	if !strings.Contains(missingRootSnippet, "    error 404") {
		t.Fatalf("renderHostRouteSnippet(...) missing root fallback = %q", missingRootSnippet)
	}
}

func TestRenderHostRouteSnippetWithStackName(t *testing.T) {
	registrations := []routeRegistration{
		mustParseRouteRegistration(t, createRouteRegistrationText(ActivateRouteOptions{
			AppBindHost: "127.0.0.1",
			AppPort:     3001,
			Host:        "hello.localhost",
			Path:        "/",
			ServiceName: "api",
			StackName:   "my-awesome-stack",
		}, "/tmp/project/devhost.toml")),
	}

	tempDir := t.TempDir()
	routesDirectoryPath := filepath.Join(tempDir, "caddy", "routes")
	snippet, err := renderHostRouteSnippet(registrations, true, 8080, 4443, routesDirectoryPath)
	if err != nil {
		t.Fatalf("renderHostRouteSnippet(...) unexpected error = %v", err)
	}

	// Verify the log block exists and points to the correct location
	expectedLogPath := filepath.ToSlash(filepath.Join(tempDir, "caddy", "logs", "my-awesome-stack_access.log"))
	expectedSnippet := `    log {
        output file "` + expectedLogPath + `"
    }`
	if !strings.Contains(snippet, expectedSnippet) {
		t.Fatalf("expected snippet to contain log configuration, got:\n%s\nExpected:\n%s", snippet, expectedSnippet)
	}
}

func TestSyncHostRouteOrdersRegistrations(t *testing.T) {
	withRouteMutationTestHooks(t, routeMutationTestHooks{
		now:       time.Date(2026, time.April, 19, 12, 34, 56, 0, time.UTC),
		processID: 4321,
	})

	paths := newManagedCaddyPaths(t)
	writeRegistration(t, filepath.Join(paths.RegistrationsDirectoryPath, "hello.localhost_api_2f6170692f2a.json"), createRouteRegistrationText(ActivateRouteOptions{
		AppBindHost: "127.0.0.1",
		AppPort:     3002,
		Host:        "hello.localhost",
		Path:        "/api/users",
		ServiceName: "users",
	}, "/tmp/project/devhost.toml"))
	writeRegistration(t, filepath.Join(paths.RegistrationsDirectoryPath, "hello.localhost_accounts_2f6170692f2a.json"), createRouteRegistrationText(ActivateRouteOptions{
		AppBindHost: "127.0.0.1",
		AppPort:     3003,
		Host:        "hello.localhost",
		Path:        "/api/users",
		ServiceName: "accounts",
	}, "/tmp/project/devhost.toml"))
	writeRegistration(t, filepath.Join(paths.RegistrationsDirectoryPath, "hello.localhost_api_2f6170692a.json"), createRouteRegistrationText(ActivateRouteOptions{
		AppBindHost: "127.0.0.1",
		AppPort:     3001,
		Host:        "hello.localhost",
		Path:        "/api/*",
		ServiceName: "api",
	}, "/tmp/project/devhost.toml"))
	writeRegistration(t, filepath.Join(paths.RegistrationsDirectoryPath, "hello.localhost_web_2f.json"), createRouteRegistrationText(ActivateRouteOptions{
		AppBindHost: "127.0.0.1",
		AppPort:     3000,
		Host:        "hello.localhost",
		Path:        "/",
		ServiceName: "web",
	}, "/tmp/project/devhost.toml"))

	if err := syncHostRoute("hello.localhost", paths.RoutesDirectoryPath, &ManagedCaddyGlobalSettings{AdminAddress: DefaultManagedCaddyAdminAddress, BindHost: defaultManagedCaddyBindHost, HTTPPort: defaultManagedCaddyHTTPPort, HTTPSPort: defaultManagedCaddyHTTPSPort}); err != nil {
		t.Fatalf("syncHostRoute(...) unexpected error = %v", err)
	}

	hostRouteText, err := os.ReadFile(filepath.Join(paths.RoutesDirectoryPath, "hello.localhost.caddy"))
	if err != nil {
		t.Fatalf("ReadFile(...) host route error = %v", err)
	}
	rendered := string(hostRouteText)
	accountsIndex := strings.Index(rendered, "    handle /api/users {\n        reverse_proxy 127.0.0.1:3003")
	usersIndex := strings.Index(rendered, "    handle /api/users {\n        reverse_proxy 127.0.0.1:3002")
	wildcardIndex := strings.Index(rendered, "    handle /api/* {\n        reverse_proxy 127.0.0.1:3001")
	if !(accountsIndex >= 0 && usersIndex > accountsIndex && wildcardIndex > usersIndex) {
		t.Fatalf("syncHostRoute(...) route order = %q", rendered)
	}
}

func TestActivateRoute(t *testing.T) {
	withRouteMutationTestHooks(t, routeMutationTestHooks{
		now:       time.Date(2026, time.April, 19, 12, 34, 56, 0, time.UTC),
		processID: 4321,
	})

	paths := newManagedCaddyPaths(t)
	var reloadCalls []ManagedCaddyCommandOptions
	routeMutationRunManagedCaddyCommand = func(paths Paths, arguments []string, options ManagedCaddyCommandOptions) CommandResult {
		if len(arguments) != 1 || arguments[0] != "reload" {
			t.Fatalf("routeMutationRunManagedCaddyCommand(...) arguments = %#v, want reload", arguments)
		}
		reloadCalls = append(reloadCalls, options)
		return CommandResult{Success: true}
	}
	t.Cleanup(func() {
		routeMutationRunManagedCaddyCommand = func(paths Paths, arguments []string, options ManagedCaddyCommandOptions) CommandResult {
			return RunManagedCaddyCommand(paths, arguments, options, ManagedCaddyCommandDependencies{})
		}
	})

	if err := ActivateRoute(ActivateRouteOptions{
		AppBindHost: "127.0.0.1",
		AppPort:     3000,
		Host:        "hello.localhost",
		Path:        "/",
		ServiceName: "web",
	}, "/tmp/project/devhost.toml", paths.RoutesDirectoryPath); err != nil {
		t.Fatalf("ActivateRoute(...) unexpected error = %v", err)
	}

	registrationPath := filepath.Join(paths.RegistrationsDirectoryPath, "hello.localhost_web_2f.json")
	if _, err := os.Stat(registrationPath); err != nil {
		t.Fatalf("stat registration error = %v", err)
	}
	hostRoutePath := filepath.Join(paths.RoutesDirectoryPath, "hello.localhost.caddy")
	hostRouteText, err := os.ReadFile(hostRoutePath)
	if err != nil {
		t.Fatalf("ReadFile(...) host route error = %v", err)
	}
	if !strings.Contains(string(hostRouteText), "https://hello.localhost {") || !strings.Contains(string(hostRouteText), "reverse_proxy 127.0.0.1:3000") {
		t.Fatalf("host route text = %q, want synced route", string(hostRouteText))
	}
	if len(reloadCalls) != 1 || reloadCalls[0].AdminAddress != DefaultManagedCaddyAdminAddress {
		t.Fatalf("reload calls = %#v, want one default-admin reload", reloadCalls)
	}
}

func TestActivateRouteRollbackOnReloadFailure(t *testing.T) {
	withRouteMutationTestHooks(t, routeMutationTestHooks{
		now:       time.Date(2026, time.April, 19, 12, 34, 56, 0, time.UTC),
		processID: 4321,
	})

	paths := newManagedCaddyPaths(t)
	previousCaddyfile, err := os.ReadFile(paths.CaddyfilePath)
	if err != nil {
		t.Fatal(err)
	}
	var reloadCallCount int
	routeMutationRunManagedCaddyCommand = func(paths Paths, arguments []string, options ManagedCaddyCommandOptions) CommandResult {
		reloadCallCount++
		return CommandResult{Stderr: []byte("stderr line\n"), Stdout: []byte("stdout line\n"), Success: false}
	}
	t.Cleanup(func() {
		routeMutationRunManagedCaddyCommand = func(paths Paths, arguments []string, options ManagedCaddyCommandOptions) CommandResult {
			return RunManagedCaddyCommand(paths, arguments, options, ManagedCaddyCommandDependencies{})
		}
	})

	err = ActivateRoute(ActivateRouteOptions{
		AppBindHost:    "127.0.0.1",
		AppPort:        3000,
		CaddyHTTPSPort: 4443,
		Host:           "hello.localhost",
		Path:           "/",
		ServiceName:    "web",
	}, "/tmp/project/devhost.toml", paths.RoutesDirectoryPath)
	if err == nil || err.Error() != "Caddy reload failed. Is Caddy already running?\nstderr line\nstdout line" {
		t.Fatalf("ActivateRoute(...) error = %v, want exact reload failure", err)
	}
	if reloadCallCount != 1 {
		t.Fatalf("reload call count = %d, want 1", reloadCallCount)
	}
	if _, statError := os.Stat(filepath.Join(paths.RegistrationsDirectoryPath, "hello.localhost_web_2f.json")); !errors.Is(statError, os.ErrNotExist) {
		t.Fatalf("stat rolled-back registration error = %v, want not-exist", statError)
	}
	if _, statError := os.Stat(filepath.Join(paths.RoutesDirectoryPath, "hello.localhost.caddy")); !errors.Is(statError, os.ErrNotExist) {
		t.Fatalf("stat rolled-back host route error = %v, want not-exist", statError)
	}

	caddyfileText, err := os.ReadFile(paths.CaddyfilePath)
	if err != nil {
		t.Fatalf("ReadFile(...) caddyfile error = %v", err)
	}
	if !bytes.Equal(caddyfileText, previousCaddyfile) {
		t.Fatalf("caddyfile text = %q, want previous global settings after rollback", string(caddyfileText))
	}

	notFoundPagePath := createManagedCaddyNotFoundSitePaths(paths.CaddyDirectoryPath).PagePath
	pageText, err := os.ReadFile(notFoundPagePath)
	if err != nil {
		t.Fatalf("ReadFile(...) not-found page error = %v", err)
	}
	if !strings.Contains(string(pageText), "No devhost hostnames are active right now.") {
		t.Fatalf("not-found page = %q, want rollback resync", string(pageText))
	}
}

func TestActivateRoutesUpdateRestoresPreviousConfiguration(t *testing.T) {
	for _, failure := range []string{"reload", "render"} {
		t.Run(failure, func(t *testing.T) {
			withRouteMutationTestHooks(t, routeMutationTestHooks{now: time.Date(2026, time.April, 19, 12, 34, 56, 0, time.UTC), processID: 4321})
			paths := newManagedCaddyPaths(t)
			originalRun := routeMutationRunManagedCaddyCommand
			t.Cleanup(func() { routeMutationRunManagedCaddyCommand = originalRun })
			routeMutationRunManagedCaddyCommand = func(Paths, []string, ManagedCaddyCommandOptions) CommandResult {
				return CommandResult{Success: true}
			}
			options := ActivateRouteOptions{AppBindHost: "127.0.0.1", AppPort: 3000, CaddyHTTPSPort: 4443, Host: "hello.localhost", Path: "/", ServiceName: "web"}
			if err := ActivateRoute(options, "/project/devhost.toml", paths.RoutesDirectoryPath); err != nil {
				t.Fatal(err)
			}
			alias := options
			alias.Host = "alias.localhost"
			if err := ActivateRoute(alias, "/project/devhost.toml", paths.RoutesDirectoryPath); err != nil {
				t.Fatal(err)
			}
			other := options
			other.Host, other.ServiceName, other.AppPort = "other.localhost", "worker", 3002
			other.CaddyHTTPSPort = 0
			if err := ActivateRoute(other, "/other/devhost.toml", paths.RoutesDirectoryPath); err != nil {
				t.Fatal(err)
			}
			filePaths := []string{
				getRouteRegistrationPath("web", "hello.localhost", "/", paths.RoutesDirectoryPath),
				getRouteRegistrationPath("web", "alias.localhost", "/", paths.RoutesDirectoryPath),
				getRouteRegistrationPath("worker", "other.localhost", "/", paths.RoutesDirectoryPath),
				filepath.Join(paths.RoutesDirectoryPath, "hello.localhost.caddy"),
				filepath.Join(paths.RoutesDirectoryPath, "alias.localhost.caddy"),
				filepath.Join(paths.RoutesDirectoryPath, "other.localhost.caddy"),
				paths.CaddyfilePath,
				createManagedCaddyNotFoundSitePaths(paths.CaddyDirectoryPath).PagePath,
			}
			previous := make(map[string][]byte)
			for _, path := range filePaths {
				data, err := os.ReadFile(path)
				if err != nil {
					t.Fatal(err)
				}
				previous[path] = data
			}
			options.AppPort = 3001
			if failure == "reload" {
				options.CaddyHTTPSPort = 8443
				routeMutationRunManagedCaddyCommand = func(Paths, []string, ManagedCaddyCommandOptions) CommandResult {
					return CommandResult{Stderr: []byte("reload rejected"), Success: false}
				}
			} else {
				options.AppBindHost = "invalid host"
			}
			alias.AppPort, alias.CaddyHTTPSPort = options.AppPort, options.CaddyHTTPSPort
			if err := ActivateRoutes([]ActivateRouteOptions{alias, options}, "/project/devhost.toml", paths.RoutesDirectoryPath); err == nil {
				t.Fatal("route update unexpectedly succeeded")
			} else if failure == "reload" && !strings.Contains(err.Error(), "reload rejected") {
				t.Fatalf("failure did not reach Caddy reload: %v", err)
			}
			for _, path := range filePaths {
				data, err := os.ReadFile(path)
				if err != nil {
					t.Fatal(err)
				}
				if !bytes.Equal(data, previous[path]) {
					t.Errorf("failed update changed %s", path)
				}
			}
		})
	}
}

func TestActivateRouteSuccessfulReloadOutput(t *testing.T) {
	withRouteMutationTestHooks(t, routeMutationTestHooks{
		now:       time.Date(2026, time.April, 19, 12, 34, 56, 0, time.UTC),
		processID: 4321,
	})

	paths := newManagedCaddyPaths(t)
	routeMutationRunManagedCaddyCommand = func(paths Paths, arguments []string, options ManagedCaddyCommandOptions) CommandResult {
		return CommandResult{Stderr: []byte("noisy stderr\n"), Stdout: []byte("noisy stdout\n"), Success: true}
	}
	t.Cleanup(func() {
		routeMutationRunManagedCaddyCommand = func(paths Paths, arguments []string, options ManagedCaddyCommandOptions) CommandResult {
			return RunManagedCaddyCommand(paths, arguments, options, ManagedCaddyCommandDependencies{})
		}
	})

	t.Run("suppresses output without writers", func(t *testing.T) {
		if err := ActivateRoute(ActivateRouteOptions{
			AppBindHost: "127.0.0.1",
			AppPort:     3000,
			Host:        "quiet.localhost",
			Path:        "/",
			ServiceName: "web",
		}, "/tmp/project/devhost.toml", paths.RoutesDirectoryPath); err != nil {
			t.Fatalf("ActivateRoute(...) unexpected error = %v", err)
		}

		if _, err := os.Stat(filepath.Join(paths.RegistrationsDirectoryPath, "quiet.localhost_web_2f.json")); err != nil {
			t.Fatalf("stat registration error = %v", err)
		}
	})

	t.Run("prints output with verbose writers", func(t *testing.T) {
		var stdout strings.Builder
		var stderr strings.Builder
		if err := ActivateRoute(ActivateRouteOptions{
			AppBindHost: "127.0.0.1",
			AppPort:     3000,
			Host:        "verbose.localhost",
			Path:        "/",
			ServiceName: "web",
			CaddyOutputWriters: RouteCommandOutputWriters{
				StdoutWriter: &stdout,
				StderrWriter: &stderr,
			},
		}, "/tmp/project/devhost.toml", paths.RoutesDirectoryPath); err != nil {
			t.Fatalf("ActivateRoute(...) unexpected error = %v", err)
		}

		if stdout.String() != "noisy stdout\n" {
			t.Fatalf("ActivateRoute(...) stdout = %q, want caddy stdout", stdout.String())
		}
		if stderr.String() != "noisy stderr\n" {
			t.Fatalf("ActivateRoute(...) stderr = %q, want caddy stderr", stderr.String())
		}
	})

	if _, err := os.Stat(filepath.Join(paths.RegistrationsDirectoryPath, "verbose.localhost_web_2f.json")); err != nil {
		t.Fatalf("stat verbose registration error = %v", err)
	}
}

func TestUnregisterRoute(t *testing.T) {
	withRouteMutationTestHooks(t, routeMutationTestHooks{
		now:       time.Date(2026, time.April, 19, 12, 34, 56, 0, time.UTC),
		processID: 4321,
	})

	paths := newManagedCaddyPaths(t)
	writeRegistration(t, filepath.Join(paths.RegistrationsDirectoryPath, "hello.localhost_web_2f.json"), createRouteRegistrationText(ActivateRouteOptions{
		AppBindHost: "127.0.0.1",
		AppPort:     3000,
		Host:        "hello.localhost",
		Path:        "/",
		ServiceName: "web",
	}, "/tmp/project/devhost.toml"))
	if err := syncHostRoute("hello.localhost", paths.RoutesDirectoryPath, &ManagedCaddyGlobalSettings{AdminAddress: DefaultManagedCaddyAdminAddress, BindHost: defaultManagedCaddyBindHost, HTTPPort: defaultManagedCaddyHTTPPort, HTTPSPort: defaultManagedCaddyHTTPSPort}); err != nil {
		t.Fatalf("syncHostRoute(...) unexpected error = %v", err)
	}

	var reloadCalls int
	routeMutationRunManagedCaddyCommand = func(paths Paths, arguments []string, options ManagedCaddyCommandOptions) CommandResult {
		reloadCalls++
		return CommandResult{Success: true}
	}
	t.Cleanup(func() {
		routeMutationRunManagedCaddyCommand = func(paths Paths, arguments []string, options ManagedCaddyCommandOptions) CommandResult {
			return RunManagedCaddyCommand(paths, arguments, options, ManagedCaddyCommandDependencies{})
		}
	})

	if err := UnregisterRoute("web", "hello.localhost", "/", "/tmp/other/devhost.toml", paths.RegistrationsDirectoryPath, ManagedCaddyConfigFallback{}, RouteCommandOutputWriters{}); err != nil {
		t.Fatalf("UnregisterRoute(...) wrong manifest unexpected error = %v", err)
	}
	if reloadCalls != 0 {
		t.Fatalf("reload calls after ignored unregister = %d, want 0", reloadCalls)
	}

	if err := UnregisterRoute("web", "hello.localhost", "/", "/tmp/project/devhost.toml", paths.RegistrationsDirectoryPath, ManagedCaddyConfigFallback{}, RouteCommandOutputWriters{}); err != nil {
		t.Fatalf("UnregisterRoute(...) unexpected error = %v", err)
	}
	if reloadCalls != 1 {
		t.Fatalf("reload calls after unregister = %d, want 1", reloadCalls)
	}
	if _, err := os.Stat(filepath.Join(paths.RegistrationsDirectoryPath, "hello.localhost_web_2f.json")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("stat unregistered registration error = %v, want not-exist", err)
	}
	if _, err := os.Stat(filepath.Join(paths.RoutesDirectoryPath, "hello.localhost.caddy")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("stat unregistered host route error = %v, want not-exist", err)
	}
}

func TestCleanupStaleRegistrations(t *testing.T) {
	withRouteMutationTestHooks(t, routeMutationTestHooks{
		now:       time.Date(2026, time.April, 19, 12, 34, 56, 0, time.UTC),
		processID: 4321,
	})

	paths := newManagedCaddyPaths(t)
	writeRegistration(t, filepath.Join(paths.RegistrationsDirectoryPath, "hello.localhost_web_2f.json"), strings.ReplaceAll(createRouteRegistrationText(ActivateRouteOptions{
		AppBindHost: "127.0.0.1",
		AppPort:     3000,
		Host:        "hello.localhost",
		Path:        "/",
		ServiceName: "web",
	}, "/tmp/project/devhost.toml"), `"ownerPid": 4321`, `"ownerPid": 999999`))
	writeRegistration(t, filepath.Join(paths.RegistrationsDirectoryPath, "legacy.localhost_legacy_2f.json"), strings.Join([]string{
		"{",
		`  "createdAt": "2026-04-19T12:34:56.000Z",`,
		`  "host": "legacy.localhost",`,
		`  "ownerPid": 999999,`,
		`  "port": 3000`,
		"}",
	}, "\n"))
	writeRouteFile(t, filepath.Join(paths.RoutesDirectoryPath, "legacy.localhost_legacy_2f.caddy"))
	writeRegistration(t, filepath.Join(paths.RegistrationsDirectoryPath, "live.localhost_web_2f.json"), createRouteRegistrationText(ActivateRouteOptions{
		AppBindHost: "127.0.0.1",
		AppPort:     3001,
		Host:        "live.localhost",
		Path:        "/",
		ServiceName: "web",
	}, "/tmp/project/devhost.toml"))
	writeRegistration(t, filepath.Join(paths.HostClaimsDirectoryPath, "hello.localhost.json"), strings.Join([]string{
		"{",
		`  "createdAt": "2026-04-19T12:34:56.000Z",`,
		`  "host": "hello.localhost",`,
		`  "manifestPath": "/tmp/project/devhost.toml",`,
		`  "ownerPid": 999999`,
		"}",
	}, "\n"))
	if err := syncHostRoute("live.localhost", paths.RoutesDirectoryPath, &ManagedCaddyGlobalSettings{AdminAddress: DefaultManagedCaddyAdminAddress, BindHost: defaultManagedCaddyBindHost, HTTPPort: defaultManagedCaddyHTTPPort, HTTPSPort: defaultManagedCaddyHTTPSPort}); err != nil {
		t.Fatalf("syncHostRoute(...) unexpected error = %v", err)
	}

	routeMutationRunManagedCaddyCommand = func(paths Paths, arguments []string, options ManagedCaddyCommandOptions) CommandResult {
		t.Fatalf("cleanup should not reload caddy")
		return CommandResult{Success: false}
	}
	t.Cleanup(func() {
		routeMutationRunManagedCaddyCommand = func(paths Paths, arguments []string, options ManagedCaddyCommandOptions) CommandResult {
			return RunManagedCaddyCommand(paths, arguments, options, ManagedCaddyCommandDependencies{})
		}
	})

	if err := CleanupStaleRegistrations(paths.RegistrationsDirectoryPath, ManagedCaddyConfigFallback{}); err != nil {
		t.Fatalf("CleanupStaleRegistrations(...) unexpected error = %v", err)
	}
	for _, stalePath := range []string{
		filepath.Join(paths.RegistrationsDirectoryPath, "hello.localhost_web_2f.json"),
		filepath.Join(paths.RegistrationsDirectoryPath, "legacy.localhost_legacy_2f.json"),
		filepath.Join(paths.RoutesDirectoryPath, "legacy.localhost_legacy_2f.caddy"),
		filepath.Join(paths.HostClaimsDirectoryPath, "hello.localhost.json"),
	} {
		if _, err := os.Stat(stalePath); !errors.Is(err, os.ErrNotExist) {
			t.Fatalf("stat stale cleanup path %q error = %v, want not-exist", stalePath, err)
		}
	}

	liveHostRouteText, err := os.ReadFile(filepath.Join(paths.RoutesDirectoryPath, "live.localhost.caddy"))
	if err != nil {
		t.Fatalf("ReadFile(...) live host route error = %v", err)
	}
	if !strings.Contains(string(liveHostRouteText), "reverse_proxy 127.0.0.1:3001") {
		t.Fatalf("live host route text = %q, want synced live route", string(liveHostRouteText))
	}
}

type routeMutationTestHooks struct {
	listeningProcessLabel func(int) string
	now                   time.Time
	processAlive          func(int) bool
	processID             int
}

func withRouteMutationTestHooks(t *testing.T, hooks routeMutationTestHooks) {
	t.Helper()
	originalNow := routeMutationNow
	originalProcessID := routeMutationProcessID
	originalOwnerAlive := routeMutationIsOwnerAlive
	originalOwnerStartIdentity := routeMutationOwnerStartIdentity
	originalListeningProcessLabel := routeMutationReadListeningProcessLabel
	routeMutationNow = func() time.Time {
		return hooks.now
	}
	routeMutationProcessID = func() int {
		return hooks.processID
	}
	// The records of these tests name invented PIDs, which have no start identity
	// to record or to check.
	routeMutationOwnerStartIdentity = func() string {
		return ""
	}
	processAlive := hooks.processAlive
	if processAlive == nil {
		processAlive = func(processID int) bool {
			return processID == hooks.processID
		}
	}
	routeMutationIsOwnerAlive = func(processID int, _ string) bool {
		return processAlive(processID)
	}
	if hooks.listeningProcessLabel == nil {
		routeMutationReadListeningProcessLabel = func(port int) string {
			if port == 3000 {
				return "`bun dev`"
			}
			return ""
		}
	} else {
		routeMutationReadListeningProcessLabel = hooks.listeningProcessLabel
	}
	t.Cleanup(func() {
		routeMutationNow = originalNow
		routeMutationProcessID = originalProcessID
		routeMutationIsOwnerAlive = originalOwnerAlive
		routeMutationOwnerStartIdentity = originalOwnerStartIdentity
		routeMutationReadListeningProcessLabel = originalListeningProcessLabel
	})
}

func newManagedCaddyPaths(t *testing.T) Paths {
	t.Helper()
	paths := CreateManagedCaddyPaths(t.TempDir())
	// Route changes render the Caddyfile for the operating system they run on, so the starting point does too.
	if err := ensureManagedCaddyConfig(paths, ManagedCaddyConfigFallback{RuntimeOS: runtime.GOOS}); err != nil {
		t.Fatalf("ensureManagedCaddyConfig(...) unexpected error = %v", err)
	}

	return paths
}

func mustParseRouteRegistration(t *testing.T, text string) routeRegistration {
	t.Helper()
	registration, err := parseRouteRegistration([]byte(text))
	if err != nil {
		t.Fatalf("parseRouteRegistration(...) unexpected error = %v", err)
	}

	return registration
}

func TestReadAppTargetUnsupportedHost(t *testing.T) {
	target, err := readAppTarget(routeRegistration{AppBindHost: "192.168.1.10", AppPort: 3000})
	if err == nil || err.Error() != "Unsupported bind host: 192.168.1.10" {
		t.Fatalf("readAppTarget(...) error = %v, want %q", err, "Unsupported bind host: 192.168.1.10")
	}
	if target != "" {
		t.Fatalf("readAppTarget(...) = %q, want empty target on error", target)
	}
}
