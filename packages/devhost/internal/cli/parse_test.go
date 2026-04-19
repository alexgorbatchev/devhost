package cli

import (
	"testing"
)

func TestParseCommandLineArguments(t *testing.T) {
	t.Parallel()

	manifestPath := "./devhost.toml"

	tests := []struct {
		name        string
		rawArgs     []string
		want        CommandLineArguments
		wantError   string
		comparePath bool
	}{
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
			name:      "rejects missing caddy action",
			rawArgs:   []string{"caddy"},
			wantError: "Expected a caddy action: start, stop, trust, download, privileged-ports, print-root-cert, or trust-remote.",
		},
		{
			name:      "rejects unsupported caddy action",
			rawArgs:   []string{"caddy", "restart"},
			wantError: "Unsupported caddy action: restart",
		},
		{
			name:      "rejects extra lifecycle arguments",
			rawArgs:   []string{"caddy", "start", "now"},
			wantError: "Caddy lifecycle commands do not accept additional arguments.",
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
			wantError: "The caddy trust-remote command accepts exactly one SSH target.",
		},
		{
			name:      "rejects manifest on trust remote",
			rawArgs:   []string{"--manifest", manifestPath, "caddy", "trust-remote", "devbox"},
			wantError: "The caddy trust-remote command does not accept --manifest.",
		},
		{
			name:      "rejects extra print root cert arguments",
			rawArgs:   []string{"caddy", "print-root-cert", "now"},
			wantError: "The caddy print-root-cert command does not accept additional arguments.",
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
			name:      "rejects manifest mode child after dash dash",
			rawArgs:   []string{"--manifest", manifestPath, "--", "bun"},
			wantError: "Manifest mode does not accept a child command.",
		},
		{
			name:      "rejects manifest mode child command",
			rawArgs:   []string{"--manifest", manifestPath, "bun"},
			wantError: "Manifest mode does not accept a child command.",
		},
		{
			name:    "keeps implicit manifest positional quirk",
			rawArgs: []string{"bun"},
			want: CommandLineArguments{
				Kind: KindManifest,
			},
		},
	}

	for _, tt := range tests {
		tc := tt
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

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
