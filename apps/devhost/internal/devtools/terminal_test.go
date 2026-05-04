package devtools

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/manifest"
	"golang.org/x/sys/unix"
)

func TestCreateEditorTerminalCommandMatchesNeovimContract(t *testing.T) {
	t.Parallel()

	request := terminalSessionRequest{
		ComponentName: "PrimaryButton",
		Kind:          terminalSessionRequestKindEditor,
		Launcher:      terminalSessionLauncherNeovim,
		Source: &sourceLocation{
			FileName:   "webpack:///./src/components/PrimaryButton.tsx",
			LineNumber: 42,
		},
		SourceLabel: "src/components/PrimaryButton.tsx:42:1",
	}

	command, err := createEditorTerminalCommand("neovim", request, "/tmp/project")
	if err != nil {
		t.Fatalf("createEditorTerminalCommand(...) error = %v", err)
	}
	if got, want := strings.Join(command, "\x00"), strings.Join([]string{"nvim", "-c", "call cursor(42, 1)", "--", "/tmp/project/src/components/PrimaryButton.tsx"}, "\x00"); got != want {
		t.Fatalf("command = %#v, want %#v", command, []string{"nvim", "-c", "call cursor(42, 1)", "--", "/tmp/project/src/components/PrimaryButton.tsx"})
	}

	request.Launcher = "vscode"
	if _, err := createEditorTerminalCommand("neovim", request, "/tmp/project"); err == nil || err.Error() != "unsupported editor terminal launcher: vscode" {
		t.Fatalf("unsupported launcher error = %v", err)
	}

	request.Launcher = terminalSessionLauncherNeovim
	if _, err := createEditorTerminalCommand("cursor", request, "/tmp/project"); err == nil || err.Error() != "Editor terminal sessions require devtoolsComponentEditor = \"neovim\"." {
		t.Fatalf("unsupported editor error = %v", err)
	}
}

func TestLaunchTerminalCommandUsesPTYAndTerminalEnvironment(t *testing.T) {
	t.Parallel()

	var mu sync.Mutex
	chunks := []string{}
	launchedSession, err := launchTerminalCommand(
		[]string{os.Args[0], "-test.run=TestDevtoolsTerminalHelperProcess", "--"},
		"/tmp",
		map[string]string{
			"GO_WANT_TERMINAL_HELPER_PROCESS": "1",
			"DEVHOST_TERMINAL_HELPER_MODE":    "print-terminal-env",
		},
		func(data []byte) {
			mu.Lock()
			defer mu.Unlock()
			chunks = append(chunks, string(data))
		},
		func() {},
	)
	if err != nil {
		t.Fatalf("launchTerminalCommand(...) error = %v", err)
	}

	exitStatus := launchedSession.wait()
	if exitStatus.ExitCode == nil || *exitStatus.ExitCode != 0 || exitStatus.SignalCode != nil {
		t.Fatalf("exit status = %#v, want exitCode=0 signalCode=nil", exitStatus)
	}

	mu.Lock()
	output := strings.ReplaceAll(strings.Join(chunks, ""), "\r\n", "\n")
	mu.Unlock()
	for _, want := range []string{
		"PTY=1\n",
		"COLORTERM=truecolor\n",
		"TERM=xterm-256color\n",
		"TERM_PROGRAM=devhost\n",
	} {
		if !strings.Contains(output, want) {
			t.Fatalf("output missing %q in %q", want, output)
		}
	}
}

func TestCreateAgentTerminalCommandMatchesBuiltInAdapters(t *testing.T) {
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
		name     string
		agent    manifest.ValidatedAgent
		assertFn func(t *testing.T, command *terminalSessionCommand)
	}{
		{
			name:  "pi",
			agent: manifest.ValidatedAgent{DisplayName: "Pi", Kind: "pi"},
			assertFn: func(t *testing.T, command *terminalSessionCommand) {
				t.Helper()
				if len(command.command) != 4 || command.command[0] != "pi" || command.command[1] != "-e" || !strings.HasPrefix(command.command[3], "@") {
					t.Fatalf("pi command = %#v", command.command)
				}
			},
		},
		{
			name:  "claude-code",
			agent: manifest.ValidatedAgent{DisplayName: "Claude Code", Kind: "claude-code"},
			assertFn: func(t *testing.T, command *terminalSessionCommand) {
				t.Helper()
				if len(command.command) != 4 || command.command[0] != "claude" || command.command[1] != "--settings" || !strings.Contains(command.command[3], "Please read the annotation details from") {
					t.Fatalf("claude command = %#v", command.command)
				}
			},
		},
		{
			name:  "opencode",
			agent: manifest.ValidatedAgent{DisplayName: "OpenCode", Kind: "opencode"},
			assertFn: func(t *testing.T, command *terminalSessionCommand) {
				t.Helper()
				if len(command.command) != 3 || command.command[0] != "opencode" || command.command[1] != "run" || command.env["OPENCODE_CONFIG"] == "" {
					t.Fatalf("opencode command = %#v env=%#v", command.command, command.env)
				}
			},
		},
		{
			name:  "configured",
			agent: manifest.ValidatedAgent{Command: []string{"bun", "./scripts/devhost-agent.ts"}, Cwd: "/tmp/project", DisplayName: "Custom", Env: map[string]string{"DEVHOST_AGENT_MODE": "annotation"}, Kind: "configured"},
			assertFn: func(t *testing.T, command *terminalSessionCommand) {
				t.Helper()
				if got, want := strings.Join(command.command, "\x00"), strings.Join([]string{"bun", "./scripts/devhost-agent.ts"}, "\x00"); got != want {
					t.Fatalf("configured command = %#v", command.command)
				}
				if command.cwd != "/tmp/project" || command.env["DEVHOST_AGENT_MODE"] != "annotation" {
					t.Fatalf("configured cwd/env = %q %#v", command.cwd, command.env)
				}
			},
		},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			command, err := createTerminalSessionCommand([]manifest.ValidatedAnnotationAction{{Agent: tc.agent, DisplayName: tc.agent.DisplayName, ID: defaultAnnotationActionID, Kind: "agent"}}, "vscode", "/tmp/project", terminalSessionRequest{
				ActionID:   defaultAnnotationActionID,
				Annotation: &annotation,
				Kind:       terminalSessionRequestKindAgent,
			}, "hello-stack")
			if err != nil {
				t.Fatalf("createTerminalSessionCommand(...) error = %v", err)
			}
			defer command.cleanup()
			if command.env["DEVHOST_AGENT_ANNOTATION_FILE"] == "" || command.env["DEVHOST_AGENT_PROMPT_FILE"] == "" || command.env["DEVHOST_AGENT_TRANSPORT"] != "files" || command.env["DEVHOST_ANNOTATION_FILE"] == "" || command.env["DEVHOST_ANNOTATION_PROMPT_FILE"] == "" || command.env["DEVHOST_ANNOTATION_ACTION_ID"] != defaultAnnotationActionID || command.env["DEVHOST_ANNOTATION_ACTION_KIND"] != "agent" || command.env["DEVHOST_ANNOTATION_ACTION_LABEL"] != tc.agent.DisplayName || command.env["DEVHOST_PROJECT_ROOT"] != "/tmp/project" || command.env["DEVHOST_STACK_NAME"] != "hello-stack" {
				t.Fatalf("agent env = %#v", command.env)
			}
			annotationPayload, err := os.ReadFile(command.env["DEVHOST_AGENT_ANNOTATION_FILE"])
			if err != nil {
				t.Fatalf("ReadFile(annotation) error = %v", err)
			}
			var decoded annotationSubmitDetail
			if err := json.Unmarshal(annotationPayload, &decoded); err != nil {
				t.Fatalf("Unmarshal(annotation) error = %v", err)
			}
			if decoded.Comment != annotation.Comment {
				t.Fatalf("decoded annotation = %#v", decoded)
			}
			tc.assertFn(t, command)
		})
	}
}

func TestCreateCommandAnnotationTerminalCommand(t *testing.T) {
	t.Parallel()

	action := manifest.ValidatedAnnotationAction{
		Command:     []string{"bun", "run", "lint"},
		Cwd:         "/tmp/project/tools",
		DisplayName: "Run lint",
		Env:         map[string]string{"CI": "1"},
		ID:          "lint",
		Kind:        "command",
	}
	annotation := annotationSubmitDetail{
		Comment:     "Check lint.",
		Markers:     []annotationMarkerPayload{},
		StackName:   "hello-stack",
		SubmittedAt: 1717171717000,
		Title:       "Buttons",
		URL:         "https://hello.test/buttons",
	}

	command, err := createTerminalSessionCommand([]manifest.ValidatedAnnotationAction{action}, "vscode", "/tmp/project", terminalSessionRequest{
		ActionID:   "lint",
		Annotation: &annotation,
		Kind:       terminalSessionRequestKindCommand,
	}, "hello-stack")
	if err != nil {
		t.Fatalf("createTerminalSessionCommand(...) error = %v", err)
	}
	defer command.cleanup()

	if got, want := strings.Join(command.command, "\x00"), strings.Join([]string{"bun", "run", "lint"}, "\x00"); got != want {
		t.Fatalf("command = %#v, want %#v", command.command, action.Command)
	}
	if command.cwd != "/tmp/project/tools" || command.env["CI"] != "1" || command.env["DEVHOST_ANNOTATION_FILE"] == "" || command.env["DEVHOST_ANNOTATION_PROMPT_FILE"] == "" || command.env["DEVHOST_ANNOTATION_ACTION_ID"] != "lint" || command.env["DEVHOST_ANNOTATION_ACTION_KIND"] != "command" || command.env["DEVHOST_ANNOTATION_ACTION_LABEL"] != "Run lint" || command.env["DEVHOST_PROJECT_ROOT"] != "/tmp/project" || command.env["DEVHOST_STACK_NAME"] != "hello-stack" {
		t.Fatalf("command cwd/env = %q %#v", command.cwd, command.env)
	}

	annotationPayload, err := os.ReadFile(command.env["DEVHOST_ANNOTATION_FILE"])
	if err != nil {
		t.Fatalf("ReadFile(annotation) error = %v", err)
	}
	var decoded annotationSubmitDetail
	if err := json.Unmarshal(annotationPayload, &decoded); err != nil {
		t.Fatalf("Unmarshal(annotation) error = %v", err)
	}
	if decoded.Comment != annotation.Comment {
		t.Fatalf("decoded annotation = %#v", decoded)
	}
}

func TestCreateAgentTerminalCommandRejectsUnsupportedEditorSession(t *testing.T) {
	t.Parallel()

	if _, err := createTerminalSessionCommand([]manifest.ValidatedAnnotationAction{{Agent: manifest.ValidatedAgent{DisplayName: "Pi", Kind: "pi"}, DisplayName: "Pi", ID: defaultAnnotationActionID, Kind: "agent"}}, "cursor", "/tmp/project", terminalSessionRequest{
		ComponentName: "PrimaryButton",
		Kind:          terminalSessionRequestKindEditor,
		Launcher:      terminalSessionLauncherNeovim,
		Source: &sourceLocation{
			FileName:   "src/components/PrimaryButton.tsx",
			LineNumber: 42,
		},
		SourceLabel: "src/components/PrimaryButton.tsx:42:1",
	}, "hello-stack"); err == nil || err.Error() != "Editor terminal sessions require devtoolsComponentEditor = \"neovim\"." {
		t.Fatalf("editor terminal error = %v", err)
	}
}

func TestCreateAgentSessionFilesWritesExpectedSupportFiles(t *testing.T) {
	t.Parallel()

	files, err := createAgentSessionFiles(annotationSubmitDetail{
		Comment:     "Fix it",
		Markers:     []annotationMarkerPayload{},
		StackName:   "hello-stack",
		SubmittedAt: 1,
		Title:       "Example",
		URL:         "https://example.test/page",
	}, defaultAnnotationActionID, "Ask Pi", "Pi", "/tmp/project", "Prompt text", "hello-stack")
	if err != nil {
		t.Fatalf("createAgentSessionFiles(...) error = %v", err)
	}
	defer files.cleanup()

	for _, key := range []string{
		"DEVHOST_ANNOTATION_ACTION_ID",
		"DEVHOST_ANNOTATION_ACTION_KIND",
		"DEVHOST_ANNOTATION_ACTION_LABEL",
		"DEVHOST_ANNOTATION_DISPLAY_NAME",
		"DEVHOST_ANNOTATION_FILE",
		"DEVHOST_ANNOTATION_PROMPT_FILE",
		"DEVHOST_ANNOTATION_TRANSPORT",
		"DEVHOST_AGENT_ANNOTATION_FILE",
		"DEVHOST_AGENT_CLAUDE_SETTINGS_FILE",
		"DEVHOST_AGENT_DISPLAY_NAME",
		"DEVHOST_AGENT_OPENCODE_CONFIG_FILE",
		"DEVHOST_AGENT_PROMPT_FILE",
		"DEVHOST_AGENT_TRANSPORT",
		"DEVHOST_PROJECT_ROOT",
		"DEVHOST_STACK_NAME",
	} {
		if files.env[key] == "" {
			t.Fatalf("missing env %q in %#v", key, files.env)
		}
	}
	for _, path := range []string{
		files.env["DEVHOST_AGENT_ANNOTATION_FILE"],
		files.env["DEVHOST_AGENT_CLAUDE_SETTINGS_FILE"],
		files.env["DEVHOST_AGENT_OPENCODE_CONFIG_FILE"],
		files.env["DEVHOST_AGENT_PROMPT_FILE"],
		files.piExtensionFilePath,
	} {
		if _, err := os.Stat(path); err != nil {
			t.Fatalf("Stat(%q) error = %v", filepath.Base(path), err)
		}
	}
}

func TestDevtoolsTerminalHelperProcess(t *testing.T) {
	if os.Getenv("GO_WANT_TERMINAL_HELPER_PROCESS") != "1" {
		return
	}

	switch os.Getenv("DEVHOST_TERMINAL_HELPER_MODE") {
	case "print-terminal-env":
		isPTY := 0
		if _, err := unix.IoctlGetTermios(int(os.Stdin.Fd()), unix.TCGETS); err == nil {
			isPTY = 1
		}
		_, _ = os.Stdout.WriteString("PTY=" + string(rune('0'+isPTY)) + "\n")
		_, _ = os.Stdout.WriteString("COLORTERM=" + os.Getenv("COLORTERM") + "\n")
		_, _ = os.Stdout.WriteString("TERM=" + os.Getenv("TERM") + "\n")
		_, _ = os.Stdout.WriteString("TERM_PROGRAM=" + os.Getenv("TERM_PROGRAM") + "\n")
		os.Exit(0)
	default:
		os.Exit(2)
	}
}
