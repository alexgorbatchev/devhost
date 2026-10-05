package devtools

import (
	"fmt"
	"strconv"
)

const codexStatusTTYEnvironmentName = "DEVHOST_CODEX_STATUS_TTY"

func codexTerminalCommand() []string {
	// A shared daemon has no controlling terminal for these hooks. Keep the
	// session attached to its own PTY, without changing Codex's trust policy.
	command := []string{"codex", "--no-daemon"}
	for _, hook := range []struct {
		event  string
		status agentSessionStatus
	}{
		{"SessionStart", agentSessionStatusWorking},
		{"UserPromptSubmit", agentSessionStatusWorking},
		{"Stop", agentSessionStatusFinished},
		{"Interrupt", agentSessionStatusFinished},
		{"SessionEnd", agentSessionStatusFinished},
	} {
		// Hook stdout is captured by Codex and may become model context. Write
		// directly to this session's PTY instead. POSIX octal escapes
		// work with the shell's printf on both Linux and macOS.
		script := fmt.Sprintf("printf '\\033]1337;SetAgentStatus=%s\\007' > \"$%s\"", hook.status, codexStatusTTYEnvironmentName)
		config := fmt.Sprintf("hooks.%s=[{hooks=[{type=\"command\",command=%s,timeout=3}]}]", hook.event, strconv.Quote(script))
		command = append(command, "-c", config)
	}
	return command
}
