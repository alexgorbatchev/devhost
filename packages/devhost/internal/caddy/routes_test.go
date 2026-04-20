package caddy

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
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
	if error := ClaimFixedPort(claimOptions); error != nil {
		t.Fatalf("ClaimFixedPort(...) unexpected error = %v", error)
	}

	claimPath := filepath.Join(paths.PortClaimsDirectoryPath, "ipv4_3000.json")
	claimText, error := os.ReadFile(claimPath)
	if error != nil {
		t.Fatalf("ReadFile(...) error = %v", error)
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
	if error := CleanupStaleFixedPortClaims(paths.PortClaimsDirectoryPath); error != nil {
		t.Fatalf("CleanupStaleFixedPortClaims(...) unexpected error = %v", error)
	}
	if _, error := os.Stat(claimPath); !errors.Is(error, os.ErrNotExist) {
		t.Fatalf("stat stale fixed port claim error = %v, want not-exist", error)
	}

	if error := ClaimFixedPort(claimOptions); error != nil {
		t.Fatalf("ClaimFixedPort(...) after stale cleanup unexpected error = %v", error)
	}
	if error := ClaimFixedPort(ClaimFixedPortOptions{
		BindHost:                "0.0.0.0",
		ManifestPath:            "/tmp/other/devhost.toml",
		Port:                    3000,
		PortClaimsDirectoryPath: paths.PortClaimsDirectoryPath,
	}); error == nil || !strings.Contains(error.Error(), "Fixed bind port 0.0.0.0:3000 is already claimed by PID 4321 from /tmp/project/devhost.toml.") {
		t.Fatalf("ClaimFixedPort(...) overlapping error = %v", error)
	}

	if error := ReleaseFixedPortClaim(ClaimFixedPortOptions{
		BindHost:                "127.0.0.1",
		ManifestPath:            "/tmp/other/devhost.toml",
		Port:                    3000,
		PortClaimsDirectoryPath: paths.PortClaimsDirectoryPath,
	}); error != nil {
		t.Fatalf("ReleaseFixedPortClaim(...) wrong manifest unexpected error = %v", error)
	}
	if _, error := os.Stat(claimPath); error != nil {
		t.Fatalf("stat fixed port claim after ignored release error = %v", error)
	}

	if error := ReleaseFixedPortClaim(claimOptions); error != nil {
		t.Fatalf("ReleaseFixedPortClaim(...) unexpected error = %v", error)
	}
	if _, error := os.Stat(claimPath); !errors.Is(error, os.ErrNotExist) {
		t.Fatalf("stat released fixed port claim error = %v, want not-exist", error)
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
	if error := ClaimHost(claimOptions); error != nil {
		t.Fatalf("ClaimHost(...) unexpected error = %v", error)
	}
	if error := ClaimHost(claimOptions); error != nil {
		t.Fatalf("ClaimHost(...) same manifest unexpected error = %v", error)
	}

	claimPath := filepath.Join(paths.HostClaimsDirectoryPath, "hello.localhost.json")
	claimText, error := os.ReadFile(claimPath)
	if error != nil {
		t.Fatalf("ReadFile(...) error = %v", error)
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
	if error := ClaimHost(ClaimHostOptions{
		Host:                       "hello.localhost",
		ManifestPath:               "/tmp/project/devhost.toml",
		RegistrationsDirectoryPath: paths.RegistrationsDirectoryPath,
	}); error == nil || !strings.Contains(error.Error(), "hello.localhost is already claimed by PID 4321 from /tmp/other/devhost.toml.") {
		t.Fatalf("ClaimHost(...) live registration error = %v", error)
	}

	if error := removeIfExists(filepath.Join(paths.RegistrationsDirectoryPath, "hello.localhost_api_2f6170692f2a.json")); error != nil {
		t.Fatalf("removeIfExists(...) error = %v", error)
	}
	writeRegistration(t, filepath.Join(paths.RegistrationsDirectoryPath, "hello.localhost_legacy_2f.json"), strings.Join([]string{
		"{",
		`  "createdAt": "2026-04-19T12:34:56.000Z",`,
		`  "host": "hello.localhost",`,
		`  "ownerPid": 4321,`,
		`  "port": 3000`,
		"}",
	}, "\n"))
	if error := ClaimHost(ClaimHostOptions{
		Host:                       "hello.localhost",
		ManifestPath:               "/tmp/project/devhost.toml",
		RegistrationsDirectoryPath: paths.RegistrationsDirectoryPath,
	}); error == nil || !strings.Contains(error.Error(), "hello.localhost is already claimed by PID 4321 on port 3000.") {
		t.Fatalf("ClaimHost(...) legacy registration error = %v", error)
	}

	if error := ReleaseHostClaim(ClaimHostOptions{
		Host:                       "hello.localhost",
		ManifestPath:               "/tmp/other/devhost.toml",
		RegistrationsDirectoryPath: paths.RegistrationsDirectoryPath,
	}); error != nil {
		t.Fatalf("ReleaseHostClaim(...) wrong manifest unexpected error = %v", error)
	}
	if _, error := os.Stat(claimPath); error != nil {
		t.Fatalf("stat host claim after ignored release error = %v", error)
	}

	if error := ReleaseHostClaim(claimOptions); error != nil {
		t.Fatalf("ReleaseHostClaim(...) unexpected error = %v", error)
	}
	if _, error := os.Stat(claimPath); !errors.Is(error, os.ErrNotExist) {
		t.Fatalf("stat released host claim error = %v, want not-exist", error)
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
		got, error := ResolveProxyHost(tt.bindHost)
		if error != nil {
			t.Fatalf("ResolveProxyHost(%q) unexpected error = %v", tt.bindHost, error)
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
	if _, error := ResolveProxyHost("192.168.1.10"); error == nil || error.Error() != "Unsupported bind host: 192.168.1.10" {
		t.Fatalf("ResolveProxyHost(...) error = %v, want %q", error, "Unsupported bind host: 192.168.1.10")
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

	snippet, error := renderHostRouteSnippet(registrations, true, 8080, 4443)
	if error != nil {
		t.Fatalf("renderHostRouteSnippet(...) unexpected error = %v", error)
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

	missingRootSnippet, error := renderHostRouteSnippet([]routeRegistration{mustParseRouteRegistration(t, createRouteRegistrationText(ActivateRouteOptions{
		AppBindHost: "127.0.0.1",
		AppPort:     3001,
		Host:        "hello.localhost",
		Path:        "/api/*",
		ServiceName: "api",
	}, "/tmp/project/devhost.toml"))}, false, 0, 0)
	if error != nil {
		t.Fatalf("renderHostRouteSnippet(...) missing-root unexpected error = %v", error)
	}
	if !strings.Contains(missingRootSnippet, "    error 404") {
		t.Fatalf("renderHostRouteSnippet(...) missing root fallback = %q", missingRootSnippet)
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

	if error := syncHostRoute("hello.localhost", paths.RoutesDirectoryPath, &managedCaddyGlobalSettings{AdminAddress: DefaultManagedCaddyAdminAddress, BindHost: defaultManagedCaddyBindHost, HTTPPort: defaultManagedCaddyHTTPPort, HTTPSPort: defaultManagedCaddyHTTPSPort}); error != nil {
		t.Fatalf("syncHostRoute(...) unexpected error = %v", error)
	}

	hostRouteText, error := os.ReadFile(filepath.Join(paths.RoutesDirectoryPath, "hello.localhost.caddy"))
	if error != nil {
		t.Fatalf("ReadFile(...) host route error = %v", error)
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

	if error := ActivateRoute(ActivateRouteOptions{
		AppBindHost: "127.0.0.1",
		AppPort:     3000,
		Host:        "hello.localhost",
		Path:        "/",
		ServiceName: "web",
	}, "/tmp/project/devhost.toml", paths.RoutesDirectoryPath); error != nil {
		t.Fatalf("ActivateRoute(...) unexpected error = %v", error)
	}

	registrationPath := filepath.Join(paths.RegistrationsDirectoryPath, "hello.localhost_web_2f.json")
	if _, error := os.Stat(registrationPath); error != nil {
		t.Fatalf("stat registration error = %v", error)
	}
	hostRoutePath := filepath.Join(paths.RoutesDirectoryPath, "hello.localhost.caddy")
	hostRouteText, error := os.ReadFile(hostRoutePath)
	if error != nil {
		t.Fatalf("ReadFile(...) host route error = %v", error)
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

	error := ActivateRoute(ActivateRouteOptions{
		AppBindHost:    "127.0.0.1",
		AppPort:        3000,
		CaddyHTTPSPort: 4443,
		Host:           "hello.localhost",
		Path:           "/",
		ServiceName:    "web",
	}, "/tmp/project/devhost.toml", paths.RoutesDirectoryPath)
	if error == nil || error.Error() != "Caddy reload failed. Is Caddy already running?\nstderr line\nstdout line" {
		t.Fatalf("ActivateRoute(...) error = %v, want exact reload failure", error)
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

	caddyfileText, error := os.ReadFile(paths.CaddyfilePath)
	if error != nil {
		t.Fatalf("ReadFile(...) caddyfile error = %v", error)
	}
	if !strings.Contains(string(caddyfileText), "https://:4443 {") {
		t.Fatalf("caddyfile text = %q, want activation-time global settings to remain after rollback", string(caddyfileText))
	}

	notFoundPagePath := createManagedCaddyNotFoundSitePaths(paths.CaddyDirectoryPath).PagePath
	pageText, error := os.ReadFile(notFoundPagePath)
	if error != nil {
		t.Fatalf("ReadFile(...) not-found page error = %v", error)
	}
	if !strings.Contains(string(pageText), "No devhost hostnames are active right now.") {
		t.Fatalf("not-found page = %q, want rollback resync", string(pageText))
	}
}

func TestActivateRouteSuppressesSuccessfulReloadOutput(t *testing.T) {
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

	if error := ActivateRoute(ActivateRouteOptions{
		AppBindHost: "127.0.0.1",
		AppPort:     3000,
		Host:        "quiet.localhost",
		Path:        "/",
		ServiceName: "web",
	}, "/tmp/project/devhost.toml", paths.RoutesDirectoryPath); error != nil {
		t.Fatalf("ActivateRoute(...) unexpected error = %v", error)
	}

	if _, error := os.Stat(filepath.Join(paths.RegistrationsDirectoryPath, "quiet.localhost_web_2f.json")); error != nil {
		t.Fatalf("stat registration error = %v", error)
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
	if error := syncHostRoute("hello.localhost", paths.RoutesDirectoryPath, &managedCaddyGlobalSettings{AdminAddress: DefaultManagedCaddyAdminAddress, BindHost: defaultManagedCaddyBindHost, HTTPPort: defaultManagedCaddyHTTPPort, HTTPSPort: defaultManagedCaddyHTTPSPort}); error != nil {
		t.Fatalf("syncHostRoute(...) unexpected error = %v", error)
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

	if error := UnregisterRoute("web", "hello.localhost", "/", "/tmp/other/devhost.toml", paths.RegistrationsDirectoryPath); error != nil {
		t.Fatalf("UnregisterRoute(...) wrong manifest unexpected error = %v", error)
	}
	if reloadCalls != 0 {
		t.Fatalf("reload calls after ignored unregister = %d, want 0", reloadCalls)
	}

	if error := UnregisterRoute("web", "hello.localhost", "/", "/tmp/project/devhost.toml", paths.RegistrationsDirectoryPath); error != nil {
		t.Fatalf("UnregisterRoute(...) unexpected error = %v", error)
	}
	if reloadCalls != 1 {
		t.Fatalf("reload calls after unregister = %d, want 1", reloadCalls)
	}
	if _, error := os.Stat(filepath.Join(paths.RegistrationsDirectoryPath, "hello.localhost_web_2f.json")); !errors.Is(error, os.ErrNotExist) {
		t.Fatalf("stat unregistered registration error = %v, want not-exist", error)
	}
	if _, error := os.Stat(filepath.Join(paths.RoutesDirectoryPath, "hello.localhost.caddy")); !errors.Is(error, os.ErrNotExist) {
		t.Fatalf("stat unregistered host route error = %v, want not-exist", error)
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
	if error := syncHostRoute("live.localhost", paths.RoutesDirectoryPath, &managedCaddyGlobalSettings{AdminAddress: DefaultManagedCaddyAdminAddress, BindHost: defaultManagedCaddyBindHost, HTTPPort: defaultManagedCaddyHTTPPort, HTTPSPort: defaultManagedCaddyHTTPSPort}); error != nil {
		t.Fatalf("syncHostRoute(...) unexpected error = %v", error)
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

	if error := CleanupStaleRegistrations(paths.RegistrationsDirectoryPath); error != nil {
		t.Fatalf("CleanupStaleRegistrations(...) unexpected error = %v", error)
	}
	for _, stalePath := range []string{
		filepath.Join(paths.RegistrationsDirectoryPath, "hello.localhost_web_2f.json"),
		filepath.Join(paths.RegistrationsDirectoryPath, "legacy.localhost_legacy_2f.json"),
		filepath.Join(paths.RoutesDirectoryPath, "legacy.localhost_legacy_2f.caddy"),
		filepath.Join(paths.HostClaimsDirectoryPath, "hello.localhost.json"),
	} {
		if _, error := os.Stat(stalePath); !errors.Is(error, os.ErrNotExist) {
			t.Fatalf("stat stale cleanup path %q error = %v, want not-exist", stalePath, error)
		}
	}

	liveHostRouteText, error := os.ReadFile(filepath.Join(paths.RoutesDirectoryPath, "live.localhost.caddy"))
	if error != nil {
		t.Fatalf("ReadFile(...) live host route error = %v", error)
	}
	if !strings.Contains(string(liveHostRouteText), "reverse_proxy 127.0.0.1:3001") {
		t.Fatalf("live host route text = %q, want synced live route", string(liveHostRouteText))
	}
}

type routeMutationTestHooks struct {
	now          time.Time
	processAlive func(int) bool
	processID    int
}

func withRouteMutationTestHooks(t *testing.T, hooks routeMutationTestHooks) {
	t.Helper()
	originalNow := routeMutationNow
	originalProcessID := routeMutationProcessID
	originalProcessAlive := routeMutationIsProcessAlive
	routeMutationNow = func() time.Time {
		return hooks.now
	}
	routeMutationProcessID = func() int {
		return hooks.processID
	}
	if hooks.processAlive == nil {
		routeMutationIsProcessAlive = func(processID int) bool {
			return processID == hooks.processID
		}
	} else {
		routeMutationIsProcessAlive = hooks.processAlive
	}
	t.Cleanup(func() {
		routeMutationNow = originalNow
		routeMutationProcessID = originalProcessID
		routeMutationIsProcessAlive = originalProcessAlive
	})
}

func newManagedCaddyPaths(t *testing.T) Paths {
	t.Helper()
	paths := CreateManagedCaddyPaths(t.TempDir())
	if error := ensureManagedCaddyConfig(paths, ManagedCaddyConfigFallback{RuntimeOS: "linux"}); error != nil {
		t.Fatalf("ensureManagedCaddyConfig(...) unexpected error = %v", error)
	}

	return paths
}

func mustParseRouteRegistration(t *testing.T, text string) routeRegistration {
	t.Helper()
	registration, error := parseRouteRegistration([]byte(text))
	if error != nil {
		t.Fatalf("parseRouteRegistration(...) unexpected error = %v", error)
	}

	return registration
}

func TestReadAppTargetUnsupportedHost(t *testing.T) {
	target, error := readAppTarget(routeRegistration{AppBindHost: "192.168.1.10", AppPort: 3000})
	if error == nil || error.Error() != "Unsupported bind host: 192.168.1.10" {
		t.Fatalf("readAppTarget(...) error = %v, want %q", error, "Unsupported bind host: 192.168.1.10")
	}
	if target != "" {
		t.Fatalf("readAppTarget(...) = %q, want empty target on error", target)
	}
}
