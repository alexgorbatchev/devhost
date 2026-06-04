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

	if manifest.Annotation.DefaultActionID != "" || len(manifest.Annotation.Actions) != 0 {
		t.Fatalf("manifest.Annotation = %#v, want no annotation actions by default", manifest.Annotation)
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

	if !service.Managed {
		t.Fatalf("service.Managed = %t, want true", service.Managed)
	}

	if service.Port == nil || service.Port.Auto || service.Port.Number != 3000 {
		t.Fatalf("service.Port = %#v, want fixed port 3000", service.Port)
	}

	if service.Health != nil {
		t.Fatalf("service.Health = %#v, want nil", service.Health)
	}

	if service.Lifecycle.Mode != "foreground" || len(service.Lifecycle.Start) != 0 || len(service.Lifecycle.Status) != 0 || len(service.Lifecycle.Stop) != 0 {
		t.Fatalf("service.Lifecycle = %#v, want default foreground lifecycle", service.Lifecycle)
	}
}

func TestValidateManifestAcceptsAnnotationActions(t *testing.T) {
	t.Parallel()

	manifest, error := ValidateManifest(filepath.Join(string(filepath.Separator), "tmp", "project", "devhost.toml"), rawManifestWithServices(map[string]any{
		"annotation": map[string]any{
			"defaultAction": "lint",
			"actions": []any{
				map[string]any{"agent": map[string]any{"adapter": "claude-code"}, "id": "fix", "kind": "agent", "label": "Ask Claude"},
				map[string]any{
					"command": map[string]any{
						"command": []any{"bun", "run", "lint"},
						"cwd":     "tools",
						"env":     map[string]any{"CI": "1"},
					},
					"id":    "lint",
					"kind":  "command",
					"label": "Run lint",
				},
			},
		},
	}))
	if error != nil {
		t.Fatalf("ValidateManifest(...) unexpected error = %v", error)
	}

	if len(manifest.Annotation.Actions) != 2 {
		t.Fatalf("manifest.Annotation.Actions = %#v, want 2 actions", manifest.Annotation.Actions)
	}
	if manifest.Annotation.DefaultActionID != "lint" {
		t.Fatalf("manifest.Annotation.DefaultActionID = %q, want lint", manifest.Annotation.DefaultActionID)
	}
	agentAction := manifest.Annotation.Actions[0]
	if agentAction.ID != "fix" || agentAction.Kind != "agent" || agentAction.DisplayName != "Ask Claude" || agentAction.Agent.DisplayName != "Claude Code" || agentAction.Agent.Kind != "claude-code" {
		t.Fatalf("agent action = %#v", agentAction)
	}
	commandAction := manifest.Annotation.Actions[1]
	if commandAction.ID != "lint" || commandAction.Kind != "command" || commandAction.DisplayName != "Run lint" || strings.Join(commandAction.Command, " ") != "bun run lint" || commandAction.Cwd != filepath.Join(string(filepath.Separator), "tmp", "project", "tools") || commandAction.Env["CI"] != "1" {
		t.Fatalf("command action = %#v", commandAction)
	}
}

func TestValidateManifestAcceptsIdleTimeout(t *testing.T) {
	t.Parallel()

	manifest, error := ValidateManifest(filepath.Join(string(filepath.Separator), "tmp", "project", "devhost.toml"), rawManifestWithServices(map[string]any{
		"devtools": map[string]any{
			"idleTimeout": "5m",
		},
	}))
	if error != nil {
		t.Fatalf("ValidateManifest(...) unexpected error = %v", error)
	}

	if manifest.Devtools.IdleTimeout != "5m" {
		t.Fatalf("manifest.Devtools.IdleTimeout = %q, want %q", manifest.Devtools.IdleTimeout, "5m")
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

	workerLifecycle := manifest.Services["worker"].Lifecycle
	if workerLifecycle.Mode != "foreground" {
		t.Fatalf("manifest.Services[\"worker\"].Lifecycle = %#v, want default foreground lifecycle", workerLifecycle)
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
			name: "rejects invalid devtools.idleTimeout",
			manifest: rawManifestWithServices(map[string]any{
				"devtools": map[string]any{"idleTimeout": "invalid_duration"},
			}),
			wantError: "devtools.idleTimeout must be a valid duration",
		},
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
			name: "rejects duplicate annotation action ids",
			manifest: rawManifestWithServices(map[string]any{
				"annotation": map[string]any{"actions": []any{
					map[string]any{"agent": map[string]any{"adapter": "pi"}, "id": "fix", "kind": "agent", "label": "Fix"},
					map[string]any{"command": map[string]any{"command": []any{"bun", "test"}}, "id": "fix", "kind": "command", "label": "Test"},
				}},
			}),
			wantError: "annotation.actions id must be unique: fix",
		},
		{
			name: "rejects annotation command action without command",
			manifest: rawManifestWithServices(map[string]any{
				"annotation": map[string]any{"actions": []any{
					map[string]any{"command": map[string]any{}, "id": "test", "kind": "command", "label": "Test"},
				}},
			}),
			wantError: "annotation.actions.test.command must define command.",
		},
		{
			name: "rejects invalid annotation action kind",
			manifest: rawManifestWithServices(map[string]any{
				"annotation": map[string]any{"actions": []any{
					map[string]any{"id": "deploy", "kind": "deploy", "label": "Deploy"},
				}},
			}),
			wantError: "annotation.actions.deploy.kind must be one of agent or command.",
		},
		{
			name: "rejects removed top-level agent table",
			manifest: rawManifestWithServices(map[string]any{
				"agent": map[string]any{"adapter": "pi"},
			}),
			wantError: "Unrecognized key: \"agent\"",
		},
		{
			name: "rejects unknown annotation default action",
			manifest: rawManifestWithServices(map[string]any{
				"annotation": map[string]any{"defaultAction": "missing", "actions": []any{
					map[string]any{"agent": map[string]any{"adapter": "pi"}, "id": "ask", "kind": "agent", "label": "Ask"},
				}},
			}),
			wantError: "annotation.defaultAction must reference an annotation action id: missing",
		},
		{
			name: "rejects annotation agent cwd escape",
			manifest: rawManifestWithServices(map[string]any{
				"annotation": map[string]any{"actions": []any{
					map[string]any{
						"agent": map[string]any{
							"command":     []any{"bun", "./scripts/devhost-agent.ts"},
							"cwd":         "../outside",
							"displayName": "Claude Code",
						},
						"id":    "ask",
						"kind":  "agent",
						"label": "Ask Claude",
					},
				}},
			}),
			wantError: "annotation.actions.ask.agent.cwd must stay within /tmp/project.",
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
			name: "accepts daemon lifecycle service without foreground command",
			manifest: rawManifestWithServices(map[string]any{
				"services": map[string]any{
					"db": map[string]any{
						"lifecycle": map[string]any{
							"mode":   "daemon",
							"start":  []any{"docker", "compose", "up", "-d", "db"},
							"status": []any{"docker", "compose", "ps", "db"},
							"stop":   []any{"docker", "compose", "stop", "db"},
						},
						"port": int64(5432),
					},
				},
			}),
			wantError: "",
		},
		{
			name: "accepts unmanaged routed service without command",
			manifest: rawManifestWithServices(map[string]any{
				"services": map[string]any{
					"web": map[string]any{"managed": false, "host": "hello.local.test", "port": int64(3000)},
				},
			}),
			wantError: "",
		},
		{
			name: "rejects unmanaged service command",
			manifest: rawManifestWithServices(map[string]any{
				"services": map[string]any{
					"web": map[string]any{"managed": false, "command": []any{"bun", "run", "dev"}, "port": int64(3000)},
				},
			}),
			wantError: "services.web must omit command when managed = false.",
		},
		{
			name: "rejects daemon lifecycle on unmanaged service",
			manifest: rawManifestWithServices(map[string]any{
				"services": map[string]any{
					"web": map[string]any{
						"lifecycle": map[string]any{
							"mode":  "daemon",
							"start": []any{"docker", "compose", "up", "-d", "web"},
							"stop":  []any{"docker", "compose", "stop", "web"},
						},
						"managed": false,
						"port":    int64(3000),
					},
				},
			}),
			wantError: "services.web.lifecycle.mode=\"daemon\" requires managed = true.",
		},
		{
			name: "rejects daemon lifecycle with foreground command",
			manifest: rawManifestWithServices(map[string]any{
				"services": map[string]any{
					"web": map[string]any{
						"command": []any{"bun", "run", "dev"},
						"lifecycle": map[string]any{
							"mode":  "daemon",
							"start": []any{"docker", "compose", "up", "-d", "web"},
							"stop":  []any{"docker", "compose", "stop", "web"},
						},
						"port": int64(3000),
					},
				},
			}),
			wantError: "services.web must omit command when lifecycle.mode = \"daemon\".",
		},
		{
			name: "rejects daemon lifecycle without stop command",
			manifest: rawManifestWithServices(map[string]any{
				"services": map[string]any{
					"web": map[string]any{
						"lifecycle": map[string]any{
							"mode":  "daemon",
							"start": []any{"docker", "compose", "up", "-d", "web"},
						},
						"port": int64(3000),
					},
				},
			}),
			wantError: "services.web.lifecycle.stop is required when lifecycle.mode = \"daemon\".",
		},
		{
			name: "rejects unmanaged service inject port",
			manifest: rawManifestWithServices(map[string]any{
				"services": map[string]any{
					"web": map[string]any{"managed": false, "injectPort": false, "port": int64(3000)},
				},
			}),
			wantError: "services.web must omit injectPort when managed = false.",
		},
		{
			name: "rejects unmanaged service auto port",
			manifest: rawManifestWithServices(map[string]any{
				"services": map[string]any{
					"web": map[string]any{"managed": false, "port": "auto"},
				},
			}),
			wantError: "services.web must not use port = \"auto\" when managed = false.",
		},
		{
			name: "rejects daemon lifecycle auto port",
			manifest: rawManifestWithServices(map[string]any{
				"services": map[string]any{
					"web": map[string]any{
						"lifecycle": map[string]any{
							"mode":  "daemon",
							"start": []any{"docker", "compose", "up", "-d", "web"},
							"stop":  []any{"docker", "compose", "stop", "web"},
						},
						"port": "auto",
					},
				},
			}),
			wantError: "services.web must not use port = \"auto\" when lifecycle.mode = \"daemon\".",
		},
		{
			name: "rejects unmanaged service process health",
			manifest: rawManifestWithServices(map[string]any{
				"services": map[string]any{
					"web": map[string]any{"managed": false, "health": map[string]any{"process": true}},
				},
			}),
			wantError: "services.web must not use health.process when managed = false.",
		},
		{
			name: "rejects daemon lifecycle process health",
			manifest: rawManifestWithServices(map[string]any{
				"services": map[string]any{
					"web": map[string]any{
						"health": map[string]any{"process": true},
						"lifecycle": map[string]any{
							"mode":  "daemon",
							"start": []any{"docker", "compose", "up", "-d", "web"},
							"stop":  []any{"docker", "compose", "stop", "web"},
						},
					},
				},
			}),
			wantError: "services.web must not use health.process when lifecycle.mode = \"daemon\".",
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

func TestValidateManifestWatchAndShortcuts(t *testing.T) {
	t.Parallel()

	manifestPath := filepath.Join(string(filepath.Separator), "tmp", "project", "devhost.toml")

	manifest, error := ValidateManifest(manifestPath, RawManifest{value: map[string]any{
		"name": "hello-stack",
		"devtools": map[string]any{
			"shortcuts": map[string]any{
				"restart-services": "ctrl+shift+k",
			},
		},
		"services": map[string]any{
			"web": map[string]any{
				"command": []any{"bun", "run", "dev"},
				"port":    int64(3000),
				"watch":   []any{"src/", "package.json"},
			},
		},
	}})
	if error != nil {
		t.Fatalf("unexpected error: %v", error)
	}

	if manifest.Devtools.Shortcuts.RestartServices != "ctrl+shift+k" {
		t.Fatalf("RestartServices = %q, want %q", manifest.Devtools.Shortcuts.RestartServices, "ctrl+shift+k")
	}

	service := manifest.Services["web"]
	if len(service.Watch) != 2 || service.Watch[0] != "src/" || service.Watch[1] != "package.json" {
		t.Fatalf("service.Watch = %#v, want [\"src/\", \"package.json\"]", service.Watch)
	}

	manifest2, error2 := ValidateManifest(manifestPath, RawManifest{value: map[string]any{
		"name": "hello-stack",
		"devtools": map[string]any{
			"shortcuts": map[string]any{
				"restart-services": "Alt+Shift+R!!",
			},
		},
		"services": map[string]any{
			"web": map[string]any{
				"command": []any{"bun", "run", "dev"},
				"port":    int64(3000),
			},
		},
	}})
	if error2 != nil {
		t.Fatalf("unexpected error: %v", error2)
	}

	if manifest2.Devtools.Shortcuts.RestartServices != "alt+shift+r" {
		t.Fatalf("RestartServices = %q, want %q", manifest2.Devtools.Shortcuts.RestartServices, "alt+shift+r")
	}
}
