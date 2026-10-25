package caddy

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

func TestApplyManagedCaddySettings(t *testing.T) {
	running := ManagedCaddyGlobalSettings{AdminAddress: "127.0.0.1:22001", BindHost: "127.0.0.1", HTTPPort: 80, HTTPSPort: 443}
	moved := ManagedCaddyGlobalSettings{StackDirectoryHost: "stacks.custom.localhost", AdminAddress: "127.0.0.1:22002", BindHost: "127.0.0.1", HTTPEnabled: true, HTTPPort: 8080, HTTPSPort: 8443}
	tests := []struct {
		name         string
		next         ManagedCaddyGlobalSettings
		reloadFails  bool
		wantChanged  bool
		wantReloads  []string
		wantApplied  ManagedCaddyGlobalSettings
		wantSnippet  string
		wantCaddy    string
		wantErrorHas string
	}{
		{
			name: "moves Caddy through the admin address it runs", next: moved, wantChanged: true,
			wantReloads: []string{running.AdminAddress}, wantApplied: moved,
			wantSnippet: "https://app.localhost:8443 {", wantCaddy: "admin 127.0.0.1:22002",
		},
		{
			name: "leaves Caddy alone when it already runs the settings", next: running,
			wantApplied: running, wantSnippet: "https://app.localhost {", wantCaddy: "admin 127.0.0.1:22001",
		},
		{
			name: "restores the running settings when Caddy rejects them", next: moved, reloadFails: true,
			// Caddy rolls a rejected config back itself, so only the files are restored.
			wantReloads: []string{running.AdminAddress}, wantApplied: running,
			wantSnippet: "https://app.localhost {", wantCaddy: "admin 127.0.0.1:22001", wantErrorHas: "Caddy reload failed",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			withRouteMutationTestHooks(t, routeMutationTestHooks{now: time.Now(), processID: 4321})
			paths := newManagedCaddyPathsWithSettings(t, running)
			original := routeMutationRunManagedCaddyCommand
			t.Cleanup(func() { routeMutationRunManagedCaddyCommand = original })
			routeMutationRunManagedCaddyCommand = func(Paths, []string, ManagedCaddyCommandOptions) CommandResult { return CommandResult{Success: true} }
			route := ActivateRouteOptions{AppBindHost: "127.0.0.1", AppPort: 3000, Host: "app.localhost", Path: "/", ServiceName: "web"}
			if err := ActivateRoute(route, "/project/devhost.toml", paths.RoutesDirectoryPath); err != nil {
				t.Fatal(err)
			}

			var reloads []string
			routeMutationRunManagedCaddyCommand = func(_ Paths, arguments []string, options ManagedCaddyCommandOptions) CommandResult {
				reloads = append(reloads, options.AdminAddress)
				return CommandResult{Success: !tc.reloadFails || len(reloads) > 1}
			}
			changed, err := ApplyManagedCaddySettings(paths, tc.next, RouteCommandOutputWriters{})
			if tc.wantErrorHas != "" {
				if err == nil || !strings.Contains(err.Error(), tc.wantErrorHas) {
					t.Fatalf("ApplyManagedCaddySettings(...) error = %v, want %q", err, tc.wantErrorHas)
				}
			} else if err != nil {
				t.Fatalf("ApplyManagedCaddySettings(...) error = %v", err)
			}
			if changed != tc.wantChanged {
				t.Fatalf("ApplyManagedCaddySettings(...) changed = %v, want %v", changed, tc.wantChanged)
			}
			if strings.Join(reloads, ",") != strings.Join(tc.wantReloads, ",") {
				t.Fatalf("reload admin addresses = %v, want %v", reloads, tc.wantReloads)
			}
			applied, ok, err := ReadAppliedManagedCaddySettings(paths)
			if err != nil || !ok || applied != tc.wantApplied {
				t.Fatalf("ReadAppliedManagedCaddySettings(...) = %#v, %v, %v, want %#v", applied, ok, err, tc.wantApplied)
			}
			assertFileContains(t, getHostRoutePath(route.Host, paths.RoutesDirectoryPath), tc.wantSnippet)
			assertFileContains(t, paths.CaddyfilePath, tc.wantCaddy)
			assertFileContains(t, stackDirectorySnippetPath(paths), tc.wantApplied.StackDirectoryHostname())
		})
	}
}

func TestRouteMutationsUseTheRunningSettings(t *testing.T) {
	withRouteMutationTestHooks(t, routeMutationTestHooks{now: time.Now(), processID: 4321})
	running := ManagedCaddyGlobalSettings{AdminAddress: "127.0.0.1:22003", BindHost: "127.0.0.1", HTTPEnabled: true, HTTPPort: 8080, HTTPSPort: 8443}
	paths := newManagedCaddyPathsWithSettings(t, running)
	original := routeMutationRunManagedCaddyCommand
	t.Cleanup(func() { routeMutationRunManagedCaddyCommand = original })
	var reloads []string
	routeMutationRunManagedCaddyCommand = func(_ Paths, _ []string, options ManagedCaddyCommandOptions) CommandResult {
		reloads = append(reloads, options.AdminAddress)
		return CommandResult{Success: true}
	}
	route := ActivateRouteOptions{AppBindHost: "127.0.0.1", AppPort: 3000, Host: "app.localhost", Path: "/", ServiceName: "web"}
	if err := ActivateRoute(route, "/project/devhost.toml", paths.RoutesDirectoryPath); err != nil {
		t.Fatal(err)
	}
	if err := UnregisterRoute(route.ServiceName, route.Host, route.Path, "/project/devhost.toml", paths.RegistrationsDirectoryPath, RouteCommandOutputWriters{}); err != nil {
		t.Fatal(err)
	}
	if strings.Join(reloads, ",") != running.AdminAddress+","+running.AdminAddress {
		t.Fatalf("reload admin addresses = %v, want the running admin address twice", reloads)
	}
	if applied, _, _ := ReadAppliedManagedCaddySettings(paths); applied != running {
		t.Fatalf("route changes altered the running settings: %#v", applied)
	}
	assertFileContains(t, paths.CaddyfilePath, "admin 127.0.0.1:22003")
}

func TestSharedCaddyChangesHoldTheRouteLock(t *testing.T) {
	withRouteMutationTestHooks(t, routeMutationTestHooks{now: time.Now(), processID: 4321})
	paths := newManagedCaddyPaths(t)
	original := routeMutationRunManagedCaddyCommand
	t.Cleanup(func() { routeMutationRunManagedCaddyCommand = original })
	route := ActivateRouteOptions{AppBindHost: "127.0.0.1", AppPort: 3000, Host: "app.localhost", Path: "/", ServiceName: "web"}
	moved := DefaultManagedCaddyGlobalSettings()
	moved.HTTPSPort = 8443
	changes := []struct {
		name   string
		change func() error
	}{
		{"activating a route", func() error { return ActivateRoute(route, "/project/devhost.toml", paths.RoutesDirectoryPath) }},
		{"syncing a host", func() error {
			return SyncManagedHostRoute(route.Host, paths.RoutesDirectoryPath, RouteCommandOutputWriters{})
		}},
		{"applying listener settings", func() error {
			_, err := ApplyManagedCaddySettings(paths, moved, RouteCommandOutputWriters{})
			return err
		}},
		{"removing a route", func() error {
			return UnregisterRoute(route.ServiceName, route.Host, route.Path, "/project/devhost.toml", paths.RegistrationsDirectoryPath, RouteCommandOutputWriters{})
		}},
	}
	for _, tc := range changes {
		// Another devhost process trying the lock while Caddy reloads must find it held.
		held := false
		routeMutationRunManagedCaddyCommand = func(Paths, []string, ManagedCaddyCommandOptions) CommandResult {
			held = isRouteLockHeld(t, paths)
			return CommandResult{Success: true}
		}
		if err := tc.change(); err != nil {
			t.Fatalf("%s: %v", tc.name, err)
		}
		if !held {
			t.Fatalf("%s reloaded Caddy without holding the route lock", tc.name)
		}
		if isRouteLockHeld(t, paths) {
			t.Fatalf("%s kept the route lock", tc.name)
		}
	}
}

func isRouteLockHeld(t *testing.T, paths Paths) bool {
	t.Helper()
	f, err := os.OpenFile(filepath.Join(paths.CaddyDirectoryPath, "routes.lock"), os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	err = unix.Flock(int(f.Fd()), unix.LOCK_EX|unix.LOCK_NB)
	if errors.Is(err, unix.EWOULDBLOCK) {
		return true
	}
	if err != nil {
		t.Fatal(err)
	}
	if err := unix.Flock(int(f.Fd()), unix.LOCK_UN); err != nil {
		t.Fatal(err)
	}
	return false
}

func TestReadAppliedManagedCaddySettingsWithoutRecord(t *testing.T) {
	paths := CreateManagedCaddyPaths(t.TempDir())
	if _, ok, err := ReadAppliedManagedCaddySettings(paths); err != nil || ok {
		t.Fatalf("ReadAppliedManagedCaddySettings(...) = %v, %v, want no record", ok, err)
	}
}

func assertFileContains(t *testing.T, path string, want string) {
	t.Helper()
	text, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(text), want) {
		t.Fatalf("%s = %q, want it to contain %q", path, text, want)
	}
}
