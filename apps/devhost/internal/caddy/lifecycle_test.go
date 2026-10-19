package caddy

import (
	"errors"
	"reflect"
	"slices"
	"strings"
	"testing"
)

const (
	testInstallingTrustLog = "[devhost] managed caddy is installing its local CA into the system trust store so browsers accept devhost HTTPS certificates. This may ask for your password.\n"
	testUntrustedLog       = "[devhost] [WARN] " + UntrustedRootCertificateWarning + "\n"
	testStartedLog         = "[devhost] managed caddy started with <state>/caddy/Caddyfile\n"
	testTrustNoise         = "2026/10/19 23:31:49.199\tINFO\tnot NSS security databases found\n2026/10/19 23:31:49.199\tINFO\tdefine JAVA_HOME environment variable to use the Java trust\n"
)

func TestRunManagedCaddyLifecycleCommand(t *testing.T) {
	t.Setenv("AGENT", "0")

	configured := ManagedCaddyGlobalSettings{AdminAddress: "127.0.0.1:22000", BindHost: "127.0.0.1", HTTPPort: 80, HTTPSPort: 443}
	running := ManagedCaddyGlobalSettings{AdminAddress: "127.0.0.1:22009", BindHost: "127.0.0.1", HTTPPort: 80, HTTPSPort: 8443}
	startArguments := []string{"start", "--pidfile", "<state>/caddy/caddy.pid"}
	trustOptions := ManagedCaddyCommandOptions{AdminAddress: "127.0.0.1:22000", Environment: []string{"SUDO_PROMPT=[caddy] Password: "}}
	declinedTrust := CommandResult{Stderr: []byte(testTrustNoise + "sudo: a password is required\n")}
	startOutput := CommandResult{
		Success: true,
		Stdout:  []byte("Successfully started Caddy (pid=1) - Caddy is running in the background\n"),
		Stderr:  []byte(`{"level":"info","ts":1,"logger":"admin","msg":"admin endpoint started"}` + "\n" + `{"level":"warn","ts":1,"logger":"tls","msg":"storage is slow"}` + "\n"),
	}

	tests := []struct {
		action               LifecycleAction
		applied              *ManagedCaddyGlobalSettings
		available            bool
		canPrompt            bool
		hasPidFile           bool
		name                 string
		quiet                bool
		rootTrust            RootCertificateTrust
		rootTrustErr         error
		runResults           map[string]CommandResult
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
			name:                 "starts managed caddy when admin api is unavailable",
			runResults:           map[string]CommandResult{"start": {Success: true}},
			wantApplied:          &configured,
			wantCommandArguments: [][]string{startArguments},
			wantCommandOptions:   []ManagedCaddyCommandOptions{{}},
			wantLog:              testStartedLog,
		},
		{
			action:               LifecycleStart,
			name:                 "shows caddy warnings after start",
			rootTrust:            RootCertificateTrusted,
			runResults:           map[string]CommandResult{"start": startOutput},
			wantApplied:          &configured,
			wantCommandArguments: [][]string{startArguments},
			wantCommandOptions:   []ManagedCaddyCommandOptions{{}},
			wantLog:              "[caddy] WARN tls: storage is slow\n" + testStartedLog,
		},
		{
			action:               LifecycleStart,
			name:                 "keeps caddy output quiet after a stack starts caddy",
			quiet:                true,
			rootTrust:            RootCertificateTrusted,
			runResults:           map[string]CommandResult{"start": startOutput},
			wantApplied:          &configured,
			wantCommandArguments: [][]string{startArguments},
			wantCommandOptions:   []ManagedCaddyCommandOptions{{}},
			wantLog:              testStartedLog,
		},
		{
			action:               LifecycleStart,
			canPrompt:            true,
			name:                 "trusts the local CA once after start",
			rootTrust:            RootCertificateUntrusted,
			runResults:           map[string]CommandResult{"start": {Success: true}, "trust": {Success: true, Stderr: []byte(testTrustNoise)}},
			wantApplied:          &configured,
			wantCommandArguments: [][]string{startArguments, {"trust"}},
			wantCommandOptions:   []ManagedCaddyCommandOptions{{}, trustOptions},
			wantLog:              testStartedLog + testInstallingTrustLog + "[devhost] managed caddy local CA trusted.\n",
		},
		{
			action:               LifecycleStart,
			canPrompt:            true,
			name:                 "warns when the local CA could not be trusted after start",
			rootTrust:            RootCertificateUntrusted,
			runResults:           map[string]CommandResult{"start": {Success: true}, "trust": declinedTrust},
			wantApplied:          &configured,
			wantCommandArguments: [][]string{startArguments, {"trust"}},
			wantCommandOptions:   []ManagedCaddyCommandOptions{{}, trustOptions},
			wantLog:              testStartedLog + testInstallingTrustLog + "[caddy] sudo: a password is required\n" + testUntrustedLog,
		},
		{
			action:               LifecycleStart,
			name:                 "warns instead of asking for a password without a terminal",
			rootTrust:            RootCertificateUntrusted,
			runResults:           map[string]CommandResult{"start": {Success: true}},
			wantApplied:          &configured,
			wantCommandArguments: [][]string{startArguments},
			wantCommandOptions:   []ManagedCaddyCommandOptions{{}},
			wantLog:              testStartedLog + testUntrustedLog,
		},
		{
			action:               LifecycleStart,
			canPrompt:            true,
			name:                 "warns when the local CA cannot be read after start",
			rootTrustErr:         errors.New("parse root.crt: malformed certificate"),
			runResults:           map[string]CommandResult{"start": {Success: true}},
			wantApplied:          &configured,
			wantCommandArguments: [][]string{startArguments},
			wantCommandOptions:   []ManagedCaddyCommandOptions{{}},
			wantLog:              testStartedLog + "[devhost] [WARN] managed caddy could not check whether its local CA is trusted: parse root.crt: malformed certificate\n",
		},
		{
			action:               LifecycleStart,
			name:                 "records nothing when caddy fails to start",
			runResults:           map[string]CommandResult{"start": {Stderr: []byte("listen tcp :443: address already in use\n")}},
			wantCommandArguments: [][]string{startArguments},
			wantCommandOptions:   []ManagedCaddyCommandOptions{{}},
			wantError:            "Caddy start failed. Check the Caddy logs in <state>/caddy.",
			wantLog:              "[caddy] listen tcp :443: address already in use\n",
		},
		{
			action:     LifecycleStart,
			available:  true,
			hasPidFile: true,
			name:       "returns success when managed caddy is already running",
			rootTrust:  RootCertificateTrusted,
			wantLog:    "[devhost] managed caddy is already running with <state>/caddy/Caddyfile\n",
		},
		{
			action:               LifecycleStart,
			available:            true,
			canPrompt:            true,
			hasPidFile:           true,
			name:                 "trusts the local CA of an already running caddy",
			rootTrust:            RootCertificateUntrusted,
			runResults:           map[string]CommandResult{"trust": {Success: true}},
			wantCommandArguments: [][]string{{"trust"}},
			wantCommandOptions:   []ManagedCaddyCommandOptions{trustOptions},
			wantLog:              "[devhost] managed caddy is already running with <state>/caddy/Caddyfile\n" + testInstallingTrustLog + "[devhost] managed caddy local CA trusted.\n",
		},
		{
			action:    LifecycleStart,
			available: true,
			name:      "rejects foreign running caddy",
			wantError: foreignManagedCaddyError,
		},
		{
			action:             LifecycleStop,
			hasPidFile:         true,
			name:               "removes stale pid file",
			wantLog:            "[devhost] managed caddy is not running. Removed the stale pid file.\n",
			wantRemovedPidFile: true,
		},
		{
			action:               LifecycleStop,
			available:            true,
			hasPidFile:           true,
			name:                 "stops managed caddy",
			runResults:           map[string]CommandResult{"stop": {Success: true}},
			wantCommandArguments: [][]string{{"stop"}},
			wantCommandOptions:   []ManagedCaddyCommandOptions{{AdminAddress: "127.0.0.1:22000"}},
			wantLog:              "[devhost] managed caddy stopped.\n",
			wantRemovedPidFile:   true,
		},
		{
			action:               LifecycleStop,
			applied:              &running,
			available:            true,
			hasPidFile:           true,
			name:                 "stops caddy through the admin address it runs",
			runResults:           map[string]CommandResult{"stop": {Success: true}},
			wantCommandArguments: [][]string{{"stop"}},
			wantCommandOptions:   []ManagedCaddyCommandOptions{{AdminAddress: running.AdminAddress}},
			wantLog:              "[devhost] managed caddy stopped.\n",
			wantRemovedPidFile:   true,
		},
		{
			action:    LifecycleStop,
			available: true,
			name:      "rejects foreign caddy on stop",
			wantError: foreignManagedCaddyError,
		},
		{
			action:     LifecycleTrust,
			hasPidFile: true,
			name:       "requires running managed caddy before trust",
			wantError:  "Managed Caddy is not running. Run 'devhost caddy start' first.",
		},
		{
			action:    LifecycleTrust,
			available: true,
			name:      "rejects foreign caddy on trust",
			wantError: foreignManagedCaddyError,
		},
		{
			action:     LifecycleTrust,
			available:  true,
			hasPidFile: true,
			name:       "reports an already trusted local ca",
			rootTrust:  RootCertificateTrusted,
			wantLog:    "[devhost] managed caddy local CA is already trusted.\n",
		},
		{
			action:               LifecycleTrust,
			available:            true,
			hasPidFile:           true,
			name:                 "trusts managed caddy local ca",
			rootTrust:            RootCertificateUntrusted,
			runResults:           map[string]CommandResult{"trust": {Success: true, Stderr: []byte(testTrustNoise)}},
			wantCommandArguments: [][]string{{"trust"}},
			wantCommandOptions:   []ManagedCaddyCommandOptions{trustOptions},
			wantLog:              testInstallingTrustLog + "[devhost] managed caddy local CA trusted.\n",
		},
		{
			action:               LifecycleTrust,
			available:            true,
			hasPidFile:           true,
			name:                 "leaves a missing local ca to caddy",
			runResults:           map[string]CommandResult{"trust": {Success: true}},
			wantCommandArguments: [][]string{{"trust"}},
			wantCommandOptions:   []ManagedCaddyCommandOptions{trustOptions},
			wantLog:              testInstallingTrustLog + "[devhost] managed caddy local CA trusted.\n",
		},
		{
			action:               LifecycleTrust,
			available:            true,
			hasPidFile:           true,
			name:                 "reports a failed trust installation",
			rootTrust:            RootCertificateUntrusted,
			runResults:           map[string]CommandResult{"trust": declinedTrust},
			wantCommandArguments: [][]string{{"trust"}},
			wantCommandOptions:   []ManagedCaddyCommandOptions{trustOptions},
			wantError:            "Caddy trust failed. Check the Caddy diagnostics above.",
			wantLog:              testInstallingTrustLog + "[caddy] sudo: a password is required\n",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
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
				tc.wantCommandArguments[index] = slices.Clone(tc.wantCommandArguments[index])
				for argument := range tc.wantCommandArguments[index] {
					tc.wantCommandArguments[index][argument] = strings.ReplaceAll(tc.wantCommandArguments[index][argument], "<state>", stateDirectoryPath)
				}
			}
			tc.wantLog = strings.ReplaceAll(tc.wantLog, "<state>", stateDirectoryPath)
			tc.wantError = strings.ReplaceAll(tc.wantError, "<state>", stateDirectoryPath)
			var logOutput strings.Builder
			var callOrder []string
			var gotArguments [][]string
			var gotOptions []ManagedCaddyCommandOptions
			removedPidFile := false

			exitCode, err := RunManagedCaddyLifecycleCommand(tc.action, &logOutput, paths, configured, ManagedCaddyLifecycleDependencies{
				CanPromptForPassword: func() bool {
					return tc.canPrompt
				},
				EnsureManagedCaddyConfig: func() error {
					callOrder = append(callOrder, "ensure")
					return nil
				},
				HasManagedPidFile: func() bool {
					return tc.hasPidFile
				},
				IsManagedCaddyAvailable: func() bool {
					return tc.available
				},
				Quiet: tc.quiet,
				ReadRootCertificateTrust: func() (RootCertificateTrust, error) {
					return tc.rootTrust, tc.rootTrustErr
				},
				RemoveManagedPidFile: func() error {
					removedPidFile = true
					return nil
				},
				RunManagedCaddyCommand: func(arguments []string, options ManagedCaddyCommandOptions) CommandResult {
					callOrder = append(callOrder, "command")
					gotArguments = append(gotArguments, append([]string{}, arguments...))
					gotOptions = append(gotOptions, options)
					return tc.runResults[arguments[0]]
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

func TestManagedCaddyStartFailure(t *testing.T) {
	t.Parallel()

	result := CommandResult{Stderr: []byte("listen tcp 127.0.0.1:443: bind: permission denied\n"), Success: false}
	for _, tc := range []struct{ os, hint string }{{"darwin", "Use wildcard listeners"}, {"linux", "devhost caddy privileged-ports"}} {
		failure, handled := managedCaddyStartFailure(result, tc.os, "/state/caddy")
		if !handled || !strings.Contains(failure.Hint, tc.hint) || strings.Contains(failure.Error(), "listen tcp") {
			t.Fatalf("managedCaddyStartFailure(%s) = %+v, handled %v", tc.os, failure, handled)
		}
	}
}

func TestManagedCaddyStartFailurePreservesUnknownFailures(t *testing.T) {
	t.Parallel()
	result := CommandResult{Stderr: []byte("listen tcp 127.0.0.1:4433: bind: permission denied\n")}
	failure, handled := managedCaddyStartFailure(result, "linux", "/state/caddy")
	if handled || strings.Contains(failure.Hint, "privileged-ports") {
		t.Fatalf("non-privileged port misclassified: %+v", failure)
	}
}
