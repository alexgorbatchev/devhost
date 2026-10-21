package services

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/manifest"
)

func (g *worktreeGroup) configuration(root string) (manifest.Manifest, error) {
	path := filepath.Join(root, g.manifestOffset)
	if _, err := os.Stat(path); errors.Is(err, os.ErrNotExist) {
		if owningPath, known := g.configurationPaths[root]; known {
			path = owningPath
		}
	}
	raw, err := manifest.ReadManifest(path)
	if err != nil {
		return manifest.Manifest{}, fmt.Errorf("load checkout configuration %s: %w", path, err)
	}
	next, err := manifest.ValidateManifest(path, raw)
	if err != nil {
		return next, err
	}
	for name, service := range next.Services {
		if err := validateServiceWorkingDirectory(ResolvedService{Name: name, Cwd: service.Cwd}); err != nil {
			return next, err
		}
		if _, inside := pathWithin(root, service.Cwd); inside {
			resolved, err := filepath.EvalSymlinks(service.Cwd)
			if err != nil {
				return next, err
			}
			if _, inside := pathWithin(root, resolved); !inside {
				return next, fmt.Errorf("service %s directory escapes checkout: %s", name, service.Cwd)
			}
		}
	}
	return next, nil
}
