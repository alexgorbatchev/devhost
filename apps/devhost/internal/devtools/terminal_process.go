package devtools

import (
	"os"
	"os/exec"
	"syscall"

	"github.com/creack/pty"
)

func startTerminalProcess(cmd *exec.Cmd, environment map[string]string) (*os.File, error) {
	size := &pty.Winsize{Cols: defaultTerminalColumns, Rows: defaultTerminalRows}
	if _, ok := environment[codexStatusTTYEnvironmentName]; !ok {
		return pty.StartWithSize(cmd, size)
	}

	// Codex detaches its hook subprocesses. Open the PTY before spawning so
	// hooks can address this session's slave even without a controlling TTY.
	master, slave, err := pty.Open()
	if err != nil {
		return nil, err
	}
	defer func() { _ = slave.Close() }() // Best-effort release of the parent's descriptor.
	if err := pty.Setsize(master, size); err != nil {
		_ = master.Close() // Best-effort cleanup before returning the resize error.
		return nil, err
	}
	cmd.Env = append(cmd.Env, codexStatusTTYEnvironmentName+"="+slave.Name())
	cmd.Stdin, cmd.Stdout, cmd.Stderr = slave, slave, slave
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true, Setctty: true}
	if err := cmd.Start(); err != nil {
		_ = master.Close() // Best-effort cleanup before returning the process error.
		return nil, err
	}
	return master, nil
}
