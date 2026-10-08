package cli

import (
	"errors"
	"io"
	"testing"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/cliout"
)

func TestParseCommandLineArguments(t *testing.T) {
	manifestPath := "./devhost.toml"

	tests := []struct {
		name        string
		rawArgs     []string
		env         map[string]string
		want        CommandLineArguments
		wantError   string
		comparePath bool
	}{
		{
			name:    "parses stop command",
			rawArgs: []string{"stop"},
			want: CommandLineArguments{
				Kind: KindStop,
			},
		},
		{
			name:    "parses stop command with explicit manifest",
			rawArgs: []string{"stop", "--manifest", manifestPath},
			want: CommandLineArguments{
				Kind:         KindStop,
				ManifestPath: &manifestPath,
			},
			comparePath: true,
		},
		{
			name:    "parses stop command manifest from environment",
			rawArgs: []string{"stop"},
			env: map[string]string{
				"DEVHOST_MANIFEST": manifestPath,
			},
			want: CommandLineArguments{
				Kind:         KindStop,
				ManifestPath: &manifestPath,
			},
			comparePath: true,
		},
		{
			name:      "rejects stack-only flags on stop",
			rawArgs:   []string{"stop", "--debug"},
			wantError: "unknown option: --debug",
		},
		{
			name:      "rejects stack-only flags on caddy lifecycle commands",
			rawArgs:   []string{"caddy", "start", "--idle-timeout", "1m"},
			wantError: "unknown option: --idle-timeout",
		},
		{
			name:      "rejects invalid stop manifest suffix",
			rawArgs:   []string{"stop", "--manifest", "./other.toml"},
			wantError: "--manifest must point to a file named devhost.toml, received: ./other.toml",
		},
		{
			name:    "parses caddy start",
			rawArgs: []string{"caddy", "start"},
			want: CommandLineArguments{
				Action: CaddyStart,
				Kind:   KindCaddyLifecycle,
			},
		},
		{
			name:    "parses caddy lifecycle with explicit manifest",
			rawArgs: []string{"caddy", "start", "--manifest", manifestPath},
			want: CommandLineArguments{
				Action:       CaddyStart,
				Kind:         KindCaddyLifecycle,
				ManifestPath: &manifestPath,
			},
			comparePath: true,
		},
		{
			name:    "parses root manifest before caddy subcommand",
			rawArgs: []string{"--manifest", manifestPath, "caddy", "start"},
			want: CommandLineArguments{
				Action:       CaddyStart,
				Kind:         KindCaddyLifecycle,
				ManifestPath: &manifestPath,
			},
			comparePath: true,
		},
		{
			name:    "parses print root cert",
			rawArgs: []string{"caddy", "print-root-cert"},
			want: CommandLineArguments{
				Kind: KindCaddyPrintRootCert,
			},
		},
		{
			name:    "parses trust remote",
			rawArgs: []string{"caddy", "trust-remote", "devbox"},
			want: CommandLineArguments{
				Kind:      KindCaddyTrustRemote,
				SSHTarget: "devbox",
			},
		},
		{
			name:    "parses version flag",
			rawArgs: []string{"--version"},
			want: CommandLineArguments{
				Kind: KindVersion,
			},
		},
		{
			name:    "parses start command",
			rawArgs: []string{"start"},
			want: CommandLineArguments{
				Kind: KindStart,
			},
		},
		{
			name:    "parses start command with explicit manifest",
			rawArgs: []string{"start", "--manifest", manifestPath},
			want: CommandLineArguments{
				Kind:         KindStart,
				ManifestPath: &manifestPath,
			},
			comparePath: true,
		},
		{
			name:    "parses debug start",
			rawArgs: []string{"start", "--debug"},
			want: CommandLineArguments{
				Kind:  KindStart,
				Debug: true,
			},
		},
		{
			name:    "parses idle-timeout flag",
			rawArgs: []string{"start", "--idle-timeout", "1h"},
			want: CommandLineArguments{
				Kind:        KindStart,
				IdleTimeout: "1h",
			},
		},
		{
			name: "parses idle-timeout from environment",
			env: map[string]string{
				"DEVHOST_IDLE_TIMEOUT": "30s",
			},
			rawArgs: []string{"start"},
			want: CommandLineArguments{
				Kind:        KindStart,
				IdleTimeout: "30s",
			},
		},
		{
			name:    "parses manifest from environment",
			rawArgs: []string{"start"},
			env: map[string]string{
				"DEVHOST_MANIFEST": manifestPath,
			},
			want: CommandLineArguments{
				Kind:         KindStart,
				ManifestPath: &manifestPath,
			},
			comparePath: true,
		},
		{
			name:    "parses caddy lifecycle manifest from environment",
			rawArgs: []string{"caddy", "start"},
			env: map[string]string{
				"DEVHOST_MANIFEST": manifestPath,
			},
			want: CommandLineArguments{
				Action:       CaddyStart,
				Kind:         KindCaddyLifecycle,
				ManifestPath: &manifestPath,
			},
			comparePath: true,
		},
		{
			name:    "cli manifest overrides environment",
			rawArgs: []string{"start", "--manifest", "./cli-devhost.toml"},
			env: map[string]string{
				"DEVHOST_MANIFEST": manifestPath,
			},
			want: CommandLineArguments{
				Kind:         KindStart,
				ManifestPath: pointerToString("./cli-devhost.toml"),
			},
			comparePath: true,
		},
		{
			name:    "parses skill command",
			rawArgs: []string{"skill"},
			want: CommandLineArguments{
				Kind: KindSkill,
			},
		},
		{
			name:      "suggests the caddy action an unsupported one resembles",
			rawArgs:   []string{"caddy", "restart"},
			wantError: "unknown command \"restart\" for \"devhost caddy\"; did you mean \"start\"?",
		},
		{
			name:      "suggests every root command a mistyped one resembles",
			rawArgs:   []string{"star"},
			wantError: "unknown command \"star\" for \"devhost\"; did you mean \"start\" or \"stop\"?",
		},
		{
			name:      "suggests the commands an abbreviation begins",
			rawArgs:   []string{"caddy", "tru"},
			wantError: "unknown command \"tru\" for \"devhost caddy\"; did you mean \"trust\" or \"trust-remote\"?",
		},
		{
			name:      "rejects extra lifecycle arguments",
			rawArgs:   []string{"caddy", "start", "now"},
			wantError: "unknown command \"now\" for \"devhost caddy start\"",
		},
		{
			name:      "rejects invalid caddy manifest suffix",
			rawArgs:   []string{"--manifest", "./other.toml", "caddy", "start"},
			wantError: "--manifest must point to a file named devhost.toml, received: ./other.toml",
		},
		{
			name:      "rejects missing trust remote target",
			rawArgs:   []string{"caddy", "trust-remote"},
			wantError: "Expected an SSH target. Example: devhost caddy trust-remote devbox",
		},
		{
			name:      "rejects extra trust remote arguments",
			rawArgs:   []string{"caddy", "trust-remote", "devbox", "extra"},
			wantError: "accepts 1 arg(s), received 2",
		},
		{
			name:      "rejects extra print root cert arguments",
			rawArgs:   []string{"caddy", "print-root-cert", "now"},
			wantError: "unknown command \"now\" for \"devhost caddy print-root-cert\"",
		},
		{
			name:      "rejects invalid start manifest suffix",
			rawArgs:   []string{"start", "--manifest", "./other.toml"},
			wantError: "--manifest must point to a file named devhost.toml, received: ./other.toml",
		},
		{
			name:      "rejects start positional arguments",
			rawArgs:   []string{"start", "--manifest", manifestPath, "bun"},
			wantError: "unknown command \"bun\" for \"devhost start\"",
		},
		{
			name:      "rejects stack flags on the root command",
			rawArgs:   []string{"--manifest", manifestPath},
			wantError: "unknown option: --manifest",
		},
		{
			name:      "rejects unknown root command",
			rawArgs:   []string{"bun"},
			wantError: "unknown command \"bun\" for \"devhost\"",
		},
	}

	for _, tt := range tests {
		tc := tt
		t.Run(tc.name, func(t *testing.T) {
			if len(tc.env) == 0 {
				t.Parallel()
			}

			for key, value := range tc.env {
				t.Setenv(key, value)
			}

			got, err := ParseCommandLineArguments(tc.rawArgs, io.Discard, io.Discard)
			if tc.wantError != "" {
				if err == nil {
					t.Fatalf("ParseCommandLineArguments(%q) error = nil, want %q", tc.rawArgs, tc.wantError)
				}

				if err.Error() != tc.wantError {
					t.Fatalf("ParseCommandLineArguments(%q) error = %q, want %q", tc.rawArgs, err.Error(), tc.wantError)
				}

				return
			}

			if err != nil {
				t.Fatalf("ParseCommandLineArguments(%q) unexpected error = %v", tc.rawArgs, err)
			}

			if got.Kind != tc.want.Kind || got.Action != tc.want.Action || got.SSHTarget != tc.want.SSHTarget || got.Debug != tc.want.Debug || got.IdleTimeout != tc.want.IdleTimeout {
				t.Fatalf("ParseCommandLineArguments(%q) = %#v, want %#v", tc.rawArgs, got, tc.want)
			}

			if !tc.comparePath {
				if got.ManifestPath != nil {
					t.Fatalf("ParseCommandLineArguments(%q) manifestPath = %q, want nil", tc.rawArgs, *got.ManifestPath)
				}
				return
			}

			if got.ManifestPath == nil {
				t.Fatalf("ParseCommandLineArguments(%q) manifestPath = nil, want %q", tc.rawArgs, *tc.want.ManifestPath)
			}

			if *got.ManifestPath != *tc.want.ManifestPath {
				t.Fatalf("ParseCommandLineArguments(%q) manifestPath = %q, want %q", tc.rawArgs, *got.ManifestPath, *tc.want.ManifestPath)
			}
		})
	}
}

func TestParseCommandLineArgumentsPointsAtTheHelpOfTheCommandThatFailed(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		rawArgs  []string
		wantHint string
	}{
		{name: "unknown root command", rawArgs: []string{"bun"}, wantHint: `Run "devhost --help" for usage.`},
		{name: "unknown command in a group", rawArgs: []string{"caddy", "restart"}, wantHint: `Run "devhost caddy --help" for usage.`},
		{name: "unknown option", rawArgs: []string{"start", "--bogus"}, wantHint: `Run "devhost start --help" for usage.`},
		{name: "option without its value", rawArgs: []string{"stop", "--manifest"}, wantHint: `Run "devhost stop --help" for usage.`},
		{name: "missing argument", rawArgs: []string{"caddy", "trust-remote"}, wantHint: `Run "devhost caddy trust-remote --help" for usage.`},
		{name: "rejected option value", rawArgs: []string{"start", "--manifest", "./other.toml"}, wantHint: `Run "devhost start --help" for usage.`},
	}

	for _, tt := range tests {
		tc := tt
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			_, err := ParseCommandLineArguments(tc.rawArgs, io.Discard, io.Discard)

			var failure *cliout.Failure
			if !errors.As(err, &failure) {
				t.Fatalf("ParseCommandLineArguments(%q) error = %v, want a failure with a hint", tc.rawArgs, err)
			}

			if failure.Hint != tc.wantHint {
				t.Fatalf("ParseCommandLineArguments(%q) hint = %q, want %q", tc.rawArgs, failure.Hint, tc.wantHint)
			}
		})
	}
}

func pointerToString(value string) *string {
	return &value
}
