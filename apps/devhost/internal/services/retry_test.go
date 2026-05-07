package services

import (
	"errors"
	"testing"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/manifest"
)

func TestShouldRetryAutoPortStartup(t *testing.T) {
	t.Parallel()

	autoPortService := createAutoPortService()
	if !ShouldRetryAutoPortStartup(autoPortService, errors.New("Service api exited before passing its health check with code 1."), []string{"[api] Error: listen EADDRINUSE: address already in use 127.0.0.1:3000"}, 0) {
		t.Fatalf("ShouldRetryAutoPortStartup(...) = false, want true")
	}

	if ShouldRetryAutoPortStartup(autoPortService, errors.New("listen EADDRINUSE"), []string{"address already in use"}, 3) {
		t.Fatalf("ShouldRetryAutoPortStartup(...) = true, want false after retry budget")
	}

	fixedPortService := autoPortService
	fixedPortService.Port = intPointer(3000)
	fixedPortService.PortSource = "fixed"
	if ShouldRetryAutoPortStartup(fixedPortService, errors.New("listen EADDRINUSE"), []string{"address already in use"}, 0) {
		t.Fatalf("ShouldRetryAutoPortStartup(...) = true, want false for fixed port service")
	}
}

func TestReassignAutoPort(t *testing.T) {
	t.Parallel()

	manifestValue := ResolvedManifest{
		Caddy:                 manifest.CaddyConfig{Global: manifest.CaddyGlobalConfig{AdminAddress: "127.0.0.1:20197", BindHost: "127.0.0.1", HTTPPort: 80, HTTPSPort: 443}},
		Devtools:              manifest.DevtoolsConfig{Editor: manifest.DevtoolsEditorConfig{Enabled: true, IDE: "vscode"}, ExternalToolbars: manifest.DevtoolsToggleConfig{Enabled: true}, Minimap: manifest.DevtoolsMinimapConfig{Enabled: true}, Status: manifest.DevtoolsStatusConfig{Enabled: true, Position: "bottom-right"}},
		ManifestDirectoryPath: "/tmp/project",
		ManifestPath:          "/tmp/project/devhost.toml",
		Name:                  "hello-stack",
		PrimaryService:        "web",
		Services: map[string]ResolvedService{
			"api": createAutoPortService(),
			"web": {
				BindHost:   "127.0.0.1",
				Command:    []string{"bun", "run", "web:dev"},
				Cwd:        "/tmp/project",
				DependsOn:  []string{},
				Env:        map[string]string{},
				Health:     ResolvedHealthConfig{Host: stringPointer("127.0.0.1"), Interval: 200, Kind: "tcp", Port: intPointer(3000), Retries: 0, Timeout: 30000},
				Name:       "web",
				Port:       intPointer(3000),
				PortSource: "fixed",
			},
		},
	}

	updatedService, updatedManifest, error := ReassignAutoPort(manifestValue, "api")
	if error != nil {
		t.Fatalf("ReassignAutoPort(...) unexpected error = %v", error)
	}

	if updatedService.Port == nil {
		t.Fatalf("updated service port = nil, want value")
	}
	if *updatedService.Port == 3000 || *updatedService.Port == 3200 {
		t.Fatalf("updated service port = %d, want replacement port distinct from 3000 and 3200", *updatedService.Port)
	}
	if updatedService.Health.Kind != "tcp" || updatedService.Health.Host == nil || *updatedService.Health.Host != "127.0.0.1" || updatedService.Health.Port == nil || *updatedService.Health.Port != *updatedService.Port || updatedService.Health.Interval != 200 || updatedService.Health.Retries != 0 || updatedService.Health.Timeout != 30000 {
		t.Fatalf("updated service health = %#v", updatedService.Health)
	}

	manifestService := updatedManifest.Services["api"]
	if manifestService.Port == nil || *manifestService.Port != *updatedService.Port {
		t.Fatalf("updated manifest api port = %#v, want %d", manifestService.Port, *updatedService.Port)
	}
}

func createAutoPortService() ResolvedService {
	return ResolvedService{
		BindHost:   "127.0.0.1",
		Command:    []string{"bun", "run", "api:dev"},
		Cwd:        "/tmp/project",
		DependsOn:  []string{},
		Env:        map[string]string{},
		Health:     ResolvedHealthConfig{Host: stringPointer("127.0.0.1"), Interval: 200, Kind: "tcp", Port: intPointer(3200), Retries: 0, Timeout: 30000},
		Name:       "api",
		Port:       intPointer(3200),
		PortSource: "auto",
	}
}
