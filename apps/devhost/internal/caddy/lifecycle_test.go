package caddy

import (
	"reflect"
	"strings"
	"testing"
)

func TestRunManagedCaddyLifecycleCommand(t *testing.T) {
	t.Parallel()

	configured := ManagedCaddyGlobalSettings{AdminAddress: "127.0.0.1:22000", BindHost: "127.0.0.1", HTTPPort: 80, HTTPSPort: 443}
	running := ManagedCaddyGlobalSettings{AdminAddress: "127.0.0.1:22009", BindHost: "127.0.0.1", HTTPPort: 80, HTTPSPort: 8443}
	tests := []struct {
		action               LifecycleAction
		applied              *ManagedCaddyGlobalSettings
		available            bool
		hasPidFile           bool
		hasRootCert          bool
		name                 string
		runResult            CommandResult
		wantApplied          *ManagedCaddyGlobalSettings
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
			wantApplied:          &configured,
			wantCommandArguments: [][]string{{"start", "--pidfile", "<state>/caddy/caddy.pid"}},
			wantCommandOptions:   []ManagedCaddyCommandOptions{{InheritStdio: true}},
			wantExitCode:         0,
			wantLog:              "[devhost] managed caddy may prompt for your password on first start so it can install its local CA into the system trust store.\n[devhost] managed caddy started with <state>/caddy/Caddyfile\n",
		},
		{
			action:               LifecycleStart,
			hasRootCert:          true,
			name:                 "records nothing when caddy fails to start",
			runResult:            CommandResult{Stderr: []byte("listen tcp :443: address already in use")},
			wantCommandArguments: [][]string{{"start", "--pidfile", "<state>/caddy/caddy.pid"}},
			wantCommandOptions:   []ManagedCaddyCommandOptions{{InheritStdio: true}},
			wantError:            "Caddy start failed.\nlisten tcp :443: address already in use",
		},
		{
			action:               LifecycleStop,
			applied:              &running,
			available:            true,
			hasPidFile:           true,
			name:                 "stops caddy through the admin address it runs",
			runResult:            CommandResult{Success: true},
			wantCommandArguments: [][]string{{"stop"}},
			wantCommandOptions:   []ManagedCaddyCommandOptions{{AdminAddress: running.AdminAddress}},
			wantLog:              "[devhost] managed caddy stopped.\n",
			wantRemovedPidFile:   true,
		},
		{
			action:       LifecycleStart,
			available:    true,
			hasPidFile:   true,
			hasRootCert:  true,
			name:         "returns success when managed caddy is already running",
			wantExitCode: 0,
			wantLog:      "[devhost] managed caddy is already running with <state>/caddy/Caddyfile\n",
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

			stateDirectoryPath := t.TempDir()
			paths := CreateManagedCaddyPaths(stateDirectoryPath)
			if err := EnsureManagedCaddyConfig(paths, configured, "linux"); err != nil {
				t.Fatal(err)
			}
			if tc.applied != nil {
				if err := writeAppliedManagedCaddySettings(paths, *tc.applied); err != nil {
					t.Fatal(err)
				}
			}
			for index := range tc.wantCommandArguments {
				for argument := range tc.wantCommandArguments[index] {
					tc.wantCommandArguments[index][argument] = strings.ReplaceAll(tc.wantCommandArguments[index][argument], "<state>", stateDirectoryPath)
				}
			}
			tc.wantLog = strings.ReplaceAll(tc.wantLog, "<state>", stateDirectoryPath)
			var logOutput strings.Builder
			var callOrder []string
			var gotArguments [][]string
			var gotOptions []ManagedCaddyCommandOptions
			removedPidFile := false

			exitCode, err := RunManagedCaddyLifecycleCommand(tc.action, &logOutput, paths, configured, ManagedCaddyLifecycleDependencies{
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
				if err == nil {
					t.Fatalf("RunManagedCaddyLifecycleCommand(...) error = nil, want %q", tc.wantError)
				}
				if err.Error() != tc.wantError {
					t.Fatalf("RunManagedCaddyLifecycleCommand(...) error = %q, want %q", err.Error(), tc.wantError)
				}
			} else {
				if err != nil {
					t.Fatalf("RunManagedCaddyLifecycleCommand(...) unexpected error = %v", err)
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
			wantApplied := tc.wantApplied
			if wantApplied == nil && !tc.wantRemovedPidFile {
				wantApplied = tc.applied
			}
			applied, ok, err := ReadAppliedManagedCaddySettings(paths)
			if err != nil || ok != (wantApplied != nil) || (ok && applied != *wantApplied) {
				t.Fatalf("applied settings = %#v, %v, %v, want %#v", applied, ok, err, wantApplied)
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
