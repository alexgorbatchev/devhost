package services

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

// An unreachable grace period, for a stack expected to stop when asked.
const unreachableGracePeriod = time.Hour

const stackListHint = "Other stacks are running. Run \"devhost stack list\" to print their PIDs and manifests.\n"

// endedBySignal reports whether a process that has been waited for was ended by
// signal rather than by exiting.
func endedBySignal(waitError error, signal syscall.Signal) bool {
	var exitError *exec.ExitError
	if !errors.As(waitError, &exitError) {
		return false
	}

	status, ok := exitError.Sys().(syscall.WaitStatus)
	return ok && status.Signaled() && status.Signal() == signal
}

func TestStopStackWithoutAnyStack(t *testing.T) {
	environment := map[string]string{"DEVHOST_STATE_DIR": t.TempDir()}
	manifestPath := filepath.Join(t.TempDir(), "devhost.toml")

	var stdout strings.Builder
	var stderr strings.Builder

	if err := StopStack(manifestPath, environment, &stdout, &stderr); err != nil {
		t.Fatalf("StopStack() unexpected error = %v", err)
	}

	if want := "No active devhost stack process found for manifest: " + manifestPath + "\n"; stdout.String() != want {
		t.Fatalf("StopStack() stdout = %q, want %q", stdout.String(), want)
	}

	if stderr.String() != "" {
		t.Fatalf("StopStack() stderr = %q, want empty", stderr.String())
	}
}

func TestStopStackStopsTheStackOfTheManifest(t *testing.T) {
	stateDirectoryPath := t.TempDir()
	environment := map[string]string{"DEVHOST_STATE_DIR": stateDirectoryPath}

	projectsPath := t.TempDir()
	manifestPath := filepath.Join(projectsPath, "target", "devhost.toml")
	otherManifestPath := filepath.Join(projectsPath, "other", "devhost.toml")

	// The target keeps two records, which must not make it two processes to stop.
	target := startStackOwner(t, stateDirectoryPath, stackOwnerOptions{ManifestPath: manifestPath, Port: 4000, Host: "target.localhost", Behavior: stackOwnerStopsOnRequest})
	other := startStackOwner(t, stateDirectoryPath, stackOwnerOptions{ManifestPath: otherManifestPath, Port: 5000, Host: "other.localhost", Behavior: stackOwnerStopsOnRequest})

	var stdout strings.Builder
	var stderr strings.Builder

	if err := stopStack(manifestPath, environment, unreachableGracePeriod, &stdout, &stderr); err != nil {
		t.Fatalf("stopStack() unexpected error = %v", err)
	}

	// The stand-in exits with code 0 when it handles SIGTERM, so a clean Wait is
	// the proof that it was asked to stop and not killed.
	if err := target.Wait(); err != nil {
		t.Fatalf("target stack Wait() error = %v, want a clean exit", err)
	}

	targetPID := strconv.Itoa(target.Process.Pid)
	wantStdout := "Stopping 1 active stack process(es) associated with manifest...\n" +
		"Sending SIGTERM to process " + targetPID + "...\n" +
		"Process " + targetPID + " stopped cleanly.\n"
	if stdout.String() != wantStdout {
		t.Fatalf("stopStack() stdout = %q, want %q", stdout.String(), wantStdout)
	}

	if stderr.String() != "" {
		t.Fatalf("stopStack() stderr = %q, want empty", stderr.String())
	}

	if !processExists(other.Process.Pid) {
		t.Fatalf("stopStack() stopped the stack of %s, which it was not asked to stop", otherManifestPath)
	}
}

func TestStopStackKillsAStackThatIgnoresTheRequest(t *testing.T) {
	stateDirectoryPath := t.TempDir()
	environment := map[string]string{"DEVHOST_STATE_DIR": stateDirectoryPath}
	manifestPath := filepath.Join(t.TempDir(), "devhost.toml")

	stack := startStackOwner(t, stateDirectoryPath, stackOwnerOptions{ManifestPath: manifestPath, Port: 4000, Behavior: stackOwnerIgnoresRequests})

	var stdout strings.Builder
	var stderr strings.Builder

	// The test waits for the grace period to run out, so it is a short one.
	if err := stopStack(manifestPath, environment, 200*time.Millisecond, &stdout, &stderr); err != nil {
		t.Fatalf("stopStack() unexpected error = %v", err)
	}

	if err := stack.Wait(); !endedBySignal(err, syscall.SIGKILL) {
		t.Fatalf("stack Wait() error = %v, want it ended by SIGKILL", err)
	}

	stackPID := strconv.Itoa(stack.Process.Pid)
	wantStdout := "Stopping 1 active stack process(es) associated with manifest...\n" +
		"Sending SIGTERM to process " + stackPID + "...\n" +
		"Process " + stackPID + " terminated.\n"
	if stdout.String() != wantStdout {
		t.Fatalf("stopStack() stdout = %q, want %q", stdout.String(), wantStdout)
	}

	if want := "Process " + stackPID + " did not stop in time. Sending SIGKILL...\n"; stderr.String() != want {
		t.Fatalf("stopStack() stderr = %q, want %q", stderr.String(), want)
	}
}

func TestStopStackPointsAtTheOtherRunningStacks(t *testing.T) {
	stateDirectoryPath := t.TempDir()
	environment := map[string]string{"DEVHOST_STATE_DIR": stateDirectoryPath}

	projectsPath := t.TempDir()
	manifestPath := filepath.Join(projectsPath, "idle", "devhost.toml")
	otherManifestPath := filepath.Join(projectsPath, "other", "devhost.toml")

	other := startStackOwner(t, stateDirectoryPath, stackOwnerOptions{ManifestPath: otherManifestPath, Port: 5000, Host: "other.localhost", Behavior: stackOwnerStopsOnRequest})

	var stdout strings.Builder

	if err := StopStack(manifestPath, environment, &stdout, &strings.Builder{}); err != nil {
		t.Fatalf("StopStack() unexpected error = %v", err)
	}

	if want := "No active devhost stack process found for manifest: " + manifestPath + "\n" + stackListHint; stdout.String() != want {
		t.Fatalf("StopStack() stdout = %q, want %q", stdout.String(), want)
	}

	if !processExists(other.Process.Pid) {
		t.Fatalf("StopStack() stopped the stack of %s, which it was not asked to stop", otherManifestPath)
	}
}

func TestStopStackIgnoresTheRecordsOfACrashedStack(t *testing.T) {
	stateDirectoryPath := t.TempDir()
	environment := map[string]string{"DEVHOST_STATE_DIR": stateDirectoryPath}
	manifestPath := filepath.Join(t.TempDir(), "devhost.toml")

	startStackOwner(t, stateDirectoryPath, stackOwnerOptions{ManifestPath: manifestPath, Port: 4000, Host: "crashed.localhost", Behavior: stackOwnerCrashes})

	var stdout strings.Builder

	if err := StopStack(manifestPath, environment, &stdout, &strings.Builder{}); err != nil {
		t.Fatalf("StopStack() unexpected error = %v", err)
	}

	// Nothing runs, so there is nothing to stop and no other stack to point at.
	if want := "No active devhost stack process found for manifest: " + manifestPath + "\n"; stdout.String() != want {
		t.Fatalf("StopStack() stdout = %q, want %q", stdout.String(), want)
	}
}

func TestStopStackResolvesARelativeManifestPath(t *testing.T) {
	stateDirectoryPath := t.TempDir()
	environment := map[string]string{"DEVHOST_STATE_DIR": stateDirectoryPath}

	projectPath := t.TempDir()
	manifestPath := filepath.Join(projectPath, "devhost.toml")
	stack := startStackOwner(t, stateDirectoryPath, stackOwnerOptions{ManifestPath: manifestPath, Port: 4000, Behavior: stackOwnerStopsOnRequest})

	t.Chdir(projectPath)

	if err := stopStack("./devhost.toml", environment, unreachableGracePeriod, &strings.Builder{}, &strings.Builder{}); err != nil {
		t.Fatalf("stopStack() unexpected error = %v", err)
	}

	if err := stack.Wait(); err != nil {
		t.Fatalf("stack Wait() error = %v, want a clean exit", err)
	}
}

func TestStopStackReportsAnUnreadableRecord(t *testing.T) {
	stateDirectoryPath := t.TempDir()
	environment := map[string]string{"DEVHOST_STATE_DIR": stateDirectoryPath}
	manifestPath := filepath.Join(t.TempDir(), "devhost.toml")

	// A crashed stack leaves the directories in place for the damaged record.
	startStackOwner(t, stateDirectoryPath, stackOwnerOptions{ManifestPath: manifestPath, Port: 4000, Behavior: stackOwnerCrashes})
	damagedRecordPath := filepath.Join(stateDirectoryPath, "caddy", "port-claims", "damaged.json")
	if err := os.WriteFile(damagedRecordPath, []byte("{"), 0o644); err != nil {
		t.Fatalf("write damaged record: %v", err)
	}

	err := StopStack(manifestPath, environment, &strings.Builder{}, &strings.Builder{})
	if err == nil || !strings.Contains(err.Error(), damagedRecordPath) {
		t.Fatalf("StopStack() error = %v, want it to name %s", err, damagedRecordPath)
	}
}

func TestIsNoSuchProcessError(t *testing.T) {
	tests := []struct {
		err  error
		want bool
	}{
		{nil, false},
		{fmt.Errorf("random error"), false},
		{syscall.ESRCH, true},
	}

	for i, tt := range tests {
		t.Run(strconv.Itoa(i), func(t *testing.T) {
			got := isNoSuchProcessError(tt.err)
			if got != tt.want {
				t.Errorf("isNoSuchProcessError() = %v, want %v", got, tt.want)
			}
		})
	}
}
