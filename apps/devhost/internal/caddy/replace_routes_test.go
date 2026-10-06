package caddy

import (
	"os"
	"strings"
	"testing"
	"time"
)

func TestReplaceRoutesRemovesFinalHostAndRetainsCustomCaddyAddress(t *testing.T) {
	withRouteMutationTestHooks(t, routeMutationTestHooks{now: time.Now(), processID: 4321})
	paths := newManagedCaddyPaths(t)
	original := routeMutationRunManagedCaddyCommand
	t.Cleanup(func() { routeMutationRunManagedCaddyCommand = original })
	var addresses []string
	routeMutationRunManagedCaddyCommand = func(_ Paths, _ []string, options ManagedCaddyCommandOptions) CommandResult {
		addresses = append(addresses, options.AdminAddress)
		return CommandResult{Success: true}
	}
	routes := []ActivateRouteOptions{{AppBindHost: "127.0.0.1", AppPort: 3000, Host: "last.localhost", Path: "/", ServiceName: "web", CaddyAdminAddress: "127.0.0.1:22019", CaddyHTTPPort: 28080, CaddyHTTPSPort: 28443, HTTPEnabled: true}}
	if err := ActivateRoutes(routes, "/project/devhost.toml", paths.RoutesDirectoryPath); err != nil {
		t.Fatal(err)
	}
	if err := ReplaceRoutes(routes, nil, "/project/devhost.toml", paths.RoutesDirectoryPath); err != nil {
		t.Fatal(err)
	}
	if len(addresses) != 2 || addresses[1] != routes[0].CaddyAdminAddress {
		t.Fatalf("removal changed the Caddy listener: %#v", addresses)
	}
	if _, err := os.Stat(getHostRoutePath("last.localhost", paths.RoutesDirectoryPath)); !os.IsNotExist(err) {
		t.Fatalf("obsolete host snippet remains: %v", err)
	}
}

func TestReplaceRoutesRollbackRetainsAnotherStacksConcurrentUpdate(t *testing.T) {
	withRouteMutationTestHooks(t, routeMutationTestHooks{now: time.Now(), processID: 4321})
	paths := newManagedCaddyPaths(t)
	original := routeMutationRunManagedCaddyCommand
	t.Cleanup(func() { routeMutationRunManagedCaddyCommand = original })
	routeMutationRunManagedCaddyCommand = func(Paths, []string, ManagedCaddyCommandOptions) CommandResult { return CommandResult{Success: true} }
	old := []ActivateRouteOptions{{AppBindHost: "127.0.0.1", AppPort: 3000, Host: "app.localhost", Path: "/", ServiceName: "web"}}
	other := ActivateRouteOptions{AppBindHost: "127.0.0.1", AppPort: 5000, Host: "other.localhost", Path: "/", ServiceName: "worker"}
	if err := ActivateRoutes(old, "/project/devhost.toml", paths.RoutesDirectoryPath); err != nil {
		t.Fatal(err)
	}
	if err := ActivateRoute(other, "/other/devhost.toml", paths.RoutesDirectoryPath); err != nil {
		t.Fatal(err)
	}
	otherPath := getRouteRegistrationPath(other.ServiceName, other.Host, other.Path, paths.RoutesDirectoryPath)
	other.AppPort = 6000
	updated := createRouteRegistrationText(other, "/other/devhost.toml")
	reloads := 0
	routeMutationRunManagedCaddyCommand = func(Paths, []string, ManagedCaddyCommandOptions) CommandResult {
		reloads++
		if reloads == 1 {
			if err := os.WriteFile(otherPath, []byte(updated), 0644); err != nil {
				t.Fatal(err)
			}
			return CommandResult{Success: false}
		}
		return CommandResult{Success: true}
	}
	next := append([]ActivateRouteOptions{}, old...)
	next[0].Host = "new.localhost"
	if err := ReplaceRoutes(old, next, "/project/devhost.toml", paths.RoutesDirectoryPath); err == nil {
		t.Fatal("failed publication reported success")
	}
	contents, err := os.ReadFile(otherPath)
	if err != nil || string(contents) != updated {
		t.Fatalf("rollback overwrote another stack: %v", err)
	}
	snippet, err := os.ReadFile(getHostRoutePath(other.Host, paths.RoutesDirectoryPath))
	if err != nil || !strings.Contains(string(snippet), "127.0.0.1:6000") {
		t.Fatalf("rollback used stale foreign routes: %s, %v", snippet, err)
	}
}

func TestReplaceRoutesRemovesObsoleteAliasesAndRestoresOnFailure(t *testing.T) {
	for _, fail := range []bool{false, true} {
		t.Run(map[bool]string{false: "success", true: "rollback"}[fail], func(t *testing.T) {
			withRouteMutationTestHooks(t, routeMutationTestHooks{now: time.Now(), processID: 4321})
			paths := newManagedCaddyPaths(t)
			original := routeMutationRunManagedCaddyCommand
			t.Cleanup(func() { routeMutationRunManagedCaddyCommand = original })
			reloads := 0
			routeMutationRunManagedCaddyCommand = func(Paths, []string, ManagedCaddyCommandOptions) CommandResult {
				reloads++
				return CommandResult{Success: !fail || reloads != 2}
			}
			old := []ActivateRouteOptions{{AppBindHost: "127.0.0.1", AppPort: 3000, Host: "old.localhost", Path: "/", ServiceName: "web"}}
			next := []ActivateRouteOptions{{AppBindHost: "127.0.0.1", AppPort: 4000, Host: "new.localhost", Path: "/app/*", ServiceName: "web"}}
			if err := ActivateRoutes(old, "/project/devhost.toml", paths.RoutesDirectoryPath); err != nil {
				t.Fatal(err)
			}
			oldPath := getRouteRegistrationPath("web", "old.localhost", "/", paths.RoutesDirectoryPath)
			newPath := getRouteRegistrationPath("web", "new.localhost", "/app/*", paths.RoutesDirectoryPath)
			previous, err := os.ReadFile(oldPath)
			if err != nil {
				t.Fatal(err)
			}
			err = ReplaceRoutes(old, next, "/project/devhost.toml", paths.RoutesDirectoryPath)
			if fail {
				if err == nil {
					t.Fatal("rejected reload reported success")
				}
				restored, err := os.ReadFile(oldPath)
				if err != nil || string(restored) != string(previous) {
					t.Fatalf("previous route not restored: %v", err)
				}
				if _, err := os.Stat(newPath); !os.IsNotExist(err) {
					t.Fatalf("new alias remained after failure: %v", err)
				}
				if reloads != 3 {
					t.Fatalf("rollback reloads = %d", reloads)
				}
			} else {
				if err != nil {
					t.Fatal(err)
				}
				if _, err := os.Stat(oldPath); !os.IsNotExist(err) {
					t.Fatalf("obsolete alias survived: %v", err)
				}
				if _, err := os.Stat(newPath); err != nil {
					t.Fatal(err)
				}
				if reloads != 2 {
					t.Fatalf("replacement reloads = %d", reloads)
				}
			}
		})
	}
}
