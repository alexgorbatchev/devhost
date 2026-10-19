package caddy

import (
	"errors"
	"os"
	"strings"
	"testing"
	"time"
)

func TestCustomAdminRouteRetirement(t *testing.T) {
	for _, tc := range []struct {
		name       string
		hasSibling bool
	}{
		{name: "final registration"},
		{name: "remaining sibling", hasSibling: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			withRouteMutationTestHooks(t, routeMutationTestHooks{processID: 4321, now: time.Now()})
			running := retirementTestSettings()
			paths := newManagedCaddyPathsWithSettings(t, running)
			owned := ActivateRouteOptions{ServiceName: "web", Host: "removed.localhost", Path: "/api/*", AppBindHost: "127.0.0.1", AppPort: 3000}
			writeRegistration(t, getRouteRegistrationPath(owned.ServiceName, owned.Host, owned.Path, paths.RoutesDirectoryPath), createRouteRegistrationText(owned, "/project/owned.toml"))
			if tc.hasSibling {
				sibling := owned
				sibling.Host = "sibling.localhost"
				writeRegistration(t, getRouteRegistrationPath(sibling.ServiceName, sibling.Host, sibling.Path, paths.RoutesDirectoryPath), createRouteRegistrationText(sibling, "/project/sibling.toml"))
				if err := syncHostRoute(sibling.Host, paths.RoutesDirectoryPath, running); err != nil {
					t.Fatal(err)
				}
			}
			if err := syncHostRoute(owned.Host, paths.RoutesDirectoryPath, running); err != nil {
				t.Fatal(err)
			}
			originalRun := routeMutationRunManagedCaddyCommand
			t.Cleanup(func() { routeMutationRunManagedCaddyCommand = originalRun })
			calls := 0
			routeMutationRunManagedCaddyCommand = func(actual Paths, arguments []string, options ManagedCaddyCommandOptions) CommandResult {
				calls++
				if options.AdminAddress != running.AdminAddress {
					t.Errorf("reload destination = %q, want running %q", options.AdminAddress, running.AdminAddress)
				}
				return CommandResult{Stderr: []byte("diagnostic interception: no Caddy invoked"), Success: false}
			}
			if err := UnregisterRoute(owned.ServiceName, owned.Host, owned.Path, "/project/other.toml", paths.RegistrationsDirectoryPath, RouteCommandOutputWriters{}); err != nil {
				t.Fatal(err)
			}
			if calls != 0 {
				t.Fatalf("foreign manifest triggered %d commands", calls)
			}
			ownedRegistrationText := createRouteRegistrationText(owned, "/project/owned.toml")
			routeMutationProcessID = func() int { return 8765 }
			if err := UnregisterRoute(owned.ServiceName, owned.Host, owned.Path, "/project/owned.toml", paths.RegistrationsDirectoryPath, RouteCommandOutputWriters{}); err != nil {
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
			err = UnregisterRoute(owned.ServiceName, owned.Host, owned.Path, "/project/owned.toml", paths.RegistrationsDirectoryPath, RouteCommandOutputWriters{})
			if err == nil || err.Error() != "Caddy reload failed. Is Caddy already running?\ndiagnostic interception: no Caddy invoked" {
				t.Fatalf("diagnostic error = %v", err)
			}
			if calls != 1 {
				t.Fatalf("reload calls = %d, want 1", calls)
			}
			assertRetainedListeners(t, paths, running)
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

func TestStaleRetirementPreservesRunningConfiguration(t *testing.T) {
	for _, tc := range []struct {
		name       string
		hasSibling bool
	}{
		{name: "no live routes"},
		{name: "live sibling", hasSibling: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			withRouteMutationTestHooks(t, routeMutationTestHooks{processID: 4321, now: time.Now()})
			running := retirementTestSettings()
			paths := newManagedCaddyPathsWithSettings(t, running)
			stale := ActivateRouteOptions{ServiceName: "web", Host: "stale.localhost", Path: "/", AppBindHost: "127.0.0.1", AppPort: 3000}
			writeRegistration(t, getRouteRegistrationPath(stale.ServiceName, stale.Host, stale.Path, paths.RoutesDirectoryPath), strings.ReplaceAll(createRouteRegistrationText(stale, "/project/stale.toml"), `"ownerPid": 4321`, `"ownerPid": 999999`))
			writeRouteFile(t, getHostRoutePath(stale.Host, paths.RoutesDirectoryPath))
			live := stale
			live.Host, live.Path = "live.localhost", "/api/*"
			if tc.hasSibling {
				writeRegistration(t, getRouteRegistrationPath(live.ServiceName, live.Host, live.Path, paths.RoutesDirectoryPath), createRouteRegistrationText(live, "/project/live.toml"))
				if err := syncHostRoute(live.Host, paths.RoutesDirectoryPath, running); err != nil {
					t.Fatal(err)
				}
			}
			originalRun := routeMutationRunManagedCaddyCommand
			t.Cleanup(func() { routeMutationRunManagedCaddyCommand = originalRun })
			calls := 0
			routeMutationRunManagedCaddyCommand = func(Paths, []string, ManagedCaddyCommandOptions) CommandResult {
				calls++
				return CommandResult{Stderr: []byte("diagnostic interception: no Caddy invoked"), Success: false}
			}
			if err := CleanupStaleRegistrations(paths.RegistrationsDirectoryPath); err != nil {
				t.Fatal(err)
			}
			if calls != 0 {
				t.Fatalf("startup stale cleanup unexpectedly invoked %d commands", calls)
			}
			assertRetainedListeners(t, paths, running)
			if _, err := os.Stat(getHostRoutePath(stale.Host, paths.RoutesDirectoryPath)); !errors.Is(err, os.ErrNotExist) {
				t.Fatalf("stale host survived: %v", err)
			}
			if tc.hasSibling {
				snippet, err := os.ReadFile(getHostRoutePath(live.Host, paths.RoutesDirectoryPath))
				if err != nil {
					t.Fatal(err)
				}
				if !strings.Contains(string(snippet), "/api/*") || !strings.Contains(string(snippet), "reverse_proxy 127.0.0.1:3000") || !strings.Contains(string(snippet), "https://live.localhost:43273") {
					t.Fatalf("live route lost path, backend, or listener:\n%s", snippet)
				}
			}
		})
	}
}

func assertRetainedListeners(t *testing.T, paths Paths, running ManagedCaddyGlobalSettings) {
	t.Helper()
	if applied, _, err := ReadAppliedManagedCaddySettings(paths); err != nil || applied != running {
		t.Fatalf("applied settings = %#v, %v, want %#v", applied, err, running)
	}
	text, err := os.ReadFile(paths.CaddyfilePath)
	if err != nil {
		t.Fatal(err)
	}
	for _, fragment := range []string{"admin " + running.AdminAddress, "default_bind 0.0.0.0 [::]", "https://:43273", "http://:36009"} {
		if !strings.Contains(string(text), fragment) {
			t.Errorf("retired configuration lost %q:\n%s", fragment, text)
		}
	}
}

func retirementTestSettings() ManagedCaddyGlobalSettings {
	return ManagedCaddyGlobalSettings{AdminAddress: "127.0.0.1:44723", BindHost: "0.0.0.0", HTTPEnabled: true, HTTPPort: 36009, HTTPSPort: 43273}
}
