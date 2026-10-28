package manifest

import (
	"os"
	"path/filepath"
	"testing"
)

func TestServeManifest(t *testing.T) {
	for _, tc := range []struct {
		name      string
		settings  map[string]any
		wantError bool
	}{
		{name: "automatic port"},
		{name: "fixed port", settings: map[string]any{"port": int64(41327)}},
		{name: "empty directory", settings: map[string]any{"serve": ""}, wantError: true},
		{name: "wrong type", settings: map[string]any{"serve": true}, wantError: true},
		{name: "escaping directory", settings: map[string]any{"serve": "../outside"}, wantError: true},
		{name: "command", settings: map[string]any{"command": "server"}, wantError: true},
		{name: "external", settings: map[string]any{"managed": false}, wantError: true},
		{name: "cwd", settings: map[string]any{"cwd": "."}, wantError: true},
		{name: "environment", settings: map[string]any{"env": map[string]any{"A": "B"}}, wantError: true},
		{name: "process health", settings: map[string]any{"health": map[string]any{"process": true}}, wantError: true},
		{name: "lifecycle", settings: map[string]any{"lifecycle": map[string]any{"mode": "foreground"}}, wantError: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			service := map[string]any{"serve": "public", "host": "files.localhost"}
			for k, v := range tc.settings {
				service[k] = v
			}
			got, err := ValidateManifest(filepath.Join(dir, "devhost.toml"), RawManifest{value: map[string]any{"name": "files", "services": map[string]any{"files": service}}})
			if (err != nil) != tc.wantError {
				t.Fatalf("validation error = %v", err)
			}
			if err != nil {
				return
			}
			s := got.Services["files"]
			if s.Serve != filepath.Join(dir, "public") || s.Cwd != s.Serve || len(s.Command) != 0 || !s.Managed || s.Port == nil {
				t.Fatalf("resolved service = %#v", s)
			}
		})
	}
}

func TestIncludedServeDirectory(t *testing.T) {
	dir := t.TempDir()
	if err := os.Mkdir(filepath.Join(dir, "package"), 0o755); err != nil {
		t.Fatal(err)
	}
	root := filepath.Join(dir, "devhost.toml")
	for name, body := range map[string]string{
		root: "name = 'root'\nincludes = ['package/devhost.toml']\n",
		filepath.Join(dir, "package", "devhost.toml"): "name = 'package'\n[services.files]\nserve = 'public'\nhost = 'files.localhost'\n",
	} {
		if err := os.WriteFile(name, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	raw, err := ReadManifest(root)
	if err != nil {
		t.Fatal(err)
	}
	m, err := ValidateManifest(root, raw)
	if err != nil {
		t.Fatal(err)
	}
	if got := m.Services["files"].Serve; got != filepath.Join(dir, "package", "public") {
		t.Fatalf("serve = %q", got)
	}
}
