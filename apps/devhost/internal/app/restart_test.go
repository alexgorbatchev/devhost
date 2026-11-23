package app

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy"
)

func TestRestartCommandsSelectProjectOrStateDirectory(t *testing.T) {
	state := t.TempDir()
	t.Setenv("DEVHOST_STATE_DIR", state)
	t.Setenv("DEVHOST_MANIFEST", "")
	t.Setenv("DEVHOST_TEST_CLI", "1")
	useSharedCaddy(t, state)
	paths := caddy.CreateManagedCaddyPaths(state)

	const serveDomain = "restart-serve.localhost"
	const serveName = "serve-" + serveDomain
	project, otherProject, outside := t.TempDir(), t.TempDir(), t.TempDir()
	nested := filepath.Join(project, "subdirectory", "nested")
	if err := os.MkdirAll(nested, 0o700); err != nil {
		t.Fatal(err)
	}

	readStacks := func() map[string]caddy.LiveStack {
		t.Helper()
		stacks, err := caddy.ReadLiveStacks(paths)
		if err != nil {
			t.Fatal(err)
		}
		byName := make(map[string]caddy.LiveStack, len(stacks))
		for _, stack := range stacks {
			byName[stack.Name] = stack
		}
		return byName
	}
	waitForRegistration := func(name string, pid int) {
		t.Helper()
		for deadline := time.Now().Add(10 * time.Second); time.Now().Before(deadline); {
			if stack := readStacks()[name]; stack.PID == pid && stack.ControlPort != 0 {
				return
			}
			time.Sleep(20 * time.Millisecond)
		}
		t.Fatalf("%s (PID %d) did not register its control server", name, pid)
	}
	start := func(name, directory string, args ...string) {
		t.Helper()
		cmd := exec.Command(os.Args[0], args...)
		cmd.Dir = directory
		log, err := os.Create(filepath.Join(state, name+".log"))
		if err != nil {
			t.Fatal(err)
		}
		defer log.Close()
		cmd.Stdout, cmd.Stderr = log, log
		if err := cmd.Start(); err != nil {
			t.Fatal(err)
		}
		exited := make(chan error, 1)
		go func() { exited <- cmd.Wait() }()
		t.Cleanup(func() {
			_ = cmd.Process.Signal(syscall.SIGTERM)
			select {
			case err := <-exited:
				var exit *exec.ExitError
				if !errors.As(err, &exit) || exit.ExitCode() != 128+int(syscall.SIGTERM) {
					output, _ := os.ReadFile(log.Name())
					t.Errorf("%s exited: %v, want graceful SIGTERM\n%s", name, err, output)
				}
			case <-time.After(10 * time.Second):
				t.Errorf("%s did not stop during cleanup", name)
				_ = cmd.Process.Kill()
				<-exited
			}
		})
		waitForRegistration(name, cmd.Process.Pid)
	}

	for directory, name := range map[string]string{project: "project", otherProject: "other-project"} {
		content := fmt.Sprintf(`name = %q
[worktrees]
enabled = false
[services.web]
serve = "."
host = %q
`, name, name+".localhost")
		if err := os.WriteFile(filepath.Join(directory, "devhost.toml"), []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
		start(name, directory, "start", "--local")
	}
	start(serveName, outside, "serve", "--domain", serveDomain)
	t.Cleanup(func() {
		for _, stack := range readStacks() {
			if err := stack.Signal(paths, syscall.SIGTERM); err != nil {
				t.Errorf("stop %s: %v", stack.Name, err)
			}
			for deadline := time.Now().Add(10 * time.Second); stack.Alive() && time.Now().Before(deadline); {
				time.Sleep(20 * time.Millisecond)
			}
			if stack.Alive() {
				t.Errorf("%s did not stop during cleanup", stack.Name)
				_ = stack.Signal(paths, syscall.SIGKILL)
			}
		}
	})

	run := func(directory string, args ...string) {
		t.Helper()
		var output strings.Builder
		if code := Run(args, directory, &output, &output); code != 0 {
			logs, _ := filepath.Glob(filepath.Join(state, "restart-*", "*.log"))
			for _, path := range logs {
				data, err := os.ReadFile(path)
				if err == nil {
					t.Logf("%s:\n%s", path, data)
				}
			}
			t.Fatalf("Run(%v) = %d: %s", args, code, output.String())
		}
	}
	assertReplacement := func(old, replacement caddy.LiveStack) {
		t.Helper()
		if replacement.ControlPort == 0 || replacement.PID == old.PID || old.Alive() {
			t.Fatalf("%s was not replaced: before %+v, after %+v", old.Name, old, replacement)
		}
	}

	before := readStacks()
	run(nested, "stack", "restart", "--all")
	projectRestart := readStacks()
	assertReplacement(before["project"], projectRestart["project"])
	for _, name := range []string{"other-project", serveName} {
		if projectRestart[name].PID != before[name].PID || !before[name].Alive() {
			t.Fatalf("project restart changed %s: before %+v, after %+v", name, before[name], projectRestart[name])
		}
	}

	t.Setenv("DEVHOST_MANIFEST", filepath.Join(outside, "missing", "devhost.toml"))
	run(outside, "restart-all")
	stateRestart := readStacks()
	if len(stateRestart) != 3 {
		t.Fatalf("state restart left %d stacks, want 3: %+v", len(stateRestart), stateRestart)
	}
	for name, old := range projectRestart {
		assertReplacement(old, stateRestart[name])
	}
}
