package services

import (
	"slices"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/manifest"
)

func stackManifestFiles(configuration *manifest.Manifest) []string {
	if configuration == nil {
		return nil
	}
	return append(slices.Clone(configuration.Inputs.Files), configuration.ManifestPath)
}

func (r *stackRuntime) registerManifestFiles(files []string) error {
	r.controlMu.RLock()
	port := 0
	if r.control != nil {
		port = r.control.Port()
	}
	r.controlMu.RUnlock()
	return caddy.RegisterStack(caddy.RegisterStackOptions{
		ControlPort:         port,
		ManifestPath:        r.manifest.ManifestPath,
		ManifestFiles:       files,
		StackName:           r.manifest.Name,
		StacksDirectoryPath: r.routes.paths.StacksDirectoryPath,
	})
}

func (r *stackRuntime) reserveManifestFiles(files []string) (func(bool) error, error) {
	previous := r.manifestFiles
	combined := append(slices.Clone(previous), files...)
	if err := r.registerManifestFiles(combined); err != nil {
		return nil, err
	}
	r.manifestFiles = combined
	return func(accepted bool) error {
		retained := previous
		if accepted {
			retained = files
		}
		if err := r.registerManifestFiles(retained); err != nil {
			// The union is still registered and tracked for the next operation.
			return err
		}
		r.manifestFiles = retained
		return nil
	}, nil
}
