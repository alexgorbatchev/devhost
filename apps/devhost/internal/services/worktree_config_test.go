package services

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestWorktreeSwitchLoadsTargetConfigurationAndWatchesIt(t *testing.T) {
	root, linked := createWorktreeRepository(t)
	old := strings.Replace(reloadServiceBody("web", "old", "old.localhost"), "command = ", fmt.Sprintf("cwd = %q\ncommand = ", filepath.Join(root, "web")), 1)
	f := startReloadStackConfiguration(t, old, true)
	config := filepath.Join(linked, "devhost.toml")
	body := strings.Replace(reloadServiceBody("poc", "new", "poc.localhost"), "command = ", "cwd = \"api\"\ncommand = ", 1)
	write := func(value string) {
		t.Helper()
		if err := os.WriteFile(config, []byte(strings.Replace(f.header, "name = \"reload\"", "name = \"poc\"", 1)+value), 0600); err != nil {
			t.Fatal(err)
		}
	}
	write(body)
	if err := os.RemoveAll(filepath.Join(linked, "web")); err != nil {
		t.Fatal(err)
	}
	if err := f.control.RefreshWorktrees(); err != nil {
		t.Fatal(err)
	}
	health, err := f.control.GetHealthResponse()
	if err != nil {
		t.Fatal(err)
	}
	id := health.Repositories[0].ID
	if err := f.control.SwitchWorktree(id, linked); err != nil {
		t.Fatal(err)
	}
	route := filepath.Join(f.paths.RegistrationsDirectoryPath, "poc.localhost_poc_2f.json")
	next := readRestartRoute(t, route)
	assertRestartResponse(t, serverURL(next.AppPort, "/"), "new")
	assertRestartResponse(t, serverURL(next.AppPort, "/cwd"), filepath.Join(linked, "api"))
	if _, err := os.Stat(filepath.Join(f.paths.RegistrationsDirectoryPath, "old.localhost_web_2f.json")); !os.IsNotExist(err) {
		t.Fatalf("retired route retained: %v", err)
	}
	write(strings.Replace(body, "\"new\"", "\"reloaded\"", 1))
	waitForCondition(t, 5*time.Second, func() bool { return f.logs.contains("configuration reloaded") })
	next = readRestartRoute(t, route)
	assertRestartResponse(t, serverURL(next.AppPort, "/"), "reloaded")
	write("\n[services.poc]\ncommand = [")
	if err := f.control.SwitchWorktree(id, linked); err == nil {
		t.Fatal("invalid target configuration accepted")
	}
	assertRestartResponse(t, serverURL(next.AppPort, "/"), "reloaded")
}

func TestWorktreeSelectionRestoresTargetServiceMembership(t *testing.T) {
	root, linked := createWorktreeRepository(t)
	m := worktreeTestManifest(root)
	if err := os.WriteFile(filepath.Join(linked, "devhost.toml"), []byte("name = \"poc\"\n[services.poc]\ncwd = \"api\"\ncommand = [\"service\"]\n[services.poc.health]\nprocess = true\n"), 0600); err != nil {
		t.Fatal(err)
	}
	state := t.TempDir()
	w, err := newStackWorktrees(m, state)
	if err != nil {
		t.Fatal(err)
	}
	id := w.snapshot()[0].ID
	if _, err := w.prepare(id, linked, m); err != nil {
		t.Fatal(err)
	}
	restored, err := newStackWorktrees(m, state)
	if err != nil {
		t.Fatal(err)
	}
	next, blocked := restored.restore(m)
	if len(blocked) != 0 || len(next.Services) != 1 || next.Services["poc"].Cwd != filepath.Join(linked, "api") {
		t.Fatalf("saved target service membership not restored: %#v, %#v", next.Services, blocked)
	}
	live, err := buildStackWorktrees(next, state, restored)
	if err != nil {
		t.Fatal(err)
	}
	repo := live.snapshot()[0]
	if len(repo.ServiceNames) != 1 || repo.ServiceNames[0] != "poc" || repo.SelectedPath != linked {
		t.Fatalf("restored repository metadata describes the previous stack: %#v", repo)
	}
	if next.ManifestPath != m.ManifestPath || next.configuration.ManifestPath != filepath.Join(linked, "devhost.toml") {
		t.Fatalf("owner and configuration paths were conflated: %#v", next)
	}
}
