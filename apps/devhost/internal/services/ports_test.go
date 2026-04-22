package services

import (
	"testing"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/manifest"
)

func TestResolveServicePorts(t *testing.T) {
	t.Parallel()

	t.Run("resolves auto ports to unique runtime ports", func(t *testing.T) {
		t.Parallel()

		dbAuto := &manifest.PortConfig{Auto: true}
		apiFixed := &manifest.PortConfig{Number: 3000}
		webFixed := &manifest.PortConfig{Number: 4000}
		value := manifest.Manifest{
			Agent:          manifest.ValidatedAgent{DisplayName: "Pi", Kind: "pi"},
			Caddy:          manifest.CaddyConfig{Global: manifest.CaddyGlobalConfig{AdminAddress: "127.0.0.1:20197", BindHost: "127.0.0.1", HTTPPort: 80, HTTPSPort: 443}},
			Devtools:       manifest.DevtoolsConfig{Editor: manifest.DevtoolsEditorConfig{Enabled: true, IDE: "vscode"}, ExternalToolbars: manifest.DevtoolsToggleConfig{Enabled: true}, Minimap: manifest.DevtoolsMinimapConfig{Enabled: true, Position: "right"}, Status: manifest.DevtoolsStatusConfig{Enabled: true, Position: "bottom-right"}},
			ManifestPath:   "/tmp/devhost.toml",
			PrimaryService: "web",
			Services: map[string]manifest.ValidatedService{
				"db":  {Name: "db", BindHost: "127.0.0.1", Command: []string{"bun", "run", "db"}, Port: dbAuto},
				"api": {Name: "api", BindHost: "127.0.0.1", Command: []string{"bun", "run", "api"}, Port: apiFixed},
				"web": {Name: "web", BindHost: "127.0.0.1", Command: []string{"bun", "run", "web"}, Port: webFixed},
			},
		}

		resolvedManifest, error := ResolveServicePorts(value)
		if error != nil {
			t.Fatalf("ResolveServicePorts(...) unexpected error = %v", error)
		}

		databasePort := resolvedManifest.Services["db"].Port
		if databasePort == nil {
			t.Fatalf("resolved db port = nil, want value")
		}
		if resolvedManifest.Services["db"].PortSource != "auto" {
			t.Fatalf("resolved db port source = %q, want auto", resolvedManifest.Services["db"].PortSource)
		}
		if *databasePort == 3000 || *databasePort == 4000 {
			t.Fatalf("resolved db port = %d, want auto port distinct from fixed ports", *databasePort)
		}
		if resolvedManifest.Services["db"].Health.Kind != "tcp" {
			t.Fatalf("resolved db health kind = %q, want tcp", resolvedManifest.Services["db"].Health.Kind)
		}
	})

	t.Run("treats different bind hosts as different runtime sockets", func(t *testing.T) {
		t.Parallel()

		apiPort := &manifest.PortConfig{Number: 3000}
		webHealthPort := 3000
		value := manifest.Manifest{Services: map[string]manifest.ValidatedService{
			"api": {Name: "api", BindHost: "127.0.0.1", Command: []string{"bun", "run", "api"}, Port: apiPort},
			"web": {Name: "web", BindHost: "0.0.0.0", Command: []string{"bun", "run", "web"}, Health: &manifest.HealthConfig{TCP: &webHealthPort}},
		}}

		if _, error := ResolveServicePorts(value); error != nil {
			t.Fatalf("ResolveServicePorts(...) unexpected error = %v", error)
		}
	})

	t.Run("preserves explicit health checks fixed ports and configured agents", func(t *testing.T) {
		t.Parallel()

		apiPort := &manifest.PortConfig{Number: 4000}
		healthURL := "http://127.0.0.1:4000/healthz"
		value := manifest.Manifest{
			Agent:    manifest.ValidatedAgent{Command: []string{"bun", "./scripts/devhost-agent.ts"}, Cwd: "/tmp", DisplayName: "Claude Code", Env: map[string]string{}, Kind: "configured"},
			Caddy:    manifest.CaddyConfig{Global: manifest.CaddyGlobalConfig{AdminAddress: "127.0.0.1:22000", BindHost: "0.0.0.0", HTTP: true, HTTPPort: 8080, HTTPSPort: 4443}},
			Devtools: manifest.DevtoolsConfig{Editor: manifest.DevtoolsEditorConfig{Enabled: false, IDE: "webstorm"}, ExternalToolbars: manifest.DevtoolsToggleConfig{Enabled: false}, Minimap: manifest.DevtoolsMinimapConfig{Enabled: false, Position: "right"}, Status: manifest.DevtoolsStatusConfig{Enabled: false, Position: "top-right"}},
			Services: map[string]manifest.ValidatedService{
				"api": {Name: "api", BindHost: "127.0.0.1", Command: []string{"bun", "run", "api:dev"}, Health: &manifest.HealthConfig{HTTP: &healthURL}, InjectPort: false, Port: apiPort},
			},
		}

		resolvedManifest, error := ResolveServicePorts(value)
		if error != nil {
			t.Fatalf("ResolveServicePorts(...) unexpected error = %v", error)
		}

		resolvedService := resolvedManifest.Services["api"]
		if resolvedService.Port == nil || *resolvedService.Port != 4000 {
			t.Fatalf("resolved api port = %#v, want 4000", resolvedService.Port)
		}
		if resolvedService.InjectPort {
			t.Fatalf("resolved api injectPort = %t, want false", resolvedService.InjectPort)
		}
		if resolvedService.PortSource != "fixed" {
			t.Fatalf("resolved api port source = %q, want fixed", resolvedService.PortSource)
		}
		if resolvedService.Health.Kind != "http" || resolvedService.Health.URL == nil || *resolvedService.Health.URL != healthURL {
			t.Fatalf("resolved api health = %#v, want http %q", resolvedService.Health, healthURL)
		}
		if resolvedManifest.Agent.DisplayName != "Claude Code" || resolvedManifest.Agent.Kind != "configured" {
			t.Fatalf("resolved agent = %#v", resolvedManifest.Agent)
		}
	})

	t.Run("rejects missing effective health checks", func(t *testing.T) {
		t.Parallel()

		value := manifest.Manifest{Services: map[string]manifest.ValidatedService{
			"api": {Name: "api", BindHost: "127.0.0.1", Command: []string{"bun", "run", "api"}},
		}}

		_, error := ResolveServicePorts(value)
		want := "Service api is missing an effective health check."
		if error == nil || error.Error() != want {
			t.Fatalf("ResolveServicePorts(...) error = %v, want %q", error, want)
		}
	})
}
