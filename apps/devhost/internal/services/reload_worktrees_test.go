package services

import (
	"fmt"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestManifestReloadPreservesSelectedCheckoutAndReconcilesMembership(t *testing.T) {
	root, linked := createWorktreeRepository(t)
	service := func(name, value, directory string) string {
		body := reloadServiceBody(name, value, name+".reload.localhost")
		return strings.Replace(body, "command = ", fmt.Sprintf("cwd = %q\ncommand = ", filepath.Join(root, directory)), 1)
	}
	f := startReloadStackConfiguration(t, service("api", "api", "api")+service("web", "original", "web"), true)
	health, err := f.control.GetHealthResponse()
	if err != nil || len(health.Repositories) != 1 {
		t.Fatalf("repository discovery: %#v, %v", health, err)
	}
	id := health.Repositories[0].ID
	if err := f.control.SwitchWorktree(id, linked); err != nil {
		t.Fatal(err)
	}
	original := readRestartRoute(t, filepath.Join(f.paths.RegistrationsDirectoryPath, "web.reload.localhost_web_2f.json"))
	assertRestartResponse(t, serverURL(original.AppPort, "/cwd"), filepath.Join(linked, "web"))
	f.write(t, service("web", "replacement", "web")+service("worker", "worker", "api"))
	waitForCondition(t, 5*time.Second, func() bool { return f.logs.contains("configuration reloaded") })
	health, err = f.control.GetHealthResponse()
	if err != nil || health.Repositories[0].ID != id || health.Repositories[0].SelectedPath != linked || health.Repositories[0].RunningPath != linked || len(health.Repositories[0].ServiceNames) != 2 {
		t.Fatalf("reload lost selection or membership: %#v, %v", health, err)
	}
	if health.Services[0].Name != "web" || health.Services[1].Name != "worker" {
		t.Fatalf("retired service remains: %#v", health.Services)
	}
	assertRestartResponse(t, serverURL(original.AppPort, "/"), "replacement")
	assertRestartResponse(t, serverURL(original.AppPort, "/cwd"), filepath.Join(linked, "web"))
	worker := readRestartRoute(t, filepath.Join(f.paths.RegistrationsDirectoryPath, "worker.reload.localhost_worker_2f.json"))
	assertRestartResponse(t, serverURL(worker.AppPort, "/cwd"), filepath.Join(linked, "api"))
	context, err := f.control.GetToolContext("worker")
	if err != nil || context.ProjectRootPath != linked {
		t.Fatalf("new service uses stale tool context: %#v, %v", context, err)
	}
	if err := f.control.RestartStack(); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"web", "worker"} {
		route := readRestartRoute(t, filepath.Join(f.paths.RegistrationsDirectoryPath, name+".reload.localhost_"+name+"_2f.json"))
		directory := "web"
		if name == "worker" {
			directory = "api"
		}
		assertRestartResponse(t, serverURL(route.AppPort, "/cwd"), filepath.Join(linked, directory))
	}
}

func TestManifestReloadSurvivesDeletedConfiguredCheckout(t *testing.T) {
	root, linked := createWorktreeRepository(t)
	service := func(name, value, directory string) string {
		return strings.Replace(reloadServiceBody(name, value, name+".reload.localhost"), "command = ", fmt.Sprintf("cwd = %q\ncommand = ", filepath.Join(linked, directory)), 1)
	}
	f := startReloadStackConfiguration(t, service("web", "original", "web"), true)
	health, err := f.control.GetHealthResponse()
	if err != nil || len(health.Repositories) != 1 {
		t.Fatalf("repository discovery: %#v, %v", health, err)
	}
	id := health.Repositories[0].ID
	if err := f.control.SwitchWorktree(id, root); err != nil {
		t.Fatal(err)
	}
	runWorktreeGit(t, root, "worktree", "remove", linked)
	if err := f.control.RefreshWorktrees(); err != nil {
		t.Fatal(err)
	}
	f.write(t, service("web", "replacement", "web")+service("worker", "worker", "api"))
	waitForCondition(t, 5*time.Second, func() bool {
		return f.logs.contains("configuration reloaded") || f.logs.contains("configuration reload rejected")
	})
	if !f.logs.contains("configuration reloaded") {
		t.Fatal("inactive configured checkout deletion rejected a service reload")
	}
	health, err = f.control.GetHealthResponse()
	if err != nil || health.Repositories[0].ID != id || health.Repositories[0].RunningPath != root || len(health.Repositories[0].ServiceNames) != 2 {
		t.Fatalf("reload lost repository identity or selection: %#v, %v", health, err)
	}
	for _, name := range []string{"web", "worker"} {
		route := readRestartRoute(t, filepath.Join(f.paths.RegistrationsDirectoryPath, name+".reload.localhost_"+name+"_2f.json"))
		directory := "web"
		if name == "worker" {
			directory = "api"
		}
		assertRestartResponse(t, serverURL(route.AppPort, "/cwd"), filepath.Join(root, directory))
	}
}
