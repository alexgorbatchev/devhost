package caddy

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

func TestRegisterStackRejectsRunningManifest(t *testing.T) {
	for _, state := range []string{"running", "exited", "reused PID"} {
		t.Run(state, func(t *testing.T) {
			process := startZombieProcess(t)
			paths := newManagedCaddyPaths(t)
			record := stackRecord{CreatedAt: "now", ManifestPath: identityTestManifestPath, OwnerPID: process.pid, OwnerStartIdentity: readStartIdentity(t, process.pid), StackName: "running"}
			if state == "exited" {
				p, err := os.FindProcess(process.pid)
				if err != nil {
					t.Fatal(err)
				}
				if err := p.Kill(); err != nil {
					t.Fatal(err)
				}
				process.assertKilled(t)
			} else if state == "reused PID" {
				record.OwnerStartIdentity = exitedOwnerStartIdentity
			}
			data, err := json.Marshal(record)
			if err != nil {
				t.Fatal(err)
			}
			writeRegistration(t, filepath.Join(paths.StacksDirectoryPath, "running.json"), string(data))
			err = RegisterStack(RegisterStackOptions{ManifestPath: identityTestManifestPath, StackName: "second", StacksDirectoryPath: paths.StacksDirectoryPath})
			if state != "running" {
				if err != nil {
					t.Fatalf("stale owner blocked startup: %v", err)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), "already running") {
				t.Fatalf("second startup error = %v, want already running", err)
			}
			if _, err := os.Stat(getStackRecordPath(paths.StacksDirectoryPath)); !os.IsNotExist(err) {
				t.Fatalf("rejected startup wrote a record: %v", err)
			}
		})
	}
}

const stackRegistrationTestOptions = "DEVHOST_TEST_STACK_REGISTRATION"

// Each helper uses its own real PID/start identity and the production record lock.
func TestStackRegistrationProcess(t *testing.T) {
	value := os.Getenv(stackRegistrationTestOptions)
	if value == "" {
		return
	}
	var options RegisterStackOptions
	if err := json.Unmarshal([]byte(value), &options); err != nil {
		t.Fatal(err)
	}
	if err := RegisterStack(options); err != nil {
		fmt.Println(err)
		return
	}
	fmt.Println("registered")
	var input [1]byte
	_, _ = os.Stdin.Read(input[:]) // EOF from the parent requests normal shutdown.
	if err := UnregisterStack(options.StacksDirectoryPath); err != nil {
		t.Fatal(err)
	}
}

func startRegistrationProcess(t *testing.T, options RegisterStackOptions) (string, func()) {
	t.Helper()
	data, err := json.Marshal(options)
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(os.Args[0], "-test.run=^TestStackRegistrationProcess$")
	cmd.Env = append(os.Environ(), stackRegistrationTestOptions+"="+string(data))
	stdin, err := cmd.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	stop := sync.OnceFunc(func() {
		if err := stdin.Close(); err != nil {
			t.Error(err)
		}
		if err := cmd.Wait(); err != nil {
			t.Error(err)
		}
	})
	t.Cleanup(stop)
	scanner := bufio.NewScanner(stdout)
	if !scanner.Scan() {
		t.Fatalf("registration process produced no result: %v", scanner.Err())
	}
	return scanner.Text(), stop
}

func TestStackRegistrationManifestTrees(t *testing.T) {
	root := t.TempDir()
	parent, child, other := filepath.Join(root, "parent.toml"), filepath.Join(root, "child.toml"), filepath.Join(root, "other.toml")
	for _, path := range []string{parent, child, other} {
		if err := os.WriteFile(path, nil, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	alias := filepath.Join(root, "alias.toml")
	if err := os.Symlink(child, alias); err != nil {
		t.Fatal(err)
	}
	tests := []struct {
		name           string
		ownerRoot      string
		ownerFiles     []string
		candidateRoot  string
		candidateFiles []string
		conflict       bool
	}{
		{"same root", parent, nil, parent, nil, true},
		{"included solo", parent, []string{child}, child, nil, true},
		{"solo then included", child, nil, parent, []string{child}, true},
		{"shared include", parent, []string{child}, other, []string{child}, true},
		{"symlink include", parent, []string{child}, other, []string{alias}, true},
		{"independent", parent, nil, other, nil, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			dir := newManagedCaddyPaths(t).StacksDirectoryPath
			result, stop := startRegistrationProcess(t, RegisterStackOptions{ManifestPath: tt.ownerRoot, ManifestFiles: tt.ownerFiles, StackName: "owner", StacksDirectoryPath: dir})
			if result != "registered" {
				t.Fatal(result)
			}
			options := RegisterStackOptions{ManifestPath: tt.candidateRoot, ManifestFiles: tt.candidateFiles, StackName: "candidate", StacksDirectoryPath: dir}
			err := RegisterStack(options)
			if tt.conflict {
				if err == nil || !strings.Contains(err.Error(), "already running") || !strings.Contains(err.Error(), "devhost stop --manifest") {
					t.Fatalf("conflicting registration: %v", err)
				}
			} else if err != nil {
				t.Fatal(err)
			}
			stop()
			if err := RegisterStack(options); err != nil {
				t.Fatalf("registration after owner stops: %v", err)
			}
		})
	}
}

func TestStackRegistrationConcurrentStarts(t *testing.T) {
	dir := newManagedCaddyPaths(t).StacksDirectoryPath
	options := RegisterStackOptions{ManifestPath: identityTestManifestPath, StackName: "racing", StacksDirectoryPath: dir}
	results := make(chan string, 2)
	var wg sync.WaitGroup
	for range 2 {
		wg.Go(func() {
			result, _ := startRegistrationProcess(t, options)
			results <- result
		})
	}
	wg.Wait()
	close(results)
	registered, rejected := 0, 0
	for result := range results {
		switch {
		case result == "registered":
			registered++
		case strings.Contains(result, "already running"):
			rejected++
		default:
			t.Fatalf("unexpected registration result: %s", result)
		}
	}
	if registered != 1 || rejected != 1 {
		t.Fatalf("concurrent starts: %d registered, %d rejected", registered, rejected)
	}
}
