package services

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/nettest"
)

const restartHelperVariable = "DEVHOST_TEST_RESTART_HELPER"
const restartHelperExitMarker = "exit-before-register"

type restartTrace struct {
	Args      []string
	Directory string
	Value     string
}

func runRestartHelper() int {
	stops := make(chan os.Signal, 1)
	signal.Notify(stops, syscall.SIGTERM)
	paths := caddy.CreateManagedCaddyPaths(os.Getenv("DEVHOST_STATE_DIR"))
	port, err := strconv.Atoi(os.Getenv("DEVHOST_TEST_RESTART_PORT"))
	if err != nil {
		return 2
	}
	directory, err := os.Getwd()
	if err != nil {
		return 4
	}
	if _, err := os.Stat(filepath.Join(directory, restartHelperExitMarker)); err == nil {
		return 9
	}
	trace, err := json.Marshal(restartTrace{Args: os.Args[1:], Directory: directory, Value: os.Getenv("DEVHOST_TEST_RESTART_VALUE")})
	if err != nil {
		return 5
	}
	if err := os.WriteFile(filepath.Join(paths.StateDirectoryPath, strconv.Itoa(os.Getpid())+".trace"), trace, 0o600); err != nil {
		return 6
	}
	if err := caddy.RegisterStack(caddy.RegisterStackOptions{
		ManifestPath: os.Getenv("DEVHOST_TEST_RESTART_MANIFEST"), StackName: "fixture", ControlPort: port, StacksDirectoryPath: paths.StacksDirectoryPath,
	}); err != nil {
		return 3
	}
	<-stops
	if err := caddy.UnregisterStack(paths.StacksDirectoryPath); err != nil {
		return 7
	}
	return 0
}

func startRestartFixture(t *testing.T, state, manifestPath string, serveArgs ...string) caddy.LiveStack {
	t.Helper()
	directory := t.TempDir()
	args := []string{"start", "--manifest", "./devhost.toml", "web"}
	if manifestPath == "" {
		args = []string{"serve", "--dir", ".", "--domain", "docs.localhost"}
		if len(serveArgs) > 0 {
			args = append([]string{"serve"}, serveArgs...)
		}
	}
	command := exec.Command(os.Args[0], args...)
	command.Dir = directory
	command.Env = append(os.Environ(), restartHelperVariable+"=1", "DEVHOST_STATE_DIR="+state,
		"DEVHOST_TEST_RESTART_MANIFEST="+manifestPath, "DEVHOST_TEST_RESTART_VALUE=preserved value",
		fmt.Sprintf("DEVHOST_TEST_RESTART_PORT=%d", nettest.ReservePort(t)))
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	done := make(chan struct{})
	go func() { _ = command.Wait(); close(done) }()
	t.Cleanup(func() { _ = command.Process.Signal(syscall.SIGTERM); <-done })
	paths := caddy.CreateManagedCaddyPaths(state)
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		stacks, err := caddy.ReadLiveStacks(paths)
		if err != nil {
			t.Fatal(err)
		}
		for _, stack := range stacks {
			if stack.PID == command.Process.Pid {
				if _, err := os.Stat(filepath.Join(state, strconv.Itoa(stack.PID)+".trace")); err == nil {
					return stack
				}
			}
		}
		time.Sleep(restartPollInterval)
	}
	t.Fatal("fixture did not register")
	return caddy.LiveStack{}
}

func TestRestartAllKeepsFileSessionWithUnavailableServedDirectory(t *testing.T) {
	state := t.TempDir()
	paths := caddy.CreateManagedCaddyPaths(state)
	servedDirectory := filepath.Join(t.TempDir(), "storybook-static")
	if err := os.Mkdir(servedDirectory, 0o700); err != nil {
		t.Fatal(err)
	}
	original := startRestartFixture(t, state, "", "--dir="+servedDirectory, "-d", "docs.localhost")
	healthy := startRestartFixture(t, state, "")
	stopRestartFixturesOnCleanup(t, paths, original.PID, healthy.PID)
	if err := os.Remove(servedDirectory); err != nil {
		t.Fatal(err)
	}

	var output strings.Builder
	err := RestartStacks(RestartStacksOptions{All: true}, map[string]string{"DEVHOST_STATE_DIR": state}, &output)
	if !original.Alive() {
		t.Fatal("restart stopped the session with an unavailable served directory")
	}
	if err == nil || !strings.Contains(err.Error(), "left running") || !strings.Contains(err.Error(), servedDirectory) {
		t.Fatalf("error = %v, want the unavailable directory and that the session was left running", err)
	}
	stacks, err := caddy.ReadLiveStacks(paths)
	if err != nil {
		t.Fatal(err)
	}
	if len(stacks) != 2 || healthy.Alive() {
		t.Fatalf("healthy session was not replaced: %v", stacks)
	}
}

func TestRestartReportsReplacementExitStatus(t *testing.T) {
	state := t.TempDir()
	manifest := filepath.Join(t.TempDir(), "devhost.toml")
	original := startRestartFixture(t, state, manifest)
	data, err := os.ReadFile(filepath.Join(state, strconv.Itoa(original.PID)+".trace"))
	if err != nil {
		t.Fatal(err)
	}
	var trace restartTrace
	if err := json.Unmarshal(data, &trace); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(trace.Directory, restartHelperExitMarker), nil, 0o600); err != nil {
		t.Fatal(err)
	}
	err = RestartStacks(RestartStacksOptions{ManifestPath: manifest}, map[string]string{"DEVHOST_STATE_DIR": state}, &strings.Builder{})
	if err == nil || !strings.Contains(err.Error(), "replacement exited before its control server registered (exit status 9)") {
		t.Fatalf("error = %v, want replacement exit status 9", err)
	}
}

func stopRestartFixturesOnCleanup(t *testing.T, paths caddy.Paths, originalPIDs ...int) {
	t.Helper()
	t.Cleanup(func() {
		stacks, err := caddy.ReadLiveStacks(paths)
		if err != nil {
			t.Error(err)
			return
		}
		for _, stack := range stacks {
			if slices.Contains(originalPIDs, stack.PID) {
				continue // Original fixtures already have cleanup registered.
			}
			if err := stack.Signal(paths, syscall.SIGTERM); err != nil {
				t.Error(err)
				continue
			}
			deadline := time.Now().Add(10 * time.Second)
			for processExists(stack.PID) && time.Now().Before(deadline) {
				time.Sleep(restartPollInterval)
			}
			if processExists(stack.PID) {
				t.Errorf("replacement %d did not stop", stack.PID)
				if err := stack.Signal(paths, syscall.SIGKILL); err != nil {
					t.Error(err)
					continue
				}
			}
			p, err := os.FindProcess(stack.PID)
			if err != nil {
				t.Error(err)
				continue
			}
			_, _ = p.Wait()
		}
	})
}

func TestRestartStacksPreservesLaunchAndScope(t *testing.T) {
	for _, all := range []bool{false, true} {
		t.Run(strconv.FormatBool(all), func(t *testing.T) {
			state := t.TempDir()
			paths := caddy.CreateManagedCaddyPaths(state)
			manifestPath := filepath.Join(t.TempDir(), "devhost.toml")
			target := startRestartFixture(t, state, manifestPath)
			other := startRestartFixture(t, state, "") // Standalone serve sessions have no manifest.
			stopRestartFixturesOnCleanup(t, paths, target.PID, other.PID)
			var output strings.Builder
			if err := RestartStacks(RestartStacksOptions{All: all, ManifestPath: manifestPath}, map[string]string{"DEVHOST_STATE_DIR": state}, &output); err != nil {
				t.Fatal(err)
			}
			if target.Alive() {
				t.Fatal("old target still runs")
			}
			if other.Alive() == all {
				t.Fatalf("other alive = %v, all = %v", other.Alive(), all)
			}
			stacks, err := caddy.ReadLiveStacks(paths)
			if err != nil {
				t.Fatal(err)
			}
			if len(stacks) != 2 {
				t.Fatalf("stacks = %#v", stacks)
			}
			for _, stack := range stacks {
				if stack.PID == other.PID {
					continue
				}
				original := target
				if stack.ManifestPath == "" {
					original = other
				}
				before, err := os.ReadFile(filepath.Join(state, strconv.Itoa(original.PID)+".trace"))
				if err != nil {
					t.Fatal(err)
				}
				after, err := os.ReadFile(filepath.Join(state, strconv.Itoa(stack.PID)+".trace"))
				if err != nil {
					t.Fatal(err)
				}
				var beforeLaunch, afterLaunch restartTrace
				if err := json.Unmarshal(before, &beforeLaunch); err != nil {
					t.Fatal(err)
				}
				if err := json.Unmarshal(after, &afterLaunch); err != nil {
					t.Fatal(err)
				}
				if original.ManifestPath != "" {
					beforeLaunch.Args = append(beforeLaunch.Args, "--remote=false", "--local=true")
				}
				if !slices.Equal(beforeLaunch.Args, afterLaunch.Args) || beforeLaunch.Directory != afterLaunch.Directory || beforeLaunch.Value != afterLaunch.Value {
					t.Fatalf("launch changed: %s => %s", before, after)
				}
				if !strings.Contains(output.String(), fmt.Sprintf("PID %d", stack.PID)) {
					t.Fatal("replacement PID missing from output")
				}
			}
			logs, err := filepath.Glob(filepath.Join(state, "restart-*", "*.log"))
			if err != nil || len(logs) == 0 {
				t.Fatalf("logs: %v, %v", logs, err)
			}
			for _, log := range logs {
				info, err := os.Stat(log)
				if err != nil {
					t.Fatal(err)
				}
				if info.Mode().Perm() != 0o600 {
					t.Fatalf("log permissions = %v", info.Mode())
				}
			}
		})
	}
}

func TestRestartCaptureFailureLeavesAllStacksRunning(t *testing.T) {
	state := t.TempDir()
	stack := startRestartFixture(t, state, filepath.Join(t.TempDir(), "devhost.toml"))
	paths := caddy.CreateManagedCaddyPaths(state)
	if err := caddy.RegisterStack(caddy.RegisterStackOptions{StackName: "self", StacksDirectoryPath: paths.StacksDirectoryPath}); err != nil {
		t.Fatal(err)
	}
	err := RestartStacks(RestartStacksOptions{All: true}, map[string]string{"DEVHOST_STATE_DIR": state}, &strings.Builder{})
	if err == nil || !strings.Contains(err.Error(), "ancestor") {
		t.Fatalf("error = %v", err)
	}
	if !stack.Alive() {
		t.Fatal("capture failure stopped a stack")
	}
	entries, err := os.ReadDir(state)
	if err != nil {
		t.Fatal(err)
	}
	if slices.ContainsFunc(entries, func(e os.DirEntry) bool { return strings.HasPrefix(e.Name(), "restart-") }) {
		t.Fatal("failed capture left scratch logs")
	}
}

func TestRestartAllRetiresSessionWithDeletedWorkingDirectory(t *testing.T) {
	state := t.TempDir()
	paths := caddy.CreateManagedCaddyPaths(state)
	orphan := startRestartFixture(t, state, "")
	manifestPath := filepath.Join(t.TempDir(), "devhost.toml")
	healthy := startRestartFixture(t, state, manifestPath)
	stopRestartFixturesOnCleanup(t, paths, orphan.PID, healthy.PID)
	data, err := os.ReadFile(filepath.Join(state, strconv.Itoa(orphan.PID)+".trace"))
	if err != nil {
		t.Fatal(err)
	}
	var trace restartTrace
	if err := json.Unmarshal(data, &trace); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(trace.Directory); err != nil {
		t.Fatal(err)
	}
	var output strings.Builder
	if err := RestartStacks(RestartStacksOptions{All: true}, map[string]string{"DEVHOST_STATE_DIR": state}, &output); err != nil {
		t.Fatal(err)
	}
	stacks, err := caddy.ReadLiveStacks(paths)
	if err != nil {
		t.Fatal(err)
	}
	if orphan.Alive() || healthy.Alive() || len(stacks) != 1 || stacks[0].ManifestPath != manifestPath {
		t.Fatalf("expected just the healthy replacement, got %#v", stacks)
	}
	if !strings.Contains(output.String(), fmt.Sprintf("Stopped %s (PID %d)", orphan.Name, orphan.PID)) {
		t.Fatalf("output did not report stopping the orphan: %s", &output)
	}
}

func TestRestartPreservesResolvedModeBeforeServiceSeparator(t *testing.T) {
	for _, tc := range []struct {
		args, want []string
		remote     bool
	}{
		{[]string{"start", "--", "web"}, []string{"start", "--remote=false", "--local=true", "--", "web"}, false},
		{[]string{"start", "web"}, []string{"start", "web", "--remote=true", "--local=false"}, true},
		{[]string{"serve", "--domain", "web.localhost"}, []string{"serve", "--domain", "web.localhost"}, false},
	} {
		got := preserveLaunchMode(tc.args, tc.remote)
		if !slices.Equal(got, tc.want) {
			t.Fatalf("launch arguments %v, want %v", got, tc.want)
		}
		if again := preserveLaunchMode(got, tc.remote); !slices.Equal(again, got) {
			t.Fatalf("repeated restarts grew launch arguments: %v", again)
		}
	}
}
