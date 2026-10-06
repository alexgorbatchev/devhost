package services

import (
	"context"
	"errors"
	"fmt"
	"slices"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/devtools"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/manifest"
)

func (r *stackRuntime) watchManifest() (*manifestWatcher, error) {
	// A save made during startup can be incomplete. Track the partial inputs
	// and let the initial reload report it while the accepted stack stays up.
	raw, _ := manifest.ReadManifest(r.manifest.ManifestPath)
	return newManifestWatcher(raw.Inputs)
}

func (r *stackRuntime) reloadFromDisk(ctx context.Context, w *manifestWatcher) error {
	raw, err := manifest.ReadManifest(r.manifest.ManifestPath)
	inputs := raw.Inputs
	if err != nil {
		w.inputsMu.RLock()
		inputs.Files = append(slices.Clone(w.inputs.Files), inputs.Files...)
		inputs.Patterns = append(slices.Clone(w.inputs.Patterns), inputs.Patterns...)
		w.inputsMu.RUnlock()
		return errors.Join(err, w.update(inputs))
	}
	if err := w.update(inputs); err != nil {
		return err
	}
	candidate, err := manifest.ValidateManifest(r.manifest.ManifestPath, raw)
	if err != nil {
		return err
	}
	return r.reloadConfiguration(ctx, candidate)
}

func (r *stackRuntime) toolContext(name string) (devtools.ToolContext, error) {
	r.manifestMu.RLock()
	m, worktrees := *r.manifest, r.worktrees
	isReloading := len(r.pendingReload) > 0
	blocked := r.blocked[name]
	r.manifestMu.RUnlock()
	if isReloading {
		return devtools.ToolContext{}, fmt.Errorf("configuration reload is in progress; retry when services are ready")
	}
	if blocked != "" {
		return devtools.ToolContext{}, fmt.Errorf("service %s is stopped: %s", name, blocked)
	}
	return worktrees.toolContext(m, name)
}
