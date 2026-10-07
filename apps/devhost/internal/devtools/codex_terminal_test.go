package devtools

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/BurntSushi/toml"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/manifest"
)

func TestCodexTerminalCommand(t *testing.T) {
	t.Parallel()
	for _, args := range [][]string{nil, {"--model", "example-model", "-c", "model_reasoning_effort=high"}} {
		t.Run("args", func(t *testing.T) {
			t.Parallel()
			root := t.TempDir()
			action := manifest.ValidatedAnnotationAction{
				Agent: manifest.ValidatedAgent{Kind: "codex", Args: args},
				ID:    "ask-codex", DisplayName: "Codex", Kind: "agent",
			}
			annotation := annotationSubmitDetail{Comment: "Fix spacing", StackName: "test", URL: "https://app.localhost"}
			cmd, err := createAgentTerminalCommand(action, root, annotation, agentColorSchemeLight, "test")
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(cmd.cleanup)
			if cmd.cwd != root || cmd.env["DEVHOST_PROJECT_ROOT"] != root {
				t.Fatalf("project root not preserved: %#v", cmd)
			}
			if !reflect.DeepEqual(cmd.command[:2], []string{"codex", "--no-daemon"}) {
				t.Fatalf("command = %#v", cmd.command)
			}
			wantPrompt := fmt.Sprintf("Please read the annotation details from %s and address the requested change.", cmd.env["DEVHOST_ANNOTATION_PROMPT_FILE"])
			if got := cmd.command[len(cmd.command)-1]; got != wantPrompt {
				t.Fatalf("prompt = %q, want %q", got, wantPrompt)
			}
			if got := cmd.command[len(cmd.command)-len(args)-1 : len(cmd.command)-1]; !reflect.DeepEqual(got, append([]string{}, args...)) {
				t.Fatalf("args = %#v, want %#v", got, args)
			}
			for _, arg := range cmd.command {
				if strings.HasPrefix(arg, "--dangerously-") {
					t.Fatalf("adapter bypasses Codex policy: %q", arg)
				}
			}
			promptPath := cmd.env["DEVHOST_ANNOTATION_PROMPT_FILE"]
			prompt, err := os.ReadFile(promptPath)
			if err != nil || !strings.Contains(string(prompt), annotation.Comment) {
				t.Fatalf("prompt file = %q, error = %v", prompt, err)
			}
			cmd.cleanup()
			if _, err := os.Stat(promptPath); !errors.Is(err, os.ErrNotExist) {
				t.Fatalf("prompt file survives cleanup: %v", err)
			}
		})
	}
}

// Codex captures hook stdout. Exercise the injected commands with redirected
// stdout and a detached subprocess, as used by Codex's hook runtime.
func TestCodexHooksReportStatusThroughTerminal(t *testing.T) {
	t.Parallel()
	action := manifest.ValidatedAnnotationAction{Agent: manifest.ValidatedAgent{Kind: "codex"}, Kind: "agent"}
	cmd, err := createAgentTerminalCommand(action, t.TempDir(), annotationSubmitDetail{}, "", "test")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(cmd.cleanup)
	var config struct {
		Hooks map[string][]struct {
			Hooks []struct {
				Type    string
				Command string
			}
		}
	}
	for i := 2; i < len(cmd.command)-1; i += 2 {
		if cmd.command[i] != "-c" {
			t.Fatalf("expected config override, got %q", cmd.command[i])
		}
		if _, err := toml.Decode(cmd.command[i+1], &config); err != nil {
			t.Fatal(err)
		}
	}
	for event, want := range map[string]agentSessionStatus{
		"SessionStart":     agentSessionStatusWorking,
		"UserPromptSubmit": agentSessionStatusWorking,
		"Stop":             agentSessionStatusFinished,
		"Interrupt":        agentSessionStatusFinished,
		"SessionEnd":       agentSessionStatusFinished,
	} {
		t.Run(event, func(t *testing.T) {
			t.Parallel()
			groups := config.Hooks[event]
			if len(groups) != 1 || len(groups[0].Hooks) != 1 || groups[0].Hooks[0].Type != "command" {
				t.Fatalf("missing command hook for %s: %#v", event, groups)
			}
			stdoutPath := filepath.Join(t.TempDir(), "stdout")
			// The test subprocess starts a new session and captures stdout, so
			// /dev/tty cannot be used by the hook to reach the embedded terminal.
			env := copyStringMap(cmd.env)
			env["DEVHOST_TEST_CODEX_HOOK"] = groups[0].Hooks[0].Command
			env["DEVHOST_TEST_CODEX_STDOUT"] = stdoutPath
			args := []string{os.Args[0], "-test.run=^TestCodexDetachedHookProcess$"}
			output := runCodexTerminalTestCommand(t, args, cmd.cwd, env)
			parsed := parseAgentStatusOSC("", output)
			if !reflect.DeepEqual(parsed.statuses, []agentSessionStatus{want}) {
				t.Fatalf("status = %#v, want %s; terminal output %q", parsed.statuses, want, output)
			}
			stdout, err := os.ReadFile(stdoutPath)
			if err != nil || len(stdout) != 0 {
				t.Fatalf("hook pollutes model context: stdout %q, error %v", stdout, err)
			}
		})
	}
}

func TestCodexDetachedHookProcess(t *testing.T) {
	hook := os.Getenv("DEVHOST_TEST_CODEX_HOOK")
	if hook == "" {
		return
	}
	child := exec.Command("sh", "-c", hook)
	child.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	stdout, err := child.Output()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(os.Getenv("DEVHOST_TEST_CODEX_STDOUT"), stdout, 0o600); err != nil {
		t.Fatal(err)
	}
}

// Opt-in smoke test for the installed CLI's actual config and hook runtime.
// The blocking hook ends the prompt before inference; no real credentials are
// supplied. Hook-trust bypass applies only to this isolated, vetted test config.
func TestCodexInstalledHookRuntime(t *testing.T) {
	if os.Getenv("DEVHOST_TEST_CODEX") != "1" {
		t.Skip("set DEVHOST_TEST_CODEX=1 to validate the installed Codex CLI")
	}
	if _, err := exec.LookPath("codex"); err != nil {
		t.Fatal(err)
	}
	root := t.TempDir()
	args := codexTerminalCommand()
	args = append(args,
		"--strict-config", "--dangerously-bypass-hook-trust",
		"-c", `openai_base_url="http://127.0.0.1:1/v1"`,
		"-c", `hooks.UserPromptSubmit=[{hooks=[{type="command",command="printf '%s' '{\"decision\":\"block\",\"reason\":\"devhost offline validation\"}'",timeout=3}]}]`,
		// Codex styles hook results when stdout is a terminal; plain output keeps "UserPromptSubmit Blocked" matchable.
		"exec", "--skip-git-repo-check", "--color", "never", "offline validation",
	)
	env := map[string]string{
		codexStatusTTYEnvironmentName: "",
		"CODEX_HOME":                  root,
		"OPENAI_API_KEY":              "devhost-offline-test",
		"CODEX_API_KEY":               "devhost-offline-test",
	}
	output := runCodexTerminalTestCommand(t, args, root, env)
	parsed := parseAgentStatusOSC("", output)
	if !reflect.DeepEqual(parsed.statuses, []agentSessionStatus{agentSessionStatusWorking, agentSessionStatusFinished}) {
		t.Fatalf("native hook statuses = %#v\n%s", parsed.statuses, output)
	}
	if !strings.Contains(output, "UserPromptSubmit Blocked") {
		t.Fatalf("offline hook did not stop inference:\n%s", output)
	}
}

func runCodexTerminalTestCommand(t *testing.T, args []string, cwd string, env map[string]string) string {
	t.Helper()
	var chunks []string
	session, err := launchTerminalCommand(args, cwd, env, func() {})
	if err != nil {
		t.Fatal(err)
	}
	session.startOutput(func(data []byte) {
		chunks = append(chunks, string(data))
	})
	defer session.close()
	timer := time.AfterFunc(15*time.Second, session.close)
	defer timer.Stop()
	exit := session.wait() // Joins the output reader before inspecting chunks.
	output := strings.Join(chunks, "")
	if exit.ExitCode == nil || *exit.ExitCode != 0 || exit.SignalCode != nil {
		t.Fatalf("terminal process failed: %#v\n%s", exit, output)
	}
	return output
}
