package manifest

import (
	"path/filepath"
	"testing"
)

func TestProxyLocalOriginValidation(t *testing.T) {
	for _, tc := range []struct {
		name      string
		value     any
		routed    bool
		wantError bool
	}{
		{name: "omitted", routed: true},
		{name: "enabled", value: true, routed: true},
		{name: "disabled", value: false, routed: true},
		{name: "wrong type", value: "true", routed: true, wantError: true},
		{name: "unrouted", value: true, wantError: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			service := map[string]any{"command": []any{"server"}, "port": 3000}
			if tc.routed {
				service["host"] = "app.example.test"
			}
			if tc.value != nil {
				service["proxyLocalOrigin"] = tc.value
			}
			raw := RawManifest{value: map[string]any{"name": "proxy", "services": map[string]any{"web": service}}}
			got, err := ValidateManifest(filepath.Join(t.TempDir(), "devhost.toml"), raw)
			if (err != nil) != tc.wantError {
				t.Fatalf("validation = %v, wantError %v", err, tc.wantError)
			}
			if !tc.wantError && got.Services["web"].ProxyLocalOrigin != (tc.value == true) {
				t.Fatal("proxyLocalOrigin not retained")
			}
		})
	}
}
