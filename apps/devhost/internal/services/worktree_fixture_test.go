package services

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"

	"github.com/BurntSushi/toml"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/manifest"
)

// Write real manifests for runtime fixtures that otherwise construct resolved services.
func writeWorktreeFixtureConfiguration(t *testing.T, m ResolvedManifest, root string) manifest.Manifest {
	t.Helper()
	services := map[string]any{}
	for name, s := range m.Services {
		cwd := s.Cwd
		if relative, within := pathWithin(m.ManifestDirectoryPath, cwd); within {
			cwd = relative
		}
		value := map[string]any{"cwd": cwd, "command": s.Command, "dependsOn": s.DependsOn, "env": s.Env, "watch": s.Watch}
		if len(s.Hosts) > 0 {
			value["host"] = s.Hosts
		}
		if s.Port != nil {
			value["port"] = *s.Port
			value["bindHost"] = s.BindHost
			value["injectPort"] = s.InjectPort
		}
		if s.Health.Kind == HealthKindTCP {
			value["health"] = map[string]any{"tcp": *s.Health.Port, "interval": s.Health.Interval, "timeout": s.Health.Timeout}
		} else {
			value["health"] = map[string]any{"process": true}
		}
		services[name] = value
	}
	name := m.Name
	if name == "" {
		name = "shop"
	}
	value := map[string]any{"name": name, "services": services, "worktrees": map[string]any{"enabled": true},
		"devtools": map[string]any{
			"status":           map[string]any{"enabled": m.Devtools.Status.Enabled},
			"editor":           map[string]any{"enabled": m.Devtools.Editor.Enabled},
			"minimap":          map[string]any{"enabled": m.Devtools.Minimap.Enabled},
			"externalToolbars": map[string]any{"enabled": m.Devtools.ExternalToolbars.Enabled},
		},
	}
	if m.Caddy.Global.AdminAddress != "" {
		value["caddy"] = map[string]any{"global": map[string]any{"adminAddress": m.Caddy.Global.AdminAddress}}
	}
	var buffer bytes.Buffer
	if err := toml.NewEncoder(&buffer).Encode(value); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(root, "devhost.toml")
	if err := os.WriteFile(path, buffer.Bytes(), 0600); err != nil {
		t.Fatal(err)
	}
	raw, err := manifest.ReadManifest(path)
	if err != nil {
		t.Fatal(err)
	}
	configuration, err := manifest.ValidateManifest(path, raw)
	if err != nil {
		t.Fatal(err)
	}
	return configuration
}
