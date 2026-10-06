package caddy

import (
	"os"
	"path/filepath"
	"testing"
)

func TestUnregisterLastRouteRetainsIsolatedCaddy(t *testing.T) {
	withRouteMutationTestHooks(t, routeMutationTestHooks{processID: 4321})
	paths := newManagedCaddyPaths(t)
	route := ActivateRouteOptions{
		AppBindHost: "127.0.0.1", AppPort: 3000, Host: "demo.localhost", Path: "/", ServiceName: "web",
		CaddyAdminAddress: "127.0.0.1:22000", CaddyBindHost: "127.0.0.1", HTTPEnabled: true, CaddyHTTPPort: 28080, CaddyHTTPSPort: 28443,
	}
	manifestPath := filepath.Join(paths.StateDirectoryPath, "devhost.toml")
	writeRegistration(t, getRouteRegistrationPath(route.ServiceName, route.Host, route.Path, paths.RoutesDirectoryPath), createRouteRegistrationText(route, manifestPath))
	initial, err := ReadManagedCaddyGlobalSettings(paths, ManagedCaddyConfigFallback{})
	if err != nil {
		t.Fatal(err)
	}
	if err := syncManagedCaddyGlobalState(paths.RoutesDirectoryPath, initial); err != nil {
		t.Fatal(err)
	}
	originalRun := routeMutationRunManagedCaddyCommand
	t.Cleanup(func() { routeMutationRunManagedCaddyCommand = originalRun })
	var reloadAddress string
	routeMutationRunManagedCaddyCommand = func(_ Paths, _ []string, options ManagedCaddyCommandOptions) CommandResult {
		reloadAddress = options.AdminAddress
		return CommandResult{Success: true}
	}
	if err := UnregisterRoute(route.ServiceName, route.Host, route.Path, manifestPath, paths.RegistrationsDirectoryPath, ManagedCaddyConfigFallback{AdminAddress: route.CaddyAdminAddress, BindHost: route.CaddyBindHost, HTTPEnabled: route.HTTPEnabled, HTTPPort: route.CaddyHTTPPort, HTTPSPort: route.CaddyHTTPSPort}, RouteCommandOutputWriters{}); err != nil {
		t.Fatal(err)
	}
	if reloadAddress != route.CaddyAdminAddress {
		t.Fatalf("reload targets %q, want isolated admin %q", reloadAddress, route.CaddyAdminAddress)
	}
	settings, err := ReadManagedCaddyGlobalSettings(paths, ManagedCaddyConfigFallback{AdminAddress: route.CaddyAdminAddress, BindHost: route.CaddyBindHost, HTTPEnabled: route.HTTPEnabled, HTTPPort: route.CaddyHTTPPort, HTTPSPort: route.CaddyHTTPSPort})
	if err != nil {
		t.Fatal(err)
	}
	rendered, err := renderManagedCaddyfile(renderManagedCaddyfileOptions{AdminAddress: settings.AdminAddress, BindHost: settings.BindHost, EnableHTTP: settings.HTTPEnabled, HTTPPort: settings.HTTPPort, HTTPSPort: settings.HTTPSPort, Paths: paths})
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
	if _, err := os.Stat(getHostRoutePath(route.Host, paths.RoutesDirectoryPath)); !os.IsNotExist(err) {
		t.Fatalf("removed host route still exists: %v", err)
	}
}
