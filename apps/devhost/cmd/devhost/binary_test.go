package main

import (
	"bytes"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/cli"
)

// The skill has to reach an agent that has only the binary, so this runs the
// compiled executable from a directory that holds nothing else, with nothing of
// the checkout in its environment.
func TestBinaryPrintsTheSkillWithoutTheRepository(t *testing.T) {
	t.Parallel()

	directoryPath := t.TempDir()
	binaryPath := filepath.Join(directoryPath, "devhost")

	build := exec.CommandContext(t.Context(), "go", "build", "-o", binaryPath, ".")
	if output, err := build.CombinedOutput(); err != nil {
		t.Fatalf("build devhost: %v\n%s", err, output)
	}

	// internal/cli pins these bytes; the binary prints the same ones.
	var want bytes.Buffer
	if _, err := cli.ParseCommandLineArguments([]string{"skill"}, &want, io.Discard); err != nil {
		t.Fatalf("cli.ParseCommandLineArguments(skill) unexpected error = %v", err)
	}

	for _, agent := range []string{"0", "1"} {
		t.Run("AGENT="+agent, func(t *testing.T) {
			t.Parallel()

			var stderr bytes.Buffer
			command := exec.CommandContext(t.Context(), binaryPath, "skill")
			command.Dir = directoryPath
			command.Env = []string{"AGENT=" + agent, "PATH=" + os.Getenv("PATH")}
			command.Stderr = &stderr

			stdout, err := command.Output()
			if err != nil {
				t.Fatalf("devhost skill: %v\n%s", err, stderr.String())
			}

			if string(stdout) != want.String() {
				t.Fatalf("devhost skill stdout = %q, want %q", stdout, want.String())
			}

			if stderr.String() != "" {
				t.Fatalf("devhost skill stderr = %q, want empty", stderr.String())
			}
		})
	}
}
