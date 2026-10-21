package services

import (
	"fmt"
	"path/filepath"
	"strings"
	"testing"
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
	f.path = filepath.Join(linked, "devhost.toml")
	write := func(body string) { f.write(t, strings.ReplaceAll(body, root, linked)) }
	write(service("api", "api", "api") + service("web", "original", "web"))
	if err := f.control.SwitchWorktree(id, linked); err != nil {
		t.Fatal(err)
	}
	original := readRestartRoute(t, filepath.Join(f.paths.RegistrationsDirectoryPath, "web.reload.localhost_web_2f.json"))
	assertRestartResponse(t, serverURL(original.AppPort, "/cwd"), filepath.Join(linked, "web"))
	write(service("web", "replacement", "web") + service("worker", "worker", "api"))
	waitForCondition(t, stackChangeTimeout, func() bool { return f.logs.contains("configuration reloaded") })
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

func TestManifestReloadTurnsWorktreesOnWithoutAnEarlierSelection(t *testing.T) {
	root, linked := createWorktreeRepository(t)
	body := strings.Replace(reloadServiceBody("web", "original", "reload.localhost"), "command = ", fmt.Sprintf("cwd = %q\ncommand = ", filepath.Join(root, "web")), 1)
	f := startReloadStackConfiguration(t, body, false)
	// An earlier run, with worktrees on, left the linked checkout selected.
	repo, err := discoverGitRepository(root)
	if err != nil {
		t.Fatal(err)
	}
	stateDir, err := worktreeStateDirectory(f.path, f.paths.StateDirectoryPath)
	if err != nil {
		t.Fatal(err)
	}
	earlier := &stackWorktrees{stateDir: stateDir}
	if err := earlier.save(worktreeKey(repo.commonDir), linked); err != nil {
		t.Fatal(err)
	}

	f.header = strings.Replace(f.header, "enabled = false", "enabled = true", 1)
	f.write(t, body)
	waitForCondition(t, stackChangeTimeout, func() bool { return f.logs.contains("configuration reloaded") })
	health, err := f.control.GetHealthResponse()
	if err != nil || len(health.Repositories) != 1 || health.Repositories[0].SelectedPath != root || health.Repositories[0].RunningPath != root {
		t.Fatalf("turning worktrees on moved the stack off its checkout: %#v, %v", health.Repositories, err)
	}
	route := readRestartRoute(t, filepath.Join(f.paths.RegistrationsDirectoryPath, "reload.localhost_web_2f.json"))
	assertRestartResponse(t, serverURL(route.AppPort, "/cwd"), filepath.Join(root, "web"))
	if saved, err := earlier.readSelection(); err != nil || saved != nil {
		t.Fatalf("the earlier selection is still saved for the next start: %#v, %v", saved, err)
	}
}

func TestManifestReloadTurnsWorktreesOffOnAnotherCheckout(t *testing.T) {
	root, linked := createWorktreeRepository(t)
	service := func(checkout string) string {
		return strings.Replace(reloadServiceBody("web", "original", "reload.localhost"), "command = ", fmt.Sprintf("cwd = %q\ncommand = ", filepath.Join(checkout, "web")), 1)
	}
	f := startReloadStackConfiguration(t, service(root), true)
	health, err := f.control.GetHealthResponse()
	if err != nil || len(health.Repositories) != 1 {
		t.Fatalf("repository discovery: %#v, %v", health, err)
	}
	id := health.Repositories[0].ID
	// Each checkout holds a manifest of its own; the root one keeps worktrees on.
	rootManifest := *f
	rootManifest.path = filepath.Join(root, "devhost.toml")
	rootManifest.write(t, service(root))
	f.path = filepath.Join(linked, "devhost.toml")
	f.write(t, service(linked))
	if err := f.control.SwitchWorktree(id, linked); err != nil {
		t.Fatal(err)
	}

	f.header = strings.Replace(f.header, "enabled = true", "enabled = false", 1)
	f.write(t, service(linked))
	waitForCondition(t, stackChangeTimeout, func() bool { return f.logs.count("worktree switched") == 2 })
	route := readRestartRoute(t, filepath.Join(f.paths.RegistrationsDirectoryPath, "reload.localhost_web_2f.json"))
	assertRestartResponse(t, serverURL(route.AppPort, "/cwd"), filepath.Join(root, "web"))
	health, err = f.control.GetHealthResponse()
	if err != nil || len(health.Repositories) != 1 || health.Repositories[0].RunningPath != root {
		t.Fatalf("turning worktrees off on another checkout did not return to the root: %#v, %v", health.Repositories, err)
	}
}

func TestManifestReloadAppliesKillZombies(t *testing.T) {
	body := reloadServiceBody("web", "original", "reload.localhost")
	f := startReloadStack(t, body)
	route := readRestartRoute(t, filepath.Join(f.paths.RegistrationsDirectoryPath, "reload.localhost_web_2f.json"))
	pid := reloadPID(t, route.AppPort)
	f.header = "killZombies = false\n" + f.header
	f.write(t, body)
	waitForCondition(t, stackChangeTimeout, func() bool { return f.logs.contains("configuration reloaded") })
	if reloadPID(t, route.AppPort) != pid {
		t.Fatal("changing killZombies restarted the service")
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
	f.path = filepath.Join(root, "devhost.toml")
	write := func(body string) { f.write(t, strings.ReplaceAll(body, linked, root)) }
	write(service("web", "original", "web"))
	if err := f.control.SwitchWorktree(id, root); err != nil {
		t.Fatal(err)
	}
	runWorktreeGit(t, root, "worktree", "remove", linked)
	if err := f.control.RefreshWorktrees(); err != nil {
		t.Fatal(err)
	}
	write(service("web", "replacement", "web") + service("worker", "worker", "api"))
	waitForCondition(t, stackChangeTimeout, func() bool {
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
