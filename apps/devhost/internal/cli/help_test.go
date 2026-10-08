package cli

import (
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/version"
)

func TestParseCommandLineArgumentsRendersTreeHelp(t *testing.T) {
	t.Setenv("AGENT", "0")

	tests := []struct {
		name        string
		rawArgs     []string
		wantAll     []string
		wantMissing []string
	}{
		{
			name:    "root help lists the full command tree",
			rawArgs: []string{"--help"},
			wantAll: []string{
				"├─ caddy",
				"│  ├─ download",
				"│  ╰─ trust-remote <ssh-target>",
				"├─ completion",
				"│  ├─ bash",
				"│  ╰─ zsh",
				"├─ start",
				"╰─ stop",
				"--version",
			},
			wantMissing: []string{"--manifest", "DEVHOST_IDLE_TIMEOUT"},
		},
		{
			name:    "completion help lists every supported shell",
			rawArgs: []string{"completion", "--help"},
			wantAll: []string{
				"├─ bash",
				"├─ fish",
				"├─ powershell",
				"╰─ zsh",
			},
			wantMissing: []string{"├─ caddy"},
		},
		{
			name:        "no arguments print root help",
			rawArgs:     []string{},
			wantAll:     []string{"├─ caddy", "├─ start", "╰─ stop"},
			wantMissing: []string{"--manifest"},
		},
		{
			name:    "start help documents every stack flag and environment variable",
			rawArgs: []string{"start", "-h"},
			wantAll: []string{
				"--manifest",
				"-d, --debug",
				"--idle-timeout",
				"DEVHOST_MANIFEST",
				"DEVHOST_IDLE_TIMEOUT",
			},
			wantMissing: []string{"--verbose"},
		},
		{
			name:        "stop help lists only the manifest flag",
			rawArgs:     []string{"stop", "--help"},
			wantAll:     []string{"--manifest", "DEVHOST_MANIFEST"},
			wantMissing: []string{"--debug", "--idle-timeout"},
		},
		{
			name:        "caddy lifecycle help lists only the manifest flag",
			rawArgs:     []string{"caddy", "start", "--help"},
			wantAll:     []string{"--manifest", "DEVHOST_MANIFEST"},
			wantMissing: []string{"--debug", "--idle-timeout"},
		},
		{
			name:    "group help renders only the caddy subtree",
			rawArgs: []string{"caddy", "--help"},
			wantAll: []string{
				"├─ download",
				"├─ print-root-cert",
				"╰─ trust-remote <ssh-target>",
			},
			wantMissing: []string{"├─ caddy", "--idle-timeout"},
		},
		{
			name:        "caddy without an action prints the caddy subtree",
			rawArgs:     []string{"caddy"},
			wantAll:     []string{"├─ download", "╰─ trust-remote <ssh-target>"},
			wantMissing: []string{"├─ caddy"},
		},
		{
			name:    "help wins over an unknown caddy action",
			rawArgs: []string{"caddy", "restart", "--help"},
			wantAll: []string{"╰─ trust-remote <ssh-target>"},
		},
		{
			name:    "leaf help documents its positional argument",
			rawArgs: []string{"caddy", "trust-remote", "--help"},
			wantAll: []string{"Arguments:", "<ssh-target>"},
		},
	}

	for _, tt := range tests {
		tc := tt
		t.Run(tc.name, func(t *testing.T) {
			var stdout strings.Builder
			var stderr strings.Builder

			got, err := ParseCommandLineArguments(tc.rawArgs, &stdout, &stderr)
			if err != nil {
				t.Fatalf("ParseCommandLineArguments(%q) unexpected error = %v", tc.rawArgs, err)
			}

			if got.Kind != KindHelp {
				t.Fatalf("ParseCommandLineArguments(%q) kind = %q, want %q", tc.rawArgs, got.Kind, KindHelp)
			}

			if stderr.String() != "" {
				t.Fatalf("ParseCommandLineArguments(%q) stderr = %q, want empty", tc.rawArgs, stderr.String())
			}

			for _, want := range tc.wantAll {
				if !strings.Contains(stdout.String(), want) {
					t.Fatalf("ParseCommandLineArguments(%q) stdout missing %q:\n%s", tc.rawArgs, want, stdout.String())
				}
			}

			for _, unwanted := range tc.wantMissing {
				if strings.Contains(stdout.String(), unwanted) {
					t.Fatalf("ParseCommandLineArguments(%q) stdout unexpectedly contains %q:\n%s", tc.rawArgs, unwanted, stdout.String())
				}
			}
		})
	}
}

func TestParseCommandLineArgumentsRendersAgentHelp(t *testing.T) {
	t.Setenv("AGENT", "1")

	var stdout strings.Builder
	got, err := ParseCommandLineArguments([]string{"start", "--help"}, &stdout, &strings.Builder{})
	if err != nil {
		t.Fatalf("ParseCommandLineArguments(start --help) unexpected error = %v", err)
	}

	if got.Kind != KindHelp {
		t.Fatalf("ParseCommandLineArguments(start --help) kind = %q, want %q", got.Kind, KindHelp)
	}

	for _, want := range []string{"command: devhost start", "env:", "DEVHOST_IDLE_TIMEOUT", "--idle-timeout"} {
		if !strings.Contains(stdout.String(), want) {
			t.Fatalf("agent help missing %q:\n%s", want, stdout.String())
		}
	}

	if strings.Contains(stdout.String(), "├─") {
		t.Fatalf("agent help contains tree glyphs:\n%s", stdout.String())
	}
}

func TestParseCommandLineArgumentsTrimsHelpToTerminalWidth(t *testing.T) {
	const terminalWidth = 60
	t.Setenv("AGENT", "0")
	t.Setenv("COLUMNS", "60")

	screens := []struct {
		rawArgs  []string
		headings []string
	}{
		{rawArgs: []string{"--help"}, headings: []string{"Available Commands:", "Quickstart:"}},
		{rawArgs: []string{"start", "--help"}, headings: []string{"Environment Variables:"}},
	}

	for _, screen := range screens {
		var stdout strings.Builder
		if _, err := ParseCommandLineArguments(screen.rawArgs, &stdout, &strings.Builder{}); err != nil {
			t.Fatalf("ParseCommandLineArguments(%q) unexpected error = %v", screen.rawArgs, err)
		}

		for _, heading := range screen.headings {
			lines := helpBlockLines(stdout.String(), heading)
			if len(lines) == 0 {
				t.Fatalf("%q help has no %q block:\n%s", screen.rawArgs, heading, stdout.String())
			}

			for _, line := range lines {
				if width := utf8.RuneCountInString(line); width > terminalWidth {
					t.Fatalf("%q %s line is %d columns wide, want at most %d: %q", screen.rawArgs, heading, width, terminalWidth, line)
				}
			}
		}
	}
}

// helpBlockLines returns the lines under heading up to the next blank line.
// Only these blocks are trimmed by cobra-help-tree; long descriptions and the
// trailing hint line are printed verbatim.
func helpBlockLines(help string, heading string) []string {
	_, afterHeading, found := strings.Cut(help, heading+"\n")
	if !found {
		return nil
	}

	block, _, _ := strings.Cut(afterHeading, "\n\n")
	return strings.Split(block, "\n")
}

func TestParseCommandLineArgumentsPrintsVersion(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		rawArgs []string
	}{
		{name: "long version flag", rawArgs: []string{"--version"}},
	}

	for _, tt := range tests {
		tc := tt
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			var stdout strings.Builder
			var stderr strings.Builder

			got, err := ParseCommandLineArguments(tc.rawArgs, &stdout, &stderr)
			if err != nil {
				t.Fatalf("ParseCommandLineArguments(%q) unexpected error = %v", tc.rawArgs, err)
			}

			if got.Kind != KindVersion {
				t.Fatalf("ParseCommandLineArguments(%q) kind = %q, want %q", tc.rawArgs, got.Kind, KindVersion)
			}

			if stdout.String() != version.String()+"\n" {
				t.Fatalf("ParseCommandLineArguments(%q) stdout = %q, want %q", tc.rawArgs, stdout.String(), version.String()+"\n")
			}

			if stderr.String() != "" {
				t.Fatalf("ParseCommandLineArguments(%q) stderr = %q, want empty", tc.rawArgs, stderr.String())
			}
		})
	}
}
