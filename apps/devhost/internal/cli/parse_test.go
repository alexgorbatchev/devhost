package cli

import (
	"testing"
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
			name:    "parses skill",
			rawArgs: []string{"skill"},
			want: CommandLineArguments{
				Kind: KindSkill,
			},
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
			name:    "parses implicit manifest mode",
			rawArgs: []string{},
			want: CommandLineArguments{
				Kind: KindManifest,
			},
		},
		{
			name:    "parses explicit manifest mode",
			rawArgs: []string{"--manifest", manifestPath},
			want: CommandLineArguments{
				Kind:         KindManifest,
				ManifestPath: &manifestPath,
			},
			comparePath: true,
		},
		{
			name: "parses manifest from environment",
			env: map[string]string{
				"DEVHOST_MANIFEST": manifestPath,
			},
			want: CommandLineArguments{
				Kind:         KindManifest,
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
			rawArgs: []string{"--manifest", "./cli-devhost.toml"},
			env: map[string]string{
				"DEVHOST_MANIFEST": manifestPath,
			},
			want: CommandLineArguments{
				Kind:         KindManifest,
				ManifestPath: pointerToString("./cli-devhost.toml"),
			},
			comparePath: true,
		},
		{
			name:      "rejects extra skill arguments",
			rawArgs:   []string{"skill", "extra"},
			wantError: "unknown command \"extra\" for \"devhost skill\"",
		},
		{
			name:      "rejects missing caddy action",
			rawArgs:   []string{"caddy"},
			wantError: "Expected a caddy action: start, stop, trust, download, privileged-ports, print-root-cert, or trust-remote.",
		},
		{
			name:      "rejects unsupported caddy action",
			rawArgs:   []string{"caddy", "restart"},
			wantError: "unknown command \"restart\" for \"devhost caddy\"",
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
			wantError: "accepts between 0 and 1 arg(s), received 2",
		},
		{
			name:      "rejects extra print root cert arguments",
			rawArgs:   []string{"caddy", "print-root-cert", "now"},
			wantError: "unknown command \"now\" for \"devhost caddy print-root-cert\"",
		},
		{
			name:      "rejects invalid manifest suffix",
			rawArgs:   []string{"--manifest", "./other.toml"},
			wantError: "--manifest must point to a file named devhost.toml, received: ./other.toml",
		},
		{
			name:      "rejects version flag",
			rawArgs:   []string{"--version"},
			wantError: "unknown option: --version",
		},
		{
			name:      "rejects manifest mode child command",
			rawArgs:   []string{"--manifest", manifestPath, "bun"},
			wantError: "unknown command \"bun\" for \"devhost\"",
		},
		{
			name:      "rejects implicit manifest positional quirk",
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

			got, error := ParseCommandLineArguments(tc.rawArgs)
			if tc.wantError != "" {
				if error == nil {
					t.Fatalf("ParseCommandLineArguments(%q) error = nil, want %q", tc.rawArgs, tc.wantError)
				}

				if error.Error() != tc.wantError {
					t.Fatalf("ParseCommandLineArguments(%q) error = %q, want %q", tc.rawArgs, error.Error(), tc.wantError)
				}

				return
			}

			if error != nil {
				t.Fatalf("ParseCommandLineArguments(%q) unexpected error = %v", tc.rawArgs, error)
			}

			if got.Kind != tc.want.Kind || got.Action != tc.want.Action || got.SSHTarget != tc.want.SSHTarget {
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

func pointerToString(value string) *string {
	return &value
}
