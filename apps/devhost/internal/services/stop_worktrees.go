package services

import (
	"fmt"
	"path/filepath"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy"
)

// Root manifests determine repository membership, not included manifests or
// service cwd values: a shared dependency must not widen the stop scope.
func selectStacksToStop(manifestPath string, worktrees bool, owners []caddy.StackOwner) ([]caddy.StackOwner, int, error) {
	repository, err := discoverGitRepository(filepath.Dir(manifestPath))
	if worktrees {
		if err != nil {
			return nil, 0, fmt.Errorf("resolve Git repository for --worktrees: %w", err)
		}
		if repository.commonDir == "" {
			return nil, 0, fmt.Errorf("--worktrees requires the selected manifest to be inside a Git repository")
		}
	}
	var targets []caddy.StackOwner
	siblings := 0
	for _, owner := range owners {
		exact := resolveRecordedManifestPath(owner.ManifestPath) == manifestPath
		if exact {
			targets = append(targets, owner)
			continue
		}
		if repository.commonDir == "" {
			continue
		}
		other, err := discoverGitRepository(filepath.Dir(owner.ManifestPath))
		if err != nil {
			if worktrees {
				return nil, 0, fmt.Errorf("resolve repository of stack PID %d (%s): %w", owner.PID, owner.ManifestPath, err)
			}
			continue // An optional hint must not prevent ordinary manifest-scoped stops.
		}
		if other.commonDir != repository.commonDir {
			continue
		}
		siblings++
		if worktrees {
			targets = append(targets, owner)
		}
	}
	return targets, siblings, nil
}
