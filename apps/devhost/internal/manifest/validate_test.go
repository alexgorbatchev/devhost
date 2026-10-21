package manifest

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestWorktreesConfiguration(t *testing.T) {
	for _, tc := range []struct {
		name               string
		value              any
		enabled, wantError bool
	}{
		{name: "omitted", enabled: true},
		{name: "empty table", value: map[string]any{}, enabled: true},
		{name: "enabled", value: map[string]any{"enabled": true}, enabled: true},
		{name: "disabled", value: map[string]any{"enabled": false}},
		{name: "invalid", value: map[string]any{"enabled": "yes"}, wantError: true},
		{name: "unknown setting", value: map[string]any{"rememberSelection": true}, wantError: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			raw := RawManifest{value: map[string]any{"name": "shop", "services": map[string]any{"web": map[string]any{"command": []any{"server"}, "health": map[string]any{"process": true}}}}}
			if tc.value != nil {
				raw.value["worktrees"] = tc.value
			}
			got, err := ValidateManifest(filepath.Join(t.TempDir(), "devhost.toml"), raw)
			if (err != nil) != tc.wantError {
				t.Fatalf("validation = %v", err)
			}
			if !tc.wantError && got.Worktrees.Enabled != tc.enabled {
				t.Fatalf("worktrees = %#v", got.Worktrees)
			}
		})
	}
}

func TestValidateManifestReturnsNormalizedDefaults(t *testing.T) {
	t.Parallel()

	manifestPath := filepath.Join(string(filepath.Separator), "tmp", "project", "devhost.toml")
	manifest, err := ValidateManifest(manifestPath, RawManifest{value: map[string]any{
		"name": "hello-stack",
		"services": map[string]any{
			"web": map[string]any{
				"command": []any{"bun", "run", "dev"},
				"host":    "hello.local.test",
				"port":    int64(3000),
			},
		},
	}})
	if err != nil {
		t.Fatalf("ValidateManifest(...) unexpected error = %v", err)
	}

	if manifest.Caddy.Global.AdminAddress != defaultManagedCaddyAdminAddress || manifest.Caddy.Global.BindHost != "0.0.0.0" || manifest.Caddy.Global.HTTP || manifest.Caddy.Global.HTTPPort != defaultManagedCaddyHTTPPort || manifest.Caddy.Global.HTTPSPort != defaultManagedCaddyHTTPSPort {
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

	if len(service.Hosts) != 1 || service.Hosts[0] != "hello.local.test" {
		t.Fatalf("service.Hosts = %#v, want %q", service.Hosts, "hello.local.test")
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

	if !manifest.KillZombies {
		t.Fatalf("manifest.KillZombies = %t, want true by default", manifest.KillZombies)
	}
}

func TestValidateManifestAcceptsIdleTimeout(t *testing.T) {
	t.Parallel()

	manifest, err := ValidateManifest(filepath.Join(string(filepath.Separator), "tmp", "project", "devhost.toml"), rawManifestWithServices(map[string]any{
		"devtools": map[string]any{
			"idleTimeout": "5m",
		},
	}))
	if err != nil {
		t.Fatalf("ValidateManifest(...) unexpected error = %v", err)
	}

	if manifest.Devtools.IdleTimeout != "5m" {
		t.Fatalf("manifest.Devtools.IdleTimeout = %q, want %q", manifest.Devtools.IdleTimeout, "5m")
	}
}

func TestValidateManifestAcceptsKillZombies(t *testing.T) {
	t.Parallel()

	manifest, err := ValidateManifest(filepath.Join(string(filepath.Separator), "tmp", "project", "devhost.toml"), rawManifestWithServices(map[string]any{
		"killZombies": false,
	}))
	if err != nil {
		t.Fatalf("ValidateManifest(...) unexpected error = %v", err)
	}

	if manifest.KillZombies {
		t.Fatalf("manifest.KillZombies = %t, want false", manifest.KillZombies)
	}
}

func TestValidateManifestAcceptsDocumentedFixtureShape(t *testing.T) {
	t.Parallel()

	rawManifest, err := ReadManifest(filepath.Join("..", "..", "devhost.example.toml"))
	if err != nil {
		t.Fatalf("ReadManifest(...) unexpected error = %v", err)
	}

	manifestPath := filepath.Join(string(filepath.Separator), "tmp", "devhost.toml")
	rawManifest.serviceOrder = []string{"web", "api", "cache", "db", "worker"}
	manifest, err := ValidateManifest(manifestPath, rawManifest)
	if err != nil {
		t.Fatalf("ValidateManifest(...) unexpected error = %v", err)
	}

	if manifest.PrimaryService != "web" {
		t.Fatalf("manifest.PrimaryService = %q, want %q", manifest.PrimaryService, "web")
	}

	if manifest.Services["db"].Port == nil || !manifest.Services["db"].Port.Auto {
		t.Fatalf("manifest.Services[\"db\"].Port = %#v, want auto port", manifest.Services["db"].Port)
	}

	apiHealth := manifest.Services["api"].Health
	if apiHealth == nil || apiHealth.HTTP == nil || *apiHealth.HTTP != "/healthz" {
		t.Fatalf("manifest.Services[\"api\"].Health = %#v, want HTTP health shorthand", apiHealth)
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
			name: "rejects invalid killZombies type",
			manifest: rawManifestWithServices(map[string]any{
				"killZombies": "not-a-bool",
			}),
			wantError: "killZombies must be a boolean",
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
			name: "rejects removed top-level agent table",
			manifest: rawManifestWithServices(map[string]any{
				"agent": map[string]any{"adapter": "pi"},
			}),
			wantError: "Unrecognized key: \"agent\"",
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
			name: "accepts explicit health with auto port",
			manifest: rawManifestWithServices(map[string]any{
				"services": map[string]any{
					"db": map[string]any{
						"command": []any{"bun", "run", "db:dev"},
						"health":  map[string]any{"tcp": int64(5432)},
						"port":    "auto",
					},
				},
			}),
			wantError: "",
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
			manifest:  RawManifest{value: map[string]any{"name": "hello-stack", "services": map[string]any{"web": map[string]any{"command": []any{"bun", "run", "dev"}, "health": map[string]any{"http": "health"}, "port": int64(3000)}}}},
			wantError: "services.web.health.http must be an absolute URL, received: health",
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

			manifest, err := ValidateManifest(filepath.Join(string(filepath.Separator), "tmp", "project", "devhost.toml"), tc.manifest)
			if tc.wantError == "" {
				if err != nil {
					t.Fatalf("ValidateManifest(...) unexpected error = %v", err)
				}

				if tc.name == "preserves insertion order primary fallback" && manifest.PrimaryService != "api" {
					t.Fatalf("manifest.PrimaryService = %q, want %q", manifest.PrimaryService, "api")
				}

				return
			}

			if err == nil {
				t.Fatalf("ValidateManifest(...) error = nil, want substring %q", tc.wantError)
			}

			if !strings.Contains(err.Error(), tc.wantError) {
				t.Fatalf("ValidateManifest(...) error = %q, want substring %q", err.Error(), tc.wantError)
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

	manifest, err := ValidateManifest(manifestPath, RawManifest{value: map[string]any{
		"name": "hello-stack",
		"devtools": map[string]any{
			"shortcuts": map[string]any{
				"restartServices": "ctrl+shift+k",
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
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
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
				"restartServices": "Alt+Shift+R!!",
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

	if manifest2.Devtools.Shortcuts.RestartServices != "alt+ctrl+r" {
		t.Fatalf("RestartServices = %q, want %q", manifest2.Devtools.Shortcuts.RestartServices, "alt+ctrl+r")
	}
}
