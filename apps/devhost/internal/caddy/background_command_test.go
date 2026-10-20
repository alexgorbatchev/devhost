package caddy

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestBackgroundCommandRetainsChildOutput(t *testing.T) {
	if _, err := exec.LookPath("sh"); err != nil {
		t.Skip("requires sh")
	}
	dir := t.TempDir()
	runtimePath := filepath.Join(dir, "caddy.runtime.log")
	if err := os.WriteFile(runtimePath, []byte("old diagnostic\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	// A deadline guards against regressing to pipes inherited by the daemon.
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, "sh", "-c", "sleep 300 & echo $! > child.pid; printf 'new diagnostic\\n' >> caddy.runtime.log; printf 'started\\n'; printf 'startup warning\\n' >&2")
	command.Dir = dir
	t.Cleanup(func() {
		data, err := os.ReadFile(filepath.Join(dir, "child.pid"))
		if err != nil {
			t.Error(err)
			return
		}
		pid, err := strconv.Atoi(strings.TrimSpace(string(data)))
		if err != nil {
			t.Error(err)
			return
		}
		child, err := os.FindProcess(pid)
		if err != nil {
			t.Error(err)
			return
		}
		if err := child.Kill(); err != nil {
			t.Error(err)
		}
	})
	result := runBackgroundCommand(command)
	if !result.Success || string(result.Stdout) != "started\n" || string(result.Stderr) != "startup warning\nnew diagnostic\n" {
		t.Fatalf("result = %+v", result)
	}
	if ctx.Err() != nil {
		t.Fatal("startup waited for the background child")
	}
}

func TestRuntimeCommandOutputAfterRotation(t *testing.T) {
	path := filepath.Join(t.TempDir(), "runtime.log")
	if err := os.WriteFile(path, []byte("old\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	previous, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(path, path+".old"); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("new log\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	output, err := readRuntimeCommandOutput(path, previous)
	if err != nil || string(output) != "new log\n" {
		t.Fatalf("output = %q, err = %v", output, err)
	}
}
