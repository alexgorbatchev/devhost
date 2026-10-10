package manifest

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestHealthConfiguration(t *testing.T) {
	for _, tc := range []struct {
		name      string
		port      any
		health    map[string]any
		wantError string
	}{
		{name: "auto timing", port: "auto", health: map[string]any{"timeout": int64(60000)}},
		{name: "fixed timing", port: int64(3000), health: map[string]any{"interval": int64(250), "retries": int64(3)}},
		{name: "empty inherits TCP", port: "auto", health: map[string]any{}},
		{name: "auto explicit TCP", port: "auto", health: map[string]any{"tcp": int64(5432)}},
		{name: "auto HTTP shorthand", port: "auto", health: map[string]any{"http": "/health?ready=1"}},
		{name: "auto HTTP template", port: "auto", health: map[string]any{"http": "http://127.0.0.1:{{ services.web.port }}/health"}},
		{name: "auto URL builder", port: "auto", health: map[string]any{"http": "{{ services.web.url }}/health"}},
		{name: "timing needs port", health: map[string]any{"timeout": int64(60000)}, wantError: "must define a probe or a service port"},
		{name: "shorthand needs port", health: map[string]any{"http": "/health"}, wantError: "requires services.web.port"},
		{name: "multiple probes", port: "auto", health: map[string]any{"tcp": int64(5432), "process": true}, wantError: "at most one"},
		{name: "invalid timeout", port: "auto", health: map[string]any{"timeout": int64(0)}, wantError: "timeout must be an integer >= 1"},
		{name: "network path", port: "auto", health: map[string]any{"http": "//example.com/health"}, wantError: "absolute URL"},
		{name: "relative path", port: "auto", health: map[string]any{"http": "health"}, wantError: "absolute URL"},
		{name: "malformed path", port: "auto", health: map[string]any{"http": "/%zz"}, wantError: "URL"},
		{name: "unsupported scheme", port: "auto", health: map[string]any{"http": "ftp://127.0.0.1/health"}, wantError: "http or https"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			service := map[string]any{"command": []any{"server"}, "health": tc.health}
			if tc.port != nil {
				service["port"] = tc.port
			}
			got, err := ValidateManifest(filepath.Join(t.TempDir(), "devhost.toml"), RawManifest{value: map[string]any{
				"name": "health-tests", "services": map[string]any{"web": service},
			}})
			if tc.wantError != "" {
				if err == nil || !strings.Contains(err.Error(), tc.wantError) {
					t.Fatalf("validation error = %v, want %q", err, tc.wantError)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if got.Services["web"].Health == nil {
				t.Fatal("health configuration was discarded")
			}
		})
	}
}
