package manifest

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestValidateManifestReturnsNormalizedDefaults(t *testing.T) {
	t.Parallel()

	manifestPath := filepath.Join(string(filepath.Separator), "tmp", "project", "devhost.toml")
	manifest, error := ValidateManifest(manifestPath, RawManifest{value: map[string]any{
		"name": "hello-stack",
		"services": map[string]any{
			"web": map[string]any{
				"command": []any{"bun", "run", "dev"},
				"host":    "hello.local.test",
				"port":    int64(3000),
			},
		},
	}})
	if error != nil {
		t.Fatalf("ValidateManifest(...) unexpected error = %v", error)
	}

	if manifest.Agent.DisplayName != "Pi" || manifest.Agent.Kind != "pi" {
		t.Fatalf("manifest.Agent = %#v, want Pi default", manifest.Agent)
	}

	if manifest.Caddy.Global.AdminAddress != defaultManagedCaddyAdminAddress || manifest.Caddy.Global.BindHost != defaultManagedCaddyBindHost || manifest.Caddy.Global.HTTP || manifest.Caddy.Global.HTTPPort != defaultManagedCaddyHTTPPort || manifest.Caddy.Global.HTTPSPort != defaultManagedCaddyHTTPSPort {
		t.Fatalf("manifest.Caddy.Global = %#v, want default caddy config", manifest.Caddy.Global)
	}

	if !manifest.Devtools.Editor.Enabled || manifest.Devtools.Editor.IDE != defaultDevtoolsEditor {
		t.Fatalf("manifest.Devtools.Editor = %#v, want enabled %q", manifest.Devtools.Editor, defaultDevtoolsEditor)
	}

	if !manifest.Devtools.ExternalToolbars.Enabled {
		t.Fatalf("manifest.Devtools.ExternalToolbars = %#v, want enabled", manifest.Devtools.ExternalToolbars)
	}

	if !manifest.Devtools.Minimap.Enabled {
		t.Fatalf("manifest.Devtools.Minimap = %#v, want enabled", manifest.Devtools.Minimap)
	}

	if !manifest.Devtools.Status.Enabled || manifest.Devtools.Status.Position != defaultDevtoolsStatusPosition {
		t.Fatalf("manifest.Devtools.Status = %#v, want enabled %q", manifest.Devtools.Status, defaultDevtoolsStatusPosition)
	}

	service := manifest.Services["web"]
	if service.BindHost != defaultServiceBindHost {
		t.Fatalf("service.BindHost = %q, want %q", service.BindHost, defaultServiceBindHost)
	}

	if service.Cwd != filepath.Join(string(filepath.Separator), "tmp", "project") {
		t.Fatalf("service.Cwd = %q, want %q", service.Cwd, filepath.Join(string(filepath.Separator), "tmp", "project"))
	}

	if len(service.DependsOn) != 0 {
		t.Fatalf("service.DependsOn = %#v, want empty", service.DependsOn)
	}

	if len(service.Env) != 0 {
		t.Fatalf("service.Env = %#v, want empty", service.Env)
	}

	if service.Host == nil || *service.Host != "hello.local.test" {
		t.Fatalf("service.Host = %#v, want %q", service.Host, "hello.local.test")
	}

	if service.Path == nil || *service.Path != "/" {
		t.Fatalf("service.Path = %#v, want /", service.Path)
	}

	if !service.InjectPort {
		t.Fatalf("service.InjectPort = %t, want true", service.InjectPort)
	}

	if service.Port == nil || service.Port.Auto || service.Port.Number != 3000 {
		t.Fatalf("service.Port = %#v, want fixed port 3000", service.Port)
	}

	if service.Health != nil {
		t.Fatalf("service.Health = %#v, want nil", service.Health)
	}
}

func TestValidateManifestAcceptsDocumentedFixtureShape(t *testing.T) {
	t.Parallel()

	rawManifest, error := ReadManifest(filepath.Join("..", "..", "devhost.example.toml"))
	if error != nil {
		t.Fatalf("ReadManifest(...) unexpected error = %v", error)
	}

	manifestPath := filepath.Join(string(filepath.Separator), "tmp", "devhost.toml")
	rawManifest.serviceOrder = []string{"web", "api", "cache", "db", "worker"}
	manifest, error := ValidateManifest(manifestPath, rawManifest)
	if error != nil {
		t.Fatalf("ValidateManifest(...) unexpected error = %v", error)
	}

	if manifest.PrimaryService != "web" {
		t.Fatalf("manifest.PrimaryService = %q, want %q", manifest.PrimaryService, "web")
	}

	if manifest.Services["db"].Port == nil || !manifest.Services["db"].Port.Auto {
		t.Fatalf("manifest.Services[\"db\"].Port = %#v, want auto port", manifest.Services["db"].Port)
	}

	apiHealth := manifest.Services["api"].Health
	if apiHealth == nil || apiHealth.HTTP == nil || *apiHealth.HTTP != "http://127.0.0.1:4000/healthz" {
		t.Fatalf("manifest.Services[\"api\"].Health = %#v, want HTTP health", apiHealth)
	}
}

func TestValidateManifestRejectsInvalidCases(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name      string
		manifest  RawManifest
		wantError string
	}{
		{
			name: "rejects unsupported caddy bind host",
			manifest: rawManifestWithServices(map[string]any{
				"caddy": map[string]any{"global": map[string]any{"bindHost": "192.168.1.10"}},
			}),
			wantError: "caddy.global.bindHost",
		},
		{
			name: "rejects unsupported caddy http port",
			manifest: rawManifestWithServices(map[string]any{
				"caddy": map[string]any{"global": map[string]any{"httpPort": int64(0)}},
			}),
			wantError: "caddy.global.httpPort",
		},
		{
			name: "rejects unsupported minimap position key",
			manifest: rawManifestWithServices(map[string]any{
				"devtools": map[string]any{"minimap": map[string]any{"enabled": true, "position": "left"}},
			}),
			wantError: `devtools.minimap Unrecognized key: "position"`,
		},
		{
			name: "rejects removed status position",
			manifest: rawManifestWithServices(map[string]any{
				"devtools": map[string]any{"status": map[string]any{"enabled": true, "position": "top-left"}},
			}),
			wantError: "devtools.status.position",
		},
		{
			name: "rejects unsupported caddy key",
			manifest: rawManifestWithServices(map[string]any{
				"caddy": map[string]any{"autostop": true},
			}),
			wantError: "Manifest schema is invalid:\ncaddy Unrecognized key: \"autostop\"",
		},
		{
			name: "rejects agent cwd escape",
			manifest: rawManifestWithServices(map[string]any{
				"agent": map[string]any{
					"command":     []any{"bun", "./scripts/devhost-agent.ts"},
					"cwd":         "../outside",
					"displayName": "Claude Code",
				},
			}),
			wantError: "agent.cwd must stay within /tmp/project.",
		},
		{
			name: "rejects invalid public host",
			manifest: rawManifestWithServices(map[string]any{
				"services": map[string]any{
					"web": map[string]any{"command": []any{"bun", "run", "dev"}, "host": "not a host", "port": int64(3000)},
				},
			}),
			wantError: "services.web.host must be a valid hostname",
		},
		{
			name: "rejects explicit health with auto port",
			manifest: rawManifestWithServices(map[string]any{
				"services": map[string]any{
					"db": map[string]any{
						"command": []any{"bun", "run", "db:dev"},
						"health":  map[string]any{"tcp": int64(5432)},
						"port":    "auto",
					},
				},
			}),
			wantError: "services.db must omit health when port = \"auto\" in v1.",
		},
		{
			name: "rejects routed service without port",
			manifest: rawManifestWithServices(map[string]any{
				"services": map[string]any{
					"web": map[string]any{"command": []any{"bun", "run", "dev"}, "host": "hello.local.test"},
				},
			}),
			wantError: "services.web.host requires services.web.port.",
		},
		{
			name: "rejects process health on routed service",
			manifest: rawManifestWithServices(map[string]any{
				"services": map[string]any{
					"web": map[string]any{
						"command": []any{"bun", "run", "dev"},
						"health":  map[string]any{"process": true},
						"host":    "hello.local.test",
						"port":    int64(3000),
					},
				},
			}),
			wantError: "services.web must not use health.process on a routed service.",
		},
		{
			name: "accepts same host fallback root path",
			manifest: rawManifestWithServices(map[string]any{
				"services": map[string]any{
					"api": map[string]any{"command": []any{"bun", "run", "api:dev"}, "host": "hello.localhost", "path": "/api/*", "port": int64(4000)},
					"web": map[string]any{"command": []any{"bun", "run", "web:dev"}, "host": "hello.localhost", "path": "/", "port": int64(3000)},
				},
			}),
			wantError: "",
		},
		{
			name: "rejects overlapping routed subpaths",
			manifest: rawManifestWithServices(map[string]any{
				"services": map[string]any{
					"api":    map[string]any{"command": []any{"bun", "run", "api:dev"}, "host": "hello.localhost", "path": "/api/*", "port": int64(4000)},
					"api-v2": map[string]any{"command": []any{"bun", "run", "api:v2:dev"}, "host": "hello.localhost", "path": "/api/v2/*", "port": int64(4100)},
				},
			}),
			wantError: "services.api-v2.path overlaps another routed service on host hello.localhost: /api/*",
		},
		{
			name: "rejects invalid wildcard placement",
			manifest: rawManifestWithServices(map[string]any{
				"services": map[string]any{
					"api": map[string]any{"command": []any{"bun", "run", "api:dev"}, "host": "hello.localhost", "path": "/api/*foo/*", "port": int64(4000)},
				},
			}),
			wantError: "services.api.path must be '/' or a leading-slash path with an optional trailing '/*'.",
		},
		{
			name: "rejects duplicate fixed ports",
			manifest: rawManifestWithServices(map[string]any{
				"services": map[string]any{
					"api": map[string]any{"command": []any{"bun", "run", "api:dev"}, "port": int64(3000)},
					"web": map[string]any{"command": []any{"bun", "run", "web:dev"}, "port": int64(3000)},
				},
			}),
			wantError: "services.web duplicates fixed bind port 127.0.0.1:3000.",
		},
		{
			name: "rejects duplicate fixed ports across overlapping bind hosts",
			manifest: rawManifestWithServices(map[string]any{
				"services": map[string]any{
					"api": map[string]any{"bindHost": "0.0.0.0", "command": []any{"bun", "run", "api:dev"}, "port": int64(3000)},
					"web": map[string]any{"bindHost": "127.0.0.1", "command": []any{"bun", "run", "web:dev"}, "port": int64(3000)},
				},
			}),
			wantError: "services.web duplicates fixed bind port 127.0.0.1:3000.",
		},
		{
			name: "rejects service cwd escape",
			manifest: rawManifestWithServices(map[string]any{
				"services": map[string]any{
					"web": map[string]any{"command": []any{"bun", "run", "dev"}, "cwd": "../outside", "port": int64(3000)},
				},
			}),
			wantError: "services.web.cwd must stay within /tmp/project.",
		},
		{
			name: "rejects multiple primary services",
			manifest: RawManifest{serviceOrder: []string{"api", "web"}, value: map[string]any{
				"name": "hello-stack",
				"services": map[string]any{
					"api": map[string]any{"command": []any{"bun", "run", "api:dev"}, "port": int64(4000), "primary": true},
					"web": map[string]any{"command": []any{"bun", "run", "web:dev"}, "port": int64(3000), "primary": true},
				},
			}},
			wantError: "Multiple primary services defined: api, web",
		},
		{
			name:      "rejects missing services",
			manifest:  RawManifest{value: map[string]any{"name": "hello-stack", "services": map[string]any{}}},
			wantError: "services must contain at least one service.",
		},
		{
			name:      "rejects invalid service name",
			manifest:  RawManifest{value: map[string]any{"name": "hello-stack", "services": map[string]any{"Web": map[string]any{"command": []any{"bun", "run", "dev"}, "port": int64(3000)}}}},
			wantError: "services.Web has an invalid name.",
		},
		{
			name:      "rejects missing dependsOn target",
			manifest:  RawManifest{value: map[string]any{"name": "hello-stack", "services": map[string]any{"web": map[string]any{"command": []any{"bun", "run", "dev"}, "dependsOn": []any{"api"}, "port": int64(3000)}}}},
			wantError: "services.web.dependsOn references an unknown service: api",
		},
		{
			name:      "rejects missing port and health",
			manifest:  RawManifest{value: map[string]any{"name": "hello-stack", "services": map[string]any{"web": map[string]any{"command": []any{"bun", "run", "dev"}}}}},
			wantError: "services.web must define either port or health.",
		},
		{
			name:      "rejects relative health http url",
			manifest:  RawManifest{value: map[string]any{"name": "hello-stack", "services": map[string]any{"web": map[string]any{"command": []any{"bun", "run", "dev"}, "health": map[string]any{"http": "/health"}, "port": int64(3000)}}}},
			wantError: "services.web.health.http must be an absolute URL, received: /health",
		},
		{
			name:      "rejects non loopback health http host",
			manifest:  RawManifest{value: map[string]any{"name": "hello-stack", "services": map[string]any{"web": map[string]any{"command": []any{"bun", "run", "dev"}, "health": map[string]any{"http": "http://example.com/health"}, "port": int64(3000)}}}},
			wantError: "services.web.health.http must target 127.0.0.1, localhost, or ::1.",
		},
		{
			name:      "rejects path without leading slash",
			manifest:  RawManifest{value: map[string]any{"name": "hello-stack", "services": map[string]any{"web": map[string]any{"command": []any{"bun", "run", "dev"}, "host": "hello.local.test", "path": "api/*", "port": int64(3000)}}}},
			wantError: "services.web.path must start with '/'.",
		},
		{
			name: "preserves insertion order primary fallback",
			manifest: RawManifest{serviceOrder: []string{"api", "web"}, value: map[string]any{
				"name": "hello-stack",
				"services": map[string]any{
					"web": map[string]any{"command": []any{"bun", "run", "web:dev"}, "port": int64(3000)},
					"api": map[string]any{"command": []any{"bun", "run", "api:dev"}, "port": int64(4000)},
				},
			}},
			wantError: "",
		},
	}

	for _, tt := range tests {
		tc := tt
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			manifest, error := ValidateManifest(filepath.Join(string(filepath.Separator), "tmp", "project", "devhost.toml"), tc.manifest)
			if tc.wantError == "" {
				if error != nil {
					t.Fatalf("ValidateManifest(...) unexpected error = %v", error)
				}

				if tc.name == "preserves insertion order primary fallback" && manifest.PrimaryService != "api" {
					t.Fatalf("manifest.PrimaryService = %q, want %q", manifest.PrimaryService, "api")
				}

				return
			}

			if error == nil {
				t.Fatalf("ValidateManifest(...) error = nil, want substring %q", tc.wantError)
			}

			if !strings.Contains(error.Error(), tc.wantError) {
				t.Fatalf("ValidateManifest(...) error = %q, want substring %q", error.Error(), tc.wantError)
			}
		})
	}
}

func rawManifestWithServices(extra map[string]any) RawManifest {
	value := map[string]any{
		"name": "hello-stack",
		"services": map[string]any{
			"web": map[string]any{"command": []any{"bun", "run", "dev"}, "port": int64(3000)},
		},
	}

	for key, item := range extra {
		value[key] = item
	}

	return RawManifest{serviceOrder: []string{"web"}, value: value}
}
