package services

import (
	"testing"
	"time"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/hostusage"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/manifest"
)

func TestResolveResourceIntervals(t *testing.T) {
	t.Parallel()

	readout := func(enabled bool, pollInterval time.Duration) manifest.DevtoolsResourceConfig {
		return manifest.DevtoolsResourceConfig{Enabled: enabled, PollInterval: pollInterval}
	}
	tests := []struct {
		name   string
		config manifest.DevtoolsResourcesConfig
		want   hostusage.Intervals
	}{
		{
			name: "polls every enabled readout at its interval",
			config: manifest.DevtoolsResourcesConfig{
				Enabled: true,
				CPU:     readout(true, time.Second),
				Memory:  readout(true, 2*time.Second),
				Disk:    readout(true, time.Minute),
			},
			want: hostusage.Intervals{CPU: time.Second, Memory: 2 * time.Second, Disk: time.Minute},
		},
		{
			name: "leaves a disabled readout unpolled",
			config: manifest.DevtoolsResourcesConfig{
				Enabled: true,
				CPU:     readout(true, time.Second),
				Memory:  readout(false, 2*time.Second),
				Disk:    readout(true, time.Minute),
			},
			want: hostusage.Intervals{CPU: time.Second, Disk: time.Minute},
		},
		{
			name: "polls nothing when resources are off",
			config: manifest.DevtoolsResourcesConfig{
				Enabled: false,
				CPU:     readout(true, time.Second),
				Memory:  readout(true, 2*time.Second),
				Disk:    readout(true, time.Minute),
			},
			want: hostusage.Intervals{},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			if got := resolveResourceIntervals(tt.config); got != tt.want {
				t.Fatalf("resolveResourceIntervals(...) = %+v, want %+v", got, tt.want)
			}
		})
	}
}
