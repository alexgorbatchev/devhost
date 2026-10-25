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

func startRestartFixture(t *testing.T, state, manifestPath string) caddy.LiveStack {
	t.Helper()
	directory := t.TempDir()
	args := []string{"start", "--manifest", "./devhost.toml", "web"}
	if manifestPath == "" {
		args = []string{"serve", "--dir", ".", "--domain", "docs.localhost"}
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

func TestRestartStacksPreservesLaunchAndScope(t *testing.T) {
	for _, all := range []bool{false, true} {
		t.Run(strconv.FormatBool(all), func(t *testing.T) {
			state := t.TempDir()
			paths := caddy.CreateManagedCaddyPaths(state)
			manifestPath := filepath.Join(t.TempDir(), "devhost.toml")
			target := startRestartFixture(t, state, manifestPath)
			other := startRestartFixture(t, state, "") // Standalone serve sessions have no manifest.
			t.Cleanup(func() {
				stacks, err := caddy.ReadLiveStacks(paths)
				if err != nil {
					t.Error(err)
					return
				}
				for _, stack := range stacks {
					if err := stack.Signal(paths, syscall.SIGTERM); err != nil {
						t.Error(err)
					}
				}
				deadline := time.Now().Add(10 * time.Second)
				for _, stack := range stacks {
					for processExists(stack.PID) && time.Now().Before(deadline) {
						time.Sleep(restartPollInterval)
					}
					if processExists(stack.PID) {
						t.Errorf("fixture %d did not stop", stack.PID)
					}
					if stack.PID != target.PID && stack.PID != other.PID {
						p, err := os.FindProcess(stack.PID)
						if err == nil {
							_, _ = p.Wait()
						}
					}
				}
			})
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
				if string(before) != string(after) {
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
