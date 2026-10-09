package manifest

import (
	"path/filepath"
	"testing"
)

func TestAlwaysStartValidation(t *testing.T) {
	for _, tc := range []struct {
		name      string
		value     any
		want      bool
		wantError bool
	}{
		{name: "omitted"},
		{name: "enabled", value: true, want: true},
		{name: "disabled", value: false},
		{name: "wrong type", value: "true", wantError: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			service := map[string]any{"command": []any{"server"}, "port": 3000}
			if tc.value != nil {
				service["alwaysStart"] = tc.value
			}
			raw := RawManifest{value: map[string]any{"name": "slice", "services": map[string]any{"db": service}}}
			got, err := ValidateManifest(filepath.Join(t.TempDir(), "devhost.toml"), raw)
			if (err != nil) != tc.wantError {
				t.Fatalf("validation = %v, wantError %v", err, tc.wantError)
			}
			if !tc.wantError && got.Services["db"].AlwaysStart != tc.want {
				t.Fatalf("AlwaysStart = %t, want %t", got.Services["db"].AlwaysStart, tc.want)
			}
		})
	}
}
