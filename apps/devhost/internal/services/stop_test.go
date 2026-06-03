package services

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strconv"
	"syscall"
	"testing"
	"time"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy"
)

func TestStopHelperProcess(t *testing.T) {
	if os.Getenv("GO_WANT_STOP_HELPER_PROCESS") != "1" {
		return
	}

	mode := os.Getenv("DEVHOST_STOP_HELPER_MODE")
	switch mode {
	case "sleep":
		// Sleep for up to 10 seconds, waiting to be killed or stop
		time.Sleep(10 * time.Second)
		os.Exit(0)
	case "graceful":
		signals := make(chan os.Signal, 1)
		signal.Notify(signals, syscall.SIGTERM)
		<-signals
		os.Exit(0)
	default:
		os.Exit(2)
	}
}

func TestStopStack_NoProcesses(t *testing.T) {
	tempDir := t.TempDir()
	environment := map[string]string{
		"DEVHOST_STATE_DIR": tempDir,
	}

	manifestPath := filepath.Join(tempDir, "devhost.toml")
	if err := os.WriteFile(manifestPath, []byte(""), 0o644); err != nil {
		t.Fatalf("failed to create dummy manifest: %v", err)
	}

	var stdout io.Writer = os.Stdout
	var stderr io.Writer = os.Stderr

	// Since there are no claim files, it should print "No active devhost stack process found" and succeed.
	err := StopStack(manifestPath, environment, stdout, stderr)
	if err != nil {
		t.Fatalf("StopStack failed: %v", err)
	}
}

func TestStopStack_CleanShutdown(t *testing.T) {
	tempDir := t.TempDir()
	environment := map[string]string{
		"DEVHOST_STATE_DIR": tempDir,
	}

	// 1. Spawn graceful helper process
	cmd := exec.Command(os.Args[0], "-test.run=TestStopHelperProcess", "--")
	cmd.Env = append(os.Environ(), "GO_WANT_STOP_HELPER_PROCESS=1", "DEVHOST_STOP_HELPER_MODE=graceful")
	if err := cmd.Start(); err != nil {
		t.Fatalf("failed to start helper process: %v", err)
	}
	defer func() {
		_ = cmd.Process.Kill()
	}()

	manifestPath := filepath.Join(tempDir, "devhost.toml")
	if err := os.WriteFile(manifestPath, []byte(""), 0o644); err != nil {
		t.Fatalf("failed to create dummy manifest: %v", err)
	}

	// 2. Setup mock claim directories and a mock registration file
	paths, err := caddy.CreateManagedCaddyPathsFromEnvironment(environment)
	if err != nil {
		t.Fatalf("failed to resolve caddy paths: %v", err)
	}

	err = os.MkdirAll(paths.RegistrationsDirectoryPath, 0o755)
	if err != nil {
		t.Fatalf("failed to create registrations directory: %v", err)
	}

	claim := claimMetadata{
		OwnerPID:     cmd.Process.Pid,
		ManifestPath: manifestPath,
	}
	claimBytes, err := json.Marshal(claim)
	if err != nil {
		t.Fatalf("failed to marshal mock claim: %v", err)
	}

	registrationPath := filepath.Join(paths.RegistrationsDirectoryPath, "mock_registration.json")
	if err := os.WriteFile(registrationPath, claimBytes, 0o644); err != nil {
		t.Fatalf("failed to write mock claim file: %v", err)
	}

	// 3. Verify target process exists initially
	if !processExists(cmd.Process.Pid) {
		t.Fatalf("helper process %d should be running initially", cmd.Process.Pid)
	}

	// 4. Run StopStack
	err = StopStack(manifestPath, environment, io.Discard, io.Discard)
	if err != nil {
		t.Fatalf("StopStack failed: %v", err)
	}

	// 5. Verify target process has been stopped
	// Wait up to 2 seconds for OS to clean up process table
	dead := false
	for i := 0; i < 20; i++ {
		if !processExists(cmd.Process.Pid) {
			dead = true
			break
		}
		time.Sleep(100 * time.Millisecond)
	}

	if !dead {
		t.Fatalf("expected helper process %d to be stopped, but it is still alive", cmd.Process.Pid)
	}
}

func TestStopStack_ProcessAlreadyDead(t *testing.T) {
	tempDir := t.TempDir()
	environment := map[string]string{
		"DEVHOST_STATE_DIR": tempDir,
	}

	manifestPath := filepath.Join(tempDir, "devhost.toml")
	if err := os.WriteFile(manifestPath, []byte(""), 0o644); err != nil {
		t.Fatalf("failed to create dummy manifest: %v", err)
	}

	paths, err := caddy.CreateManagedCaddyPathsFromEnvironment(environment)
	if err != nil {
		t.Fatalf("failed to resolve caddy paths: %v", err)
	}

	err = os.MkdirAll(paths.RegistrationsDirectoryPath, 0o755)
	if err != nil {
		t.Fatalf("failed to create registrations directory: %v", err)
	}

	// Use a non-existent PID (e.g. incredibly high PID)
	nonExistentPID := 999999
	// Verify it indeed does not exist
	if processExists(nonExistentPID) {
		t.Skip("skipping test: high PID 999999 exists on this machine")
	}

	claim := claimMetadata{
		OwnerPID:     nonExistentPID,
		ManifestPath: manifestPath,
	}
	claimBytes, err := json.Marshal(claim)
	if err != nil {
		t.Fatalf("failed to marshal mock claim: %v", err)
	}

	registrationPath := filepath.Join(paths.RegistrationsDirectoryPath, "mock_registration.json")
	if err := os.WriteFile(registrationPath, claimBytes, 0o644); err != nil {
		t.Fatalf("failed to write mock claim file: %v", err)
	}

	// StopStack should identify the registration, check aliveness, realize it is already dead,
	// and finish cleanly without error.
	err = StopStack(manifestPath, environment, io.Discard, io.Discard)
	if err != nil {
		t.Fatalf("StopStack with dead PID failed: %v", err)
	}
}

func TestStopStack_TargetAndClaimsPathsHandling(t *testing.T) {
	tempDir := t.TempDir()
	environment := map[string]string{
		"DEVHOST_STATE_DIR": tempDir,
	}

	manifestPath := filepath.Join(tempDir, "devhost.toml")
	if err := os.WriteFile(manifestPath, []byte(""), 0o644); err != nil {
		t.Fatalf("failed to create dummy manifest: %v", err)
	}

	paths, err := caddy.CreateManagedCaddyPathsFromEnvironment(environment)
	if err != nil {
		t.Fatalf("failed to resolve caddy paths: %v", err)
	}

	err = os.MkdirAll(paths.HostClaimsDirectoryPath, 0o755)
	if err != nil {
		t.Fatalf("failed to create host claims directory: %v", err)
	}

	// Setup multiple mock claims in HostClaims directory:
	// 1. One with relative/dirty manifest path matching our target manifest path.
	// 2. One with non-matching manifest path.
	nonMatchingPath := filepath.Join(tempDir, "other.toml")

	claims := []struct {
		pid      int
		path     string
		filename string
	}{
		{111111, "./devhost.toml", "matching_relative.json"}, // Will resolve relative to working directory or be cleaned
		{222222, nonMatchingPath, "non_matching.json"},
	}

	// Write mock claims
	for _, tc := range claims {
		// If it is "./devhost.toml", let's resolve it relative to tempDir to simulate a claim written from that directory.
		realPath := tc.path
		if tc.path == "./devhost.toml" {
			realPath = manifestPath
		}
		claim := claimMetadata{
			OwnerPID:     tc.pid,
			ManifestPath: realPath,
		}
		claimBytes, _ := json.Marshal(claim)
		_ = os.WriteFile(filepath.Join(paths.HostClaimsDirectoryPath, tc.filename), claimBytes, 0o644)
	}

	// Scan and verify that scanForManifestPIDs returns ONLY PID 111111.
	pids, err := scanForManifestPIDs(paths, manifestPath)
	if err != nil {
		t.Fatalf("scanForManifestPIDs failed: %v", err)
	}

	if !pids[111111] {
		t.Errorf("expected PID 111111 to be found in scan, pids: %v", pids)
	}
	if pids[222222] {
		t.Errorf("did not expect PID 222222 to be found in scan, pids: %v", pids)
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
