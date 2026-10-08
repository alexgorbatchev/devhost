package main

import (
	"bytes"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/skill"
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

			if string(stdout) != skill.Document() {
				t.Fatalf("devhost skill did not print the embedded SKILL.md byte for byte:\n%s", stdout)
			}

			if stderr.String() != "" {
				t.Fatalf("devhost skill stderr = %q, want empty", stderr.String())
			}
		})
	}
}
