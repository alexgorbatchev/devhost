package caddy

import (
	"reflect"
	"strings"
	"testing"
)

func TestRunManagedCaddyLifecycleCommand(t *testing.T) {
	t.Parallel()

	tests := []struct {
		action               LifecycleAction
		available            bool
		hasPidFile           bool
		hasRootCert          bool
		name                 string
		runResult            CommandResult
		wantCommandArguments [][]string
		wantCommandOptions   []ManagedCaddyCommandOptions
		wantError            string
		wantExitCode         int
		wantLog              string
		wantRemovedPidFile   bool
	}{
		{
			action:               LifecycleStart,
			available:            false,
			hasPidFile:           false,
			hasRootCert:          false,
			name:                 "starts managed caddy when admin api is unavailable",
			runResult:            CommandResult{Success: true},
			wantCommandArguments: [][]string{{"start", "--pidfile", "/tmp/devhost-state/caddy/caddy.pid"}},
			wantCommandOptions:   []ManagedCaddyCommandOptions{{InheritStdio: true}},
			wantExitCode:         0,
			wantLog:              "[devhost] managed caddy may prompt for your password on first start so it can install its local CA into the system trust store.\n[devhost] managed caddy started with /tmp/devhost-state/caddy/Caddyfile\n",
		},
		{
			action:       LifecycleStart,
			available:    true,
			hasPidFile:   true,
			hasRootCert:  true,
			name:         "returns success when managed caddy is already running",
			wantExitCode: 0,
			wantLog:      "[devhost] managed caddy is already running with /tmp/devhost-state/caddy/Caddyfile\n",
		},
		{
			action:      LifecycleStart,
			available:   true,
			hasPidFile:  false,
			hasRootCert: true,
			name:        "rejects foreign running caddy",
			wantError:   foreignManagedCaddyError,
		},
		{
			action:             LifecycleStop,
			available:          false,
			hasPidFile:         true,
			name:               "removes stale pid file",
			wantExitCode:       0,
			wantLog:            "[devhost] managed caddy is not running. Removed the stale pid file.\n",
			wantRemovedPidFile: true,
		},
		{
			action:               LifecycleStop,
			available:            true,
			hasPidFile:           true,
			name:                 "stops managed caddy",
			runResult:            CommandResult{Success: true},
			wantCommandArguments: [][]string{{"stop"}},
			wantCommandOptions:   []ManagedCaddyCommandOptions{{AdminAddress: "127.0.0.1:22000"}},
			wantExitCode:         0,
			wantLog:              "[devhost] managed caddy stopped.\n",
			wantRemovedPidFile:   true,
		},
		{
			action:     LifecycleStop,
			available:  true,
			hasPidFile: false,
			name:       "rejects foreign caddy on stop",
			wantError:  foreignManagedCaddyError,
		},
		{
			action:     LifecycleTrust,
			available:  false,
			hasPidFile: true,
			name:       "requires running managed caddy before trust",
			wantError:  "Managed Caddy is not running. Run 'devhost caddy start' first.",
			wantLog:    "[devhost] managed caddy trust may prompt for your password because installing a root CA into the system trust store is privileged.\n",
		},
		{
			action:     LifecycleTrust,
			available:  true,
			hasPidFile: false,
			name:       "rejects foreign caddy on trust",
			wantError:  foreignManagedCaddyError,
			wantLog:    "[devhost] managed caddy trust may prompt for your password because installing a root CA into the system trust store is privileged.\n",
		},
		{
			action:               LifecycleTrust,
			available:            true,
			hasPidFile:           true,
			name:                 "trusts managed caddy local ca",
			runResult:            CommandResult{Success: true},
			wantCommandArguments: [][]string{{"trust"}},
			wantCommandOptions:   []ManagedCaddyCommandOptions{{AdminAddress: "127.0.0.1:22000", InheritStdio: true}},
			wantExitCode:         0,
			wantLog:              "[devhost] managed caddy trust may prompt for your password because installing a root CA into the system trust store is privileged.\n[devhost] managed caddy local CA trusted.\n",
		},
	}

	for _, tt := range tests {
		tc := tt
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			paths := CreateManagedCaddyPaths("/tmp/devhost-state")
			var logOutput strings.Builder
			var callOrder []string
			var gotArguments [][]string
			var gotOptions []ManagedCaddyCommandOptions
			removedPidFile := false

			exitCode, error := RunManagedCaddyLifecycleCommand(tc.action, &logOutput, paths, ManagedCaddyConfigFallback{AdminAddress: "127.0.0.1:22000"}, ManagedCaddyLifecycleDependencies{
				EnsureManagedCaddyConfig: func() error {
					callOrder = append(callOrder, "ensure")
					return nil
				},
				HasManagedPidFile: func() bool {
					return tc.hasPidFile
				},
				HasManagedRootCert: func() bool {
					return tc.hasRootCert
				},
				IsManagedCaddyAvailable: func() bool {
					return tc.available
				},
				RemoveManagedPidFile: func() error {
					removedPidFile = true
					return nil
				},
				RunManagedCaddyCommand: func(arguments []string, options ManagedCaddyCommandOptions) CommandResult {
					callOrder = append(callOrder, "command")
					gotArguments = append(gotArguments, append([]string{}, arguments...))
					gotOptions = append(gotOptions, options)
					return tc.runResult
				},
				RuntimeOS: "linux",
			})

			if tc.wantError != "" {
				if error == nil {
					t.Fatalf("RunManagedCaddyLifecycleCommand(...) error = nil, want %q", tc.wantError)
				}
				if error.Error() != tc.wantError {
					t.Fatalf("RunManagedCaddyLifecycleCommand(...) error = %q, want %q", error.Error(), tc.wantError)
				}
			} else {
				if error != nil {
					t.Fatalf("RunManagedCaddyLifecycleCommand(...) unexpected error = %v", error)
				}
				if exitCode != tc.wantExitCode {
					t.Fatalf("RunManagedCaddyLifecycleCommand(...) exit code = %d, want %d", exitCode, tc.wantExitCode)
				}
			}

			if !reflect.DeepEqual(gotArguments, tc.wantCommandArguments) {
				t.Fatalf("RunManagedCaddyLifecycleCommand(...) command arguments = %#v, want %#v", gotArguments, tc.wantCommandArguments)
			}
			if !reflect.DeepEqual(gotOptions, tc.wantCommandOptions) {
				t.Fatalf("RunManagedCaddyLifecycleCommand(...) command options = %#v, want %#v", gotOptions, tc.wantCommandOptions)
			}
			if logOutput.String() != tc.wantLog {
				t.Fatalf("RunManagedCaddyLifecycleCommand(...) log output = %q, want %q", logOutput.String(), tc.wantLog)
			}
			if removedPidFile != tc.wantRemovedPidFile {
				t.Fatalf("RunManagedCaddyLifecycleCommand(...) removedPidFile = %v, want %v", removedPidFile, tc.wantRemovedPidFile)
			}
			if len(callOrder) > 0 && callOrder[0] != "ensure" {
				t.Fatalf("RunManagedCaddyLifecycleCommand(...) call order = %#v, want ensure first", callOrder)
			}
		})
	}
}

func TestCreateManagedCaddyStartErrorMessage(t *testing.T) {
	t.Parallel()

	result := CommandResult{Stderr: []byte("listen tcp 127.0.0.1:443: bind: permission denied\n"), Success: false}
	if got := CreateManagedCaddyStartErrorMessage(result, "darwin"); got != "Caddy start failed.\nlisten tcp 127.0.0.1:443: bind: permission denied\nmacOS allows rootless binds on :443 only with wildcard listeners, not loopback-specific ones." {
		t.Fatalf("CreateManagedCaddyStartErrorMessage(...) = %q", got)
	}
	if got := CreateManagedCaddyStartErrorMessage(result, "linux"); got != "Caddy start failed.\nlisten tcp 127.0.0.1:443: bind: permission denied\nOpening HTTPS on :443 requires privileged-port setup on this platform. Run 'devhost caddy privileged-ports' to configure the managed Caddy binary." {
		t.Fatalf("CreateManagedCaddyStartErrorMessage(...) = %q", got)
	}
}
