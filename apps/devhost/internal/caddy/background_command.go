package caddy

import (
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
)

// Caddy start passes stdout and stderr to its long-lived child. Use files rather
// than pipes: exec.Cmd.Wait would otherwise wait for that child to close them.
func runBackgroundCommand(command *exec.Cmd) CommandResult {
	runtimePath := filepath.Join(command.Dir, "caddy.runtime.log")
	runtimeInfo, err := os.Stat(runtimePath)
	if err != nil && !os.IsNotExist(err) {
		return commandFailure(err)
	}
	stdout, err := os.OpenFile(filepath.Join(command.Dir, "caddy.stdout.log"), os.O_CREATE|os.O_RDWR|os.O_TRUNC, 0o600)
	if err != nil {
		return commandFailure(err)
	}
	defer stdout.Close()
	stderr, err := os.OpenFile(filepath.Join(command.Dir, "caddy.stderr.log"), os.O_CREATE|os.O_RDWR|os.O_TRUNC, 0o600)
	if err != nil {
		return commandFailure(err)
	}
	defer stderr.Close()
	command.Stdout, command.Stderr, command.Stdin = stdout, stderr, os.Stdin
	runErr := command.Run()
	out, outErr := readCommandOutput(stdout, 0)
	errout, errErr := readCommandOutput(stderr, 0)
	if outErr != nil {
		return commandFailure(outErr)
	}
	if errErr != nil {
		return commandFailure(errErr)
	}
	runtimeOutput, err := readRuntimeCommandOutput(runtimePath, runtimeInfo)
	if err != nil {
		return commandFailure(err)
	}
	errout = append(errout, runtimeOutput...)
	if runErr != nil && len(errout) == 0 {
		errout = []byte(runErr.Error())
	}
	return CommandResult{Stdout: out, Stderr: errout, Success: runErr == nil}
}

func readRuntimeCommandOutput(path string, previous os.FileInfo) ([]byte, error) {
	file, err := os.Open(path)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return nil, err
	}
	var offset int64
	if previous != nil && os.SameFile(previous, info) && info.Size() >= previous.Size() {
		offset = previous.Size()
	}
	return readCommandOutput(file, offset)
}

func readCommandOutput(file *os.File, offset int64) ([]byte, error) {
	info, err := file.Stat()
	if err != nil {
		return nil, err
	}
	return io.ReadAll(io.NewSectionReader(file, offset, info.Size()-offset))
}

func commandFailure(err error) CommandResult {
	return CommandResult{Stderr: []byte(fmt.Sprintf("capture Caddy output: %v", err))}
}
