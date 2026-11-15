package services

import (
	"os"
	"slices"
	"testing"
)

func TestTakeLaunchMetadataRemovesThePrivateVariables(t *testing.T) {
	tests := []struct {
		name      string
		variables map[string]string
		want      LaunchMetadata
	}{
		{"detached start", map[string]string{DetachedLogEnvironment: "/state/logs/stack.log"}, LaunchMetadata{LogPath: "/state/logs/stack.log", Detached: true}},
		{"restart replacement", map[string]string{StackLogEnvironment: "/state/restart-1/2.log"}, LaunchMetadata{LogPath: "/state/restart-1/2.log"}},
		{"foreground start", map[string]string{}, LaunchMetadata{}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			environment := map[string]string{"KEPT": "value"}
			for name, value := range tt.variables {
				t.Setenv(name, value)
				environment[name] = value
			}
			if got := TakeLaunchMetadata(environment); got != tt.want {
				t.Fatalf("TakeLaunchMetadata() = %+v, want %+v", got, tt.want)
			}
			if len(environment) != 1 || environment["KEPT"] != "value" {
				t.Fatalf("environment = %v, want only KEPT", environment)
			}
			for _, name := range []string{DetachedLogEnvironment, StackLogEnvironment} {
				if _, ok := os.LookupEnv(name); ok {
					t.Fatalf("%s is still in the process environment", name)
				}
			}
		})
	}
}

func TestReplaceLaunchLogStartsReplacementsWithoutStrictStartup(t *testing.T) {
	const next = "/state/restart-2/3.log"
	tests := []struct {
		name        string
		environment []string
		want        []string
	}{
		{"detached start", []string{"A=1", DetachedLogEnvironment + "=/state/logs/stack.log", "B=2"}, []string{"A=1", "B=2", StackLogEnvironment + "=" + next}},
		{"earlier replacement", []string{StackLogEnvironment + "=/state/restart-1/2.log", "A=1"}, []string{"A=1", StackLogEnvironment + "=" + next}},
		{"foreground start", []string{"A=1"}, []string{"A=1"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			captured := slices.Clone(tt.environment)
			if got := replaceLaunchLog(captured, next); !slices.Equal(got, tt.want) {
				t.Fatalf("replaceLaunchLog() = %q, want %q", got, tt.want)
			}
			if !slices.Equal(captured, tt.environment) {
				t.Fatalf("captured environment changed to %q", captured)
			}
		})
	}
}
