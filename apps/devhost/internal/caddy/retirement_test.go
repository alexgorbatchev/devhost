package caddy

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestCustomAdminRouteRetirement(t *testing.T) {
	cases := []struct {
		name            string
		hasSibling      bool
		isSparseSibling bool
		wantHTTP        bool
	}{
		{name: "final registration", wantHTTP: true},
		{name: "remaining explicit sibling", hasSibling: true},
		{name: "remaining sparse default sibling", hasSibling: true, isSparseSibling: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			withRouteMutationTestHooks(t, routeMutationTestHooks{processID: 4321, now: time.Now()})
			paths := newManagedCaddyPaths(t)
			configured := retirementTestFallback()
			owned := ActivateRouteOptions{ServiceName: "web", Host: "removed.localhost", Path: "/api/*", AppBindHost: "127.0.0.1", AppPort: 3000, CaddyAdminAddress: configured.AdminAddress, CaddyBindHost: configured.BindHost, CaddyHTTPPort: configured.HTTPPort, CaddyHTTPSPort: configured.HTTPSPort, HTTPEnabled: true}
			writeRegistration(t, getRouteRegistrationPath(owned.ServiceName, owned.Host, owned.Path, paths.RoutesDirectoryPath), createRouteRegistrationText(owned, "/project/owned.toml"))
			if tc.hasSibling {
				sibling := owned
				sibling.Host = "sibling.localhost"
				sibling.HTTPEnabled = false
				if tc.isSparseSibling {
					sibling.CaddyAdminAddress, sibling.CaddyBindHost = "", ""
					sibling.CaddyHTTPPort, sibling.CaddyHTTPSPort = 0, 0
				}
				writeRegistration(t, getRouteRegistrationPath(sibling.ServiceName, sibling.Host, sibling.Path, paths.RoutesDirectoryPath), createRouteRegistrationText(sibling, "/project/sibling.toml"))
			}
			if err := ensureManagedCaddyConfig(paths, configured); err != nil {
				t.Fatal(err)
			}
			if err := syncHostRoute(owned.Host, paths.RoutesDirectoryPath, nil); err != nil {
				t.Fatal(err)
			}
			originalRun := routeMutationRunManagedCaddyCommand
			t.Cleanup(func() { routeMutationRunManagedCaddyCommand = originalRun })
			calls := 0
			routeMutationRunManagedCaddyCommand = func(actual Paths, arguments []string, options ManagedCaddyCommandOptions) CommandResult {
				calls++
				if options.AdminAddress != configured.AdminAddress {
					t.Errorf("reload destination = %q, want owned %q", options.AdminAddress, configured.AdminAddress)
				}
				return CommandResult{Stderr: []byte("diagnostic interception: no Caddy invoked"), Success: false}
			}
			if err := UnregisterRoute(owned.ServiceName, owned.Host, owned.Path, "/project/other.toml", paths.RegistrationsDirectoryPath, configured, RouteCommandOutputWriters{}); err != nil {
				t.Fatal(err)
			}
			if calls != 0 {
				t.Fatalf("foreign manifest triggered %d commands", calls)
			}
			ownedRegistrationText := createRouteRegistrationText(owned, "/project/owned.toml")
			routeMutationProcessID = func() int { return 8765 }
			if err := UnregisterRoute(owned.ServiceName, owned.Host, owned.Path, "/project/owned.toml", paths.RegistrationsDirectoryPath, configured, RouteCommandOutputWriters{}); err != nil {
				t.Fatal(err)
			}
			if calls != 0 {
				t.Fatalf("foreign process triggered %d commands", calls)
			}
			registrationText, err := os.ReadFile(getRouteRegistrationPath(owned.ServiceName, owned.Host, owned.Path, paths.RoutesDirectoryPath))
			if err != nil {
				t.Fatal(err)
			}
			if string(registrationText) != ownedRegistrationText {
				t.Fatal("foreign process changed the registration")
			}
			routeMutationProcessID = func() int { return 4321 }
			err = UnregisterRoute(owned.ServiceName, owned.Host, owned.Path, "/project/owned.toml", paths.RegistrationsDirectoryPath, configured, RouteCommandOutputWriters{})
			if err == nil || err.Error() != "Caddy reload failed. Is Caddy already running?\ndiagnostic interception: no Caddy invoked" {
				t.Fatalf("diagnostic error = %v", err)
			}
			if calls != 1 {
				t.Fatalf("reload calls = %d, want 1", calls)
			}
			text, err := os.ReadFile(paths.CaddyfilePath)
			if err != nil {
				t.Fatal(err)
			}
			for _, fragment := range []string{"admin " + configured.AdminAddress, "default_bind 0.0.0.0 [::]", "https://:43273"} {
				if !strings.Contains(string(text), fragment) {
					t.Errorf("retired configuration lost %q:\n%s", fragment, text)
				}
			}
			if strings.Contains(string(text), "http://:36009") != tc.wantHTTP {
				t.Errorf("HTTP listener after retirement = %s; want enabled %v", text, tc.wantHTTP)
			}
			if _, err := os.Stat(getHostRoutePath(owned.Host, paths.RoutesDirectoryPath)); !errors.Is(err, os.ErrNotExist) {
				t.Errorf("removed host snippet still exists: %v", err)
			}
			if tc.hasSibling {
				text, err := os.ReadFile(getHostRoutePath("sibling.localhost", paths.RoutesDirectoryPath))
				if err != nil {
					t.Fatal(err)
				}
				if !strings.Contains(string(text), "reverse_proxy 127.0.0.1:3000") || !strings.Contains(string(text), "/api/*") {
					t.Errorf("sibling route lost backend/path:\n%s", text)
				}
			}
		})
	}
}

func TestActiveHTTPVotesOverrideEmptyRuntimeFallback(t *testing.T) {
	paths := newManagedCaddyPaths(t)
	writeRegistration(t, filepath.Join(paths.RegistrationsDirectoryPath, "false-voter.json"), `{"appBindHost":"127.0.0.1","host":"false.localhost","path":"/"}`)
	settings, err := ReadManagedCaddyGlobalSettings(paths, ManagedCaddyConfigFallback{AdminAddress: "127.0.0.1:44723", HTTPEnabled: true})
	if err != nil {
		t.Fatal(err)
	}
	if settings.HTTPEnabled {
		t.Fatal("false active voter inherited retired true vote")
	}
}

func TestStaleRetirementPreservesStartupConfiguration(t *testing.T) {
	for _, tc := range []struct {
		name              string
		hasSibling        bool
		staleAdminAddress string
	}{
		{name: "prepared configuration without live votes", staleAdminAddress: "127.0.0.1:44724"},
		{name: "live false sibling", hasSibling: true, staleAdminAddress: "127.0.0.1:44723"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			withRouteMutationTestHooks(t, routeMutationTestHooks{processID: 4321, now: time.Now()})
			paths := newManagedCaddyPaths(t)
			configured := retirementTestFallback()
			if err := ensureManagedCaddyConfig(paths, configured); err != nil {
				t.Fatal(err)
			}
			stale := ActivateRouteOptions{ServiceName: "web", Host: "stale.localhost", Path: "/", AppBindHost: "127.0.0.1", AppPort: 3000, CaddyAdminAddress: tc.staleAdminAddress, CaddyBindHost: configured.BindHost, CaddyHTTPPort: configured.HTTPPort, CaddyHTTPSPort: configured.HTTPSPort, HTTPEnabled: true}
			writeRegistration(t, getRouteRegistrationPath(stale.ServiceName, stale.Host, stale.Path, paths.RoutesDirectoryPath), strings.ReplaceAll(createRouteRegistrationText(stale, "/project/stale.toml"), `"ownerPid": 4321`, `"ownerPid": 999999`))
			writeRouteFile(t, getHostRoutePath(stale.Host, paths.RoutesDirectoryPath))
			live := stale
			live.Host, live.Path, live.HTTPEnabled = "live.localhost", "/api/*", false
			if tc.hasSibling {
				writeRegistration(t, getRouteRegistrationPath(live.ServiceName, live.Host, live.Path, paths.RoutesDirectoryPath), createRouteRegistrationText(live, "/project/live.toml"))
			}
			originalRun := routeMutationRunManagedCaddyCommand
			t.Cleanup(func() { routeMutationRunManagedCaddyCommand = originalRun })
			calls := 0
			routeMutationRunManagedCaddyCommand = func(Paths, []string, ManagedCaddyCommandOptions) CommandResult {
				calls++
				return CommandResult{Stderr: []byte("diagnostic interception: no Caddy invoked"), Success: false}
			}
			if err := CleanupStaleRegistrations(paths.RegistrationsDirectoryPath, configured); err != nil {
				t.Fatal(err)
			}
			if calls != 0 {
				t.Fatalf("startup stale cleanup unexpectedly invoked %d commands", calls)
			}
			settings, err := ReadManagedCaddyGlobalSettings(paths, configured)
			if err != nil {
				t.Fatal(err)
			}
			if settings.AdminAddress != configured.AdminAddress || settings.BindHost != configured.BindHost || settings.HTTPPort != configured.HTTPPort || settings.HTTPSPort != configured.HTTPSPort || settings.HTTPEnabled == tc.hasSibling {
				t.Fatalf("retired stale settings = %#v", settings)
			}
			if _, err := os.Stat(getHostRoutePath(stale.Host, paths.RoutesDirectoryPath)); !errors.Is(err, os.ErrNotExist) {
				t.Fatalf("stale host survived: %v", err)
			}
			if tc.hasSibling {
				snippet, err := os.ReadFile(getHostRoutePath(live.Host, paths.RoutesDirectoryPath))
				if err != nil {
					t.Fatal(err)
				}
				if !strings.Contains(string(snippet), "/api/*") || !strings.Contains(string(snippet), "reverse_proxy 127.0.0.1:3000") {
					t.Fatalf("live route lost path/backend:\n%s", snippet)
				}
			}
			config, err := os.ReadFile(paths.CaddyfilePath)
			if err != nil {
				t.Fatal(err)
			}
			if strings.Contains(string(config), "http://:36009") == tc.hasSibling || !strings.Contains(string(config), "admin "+configured.AdminAddress) || !strings.Contains(string(config), "https://:43273") {
				t.Fatalf("stale retirement lost listener contract:\n%s", config)
			}
		})
	}
}

func retirementTestFallback() ManagedCaddyConfigFallback {
	return ManagedCaddyConfigFallback{AdminAddress: "127.0.0.1:44723", BindHost: "0.0.0.0", HTTPEnabled: true, HTTPPort: 36009, HTTPSPort: 43273, RuntimeOS: "linux"}
}
