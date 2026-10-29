package cli

import (
	"errors"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	cobrahelptree "github.com/alexgorbatchev/cobra-help-tree/v3"
	"github.com/spf13/cobra"
)

const skillAlert = "ALERT: Agents must read `AGENT=1 devhost skill` before using this tool.\n"

// skillInstructions is what devhost skill prints, in both modes.
const skillInstructions = `Install the devhost skill using the Skills CLI:

  npx skills add alexgorbatchev/devhost --skill devhost

Skill:

  https://github.com/alexgorbatchev/devhost/tree/main/skills/devhost
`

// repositoryRoot is the checkout root, relative to this package.
var repositoryRoot = filepath.Join("..", "..", "..", "..")

// skillDirectory holds the skill that devhost skill points to.
var skillDirectory = filepath.Join(repositoryRoot, "skills", "devhost")

// negativeInstruction matches the wordings that tell a reader what to leave
// undone. The skill is read by agents working in other people's projects, so it
// states what to do and what devhost does; rules for contributors live in the
// AGENTS.md files.
var negativeInstruction = regexp.MustCompile(`(?i)\b(do not|don't|never|must not|should not|shouldn't|avoid|refrain)\b`)

func readSkillFile(t *testing.T, path string) string {
	t.Helper()

	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}

	return string(content)
}

// frontmatterName returns the name field of the YAML frontmatter that opens
// document, or "" when the document has no such field.
func frontmatterName(document string) string {
	body, found := strings.CutPrefix(document, "---\n")
	if !found {
		return ""
	}

	frontmatter, _, found := strings.Cut(body, "\n---\n")
	if !found {
		return ""
	}

	for line := range strings.SplitSeq(frontmatter, "\n") {
		if name, found := strings.CutPrefix(line, "name:"); found {
			return strings.TrimSpace(name)
		}
	}

	return ""
}

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

			if stdout.String() != skillInstructions {
				t.Fatalf("ParseCommandLineArguments(skill) stdout = %q, want %q", stdout.String(), skillInstructions)
			}

			if stderr.String() != "" {
				t.Fatalf("ParseCommandLineArguments(skill) stderr = %q, want empty", stderr.String())
			}
		})
	}
}

func TestParseCommandLineArgumentsRejectsSkillArguments(t *testing.T) {
	tests := []struct {
		name    string
		rawArgs []string
		wantErr string
	}{
		{name: "argument", rawArgs: []string{"skill", "extra"}, wantErr: `unknown command "extra" for "devhost skill"`},
		{name: "flag", rawArgs: []string{"skill", "--manifest", "devhost.toml"}, wantErr: "unknown option: --manifest"},
	}

	for _, agent := range []string{"0", "1"} {
		for _, tc := range tests {
			t.Run("AGENT="+agent+"/"+tc.name, func(t *testing.T) {
				t.Setenv("AGENT", agent)

				var stdout strings.Builder

				_, err := ParseCommandLineArguments(tc.rawArgs, &stdout, io.Discard)
				if err == nil {
					t.Fatalf("ParseCommandLineArguments(%q) error = nil, want %q", tc.rawArgs, tc.wantErr)
				}

				if err.Error() != tc.wantErr {
					t.Fatalf("ParseCommandLineArguments(%q) error = %q, want %q", tc.rawArgs, err.Error(), tc.wantErr)
				}

				if stdout.String() != "" {
					t.Fatalf("ParseCommandLineArguments(%q) stdout = %q, want empty", tc.rawArgs, stdout.String())
				}
			})
		}
	}
}

func TestParseCommandLineArgumentsReturnsASkillWriteFailure(t *testing.T) {
	t.Parallel()

	_, err := ParseCommandLineArguments([]string{"skill"}, failingWriter{err: io.ErrClosedPipe}, io.Discard)
	if !errors.Is(err, io.ErrClosedPipe) {
		t.Fatalf("ParseCommandLineArguments(skill) error = %v, want the write failure %v", err, io.ErrClosedPipe)
	}
}

// The printed URL and --skill value must lead the Skills CLI to the SKILL.md this
// repository holds.
func TestSkillInstructionsPointAtTheRepositorySkill(t *testing.T) {
	t.Parallel()

	const urlPrefix = "https://github.com/alexgorbatchev/devhost/tree/main/"

	_, afterPrefix, found := strings.Cut(skillInstructions, urlPrefix)
	if !found {
		t.Fatalf("skill instructions name no URL starting %q:\n%s", urlPrefix, skillInstructions)
	}

	printedDirectory := strings.TrimSpace(afterPrefix)
	if got := filepath.Join(repositoryRoot, filepath.FromSlash(printedDirectory)); got != skillDirectory {
		t.Fatalf("printed skill directory %q resolves to %s, want %s", printedDirectory, got, skillDirectory)
	}

	skillName := frontmatterName(readSkillFile(t, filepath.Join(skillDirectory, "SKILL.md")))
	if skillName == "" {
		t.Fatalf("%s has no frontmatter name", filepath.Join(skillDirectory, "SKILL.md"))
	}

	if want := "--skill " + skillName + "\n"; !strings.Contains(skillInstructions, want) {
		t.Fatalf("skill instructions do not select the skill named %q (want %q):\n%s", skillName, want, skillInstructions)
	}
}

// helpRequests lists a --help request for every command in the tree devhost
// executes, the commands cobra and the help library generate included.
func helpRequests(t *testing.T) [][]string {
	t.Helper()

	rootCommand, err := newRootCommand(&CommandLineArguments{}, nil)
	if err != nil {
		t.Fatalf("newRootCommand() unexpected error = %v", err)
	}

	// Cobra adds these when the command line executes.
	rootCommand.InitDefaultHelpCmd()
	rootCommand.InitDefaultCompletionCmd()

	var requests [][]string
	var visit func(command *cobra.Command, path []string)
	visit = func(command *cobra.Command, path []string) {
		requests = append(requests, append(append([]string{}, path...), "--help"))
		for _, subcommand := range command.Commands() {
			if subcommand.Name() == cobra.ShellCompRequestCmd || subcommand.Name() == cobra.ShellCompNoDescRequestCmd {
				continue
			}
			visit(subcommand, append(append([]string{}, path...), subcommand.Name()))
		}
	}
	visit(rootCommand, nil)

	return requests
}

func TestAgentHelpStartsWithTheSkillAlert(t *testing.T) {
	t.Setenv("AGENT", "1")

	type helpRequest struct {
		rawArgs     []string
		wantCommand string
	}

	// The other ways to reach a help screen, beside --help on each command.
	requests := []helpRequest{
		{rawArgs: []string{}, wantCommand: "devhost"},
		{rawArgs: []string{"caddy"}, wantCommand: "devhost caddy"},
		{rawArgs: []string{"stack"}, wantCommand: "devhost stack"},
		{rawArgs: []string{"service"}, wantCommand: "devhost service"},
		{rawArgs: []string{"stop", "-h"}, wantCommand: "devhost stop"},
		{rawArgs: []string{"help", "start"}, wantCommand: "devhost start"},
	}
	for _, rawArgs := range helpRequests(t) {
		requests = append(requests, helpRequest{
			rawArgs:     rawArgs,
			wantCommand: strings.Join(append([]string{rootCommandName}, rawArgs[:len(rawArgs)-1]...), " "),
		})
	}

	// The tree holds the domain commands and the generated help, completion and
	// skill commands; a walk that finds fewer has stopped short.
	if len(requests) < 30 {
		t.Fatalf("collected only %d help requests", len(requests))
	}

	for _, tc := range requests {
		name := strings.Join(tc.rawArgs, " ")
		if name == "" {
			name = "no arguments"
		}

		t.Run(name, func(t *testing.T) {
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
		{name: "version for an agent", agent: "1", rawArgs: []string{"--version"}},
		{name: "completion script for an agent", agent: "1", rawArgs: []string{"completion", "bash"}},
		{name: "human help without a command", agent: "0", rawArgs: []string{}},
	}
	for _, rawArgs := range helpRequests(t) {
		tests = append(tests, struct {
			name    string
			agent   string
			rawArgs []string
		}{name: "human " + strings.Join(rawArgs, " "), agent: "0", rawArgs: rawArgs})
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

	skillContent := readSkillFile(t, filepath.Join(skillDirectory, "SKILL.md"))
	if missing := cobrahelptree.SkillOmissions(rootCommand, createHelpCatalog(), skillContent); len(missing) > 0 {
		t.Fatalf("skills/devhost/SKILL.md does not cover:\n  %s", strings.Join(missing, "\n  "))
	}
}

func TestSkillGivesNoNegativeInstructions(t *testing.T) {
	t.Parallel()

	referencePaths, err := filepath.Glob(filepath.Join(skillDirectory, "references", "*.md"))
	if err != nil {
		t.Fatalf("list the reference files: %v", err)
	}
	if len(referencePaths) == 0 {
		t.Fatalf("found no reference files in %s", filepath.Join(skillDirectory, "references"))
	}

	for _, documentPath := range append([]string{filepath.Join(skillDirectory, "SKILL.md")}, referencePaths...) {
		for index, line := range strings.Split(readSkillFile(t, documentPath), "\n") {
			// Emphasis marks can sit inside a phrase, as in "must **not**".
			plain := strings.ReplaceAll(line, "*", "")
			if phrase := negativeInstruction.FindString(plain); phrase != "" {
				t.Errorf("%s:%d says %q: %s", documentPath, index+1, phrase, strings.TrimSpace(line))
			}
		}
	}
}

// failingWriter rejects every write, standing in for a closed pipe.
type failingWriter struct{ err error }

func (w failingWriter) Write([]byte) (int, error) {
	return 0, w.err
}
