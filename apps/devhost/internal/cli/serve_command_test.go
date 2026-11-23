package cli

import (
	"io"
	"slices"
	"testing"
	"time"
)

func TestServeCommandArguments(t *testing.T) {
	for _, test := range []struct {
		args     []string
		command  []string
		detached bool
	}{
		{[]string{"serve", "bun start.ts"}, []string{"/bin/sh", "-c", "bun start.ts"}, false},
		{[]string{"serve", "--detach", "--name", "demo", "--", "bun", "start.ts", "--port", "3000"}, []string{"bun", "start.ts", "--port", "3000"}, true},
	} {
		got, err := ParseCommandLineArguments(test.args, io.Discard, io.Discard)
		if err != nil {
			t.Fatal(err)
		}
		if !slices.Equal(got.Command, test.command) || got.Detach != test.detached || got.StartupTimeout != 30*time.Second {
			t.Fatalf("arguments: %#v", got)
		}
	}
	for _, args := range [][]string{
		{"serve", "bun", "start.ts"}, {"serve", ""}, {"serve", "--detach", "--domain", "demo.localhost"},
		{"serve", "--name", "demo"}, {"serve", "--startup-timeout", "0s", "bun start.ts"},
		{"serve", "--port", "3000", "bun start.ts"}, {"serve", "--dir", ".", "bun start.ts"},
	} {
		if _, err := ParseCommandLineArguments(args, io.Discard, io.Discard); err == nil {
			t.Fatalf("accepted %v", args)
		}
	}
	t.Setenv("DEVHOST_MANIFEST", "/other/devhost.toml")
	for _, args := range [][]string{{"stop", "--session", "app-id"}, {"stack", "info", "--session", "app-id"}} {
		got, err := ParseCommandLineArguments(args, io.Discard, io.Discard)
		if err != nil || got.Session != "app-id" || got.ManifestPath != nil {
			t.Fatalf("session %v: %#v %v", args, got, err)
		}
	}
}
