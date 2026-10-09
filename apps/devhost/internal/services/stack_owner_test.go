package services

import (
	"fmt"
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

// What a stand-in stack does after it has made its claims.
const (
	// stackOwnerStopsOnRequest exits when it is sent SIGTERM, as a stack does.
	stackOwnerStopsOnRequest = "stops-on-request"
	// stackOwnerIgnoresRequests keeps running through SIGTERM.
	stackOwnerIgnoresRequests = "ignores-requests"
	// stackOwnerCrashes exits at once and leaves its claims behind.
	stackOwnerCrashes = "crashes"
)

const (
	stackOwnerHelperVariable   = "GO_WANT_STACK_OWNER_HELPER"
	stackOwnerManifestVariable = "DEVHOST_STACK_OWNER_MANIFEST"
	stackOwnerPortVariable     = "DEVHOST_STACK_OWNER_PORT"
	stackOwnerHostVariable     = "DEVHOST_STACK_OWNER_HOST"
	stackOwnerBehaviorVariable = "DEVHOST_STACK_OWNER_BEHAVIOR"
	stackOwnerReadyVariable    = "DEVHOST_STACK_OWNER_READY_FILE"
)

type stackOwnerOptions struct {
	// ManifestPath is the manifest the stand-in claims to run.
	ManifestPath string
	// Port is the fixed port it claims.
	Port int
	// Host is a hostname it also claims; empty for a stack without one.
	Host     string
	Behavior string
}

// TestStackOwnerHelperProcess is the stand-in for a running stack: a separate
// process that makes the claims a stack makes, through the functions a stack
// makes them with, so the records carry its PID.
func TestStackOwnerHelperProcess(t *testing.T) {
	if os.Getenv(stackOwnerHelperVariable) != "1" {
		return
	}

	if err := runStackOwnerHelper(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}
	os.Exit(0)
}

func runStackOwnerHelper() error {
	paths, err := caddy.CreateManagedCaddyPathsFromEnvironment(map[string]string{"DEVHOST_STATE_DIR": os.Getenv("DEVHOST_STATE_DIR")})
	if err != nil {
		return err
	}
	for _, directoryPath := range []string{paths.PortClaimsDirectoryPath, paths.HostClaimsDirectoryPath, paths.RegistrationsDirectoryPath} {
		if err := os.MkdirAll(directoryPath, 0o755); err != nil {
			return err
		}
	}

	manifestPath := os.Getenv(stackOwnerManifestVariable)
	port, err := strconv.Atoi(os.Getenv(stackOwnerPortVariable))
	if err != nil {
		return err
	}
	if err := caddy.ClaimFixedPort(caddy.ClaimFixedPortOptions{
		BindHost:                "127.0.0.1",
		Port:                    port,
		ManifestPath:            manifestPath,
		PortClaimsDirectoryPath: paths.PortClaimsDirectoryPath,
	}); err != nil {
		return err
	}
	if host := os.Getenv(stackOwnerHostVariable); host != "" {
		if err := caddy.ClaimHost(caddy.ClaimHostOptions{
			Host:                       host,
			ManifestPath:               manifestPath,
			RegistrationsDirectoryPath: paths.RegistrationsDirectoryPath,
		}); err != nil {
			return err
		}
	}

	// The handlers are in place before the test is told the stack is up, so a
	// signal sent right after cannot arrive early.
	stopRequests := make(chan os.Signal, 1)
	behavior := os.Getenv(stackOwnerBehaviorVariable)
	switch behavior {
	case stackOwnerStopsOnRequest:
		signal.Notify(stopRequests, syscall.SIGTERM)
	case stackOwnerIgnoresRequests:
		signal.Ignore(syscall.SIGTERM)
	}

	if err := os.WriteFile(os.Getenv(stackOwnerReadyVariable), nil, 0o644); err != nil {
		return err
	}

	switch behavior {
	case stackOwnerStopsOnRequest:
		<-stopRequests
	case stackOwnerIgnoresRequests:
		// Ended by SIGKILL: the one stop sends, or the one of the test that started it.
		for {
			time.Sleep(time.Hour)
		}
	case stackOwnerCrashes:
	default:
		return fmt.Errorf("unknown stack owner behavior %q", behavior)
	}

	return nil
}

// startStackOwner starts a stand-in stack that keeps its records under
// stateDirectoryPath, and returns once its claims are made. A stand-in that
// crashes has already exited and been reaped when this returns.
func startStackOwner(t *testing.T, stateDirectoryPath string, options stackOwnerOptions) *exec.Cmd {
	t.Helper()

	readyPath := filepath.Join(t.TempDir(), "ready")
	command := exec.Command(os.Args[0], "-test.run=^TestStackOwnerHelperProcess$")
	command.Stderr = os.Stderr
	command.Env = append(os.Environ(),
		stackOwnerHelperVariable+"=1",
		"DEVHOST_STATE_DIR="+stateDirectoryPath,
		stackOwnerManifestVariable+"="+options.ManifestPath,
		stackOwnerPortVariable+"="+strconv.Itoa(options.Port),
		stackOwnerHostVariable+"="+options.Host,
		stackOwnerBehaviorVariable+"="+options.Behavior,
		stackOwnerReadyVariable+"="+readyPath,
	)
	if err := command.Start(); err != nil {
		t.Fatalf("start stack owner: %v", err)
	}

	if options.Behavior == stackOwnerCrashes {
		if err := command.Wait(); err != nil {
			t.Fatalf("stack owner that crashes: %v", err)
		}
		return command
	}

	t.Cleanup(func() {
		_ = command.Process.Kill() // no-op once the stack owner has been stopped
		_ = command.Wait()         // reap it so it does not linger as a zombie
	})

	waitForCondition(t, 10*time.Second, func() bool {
		_, err := os.Stat(readyPath)
		return err == nil
	})

	return command
}
