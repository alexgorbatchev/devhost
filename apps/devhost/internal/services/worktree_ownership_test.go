package services

import (
	"context"
	"errors"
	"path/filepath"
	"syscall"
	"testing"
	"time"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/nettest"
)

func TestWorktreeDiscoveryRejectsOccupiedCheckout(t *testing.T) {
	root, linked := createWorktreeRepository(t)
	state := t.TempDir()
	path := filepath.Join(linked, "devhost.toml")
	command := startStackOwner(t, state, stackOwnerOptions{
		ManifestPath: path, ManifestFiles: []string{path},
		Port: nettest.ReservePort(t), Behavior: stackOwnerStopsOnRequest,
	})
	w, err := newStackWorktrees(worktreeTestManifest(root), state)
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range w.snapshot()[0].Worktrees {
		if entry.Path == linked && entry.Available {
			t.Fatal("occupied checkout is offered as available")
		}
	}
	repo := w.snapshot()[0]
	if _, err := w.prepare(repo.ID, linked, worktreeTestManifest(root)); err == nil {
		t.Fatal("occupied checkout accepted a switch")
	}
	var ownerID string
	for _, entry := range repo.Worktrees {
		if entry.Path == linked && len(entry.Owners) == 1 {
			ownerID = entry.Owners[0].ID
			if entry.Owners[0].PID != command.Process.Pid {
				t.Fatal("wrong owner shown")
			}
		}
	}
	if ownerID == "" {
		t.Fatal("missing owner details")
	}
	for _, target := range []struct{ repo, path, owner string }{
		{"unknown", linked, ownerID}, {repo.ID, root, ownerID}, {repo.ID, linked, "stale"},
	} {
		if _, _, err := w.occupant(target.repo, target.path, target.owner); err == nil {
			t.Fatal("unrelated or stale owner accepted")
		}
	}
	owner, paths, err := w.occupant(repo.ID, linked, ownerID)
	if err != nil {
		t.Fatal(err)
	}
	if err := stopWorktreeOccupant(context.Background(), owner, paths, stopGracePeriod); err != nil {
		t.Fatal(err)
	}
	if err := command.Wait(); err != nil {
		t.Fatal(err)
	}
	if err := w.refresh(); err != nil {
		t.Fatal(err)
	}
	for _, entry := range w.snapshot()[0].Worktrees {
		if entry.Path == linked && (!entry.Available || len(entry.Owners) != 0) {
			t.Fatal("stopped stack still occupies checkout")
		}
	}
	if _, err := w.prepare(repo.ID, linked, worktreeTestManifest(root)); err != nil {
		t.Fatalf("switch after stopping owner: %v", err)
	}
}

func TestStopWorktreeOwnerHandlesCancellationAndForcedExit(t *testing.T) {
	for _, canceled := range []bool{true, false} {
		t.Run(map[bool]string{true: "canceled", false: "forced"}[canceled], func(t *testing.T) {
			state := t.TempDir()
			path := filepath.Join(t.TempDir(), "devhost.toml")
			command := startStackOwner(t, state, stackOwnerOptions{ManifestPath: path, ManifestFiles: []string{path}, Port: nettest.ReservePort(t), Behavior: stackOwnerIgnoresRequests})
			paths := caddy.CreateManagedCaddyPaths(state)
			owners, err := caddy.ReadStackOccupants(paths, []string{path})
			if err != nil || len(owners) != 1 {
				t.Fatalf("owners = %#v, %v", owners, err)
			}
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			if canceled {
				cancel()
			}
			err = stopWorktreeOccupant(ctx, owners[0], paths, time.Millisecond)
			if canceled {
				if !errors.Is(err, context.Canceled) || !owners[0].Alive() {
					t.Fatalf("canceled stop = %v, alive = %v", err, owners[0].Alive())
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if err := command.Wait(); !endedBySignal(err, syscall.SIGKILL) {
				t.Fatalf("forced stop = %v", err)
			}
		})
	}
}
