package manifest

import (
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestValidateManifestResolvesDevtoolsResources(t *testing.T) {
	t.Parallel()

	on := func(pollInterval time.Duration) DevtoolsResourceConfig {
		return DevtoolsResourceConfig{Enabled: true, PollInterval: pollInterval}
	}
	tests := []struct {
		name      string
		resources map[string]any
		want      DevtoolsResourcesConfig
	}{
		{
			name: "is on with disk polled less often when the table is absent",
			want: DevtoolsResourcesConfig{Enabled: true, CPU: on(2 * time.Second), Memory: on(2 * time.Second), Disk: on(time.Minute)},
		},
		{
			name:      "applies the shared poll interval to every readout",
			resources: map[string]any{"pollInterval": "5s"},
			want:      DevtoolsResourcesConfig{Enabled: true, CPU: on(5 * time.Second), Memory: on(5 * time.Second), Disk: on(5 * time.Second)},
		},
		{
			name: "lets a readout override the shared poll interval",
			resources: map[string]any{
				"pollInterval": "5s",
				"cpu":          map[string]any{"pollInterval": "1s"},
				"disk":         map[string]any{"pollInterval": "10m"},
			},
			want: DevtoolsResourcesConfig{Enabled: true, CPU: on(time.Second), Memory: on(5 * time.Second), Disk: on(10 * time.Minute)},
		},
		{
			name:      "turns one readout off",
			resources: map[string]any{"memory": map[string]any{"enabled": false}},
			want: DevtoolsResourcesConfig{
				Enabled: true,
				CPU:     on(2 * time.Second),
				Memory:  DevtoolsResourceConfig{Enabled: false, PollInterval: 2 * time.Second},
				Disk:    on(time.Minute),
			},
		},
		{
			name:      "turns every readout off",
			resources: map[string]any{"enabled": false},
			want:      DevtoolsResourcesConfig{Enabled: false, CPU: on(2 * time.Second), Memory: on(2 * time.Second), Disk: on(time.Minute)},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			devtools := map[string]any{}
			if tt.resources != nil {
				devtools["resources"] = tt.resources
			}
			manifest, err := ValidateManifest(
				filepath.Join(string(filepath.Separator), "tmp", "project", "devhost.toml"),
				rawManifestWithServices(map[string]any{"devtools": devtools}),
			)
			if err != nil {
				t.Fatalf("ValidateManifest(...) unexpected error = %v", err)
			}
			if got := manifest.Devtools.Resources; got != tt.want {
				t.Fatalf("manifest.Devtools.Resources = %+v, want %+v", got, tt.want)
			}
		})
	}
}

func TestValidateManifestRejectsInvalidDevtoolsResources(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name      string
		resources map[string]any
		wantError string
	}{
		{
			name:      "a poll interval that is not a duration",
			resources: map[string]any{"pollInterval": "often"},
			wantError: "devtools.resources.pollInterval must be a valid duration",
		},
		{
			name:      "a readout poll interval below the minimum",
			resources: map[string]any{"cpu": map[string]any{"pollInterval": "10ms"}},
			wantError: "devtools.resources.cpu.pollInterval must be at least 250ms.",
		},
		{
			name:      "a poll interval given as a number",
			resources: map[string]any{"disk": map[string]any{"pollInterval": int64(2000)}},
			wantError: "devtools.resources.disk.pollInterval must be a duration string",
		},
		{
			name:      "an unknown readout",
			resources: map[string]any{"network": map[string]any{"enabled": true}},
			wantError: `devtools.resources Unrecognized key: "network"`,
		},
		{
			name:      "an unknown readout key",
			resources: map[string]any{"memory": map[string]any{"interval": "2s"}},
			wantError: `devtools.resources.memory Unrecognized key: "interval"`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			_, err := ValidateManifest(
				filepath.Join(string(filepath.Separator), "tmp", "project", "devhost.toml"),
				rawManifestWithServices(map[string]any{"devtools": map[string]any{"resources": tt.resources}}),
			)
			if err == nil || !strings.Contains(err.Error(), tt.wantError) {
				t.Fatalf("ValidateManifest(...) error = %v, want it to contain %q", err, tt.wantError)
			}
		})
	}
}
