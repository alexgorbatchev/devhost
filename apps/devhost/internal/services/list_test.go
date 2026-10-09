package services

import (
	"path/filepath"
	"slices"
	"testing"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy"
)

func TestListRunningStacks(t *testing.T) {
	stateDirectoryPath := t.TempDir()
	environment := map[string]string{"DEVHOST_STATE_DIR": stateDirectoryPath}

	projectsPath := t.TempDir()
	unroutedManifestPath := filepath.Join(projectsPath, "a-unrouted", "devhost.toml")
	routedManifestPath := filepath.Join(projectsPath, "b-routed", "devhost.toml")
	crashedManifestPath := filepath.Join(projectsPath, "c-crashed", "devhost.toml")

	// Started out of path order, so the order of the listing is not the order the
	// records were written in.
	routed := startStackOwner(t, stateDirectoryPath, stackOwnerOptions{ManifestPath: routedManifestPath, Port: 4000, Host: "routed.localhost", Behavior: stackOwnerStopsOnRequest})
	unrouted := startStackOwner(t, stateDirectoryPath, stackOwnerOptions{ManifestPath: unroutedManifestPath, Port: 5432, Behavior: stackOwnerStopsOnRequest})
	startStackOwner(t, stateDirectoryPath, stackOwnerOptions{ManifestPath: crashedManifestPath, Port: 6000, Host: "crashed.localhost", Behavior: stackOwnerCrashes})

	got, err := ListRunningStacks(environment)
	if err != nil {
		t.Fatalf("ListRunningStacks() unexpected error = %v", err)
	}

	// The routed stack keeps two records and is listed once; the crashed stack
	// left its records behind and is not listed.
	want := []caddy.StackOwner{
		{ManifestPath: unroutedManifestPath, PID: unrouted.Process.Pid},
		{ManifestPath: routedManifestPath, PID: routed.Process.Pid},
	}
	if !slices.Equal(got, want) {
		t.Fatalf("ListRunningStacks() = %#v, want %#v", got, want)
	}
}

func TestListRunningStacksWithoutAStateDirectory(t *testing.T) {
	environment := map[string]string{"DEVHOST_STATE_DIR": filepath.Join(t.TempDir(), "never-created")}

	got, err := ListRunningStacks(environment)
	if err != nil {
		t.Fatalf("ListRunningStacks() unexpected error = %v", err)
	}

	if len(got) != 0 {
		t.Fatalf("ListRunningStacks() = %#v, want no stacks", got)
	}
}
