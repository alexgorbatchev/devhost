package services

import (
	"context"
	"fmt"
	"syscall"
	"time"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy"
)

func (g *worktreeGroup) occupants(path string) ([]caddy.StackOccupant, error) {
	configuration, err := g.configuration(path)
	if err != nil {
		return nil, err
	}
	return caddy.ReadStackOccupants(g.paths, stackManifestFiles(&configuration))
}

func (w *stackWorktrees) occupant(id, path, ownerID string) (caddy.StackOccupant, caddy.Paths, error) {
	if w == nil {
		return caddy.StackOccupant{}, caddy.Paths{}, fmt.Errorf("worktrees are not enabled")
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	g := w.group(id)
	if g == nil {
		return caddy.StackOccupant{}, caddy.Paths{}, fmt.Errorf("unknown repository: %s", id)
	}
	if err := g.refresh(); err != nil {
		return caddy.StackOccupant{}, g.paths, err
	}
	for _, entry := range g.view.Worktrees {
		if entry.Path != path {
			continue
		}
		owners, err := g.occupants(path)
		if err != nil {
			return caddy.StackOccupant{}, g.paths, err
		}
		for _, owner := range owners {
			if owner.ID == ownerID {
				return owner, g.paths, nil
			}
		}
	}
	return caddy.StackOccupant{}, g.paths, fmt.Errorf("stack ownership changed; refresh worktrees before stopping a stack")
}

func (r *stackRuntime) stopWorktreeOwner(ctx context.Context, id, path, ownerID string) error {
	r.operationMu.Lock()
	defer r.operationMu.Unlock()
	if err := r.checkReady(); err != nil {
		return err
	}
	owner, paths, err := r.worktrees.occupant(id, path, ownerID)
	if err != nil {
		return err
	}
	if err := stopWorktreeOccupant(ctx, owner, paths, stopGracePeriod); err != nil {
		return err
	}
	if err := r.worktrees.refresh(); err != nil {
		return err
	}
	r.publish()
	return nil
}

func stopWorktreeOccupant(ctx context.Context, owner caddy.StackOccupant, paths caddy.Paths, gracePeriod time.Duration) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := owner.Signal(paths, syscall.SIGTERM); err != nil {
		return err
	}
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()
	deadline := time.NewTimer(gracePeriod)
	defer deadline.Stop()
	forced := false
	for processExists(owner.PID) && owner.Alive() {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-deadline.C:
			if forced {
				return fmt.Errorf("stack did not exit after being force-stopped")
			}
			// Preserve ownership checks even for escalation. A replacement stack
			// must never receive the old page's stop request.
			if err := owner.Signal(paths, syscall.SIGKILL); err != nil {
				return err
			}
			forced = true
			deadline.Reset(time.Second)
		case <-ticker.C:
		}
	}
	return nil
}
