package devtools

import (
	"encoding/json"
	"fmt"
	"maps"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/manifest"
	"golang.org/x/sys/unix"
)

func TestCreateEditorTerminalCommandMatchesNeovimContract(t *testing.T) {
	t.Parallel()

	projectRootPath := t.TempDir()
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

	command, err := createEditorTerminalCommand("neovim", request, projectRootPath, "hello-stack", editorTerminalIntegration{
		endpoint: "http://127.0.0.1:49152/__devhost__/react-highlight/cursor",
	})
	if err != nil {
		t.Fatalf("createEditorTerminalCommand(...) error = %v", err)
	}
	defer command.cleanup()
	wantCommand := []string{
		"nvim",
		"-c",
		"execute 'set packpath^=' . fnameescape($DEVHOST_NVIM_SITE_PATH)",
		"-c",
		"packadd dhr.nvim",
		"-c",
		"call cursor(42, 1)",
		"--",
		filepath.Join(projectRootPath, "src/components/PrimaryButton.tsx"),
	}
	if got, want := strings.Join(command.command, "\x00"), strings.Join(wantCommand, "\x00"); got != want {
		t.Fatalf("command = %#v, want %#v", command.command, wantCommand)
	}
	if command.cwd != projectRootPath || command.env[reactHighlightEndpointEnvironmentName] != "http://127.0.0.1:49152/__devhost__/react-highlight/cursor" || command.env[projectRootEnvironmentName] != projectRootPath || command.env[stackNameEnvironmentName] != "hello-stack" || command.env[neovimSitePathEnvironmentName] == "" {
		t.Fatalf("command cwd/env = %q %#v", command.cwd, command.env)
	}
	if _, err := os.Stat(filepath.Join(command.env[neovimSitePathEnvironmentName], "pack", "devhost", "start", "dhr.nvim", "plugin", "devhost-react-highlight.lua")); err != nil {
		t.Fatalf("Stat(bundled plugin) error = %v", err)
	}

	request.Launcher = "vscode"
	if _, err := createEditorTerminalCommand("neovim", request, projectRootPath, "hello-stack", editorTerminalIntegration{}); err == nil || err.Error() != "unsupported editor terminal launcher: vscode" {
		t.Fatalf("unsupported launcher error = %v", err)
	}

	request.Launcher = terminalSessionLauncherNeovim
	if _, err := createEditorTerminalCommand("cursor", request, projectRootPath, "hello-stack", editorTerminalIntegration{}); err == nil || err.Error() != "Editor terminal sessions require devtoolsComponentEditor = \"neovim\"." {
		t.Fatalf("unsupported editor error = %v", err)
	}
}

func TestCreateNeovimPluginShellIntegrationFilesWritesLauncher(t *testing.T) {
	t.Parallel()

	projectRootPath := t.TempDir()
	files, err := createNeovimPluginShellIntegrationFiles(projectRootPath, "hello stack", "http://127.0.0.1:49152/__devhost__/react-highlight/cursor")
	if err != nil {
		t.Fatalf("createNeovimPluginShellIntegrationFiles(...) error = %v", err)
	}
	defer files.cleanup()

	if _, err := os.Stat(filepath.Join(files.sitePath, "pack", "devhost", "start", "dhr.nvim", "plugin", "devhost-react-highlight.lua")); err != nil {
		t.Fatalf("Stat(bundled plugin) error = %v", err)
	}
	initPayload, err := os.ReadFile(filepath.Join(files.sitePath, "pack", "devhost", "start", "dhr.nvim", "lua", "devhost-react-highlight", "init.lua"))
	if err != nil {
		t.Fatalf("ReadFile(bundled plugin init) error = %v", err)
	}
	if initText := string(initPayload); !strings.Contains(initText, `vim.fn.sign_define(sign_name, { text = "->", texthl = "Search" })`) || !strings.Contains(initText, "vim.fn.sign_place(sign_id, sign_group, sign_name") {
		t.Fatalf("bundled plugin init missing Neovim highlight sign support:\n%s", initText)
	}

	launcherInfo, err := os.Stat(files.launcherPath)
	if err != nil {
		t.Fatalf("Stat(launcher) error = %v", err)
	}
	if launcherInfo.Mode().Perm() != 0o755 {
		t.Fatalf("launcher mode = %v, want 0755", launcherInfo.Mode().Perm())
	}

	launcherPayload, err := os.ReadFile(files.launcherPath)
	if err != nil {
		t.Fatalf("ReadFile(launcher) error = %v", err)
	}
	launcherScript := string(launcherPayload)
	for _, want := range []string{
		"export DEVHOST_REACT_HIGHLIGHT_URL='http://127.0.0.1:49152/__devhost__/react-highlight/cursor'",
		fmt.Sprintf("export DEVHOST_PROJECT_ROOT='%s'", projectRootPath),
		"export DEVHOST_STACK_NAME='hello stack'",
		"exec nvim -c \"execute 'set packpath^=' . fnameescape(\\$DEVHOST_NVIM_SITE_PATH)\" -c \"packadd dhr.nvim\" \"$@\"",
	} {
		if !strings.Contains(launcherScript, want) {
			t.Fatalf("launcher script missing %q in:\n%s", want, launcherScript)
		}
	}

	files.cleanup()
	if _, err := os.Stat(files.launcherPath); !os.IsNotExist(err) {
		t.Fatalf("Stat(cleaned launcher) error = %v, want not exist", err)
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
		func() {},
	)
	if err != nil {
		t.Fatalf("launchTerminalCommand(...) error = %v", err)
	}
	launchedSession.startOutput(func(data []byte) {
		mu.Lock()
		defer mu.Unlock()
		chunks = append(chunks, string(data))
	})

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
			agent: manifest.ValidatedAgent{Kind: "pi"},
			assertFn: func(t *testing.T, command *terminalSessionCommand) {
				t.Helper()
				if len(command.command) != 4 || command.command[0] != "pi" || command.command[1] != "-e" || !strings.HasPrefix(command.command[3], "@") {
					t.Fatalf("pi command = %#v", command.command)
				}
			},
		},
		{
			name:  "claude-code",
			agent: manifest.ValidatedAgent{Kind: "claude-code"},
			assertFn: func(t *testing.T, command *terminalSessionCommand) {
				t.Helper()
				if len(command.command) != 4 || command.command[0] != "claude" || command.command[1] != "--settings" || !strings.Contains(command.command[3], "Please read the annotation details from") {
					t.Fatalf("claude command = %#v", command.command)
				}
			},
		},
		{
			name:  "opencode",
			agent: manifest.ValidatedAgent{Kind: "opencode"},
			assertFn: func(t *testing.T, command *terminalSessionCommand) {
				t.Helper()
				if len(command.command) != 3 || command.command[0] != "opencode" || command.command[1] != "run" || command.env["OPENCODE_CONFIG"] == "" {
					t.Fatalf("opencode command = %#v env=%#v", command.command, command.env)
				}
			},
		},
		{
			name:  "configured",
			agent: manifest.ValidatedAgent{Command: []string{"bun", "./scripts/devhost-agent.ts"}, Cwd: "/tmp/project", Env: map[string]string{"DEVHOST_AGENT_MODE": "annotation"}, Kind: "configured"},
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
			command, err := createTerminalSessionCommand([]manifest.ValidatedAnnotationAction{{Agent: tc.agent, Label: "Review change", ID: defaultAnnotationActionID, Kind: "agent"}}, "vscode", "/tmp/project", terminalSessionRequest{
				ActionID:   defaultAnnotationActionID,
				Annotation: &annotation,
				Kind:       terminalSessionRequestKindAgent,
			}, "hello-stack", editorTerminalIntegration{})
			if err != nil {
				t.Fatalf("createTerminalSessionCommand(...) error = %v", err)
			}
			defer command.cleanup()
			if command.env["DEVHOST_ANNOTATION_FILE"] == "" || command.env["DEVHOST_ANNOTATION_PROMPT_FILE"] == "" || command.env["DEVHOST_ANNOTATION_TRANSPORT"] != "files" || command.env["DEVHOST_ANNOTATION_ACTION_ID"] != defaultAnnotationActionID || command.env["DEVHOST_ANNOTATION_ACTION_KIND"] != "agent" || command.env["DEVHOST_ANNOTATION_ACTION_LABEL"] != "Review change" || command.env["DEVHOST_PROJECT_ROOT"] != "/tmp/project" || command.env["DEVHOST_STACK_NAME"] != "hello-stack" {
				t.Fatalf("agent env = %#v", command.env)
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
			tc.assertFn(t, command)
		})
	}
}

func TestCreateAgentTerminalCommandPassesColorSchemeToPi(t *testing.T) {
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
		name          string
		colorScheme   agentColorScheme
		wantThemeArgs []string
	}{
		{name: "light", colorScheme: agentColorSchemeLight, wantThemeArgs: []string{"--use-theme", "light"}},
		{name: "dark", colorScheme: agentColorSchemeDark, wantThemeArgs: []string{"--use-theme", "dark"}},
		{name: "unspecified"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			command, err := createTerminalSessionCommand([]manifest.ValidatedAnnotationAction{{Agent: manifest.ValidatedAgent{Kind: "pi"}, Label: "Review change", ID: defaultAnnotationActionID, Kind: "agent"}}, "vscode", "/tmp/project", terminalSessionRequest{
				ActionID:    defaultAnnotationActionID,
				Annotation:  &annotation,
				ColorScheme: tc.colorScheme,
				Kind:        terminalSessionRequestKindAgent,
			}, "hello-stack", editorTerminalIntegration{})
			if err != nil {
				t.Fatalf("createTerminalSessionCommand(...) error = %v", err)
			}
			defer command.cleanup()

			want := slices.Concat([]string{"pi", "-e", command.command[2]}, tc.wantThemeArgs, []string{"@" + command.env["DEVHOST_ANNOTATION_PROMPT_FILE"]})
			if !slices.Equal(command.command, want) {
				t.Fatalf("command = %#v, want %#v", command.command, want)
			}
		})
	}
}

func TestCreateAgentTerminalCommandWritesColorSchemeToClaudeSettings(t *testing.T) {
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
		colorScheme agentColorScheme
		wantTheme   any
	}{
		{name: "light", colorScheme: agentColorSchemeLight, wantTheme: "light"},
		// Without a scheme the settings carry no theme, which leaves the user's own Claude Code theme in effect.
		{name: "unspecified", wantTheme: nil},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			command, err := createTerminalSessionCommand([]manifest.ValidatedAnnotationAction{{Agent: manifest.ValidatedAgent{Kind: "claude-code"}, Label: "Review change", ID: defaultAnnotationActionID, Kind: "agent"}}, "vscode", "/tmp/project", terminalSessionRequest{
				ActionID:    defaultAnnotationActionID,
				Annotation:  &annotation,
				ColorScheme: tc.colorScheme,
				Kind:        terminalSessionRequestKindAgent,
			}, "hello-stack", editorTerminalIntegration{})
			if err != nil {
				t.Fatalf("createTerminalSessionCommand(...) error = %v", err)
			}
			defer command.cleanup()

			// Claude Code receives its settings file as the --settings argument.
			settingsPayload, err := os.ReadFile(command.command[2])
			if err != nil {
				t.Fatalf("ReadFile(claude settings) error = %v", err)
			}
			var settings map[string]any
			if err := json.Unmarshal(settingsPayload, &settings); err != nil {
				t.Fatalf("Unmarshal(claude settings) error = %v", err)
			}
			if theme := settings["theme"]; theme != tc.wantTheme {
				t.Fatalf("claude settings theme = %#v, want %#v", theme, tc.wantTheme)
			}
			if _, hasHooks := settings["hooks"]; !hasHooks {
				t.Fatalf("claude settings = %#v, want status hooks kept", settings)
			}
		})
	}
}

func TestParseTerminalSessionRequestColorScheme(t *testing.T) {
	t.Parallel()

	annotation := annotationSubmitDetail{
		Comment:     "Fix it",
		Markers:     []annotationMarkerPayload{},
		StackName:   "hello-stack",
		SubmittedAt: 1,
		Title:       "Example",
		URL:         "https://example.test/page",
	}
	tests := []struct {
		name            string
		colorScheme     *string
		wantOK          bool
		wantColorScheme agentColorScheme
	}{
		{name: "light", colorScheme: stringPointer("light"), wantOK: true, wantColorScheme: agentColorSchemeLight},
		{name: "dark", colorScheme: stringPointer("dark"), wantOK: true, wantColorScheme: agentColorSchemeDark},
		{name: "omitted", colorScheme: nil, wantOK: true, wantColorScheme: ""},
		{name: "unsupported", colorScheme: stringPointer("sepia"), wantOK: false},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			kind := terminalSessionRequestKindAgent
			request, _, ok := parseTerminalSessionRequest(terminalSessionRequestPayload{
				Annotation:  &annotation,
				ColorScheme: tc.colorScheme,
				Kind:        &kind,
			})
			if ok != tc.wantOK {
				t.Fatalf("parseTerminalSessionRequest(...) ok = %v, want %v", ok, tc.wantOK)
			}
			if tc.wantOK && request.ColorScheme != tc.wantColorScheme {
				t.Fatalf("parseTerminalSessionRequest(...) colorScheme = %q, want %q", request.ColorScheme, tc.wantColorScheme)
			}
		})
	}
}

func TestCreateCommandAnnotationTerminalCommand(t *testing.T) {
	t.Parallel()

	action := manifest.ValidatedAnnotationAction{
		Command: []string{"bun", "run", "lint"},
		Cwd:     "/tmp/project/tools",
		Label:   "Run lint",
		Env:     map[string]string{"CI": "1"},
		ID:      "lint",
		Kind:    "command",
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
	}, "hello-stack", editorTerminalIntegration{})
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
	wantEnvKeys := []string{
		"CI",
		"DEVHOST_ANNOTATION_ACTION_ID",
		"DEVHOST_ANNOTATION_ACTION_KIND",
		"DEVHOST_ANNOTATION_ACTION_LABEL",
		"DEVHOST_ANNOTATION_FILE",
		"DEVHOST_ANNOTATION_PROMPT_FILE",
		"DEVHOST_ANNOTATION_TRANSPORT",
		"DEVHOST_PROJECT_ROOT",
		"DEVHOST_STACK_NAME",
	}
	if got := slices.Sorted(maps.Keys(command.env)); !slices.Equal(got, wantEnvKeys) {
		t.Fatalf("command env variables = %v, want %v", got, wantEnvKeys)
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

	if _, err := createTerminalSessionCommand([]manifest.ValidatedAnnotationAction{{Agent: manifest.ValidatedAgent{Kind: "pi"}, Label: "Pi", ID: defaultAnnotationActionID, Kind: "agent"}}, "cursor", "/tmp/project", terminalSessionRequest{
		ComponentName: "PrimaryButton",
		Kind:          terminalSessionRequestKindEditor,
		Launcher:      terminalSessionLauncherNeovim,
		Source: &sourceLocation{
			FileName:   "src/components/PrimaryButton.tsx",
			LineNumber: 42,
		},
		SourceLabel: "src/components/PrimaryButton.tsx:42:1",
	}, "hello-stack", editorTerminalIntegration{}); err == nil || err.Error() != "Editor terminal sessions require devtoolsComponentEditor = \"neovim\"." {
		t.Fatalf("editor terminal error = %v", err)
	}
}

func TestDevtoolsTerminalHelperProcess(t *testing.T) {
	if os.Getenv("GO_WANT_TERMINAL_HELPER_PROCESS") != "1" {
		return
	}

	switch os.Getenv("DEVHOST_TERMINAL_HELPER_MODE") {
	case "print-terminal-env":
		isPTY := 0
		if _, err := unix.IoctlGetWinsize(int(os.Stdin.Fd()), unix.TIOCGWINSZ); err == nil {
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
