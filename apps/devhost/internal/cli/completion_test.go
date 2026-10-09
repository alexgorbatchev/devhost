package cli

import (
	"strings"
	"testing"
)

func TestParseCommandLineArgumentsRunsShellCompletion(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		rawArgs    []string
		wantStdout []string
	}{
		{
			name:       "bash script registers itself for devhost",
			rawArgs:    []string{"completion", "bash"},
			wantStdout: []string{"complete -o default -F __start_devhost devhost"},
		},
		{
			name:       "zsh script registers itself for devhost",
			rawArgs:    []string{"completion", "zsh"},
			wantStdout: []string{"compdef _devhost devhost"},
		},
		{
			name:       "fish script registers itself for devhost",
			rawArgs:    []string{"completion", "fish"},
			wantStdout: []string{"complete -c devhost"},
		},
		{
			name:       "powershell script registers itself for devhost",
			rawArgs:    []string{"completion", "powershell"},
			wantStdout: []string{"Register-ArgumentCompleter -CommandName 'devhost'"},
		},
		{
			name:    "request lists the root commands with their descriptions",
			rawArgs: []string{"__complete", ""},
			wantStdout: []string{
				"caddy\tSet up and control the shared HTTPS proxy\n",
				"completion\t",
				"stack\tInspect the stacks running on this machine\n",
				"start\tStart the services in devhost.toml\n",
				"stop\tStop the running stack for this project\n",
			},
		},
		{
			name:       "request lists the subcommands of a group",
			rawArgs:    []string{"__complete", "caddy", ""},
			wantStdout: []string{"download\t", "trust-remote\t"},
		},
		{
			name:       "request without descriptions lists names only",
			rawArgs:    []string{"__completeNoDesc", ""},
			wantStdout: []string{"caddy\n", "start\n", "stop\n"},
		},
	}

	for _, tt := range tests {
		tc := tt
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			var stdout strings.Builder

			got, err := ParseCommandLineArguments(tc.rawArgs, &stdout, &strings.Builder{})
			if err != nil {
				t.Fatalf("ParseCommandLineArguments(%q) unexpected error = %v", tc.rawArgs, err)
			}

			if got.Kind != KindCompletion {
				t.Fatalf("ParseCommandLineArguments(%q) kind = %q, want %q", tc.rawArgs, got.Kind, KindCompletion)
			}

			for _, want := range tc.wantStdout {
				if !strings.Contains(stdout.String(), want) {
					t.Fatalf("ParseCommandLineArguments(%q) stdout missing %q:\n%s", tc.rawArgs, want, stdout.String())
				}
			}
		})
	}
}
