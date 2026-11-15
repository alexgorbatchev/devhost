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

// FindRunningStacks returns the running stacks that match query, in the order
// of ListRunningStacks. A relative manifest path in query names a file in
// directory.
func FindRunningStacks(query, directory string, environment map[string]string) ([]caddy.StackOwner, error) {
	paths, err := caddy.CreateManagedCaddyPathsFromEnvironment(environment)
	if err != nil {
		return nil, fmt.Errorf("resolve caddy paths from environment: %w", err)
	}
	return caddy.FindLiveStackOwners(paths, query, directory)
}
