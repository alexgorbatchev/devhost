package services

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/devtools"
)

// readWorktreeList reads the worktree list the way the picker and recovery pages do: a GET of the worktree route,
// which refreshes the list first.
func readWorktreeList(t *testing.T, f *reloadStackFixture) devtools.HealthResponse {
	t.Helper()
	response, err := http.Get(serverURL(f.controlPort, "/__devhost__/worktrees"))
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("worktree list answered %d", response.StatusCode)
	}
	var health devtools.HealthResponse
	if err := json.NewDecoder(response.Body).Decode(&health); err != nil {
		t.Fatal(err)
	}
	return health
}

func findWorktree(t *testing.T, repository devtools.WorktreeRepository, path string) devtools.Worktree {
	t.Helper()
	for _, entry := range repository.Worktrees {
		if entry.Path == path {
			return entry
		}
	}
	t.Fatalf("worktree list lacks %s: %#v", path, repository.Worktrees)
	return devtools.Worktree{}
}

func TestWorktreeListLeavesARejectedRunningManifestToHotReload(t *testing.T) {
	root, linked := createWorktreeRepository(t)
	services := func(checkout string) string {
		var body strings.Builder
		for _, name := range []string{"api", "web"} {
			service := reloadServiceBody(name, name, name+".refresh.localhost")
			body.WriteString(strings.Replace(service, "command = ", fmt.Sprintf("cwd = %q\ncommand = ", filepath.Join(checkout, name)), 1))
		}
		return body.String()
	}
	f := startReloadStackConfiguration(t, services(root), true)
	health, err := f.control.GetHealthResponse()
	if err != nil || len(health.Repositories) != 1 {
		t.Fatalf("repository discovery: %#v, %v", health, err)
	}
	// Run the linked checkout from its own manifest, which hot reload then watches.
	f.path = filepath.Join(linked, "devhost.toml")
	accepted := services(linked)
	f.write(t, accepted)
	if err := f.control.SwitchWorktree(health.Repositories[0].ID, linked); err != nil {
		t.Fatal(err)
	}
	pids := map[string]int{}
	for _, name := range []string{"api", "web"} {
		route := readRestartRoute(t, filepath.Join(f.paths.RegistrationsDirectoryPath, name+".refresh.localhost_"+name+"_2f.json"))
		pids[name] = reloadPID(t, route.AppPort)
	}
	// The configured checkout is not running, so its own invalid manifest still makes it unavailable.
	if err := os.WriteFile(filepath.Join(root, "devhost.toml"), []byte("[services.api]\ncommand = ["), 0o600); err != nil {
		t.Fatal(err)
	}

	f.write(t, strings.Replace(accepted, "[services.web]\n", "[services.web]\ndependOn = [\"api\"]\n", 1))
	waitForCondition(t, stackChangeTimeout, func() bool { return f.logs.contains("configuration reload rejected") })
	list := readWorktreeList(t, f)
	if err := f.control.RefreshWorktrees(); err != nil {
		t.Fatal(err)
	}

	if len(list.Repositories) != 1 {
		t.Fatalf("worktree list = %#v", list.Repositories)
	}
	repository := list.Repositories[0]
	if repository.Error != "" || repository.SelectedPath != linked || repository.RunningPath != linked {
		t.Fatalf("reading the worktree list stopped the running checkout: %#v", repository)
	}
	if running := findWorktree(t, repository, linked); !running.Available || running.Reason != "" {
		t.Fatalf("the running checkout is offered as unavailable: %#v", running)
	}
	if configured := findWorktree(t, repository, root); configured.Available || configured.Reason == "" {
		t.Fatalf("an inactive checkout with an invalid manifest is offered: %#v", configured)
	}
	if f.logs.contains("is unavailable; choose a checkout") {
		t.Fatal("reading the worktree list reported the running checkout as unavailable")
	}
	health, err = f.control.GetHealthResponse()
	if err != nil {
		t.Fatal(err)
	}
	for _, service := range health.Services {
		if !service.Status || service.Restarting {
			t.Fatalf("reading the worktree list stopped or blocked %s: %#v", service.Name, health.Services)
		}
	}
	for _, name := range []string{"api", "web"} {
		route := readRestartRoute(t, filepath.Join(f.paths.RegistrationsDirectoryPath, name+".refresh.localhost_"+name+"_2f.json"))
		if pid := reloadPID(t, route.AppPort); pid != pids[name] {
			t.Fatalf("reading the worktree list restarted %s: PID %d -> %d", name, pids[name], pid)
		}
		assertRestartResponse(t, serverURL(route.AppPort, "/cwd"), filepath.Join(linked, name))
	}
	if _, err := f.control.GetToolContext("web"); err != nil {
		t.Fatalf("reading the worktree list blocked tool launches: %v", err)
	}
	// Hot reload keeps reporting the edit as rejected.
	if status := readConfigurationStatus(t, f, devtools.ConfigurationSourceManifest); !strings.Contains(status.Error, "dependOn") {
		t.Fatalf("the rejected edit is no longer reported: %#v", status)
	}
}
