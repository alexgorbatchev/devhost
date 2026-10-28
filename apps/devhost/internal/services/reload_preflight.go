package services

import (
	"fmt"
	"maps"
	"os"
	"slices"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/manifest"
)

type reloadPortResolver func(manifest.Manifest, ResolvedManifest, []string) (ResolvedManifest, error)

// resolveReloadCandidate orders the services of next and resolves its ports against the running configuration: the
// checks of a reload that change nothing. It returns the configuration the reload would run and its start order.
func resolveReloadCandidate(next manifest.Manifest, current ResolvedManifest, requested []string, resolvePorts reloadPortResolver) (ResolvedManifest, []string, error) {
	order, err := ResolveServiceOrder(next)
	if err != nil {
		return ResolvedManifest{}, nil, err
	}
	candidate, err := resolvePorts(next, current, requested)
	if err != nil {
		return ResolvedManifest{}, nil, err
	}
	// The stack is identified by the root manifest path, which a worktree switch
	// keeps; its name is a label that follows the configuration.
	candidate.ManifestPath = current.ManifestPath
	candidate.ServiceOrder = orderedServiceNames(next)
	return candidate, order, nil
}

// validateServiceWorkingDirectories rejects a configuration in which a managed service that is not stopped cannot
// start in its working directory.
func validateServiceWorkingDirectories(m ResolvedManifest, blocked map[string]string) error {
	for _, name := range slices.Sorted(maps.Keys(m.Services)) {
		if service := m.Services[name]; isManagedService(service) && blocked[name] == "" {
			if err := validateServiceWorkingDirectory(service); err != nil {
				return err
			}
		}
	}
	return nil
}

func validateServiceWorkingDirectory(service ResolvedService) error {
	if service.Serve != "" {
		info, err := os.Stat(service.Serve)
		if err != nil {
			return fmt.Errorf("start service %s: cannot access serve directory %q: %w", service.Name, service.Serve, err)
		}
		if !info.IsDir() {
			return fmt.Errorf("start service %s: serve path %q is not a directory", service.Name, service.Serve)
		}
		return nil
	}
	if service.Cwd == "" {
		return nil
	}
	info, err := os.Stat(service.Cwd)
	if err != nil {
		return fmt.Errorf("start service %s: cannot access working directory %q (services.%s.cwd); check the configured cwd path: %w", service.Name, service.Cwd, service.Name, err)
	}
	if !info.IsDir() {
		return fmt.Errorf("start service %s: working directory %q (services.%s.cwd) is not a directory; set cwd to a directory", service.Name, service.Cwd, service.Name)
	}
	return nil
}
