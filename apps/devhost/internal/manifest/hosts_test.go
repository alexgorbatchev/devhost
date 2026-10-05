package manifest

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestManifestHostForms(t *testing.T) {
	tests := []struct {
		name      string
		host      string
		wantError string
	}{
		{name: "single", host: `"app.localhost"`},
		{name: "array", host: `["app.localhost", "alias.localhost"]`},
		{name: "one element array", host: `["app.localhost"]`},
		{name: "empty array", host: `[]`, wantError: "at least one string"},
		{name: "empty element", host: `["app.localhost", ""]`, wantError: "non-empty strings"},
		{name: "wrong element type", host: `["app.localhost", 42]`, wantError: "non-empty strings"},
		{name: "invalid alias", host: `["app.localhost", "https://alias.localhost"]`, wantError: "valid hostname"},
		{name: "duplicate alias", host: `["app.localhost", "app.localhost"]`, wantError: "duplicate hostname"},
		{name: "case insensitive duplicate", host: `["App.localhost", "app.localhost"]`, wantError: "duplicate hostname"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "devhost.toml")
			text := "name = \"hosts\"\n[services.web]\nmanaged = false\nport = 3000\nhost = " + tc.host + "\n"
			if err := os.WriteFile(path, []byte(text), 0o600); err != nil {
				t.Fatal(err)
			}
			raw, err := ReadManifest(path)
			if err != nil {
				t.Fatal(err)
			}
			_, err = ValidateManifest(path, raw)
			if tc.wantError == "" {
				if err != nil {
					t.Fatal(err)
				}
			} else if err == nil || !strings.Contains(err.Error(), tc.wantError) {
				t.Fatalf("validation error = %v, want %q", err, tc.wantError)
			}
		})
	}
}

func TestManifestChecksEveryHostPath(t *testing.T) {
	for _, tc := range []struct {
		name, path string
		wantError  bool
	}{
		{name: "overlapping alias", path: "/api/*", wantError: true},
		{name: "distinct alias path", path: "/other/*"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := ValidateManifest(filepath.Join(t.TempDir(), "devhost.toml"), RawManifest{value: map[string]any{
				"name": "hosts", "services": map[string]any{
					"web": map[string]any{"managed": false, "port": int64(3000), "host": []any{"app.localhost", "alias.localhost"}, "path": "/api/*"},
					"api": map[string]any{"managed": false, "port": int64(3001), "host": "alias.localhost", "path": tc.path},
				},
			}})
			if (err != nil) != tc.wantError {
				t.Fatalf("validation error = %v", err)
			}
			if tc.wantError && !strings.Contains(err.Error(), "overlaps another routed service") {
				t.Fatalf("error = %v", err)
			}
		})
	}
}
