package services

import (
	"io"
	"path/filepath"
	"strings"
	"testing"
)

func TestStopWorktreesScopesToGitRepository(t *testing.T) {
	root, linked := createWorktreeRepository(t)
	otherRoot, _ := createWorktreeRepository(t)
	state := t.TempDir()
	environment := map[string]string{"DEVHOST_STATE_DIR": state}
	main := startStackOwner(t, state, stackOwnerOptions{ManifestPath: filepath.Join(root, "devhost.toml"), Port: 4101, Behavior: stackOwnerStopsOnRequest})
	sibling := startStackOwner(t, state, stackOwnerOptions{ManifestPath: filepath.Join(linked, "devhost.toml"), Port: 4102, Behavior: stackOwnerStopsOnRequest})
	other := startStackOwner(t, state, stackOwnerOptions{ManifestPath: filepath.Join(otherRoot, "devhost.toml"), Port: 4103, Behavior: stackOwnerStopsOnRequest})
	var output strings.Builder
	// Starting from a linked checkout must include the main checkout too.
	options := StopStackOptions{ManifestPath: filepath.Join(linked, "devhost.toml"), Worktrees: true}
	if err := StopStack(options, environment, &output, io.Discard); err != nil {
		t.Fatal(err)
	}
	if err := main.Wait(); err != nil {
		t.Fatal(err)
	}
	if err := sibling.Wait(); err != nil {
		t.Fatal(err)
	}
	if !processExists(other.Process.Pid) {
		t.Fatal("stopped an unrelated repository")
	}
	for _, path := range []string{root, linked} {
		if !strings.Contains(output.String(), path) {
			t.Fatalf("missing stopped manifest %s in %s", path, output.String())
		}
	}
}

func TestPlainStopSuggestsWorktreesWithoutStoppingThem(t *testing.T) {
	root, linked := createWorktreeRepository(t)
	state := t.TempDir()
	sibling := startStackOwner(t, state, stackOwnerOptions{ManifestPath: filepath.Join(linked, "devhost.toml"), Port: 4102, Behavior: stackOwnerStopsOnRequest})
	var output strings.Builder
	if err := StopStack(StopStackOptions{ManifestPath: filepath.Join(root, "devhost.toml")}, map[string]string{"DEVHOST_STATE_DIR": state}, &output, io.Discard); err != nil {
		t.Fatal(err)
	}
	if !processExists(sibling.Process.Pid) || !strings.Contains(output.String(), "devhost stop --worktrees --manifest") {
		t.Fatalf("unexpected stop/hint: %s", output.String())
	}
}

func TestStopWorktreesRequiresGit(t *testing.T) {
	err := StopStack(StopStackOptions{ManifestPath: filepath.Join(t.TempDir(), "devhost.toml"), Worktrees: true}, map[string]string{"DEVHOST_STATE_DIR": t.TempDir()}, io.Discard, io.Discard)
	if err == nil || !strings.Contains(err.Error(), "Git repository") {
		t.Fatalf("error = %v", err)
	}
}
