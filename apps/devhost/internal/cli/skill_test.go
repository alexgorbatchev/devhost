package cli

import (
	"errors"
	"io"
	"strings"
	"testing"

	cobrahelptree "github.com/alexgorbatchev/cobra-help-tree/v2"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/skill"
)

const skillAlert = "ALERT: Agents must read `AGENT=1 devhost skill` before using this tool.\n"

func TestParseCommandLineArgumentsPrintsTheSkillVerbatim(t *testing.T) {
	for _, agent := range []string{"0", "1"} {
		t.Run("AGENT="+agent, func(t *testing.T) {
			t.Setenv("AGENT", agent)

			var stdout strings.Builder
			var stderr strings.Builder

			got, err := ParseCommandLineArguments([]string{"skill"}, &stdout, &stderr)
			if err != nil {
				t.Fatalf("ParseCommandLineArguments(skill) unexpected error = %v", err)
			}

			if got.Kind != KindSkill {
				t.Fatalf("ParseCommandLineArguments(skill) kind = %q, want %q", got.Kind, KindSkill)
			}

			if stdout.String() != skill.Document() {
				t.Fatalf("ParseCommandLineArguments(skill) stdout is not the embedded SKILL.md byte for byte:\n%s", stdout.String())
			}

			if stderr.String() != "" {
				t.Fatalf("ParseCommandLineArguments(skill) stderr = %q, want empty", stderr.String())
			}
		})
	}
}

func TestParseCommandLineArgumentsRejectsSkillArguments(t *testing.T) {
	t.Parallel()

	var stdout strings.Builder

	_, err := ParseCommandLineArguments([]string{"skill", "extra"}, &stdout, io.Discard)
	if err == nil {
		t.Fatal("ParseCommandLineArguments(skill extra) error = nil, want a rejected argument")
	}

	if want := `unknown command "extra" for "devhost skill"`; err.Error() != want {
		t.Fatalf("ParseCommandLineArguments(skill extra) error = %q, want %q", err.Error(), want)
	}

	if stdout.String() != "" {
		t.Fatalf("ParseCommandLineArguments(skill extra) stdout = %q, want empty", stdout.String())
	}
}

func TestParseCommandLineArgumentsReturnsASkillWriteFailure(t *testing.T) {
	t.Parallel()

	_, err := ParseCommandLineArguments([]string{"skill"}, failingWriter{err: io.ErrClosedPipe}, io.Discard)
	if !errors.Is(err, io.ErrClosedPipe) {
		t.Fatalf("ParseCommandLineArguments(skill) error = %v, want the write failure %v", err, io.ErrClosedPipe)
	}
}

func TestAgentHelpStartsWithTheSkillAlert(t *testing.T) {
	t.Setenv("AGENT", "1")

	// Every help screen an agent can reach, the generated commands included.
	tests := []struct {
		name        string
		rawArgs     []string
		wantCommand string
	}{
		{name: "root", rawArgs: []string{"--help"}, wantCommand: "devhost"},
		{name: "no arguments", rawArgs: []string{}, wantCommand: "devhost"},
		{name: "group", rawArgs: []string{"caddy", "--help"}, wantCommand: "devhost caddy"},
		{name: "group without a command", rawArgs: []string{"caddy"}, wantCommand: "devhost caddy"},
		{name: "command in a group", rawArgs: []string{"caddy", "trust-remote", "--help"}, wantCommand: "devhost caddy trust-remote"},
		{name: "start", rawArgs: []string{"start", "--help"}, wantCommand: "devhost start"},
		{name: "service group", rawArgs: []string{"service"}, wantCommand: "devhost service"},
		{name: "service list", rawArgs: []string{"service", "list", "--help"}, wantCommand: "devhost service list"},
		{name: "stop", rawArgs: []string{"stop", "-h"}, wantCommand: "devhost stop"},
		{name: "skill", rawArgs: []string{"skill", "--help"}, wantCommand: "devhost skill"},
		{name: "generated completion group", rawArgs: []string{"completion", "--help"}, wantCommand: "devhost completion"},
		{name: "generated completion command", rawArgs: []string{"completion", "zsh", "--help"}, wantCommand: "devhost completion zsh"},
		{name: "generated help command", rawArgs: []string{"help", "start"}, wantCommand: "devhost start"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			var stdout strings.Builder

			got, err := ParseCommandLineArguments(tc.rawArgs, &stdout, io.Discard)
			if err != nil {
				t.Fatalf("ParseCommandLineArguments(%q) unexpected error = %v", tc.rawArgs, err)
			}

			if got.Kind != KindHelp {
				t.Fatalf("ParseCommandLineArguments(%q) kind = %q, want %q", tc.rawArgs, got.Kind, KindHelp)
			}

			if want := skillAlert + "command: " + tc.wantCommand + "\n"; !strings.HasPrefix(stdout.String(), want) {
				t.Fatalf("ParseCommandLineArguments(%q) help does not start with %q:\n%s", tc.rawArgs, want, stdout.String())
			}
		})
	}
}

func TestSkillAlertIsForAgentHelpOnly(t *testing.T) {
	tests := []struct {
		name    string
		agent   string
		rawArgs []string
	}{
		{name: "human help", agent: "0", rawArgs: []string{"--help"}},
		{name: "human help of a command", agent: "0", rawArgs: []string{"start", "--help"}},
		{name: "version for an agent", agent: "1", rawArgs: []string{"--version"}},
		{name: "completion script for an agent", agent: "1", rawArgs: []string{"completion", "bash"}},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("AGENT", tc.agent)

			var stdout strings.Builder
			if _, err := ParseCommandLineArguments(tc.rawArgs, &stdout, io.Discard); err != nil {
				t.Fatalf("ParseCommandLineArguments(%q) unexpected error = %v", tc.rawArgs, err)
			}

			if strings.Contains(stdout.String(), "ALERT") {
				t.Fatalf("ParseCommandLineArguments(%q) output carries the alert:\n%s", tc.rawArgs, stdout.String())
			}
		})
	}
}

// The skill is the reference an agent works from, so a command, flag, argument
// or environment variable devhost gains has to reach SKILL.md in the same change,
// and so has a flag's new type or default.
func TestSkillCoversTheWholeInterface(t *testing.T) {
	t.Parallel()

	rootCommand, err := newRootCommand(&CommandLineArguments{}, nil)
	if err != nil {
		t.Fatalf("newRootCommand() unexpected error = %v", err)
	}

	if missing := cobrahelptree.SkillOmissions(rootCommand, createHelpCatalog(), skill.Document()); len(missing) > 0 {
		t.Fatalf("internal/skill/devhost/SKILL.md does not cover:\n  %s", strings.Join(missing, "\n  "))
	}
}

// failingWriter rejects every write, standing in for a closed pipe.
type failingWriter struct{ err error }

func (w failingWriter) Write([]byte) (int, error) {
	return 0, w.err
}
