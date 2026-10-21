package services

import (
	"fmt"
	"path/filepath"
	"slices"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/config"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/devtools"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/manifest"
)

// configFiles lists the files the config editor may change: the manifest the stack runs, the files it includes, and
// the devhost config file. After a worktree switch, the manifest is the one in the selected checkout.
func (r *stackRuntime) configFiles() ([]devtools.ConfigFileRef, error) {
	r.operationMu.Lock()
	defer r.operationMu.Unlock()
	if err := r.checkReady(); err != nil {
		return nil, err
	}
	files := []devtools.ConfigFileRef{}
	if r.configured != nil && r.manifestWatch != nil {
		rootPath, err := filepath.Abs(r.configured.ManifestPath)
		if err != nil {
			return nil, fmt.Errorf("resolve manifest path: %w", err)
		}
		files = append(files, devtools.ConfigFileRef{Path: rootPath, Kind: devtools.ConfigFileKindManifest})
		// The watcher tracks what the last read reached, including files of a read that failed.
		r.manifestWatch.inputsMu.RLock()
		inputs := slices.Clone(r.manifestWatch.inputs.Files)
		r.manifestWatch.inputsMu.RUnlock()
		for _, path := range inputs {
			if !slices.ContainsFunc(files, func(file devtools.ConfigFileRef) bool { return file.Path == path }) {
				files = append(files, devtools.ConfigFileRef{Path: path, Kind: devtools.ConfigFileKindInclude})
			}
		}
	}
	return append(files, devtools.ConfigFileRef{Path: r.configPath, Kind: devtools.ConfigFileKindConfig}), nil
}

// checkConfigFile makes the checks a reload makes before it stops any service, with content in place of the file at
// path, and changes nothing.
func (r *stackRuntime) checkConfigFile(path string, content []byte) error {
	r.operationMu.Lock()
	defer r.operationMu.Unlock()
	if err := r.checkReady(); err != nil {
		return err
	}
	if path == r.configPath {
		_, err := config.Parse(path, content)
		return err
	}
	if r.configured == nil {
		return fmt.Errorf("the stack runs without a manifest")
	}
	rootPath, err := filepath.Abs(r.configured.ManifestPath)
	if err != nil {
		return fmt.Errorf("resolve manifest path: %w", err)
	}
	raw, err := manifest.ReadManifestWithOverrides(rootPath, map[string][]byte{path: content})
	if err != nil {
		return err
	}
	next, err := manifest.ValidateManifest(r.configured.ManifestPath, raw)
	if err != nil {
		return err
	}
	r.manifestMu.RLock()
	current := *r.manifest
	r.manifestMu.RUnlock()
	candidate, _, err := resolveReloadCandidate(next, current, current.requested, resolveReloadPorts)
	if err != nil {
		return err
	}
	return validateServiceWorkingDirectories(candidate, nil)
}
