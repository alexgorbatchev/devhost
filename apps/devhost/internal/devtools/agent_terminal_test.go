package devtools

import (
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/manifest"
)

func TestAnnotationSessionTempDir(t *testing.T) {
	for _, kind := range []string{"agent", "command"} {
		for _, configured := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/configured=%t", kind, configured), func(t *testing.T) {
				base := filepath.Join(t.TempDir(), "nested", "annotations")
				action := manifest.ValidatedAnnotationAction{
					ID: "fix", Kind: kind, DisplayName: "Fix", Command: []string{"true"},
					Agent: manifest.ValidatedAgent{Kind: "pi", DisplayName: "Pi"},
				}
				if configured {
					action.TempDir = &base
				} else {
					base = t.TempDir()
					t.Setenv("TMPDIR", base)
				}
				create := func() *terminalSessionCommand {
					t.Helper()
					var cmd *terminalSessionCommand
					var err error
					if kind == "agent" {
						cmd, err = createAgentTerminalCommand(action, "/project", annotationSubmitDetail{Comment: "fix"}, "", "stack")
					} else {
						cmd, err = createCommandAnnotationTerminalCommand(action, "/project", annotationSubmitDetail{Comment: "fix"}, "stack")
					}
					if err != nil {
						t.Fatal(err)
					}
					t.Cleanup(cmd.cleanup)
					return cmd
				}
				first, second := create(), create()
				firstDir := filepath.Dir(first.env["DEVHOST_ANNOTATION_FILE"])
				secondDir := filepath.Dir(second.env["DEVHOST_ANNOTATION_FILE"])
				if filepath.Dir(firstDir) != base || filepath.Dir(secondDir) != base || firstDir == secondDir {
					t.Fatalf("session directories = %q %q, base = %q", firstDir, secondDir, base)
				}
				data, err := os.ReadFile(first.env["DEVHOST_ANNOTATION_FILE"])
				if err != nil || !strings.Contains(string(data), "fix") {
					t.Fatalf("annotation = %s, error = %v", data, err)
				}
				for _, path := range []string{firstDir, first.env["DEVHOST_ANNOTATION_FILE"], first.env["DEVHOST_ANNOTATION_PROMPT_FILE"]} {
					info, err := os.Stat(path)
					if err != nil || info.Mode().Perm()&0o077 != 0 {
						t.Fatalf("permissions for %q: info=%v error=%v", path, info, err)
					}
				}
				first.cleanup()
				if _, err := os.Stat(firstDir); !os.IsNotExist(err) {
					t.Fatalf("session remains: %v", err)
				}
				if _, err := os.Stat(second.env["DEVHOST_ANNOTATION_FILE"]); err != nil {
					t.Fatal(err)
				}
				if _, err := os.Stat(base); err != nil {
					t.Fatal(err)
				}
			})
		}
	}
}

func TestAnnotationSessionTempDirFailure(t *testing.T) {
	base := filepath.Join(t.TempDir(), "file")
	if err := os.WriteFile(base, []byte("keep"), 0o600); err != nil {
		t.Fatal(err)
	}
	for _, kind := range []string{"agent", "command"} {
		t.Run(kind, func(t *testing.T) {
			action := manifest.ValidatedAnnotationAction{TempDir: &base, ID: "fix", Kind: kind, Agent: manifest.ValidatedAgent{Kind: "pi"}}
			var err error
			if kind == "agent" {
				_, err = createAgentTerminalCommand(action, "/project", annotationSubmitDetail{}, "", "stack")
			} else {
				_, err = createCommandAnnotationTerminalCommand(action, "/project", annotationSubmitDetail{}, "stack")
			}
			if err == nil || !strings.Contains(err.Error(), base) {
				t.Fatalf("error = %v, want configured directory failure", err)
			}
		})
	}
}

func TestAgentTerminalCommandAdapters(t *testing.T) {
	t.Parallel()

	annotation := annotationSubmitDetail{
		Comment:     "Fix the primary button spacing.",
		Markers:     []annotationMarkerPayload{},
		StackName:   "hello-stack",
		SubmittedAt: 1717171717000,
		Title:       "Buttons",
		URL:         "https://hello.test/buttons",
	}

	tests := []struct {
		name        string
		action      manifest.ValidatedAnnotationAction
		colorScheme agentColorScheme
		assertFn    func(t *testing.T, command *terminalSessionCommand)
	}{
		{
			name: "pi without args",
			action: manifest.ValidatedAnnotationAction{
				Agent: manifest.ValidatedAgent{
					DisplayName: "Pi",
					Kind:        "pi",
				},
				DisplayName: "Ask Pi",
				ID:          "ask-pi",
				Kind:        "agent",
			},
			assertFn: func(t *testing.T, command *terminalSessionCommand) {
				t.Helper()
				if len(command.command) != 4 {
					t.Fatalf("command length = %d, want 4; command = %#v", len(command.command), command.command)
				}
				if command.command[0] != "pi" || command.command[1] != "-e" {
					t.Fatalf("command prefix = %#v, want [pi -e]", command.command[:2])
				}
				if _, err := os.Stat(command.command[2]); err != nil {
					t.Fatalf("pi extension file %q stat error = %v", command.command[2], err)
				}
				wantPrompt := "@" + command.env["DEVHOST_AGENT_PROMPT_FILE"]
				if command.command[3] != wantPrompt {
					t.Fatalf("command prompt = %q, want %q", command.command[3], wantPrompt)
				}
			},
		},
		{
			name: "pi with args",
			action: manifest.ValidatedAnnotationAction{
				Agent: manifest.ValidatedAgent{
					Args:        []string{"--thinking", "high"},
					DisplayName: "Pi",
					Kind:        "pi",
				},
				DisplayName: "Ask Pi",
				ID:          "ask-pi",
				Kind:        "agent",
			},
			assertFn: func(t *testing.T, command *terminalSessionCommand) {
				t.Helper()
				if len(command.command) != 6 {
					t.Fatalf("command length = %d, want 6; command = %#v", len(command.command), command.command)
				}
				if command.command[0] != "pi" || command.command[1] != "-e" {
					t.Fatalf("command prefix = %#v, want [pi -e]", command.command[:2])
				}
				if _, err := os.Stat(command.command[2]); err != nil {
					t.Fatalf("pi extension file %q stat error = %v", command.command[2], err)
				}
				if got, want := command.command[3:5], []string{"--thinking", "high"}; !reflect.DeepEqual(got, want) {
					t.Fatalf("command args = %#v, want %#v", got, want)
				}
				wantPrompt := "@" + command.env["DEVHOST_AGENT_PROMPT_FILE"]
				if command.command[5] != wantPrompt {
					t.Fatalf("command prompt = %q, want %q", command.command[5], wantPrompt)
				}
			},
		},
		{
			name: "pi with args and color scheme",
			action: manifest.ValidatedAnnotationAction{
				Agent: manifest.ValidatedAgent{
					Args:        []string{"--thinking", "high"},
					DisplayName: "Pi",
					Kind:        "pi",
				},
				DisplayName: "Ask Pi",
				ID:          "ask-pi",
				Kind:        "agent",
			},
			colorScheme: agentColorSchemeDark,
			assertFn: func(t *testing.T, command *terminalSessionCommand) {
				t.Helper()
				if len(command.command) != 8 {
					t.Fatalf("command length = %d, want 8; command = %#v", len(command.command), command.command)
				}
				if command.command[0] != "pi" || command.command[1] != "-e" {
					t.Fatalf("command prefix = %#v, want [pi -e]", command.command[:2])
				}
				if _, err := os.Stat(command.command[2]); err != nil {
					t.Fatalf("pi extension file %q stat error = %v", command.command[2], err)
				}
				if got, want := command.command[3:5], []string{"--use-theme", "dark"}; !reflect.DeepEqual(got, want) {
					t.Fatalf("command theme = %#v, want %#v", got, want)
				}
				if got, want := command.command[5:7], []string{"--thinking", "high"}; !reflect.DeepEqual(got, want) {
					t.Fatalf("command args = %#v, want %#v", got, want)
				}
				wantPrompt := "@" + command.env["DEVHOST_AGENT_PROMPT_FILE"]
				if command.command[7] != wantPrompt {
					t.Fatalf("command prompt = %q, want %q", command.command[7], wantPrompt)
				}
			},
		},
		{
			name: "claude-code without args",
			action: manifest.ValidatedAnnotationAction{
				Agent: manifest.ValidatedAgent{
					DisplayName: "Claude Code",
					Kind:        "claude-code",
				},
				DisplayName: "Ask Claude",
				ID:          "ask-claude",
				Kind:        "agent",
			},
			assertFn: func(t *testing.T, command *terminalSessionCommand) {
				t.Helper()
				if len(command.command) != 4 {
					t.Fatalf("command length = %d, want 4; command = %#v", len(command.command), command.command)
				}
				if command.command[0] != "claude" || command.command[1] != "--settings" {
					t.Fatalf("command prefix = %#v, want [claude --settings]", command.command[:2])
				}
				if _, err := os.Stat(command.command[2]); err != nil {
					t.Fatalf("claude settings file %q stat error = %v", command.command[2], err)
				}
				wantInstruction := fmt.Sprintf("Please read the annotation details from %s and address the requested change.", command.env["DEVHOST_AGENT_PROMPT_FILE"])
				if command.command[3] != wantInstruction {
					t.Fatalf("command prompt = %q, want %q", command.command[3], wantInstruction)
				}
			},
		},
		{
			name: "claude-code with args",
			action: manifest.ValidatedAnnotationAction{
				Agent: manifest.ValidatedAgent{
					Args:        []string{"--model", "claude-3-7-sonnet", "--dangerously-skip-permissions"},
					DisplayName: "Claude Code",
					Kind:        "claude-code",
				},
				DisplayName: "Ask Claude",
				ID:          "ask-claude",
				Kind:        "agent",
			},
			assertFn: func(t *testing.T, command *terminalSessionCommand) {
				t.Helper()
				if len(command.command) != 7 {
					t.Fatalf("command length = %d, want 7; command = %#v", len(command.command), command.command)
				}
				if command.command[0] != "claude" || command.command[1] != "--settings" {
					t.Fatalf("command prefix = %#v, want [claude --settings]", command.command[:2])
				}
				if _, err := os.Stat(command.command[2]); err != nil {
					t.Fatalf("claude settings file %q stat error = %v", command.command[2], err)
				}
				if got, want := command.command[3:6], []string{"--model", "claude-3-7-sonnet", "--dangerously-skip-permissions"}; !reflect.DeepEqual(got, want) {
					t.Fatalf("command args = %#v, want %#v", got, want)
				}
				wantInstruction := fmt.Sprintf("Please read the annotation details from %s and address the requested change.", command.env["DEVHOST_AGENT_PROMPT_FILE"])
				if command.command[6] != wantInstruction {
					t.Fatalf("command prompt = %q, want %q", command.command[6], wantInstruction)
				}
			},
		},
		{
			name: "opencode without args",
			action: manifest.ValidatedAnnotationAction{
				Agent: manifest.ValidatedAgent{
					DisplayName: "OpenCode",
					Kind:        "opencode",
				},
				DisplayName: "Ask OpenCode",
				ID:          "ask-opencode",
				Kind:        "agent",
			},
			assertFn: func(t *testing.T, command *terminalSessionCommand) {
				t.Helper()
				if len(command.command) != 3 {
					t.Fatalf("command length = %d, want 3; command = %#v", len(command.command), command.command)
				}
				if command.command[0] != "opencode" || command.command[1] != "run" {
					t.Fatalf("command prefix = %#v, want [opencode run]", command.command[:2])
				}
				if command.env["OPENCODE_CONFIG"] == "" {
					t.Fatalf("opencode OPENCODE_CONFIG env is empty")
				}
				if _, err := os.Stat(command.env["OPENCODE_CONFIG"]); err != nil {
					t.Fatalf("opencode config file stat error = %v", err)
				}
				wantInstruction := fmt.Sprintf("Please read the annotation details from %s and address the requested change.", command.env["DEVHOST_AGENT_PROMPT_FILE"])
				if command.command[2] != wantInstruction {
					t.Fatalf("command prompt = %q, want %q", command.command[2], wantInstruction)
				}
			},
		},
		{
			name: "opencode with args",
			action: manifest.ValidatedAnnotationAction{
				Agent: manifest.ValidatedAgent{
					Args:        []string{"--model", "gpt-4o"},
					DisplayName: "OpenCode",
					Kind:        "opencode",
				},
				DisplayName: "Ask OpenCode",
				ID:          "ask-opencode",
				Kind:        "agent",
			},
			assertFn: func(t *testing.T, command *terminalSessionCommand) {
				t.Helper()
				if len(command.command) != 5 {
					t.Fatalf("command length = %d, want 5; command = %#v", len(command.command), command.command)
				}
				if command.command[0] != "opencode" || command.command[1] != "run" {
					t.Fatalf("command prefix = %#v, want [opencode run]", command.command[:2])
				}
				if command.env["OPENCODE_CONFIG"] == "" {
					t.Fatalf("opencode OPENCODE_CONFIG env is empty")
				}
				if _, err := os.Stat(command.env["OPENCODE_CONFIG"]); err != nil {
					t.Fatalf("opencode config file stat error = %v", err)
				}
				if got, want := command.command[2:4], []string{"--model", "gpt-4o"}; !reflect.DeepEqual(got, want) {
					t.Fatalf("command args = %#v, want %#v", got, want)
				}
				wantInstruction := fmt.Sprintf("Please read the annotation details from %s and address the requested change.", command.env["DEVHOST_AGENT_PROMPT_FILE"])
				if command.command[4] != wantInstruction {
					t.Fatalf("command prompt = %q, want %q", command.command[4], wantInstruction)
				}
			},
		},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			projectRootPath := t.TempDir()
			command, err := createAgentTerminalCommand(tc.action, projectRootPath, annotation, tc.colorScheme, "hello-stack")
			if err != nil {
				t.Fatalf("createAgentTerminalCommand(...) error = %v", err)
			}
			defer command.cleanup()
			tc.assertFn(t, command)
		})
	}
}
