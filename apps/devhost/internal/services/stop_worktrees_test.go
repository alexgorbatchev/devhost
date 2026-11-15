package services

import (
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/nettest"
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

// A manifest linked from another repository keeps the stop scope in the
// repository its path is in, which is how every running stack's repository is
// found too.
func TestStopWorktreesScopesALinkedManifestToItsOwnRepository(t *testing.T) {
	root, linked := createWorktreeRepository(t)
	otherRoot, otherLinked := createWorktreeRepository(t)
	manifest := filepath.Join(root, "devhost.toml")
	if err := os.Remove(manifest); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(otherRoot, "devhost.toml"), manifest); err != nil {
		t.Fatal(err)
	}
	state := t.TempDir()
	ports := nettest.ReservePorts(t, 3)
	own := startStackOwner(t, state, stackOwnerOptions{ManifestPath: manifest, Port: ports[0], Behavior: stackOwnerStopsOnRequest})
	sibling := startStackOwner(t, state, stackOwnerOptions{ManifestPath: filepath.Join(linked, "devhost.toml"), Port: ports[1], Behavior: stackOwnerStopsOnRequest})
	other := startStackOwner(t, state, stackOwnerOptions{ManifestPath: filepath.Join(otherLinked, "devhost.toml"), Port: ports[2], Behavior: stackOwnerStopsOnRequest})
	var output strings.Builder
	if err := StopStack(StopStackOptions{ManifestPath: manifest, Worktrees: true}, map[string]string{"DEVHOST_STATE_DIR": state}, &output, io.Discard); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(output.String(), linked) || strings.Contains(output.String(), otherLinked) {
		t.Fatalf("stopped the stacks of another repository's worktrees: %s", output.String())
	}
	for _, stack := range []*exec.Cmd{own, sibling} {
		if err := stack.Wait(); err != nil {
			t.Fatal(err)
		}
	}
	if !processExists(other.Process.Pid) {
		t.Fatal("stopped a stack of the repository the manifest links to")
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
	// A temporary directory can sit inside this checkout, and runGit drops GIT_CEILING_DIRECTORIES,
	// so the filesystem root is the one place outside every repository.
	manifestPath := filepath.Join(string(filepath.Separator), "devhost.toml")
	err := StopStack(StopStackOptions{ManifestPath: manifestPath, Worktrees: true}, map[string]string{"DEVHOST_STATE_DIR": t.TempDir()}, io.Discard, io.Discard)
	if err == nil || !strings.Contains(err.Error(), "--worktrees requires") {
		t.Fatalf("error = %v", err)
	}
}
