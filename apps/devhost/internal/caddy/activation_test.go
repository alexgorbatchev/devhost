package caddy

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestActivateRoutesUsesOneReload(t *testing.T) {
	withRouteMutationTestHooks(t, routeMutationTestHooks{now: time.Date(2026, time.April, 19, 12, 34, 56, 0, time.UTC), processID: 4321})
	paths := newManagedCaddyPaths(t)
	originalRun := routeMutationRunManagedCaddyCommand
	t.Cleanup(func() { routeMutationRunManagedCaddyCommand = originalRun })
	reloads := 0
	routeMutationRunManagedCaddyCommand = func(Paths, []string, ManagedCaddyCommandOptions) CommandResult {
		reloads++
		return CommandResult{Success: true}
	}
	options := []ActivateRouteOptions{
		{AppBindHost: "127.0.0.1", AppPort: 3000, Host: "app.localhost", Path: "/", ServiceName: "web"},
		{AppBindHost: "127.0.0.1", AppPort: 3000, Host: "alias.localhost", Path: "/", ServiceName: "web"},
	}
	if err := ActivateRoutes(options, "/project/devhost.toml", paths.RoutesDirectoryPath); err != nil {
		t.Fatal(err)
	}
	if reloads != 1 {
		t.Fatalf("Caddy reloads = %d, want 1", reloads)
	}
	for _, route := range options {
		if _, err := os.Stat(getRouteRegistrationPath(route.ServiceName, route.Host, route.Path, paths.RoutesDirectoryPath)); err != nil {
			t.Fatal(err)
		}
		if _, err := os.Stat(filepath.Join(paths.RoutesDirectoryPath, route.Host+".caddy")); err != nil {
			t.Fatal(err)
		}
	}
}
