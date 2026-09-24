package devtools

import (
	"fmt"
	"os"
	"reflect"
	"testing"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/manifest"
)

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
