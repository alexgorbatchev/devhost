package caddy

import (
	"bytes"
	"os"
	"os/exec"
)

type CommandResult struct {
	Stderr  []byte
	Stdout  []byte
	Success bool
}

type RunCommandOptions struct {
	InheritStdio bool
}

func RunCommand(arguments []string, options RunCommandOptions) CommandResult {
	command := exec.Command(arguments[0], arguments[1:]...)
	if options.InheritStdio {
		command.Stdin = os.Stdin
		command.Stdout = os.Stdout
		command.Stderr = os.Stderr
		error := command.Run()
		return CommandResult{Stderr: []byte{}, Stdout: []byte{}, Success: error == nil}
	}

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	command.Stdout = &stdout
	command.Stderr = &stderr
	error := command.Run()

	return CommandResult{Stderr: stderr.Bytes(), Stdout: stdout.Bytes(), Success: error == nil}
}
