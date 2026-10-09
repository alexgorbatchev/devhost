package services

import (
	"fmt"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy"
)

// ListRunningStacks returns the process and manifest of every stack running on
// this machine, in manifest path and then PID order. A stack is found through
// the records it keeps while it runs, so the paths are the ones StopStack
// matches.
func ListRunningStacks(environment map[string]string) ([]caddy.StackOwner, error) {
	paths, err := caddy.CreateManagedCaddyPathsFromEnvironment(environment)
	if err != nil {
		return nil, fmt.Errorf("resolve caddy paths from environment: %w", err)
	}

	owners, err := caddy.ReadLiveStackOwners(paths)
	if err != nil {
		return nil, fmt.Errorf("scan record directories for running stacks: %w", err)
	}

	return owners, nil
}
