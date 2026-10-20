package caddy

import (
	"strings"
	"testing"
)

func TestReloadCommandOutput(t *testing.T) {
	previous := routeMutationRunManagedCaddyCommand
	t.Cleanup(func() { routeMutationRunManagedCaddyCommand = previous })
	for _, tc := range []struct {
		name           string
		success, quiet bool
		stdout, stderr string
	}{
		{name: "quiet success", success: true, quiet: true},
		{name: "verbose success", success: true, stdout: "[devhost] response\n", stderr: "[devhost] diagnostic\n"},
		{name: "quiet failure", quiet: true, stderr: "[devhost] diagnostic\n[devhost] response\n"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			routeMutationRunManagedCaddyCommand = func(Paths, []string, ManagedCaddyCommandOptions) CommandResult {
				return CommandResult{Success: tc.success, Stdout: []byte("response"), Stderr: []byte("diagnostic\n")}
			}
			var stdout, stderr strings.Builder
			err := reloadManagedCaddy("127.0.0.1:20197", t.TempDir(), RouteCommandOutputWriters{StdoutWriter: &stdout, StderrWriter: &stderr, Quiet: tc.quiet})
			if (err == nil) != tc.success {
				t.Fatalf("err = %v", err)
			}
			if stdout.String() != tc.stdout || stderr.String() != tc.stderr {
				t.Fatalf("stdout=%q stderr=%q", stdout.String(), stderr.String())
			}
			if err != nil && (strings.Contains(err.Error(), "diagnostic") && !strings.Contains(err.Error(), "above")) {
				t.Fatalf("diagnostics duplicated in error: %v", err)
			}
		})
	}
}
