package caddy

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

type CommandResult struct {
	Stderr  []byte
	Stdout  []byte
	Success bool
}

type RunCommandOptions struct {
	InheritStdio bool
	WorkingDir   string
}

func RunCommand(arguments []string, options RunCommandOptions) CommandResult {
	if len(arguments) == 0 {
		return CommandResult{Stderr: []byte{}, Stdout: []byte{}, Success: false}
	}

	command := exec.Command(arguments[0], arguments[1:]...)
	command.Dir = options.WorkingDir
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

type ManagedCaddyCommandOptions struct {
	AdminAddress string
	InheritStdio bool
	RuntimeOS    string
}

type ManagedCaddyCommandDependencies struct {
	RunCommand func([]string, RunCommandOptions) CommandResult
	Stat       func(string) (os.FileInfo, error)
}

func CreateManagedCaddyCommandArguments(paths Paths, arguments []string, options ManagedCaddyCommandOptions) []string {
	commandArguments := append([]string{}, arguments...)
	if strings.TrimSpace(options.AdminAddress) != "" {
		commandArguments = append(commandArguments, "--address", strings.TrimSpace(options.AdminAddress))
	}

	commandArguments = append(commandArguments, "--config", paths.CaddyfilePath, "--adapter", "caddyfile")
	return commandArguments
}

func CreateManagedCaddyExecutablePath(paths Paths, runtimeOS string) string {
	if runtimeOS == "windows" || runtimeOS == "win32" {
		return filepath.Join(paths.CaddyDirectoryPath, "caddy.exe")
	}

	return filepath.Join(paths.CaddyDirectoryPath, "caddy")
}

func ResolveManagedCaddyExecutablePath(paths Paths, runtimeOS string, stat func(string) (os.FileInfo, error)) string {
	if stat == nil {
		stat = os.Stat
	}

	executablePath := CreateManagedCaddyExecutablePath(paths, runtimeOS)
	if _, error := stat(executablePath); error == nil {
		return executablePath
	}

	return "caddy"
}

func RunManagedCaddyCommand(paths Paths, arguments []string, options ManagedCaddyCommandOptions, dependencies ManagedCaddyCommandDependencies) CommandResult {
	runCommand := dependencies.RunCommand
	if runCommand == nil {
		runCommand = RunCommand
	}

	resolvedRuntimeOS := options.RuntimeOS
	resolvedRuntimeOS = strings.TrimSpace(resolvedRuntimeOS)

	executablePath := ResolveManagedCaddyExecutablePath(paths, resolvedRuntimeOS, dependencies.Stat)
	commandArguments := append([]string{executablePath}, CreateManagedCaddyCommandArguments(paths, arguments, options)...)
	return runCommand(commandArguments, RunCommandOptions{InheritStdio: options.InheritStdio, WorkingDir: paths.CaddyDirectoryPath})
}

func CreateManagedCaddyCommandErrorMessage(commandName string, result CommandResult) string {
	combinedOutput := []string{}
	if stderrText := strings.TrimSpace(string(result.Stderr)); stderrText != "" {
		combinedOutput = append(combinedOutput, stderrText)
	}
	if stdoutText := strings.TrimSpace(string(result.Stdout)); stdoutText != "" {
		combinedOutput = append(combinedOutput, stdoutText)
	}

	if len(combinedOutput) == 0 {
		return fmt.Sprintf("Caddy %s failed.", commandName)
	}

	return fmt.Sprintf("Caddy %s failed.\n%s", commandName, strings.Join(combinedOutput, "\n"))
}
