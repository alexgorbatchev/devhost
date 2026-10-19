package caddy

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestUnregisterLastRouteRetainsIsolatedCaddy(t *testing.T) {
	withRouteMutationTestHooks(t, routeMutationTestHooks{processID: 4321})
	running := ManagedCaddyGlobalSettings{AdminAddress: "127.0.0.1:22000", BindHost: "127.0.0.1", HTTPEnabled: true, HTTPPort: 28080, HTTPSPort: 28443}
	paths := newManagedCaddyPathsWithSettings(t, running)
	route := ActivateRouteOptions{AppBindHost: "127.0.0.1", AppPort: 3000, Host: "demo.localhost", Path: "/", ServiceName: "web"}
	manifestPath := filepath.Join(paths.StateDirectoryPath, "devhost.toml")
	writeRegistration(t, getRouteRegistrationPath(route.ServiceName, route.Host, route.Path, paths.RoutesDirectoryPath), createRouteRegistrationText(route, manifestPath))
	if err := syncHostRoute(route.Host, paths.RoutesDirectoryPath, running); err != nil {
		t.Fatal(err)
	}
	originalRun := routeMutationRunManagedCaddyCommand
	t.Cleanup(func() { routeMutationRunManagedCaddyCommand = originalRun })
	var reloadAddress string
	routeMutationRunManagedCaddyCommand = func(_ Paths, _ []string, options ManagedCaddyCommandOptions) CommandResult {
		reloadAddress = options.AdminAddress
		return CommandResult{Success: true}
	}
	if err := UnregisterRoute(route.ServiceName, route.Host, route.Path, manifestPath, paths.RegistrationsDirectoryPath, RouteCommandOutputWriters{}); err != nil {
		t.Fatal(err)
	}
	if reloadAddress != running.AdminAddress {
		t.Fatalf("reload targets %q, want isolated admin %q", reloadAddress, running.AdminAddress)
	}
	rendered, err := renderManagedCaddyfile(renderManagedCaddyfileOptions{AdminAddress: running.AdminAddress, BindHost: running.BindHost, EnableHTTP: running.HTTPEnabled, HTTPPort: running.HTTPPort, HTTPSPort: running.HTTPSPort, Paths: paths, RuntimeOS: runtime.GOOS})
	if err != nil {
		t.Fatal(err)
	}
	actual, err := os.ReadFile(paths.CaddyfilePath)
	if err != nil {
		t.Fatal(err)
	}
	// With no routes, retain the current listener configuration rather than exposing default ports.
	if string(actual) != rendered {
		t.Fatalf("Caddyfile after shutdown = %q, want %q", actual, rendered)
	}
	if applied, _, _ := ReadAppliedManagedCaddySettings(paths); applied != running {
		t.Fatalf("applied settings after shutdown = %#v, want %#v", applied, running)
	}
	if _, err := os.Stat(getHostRoutePath(route.Host, paths.RoutesDirectoryPath)); !os.IsNotExist(err) {
		t.Fatalf("removed host route still exists: %v", err)
	}
}
