package app

import (
	"io"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy/caddytest"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/skill"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/version"
)

func TestRunHelpShortCircuitsInvalidArguments(t *testing.T) {
	t.Setenv("AGENT", "0")

	var stdout strings.Builder
	var stderr strings.Builder

	exitCode := Run([]string{"caddy", "restart", "--help"}, "/tmp", &stdout, &stderr)

	if exitCode != 0 {
		t.Fatalf("Run(...) exit code = %d, want 0", exitCode)
	}

	if !strings.Contains(stdout.String(), "╰─ trust-remote <ssh-target>") {
		t.Fatalf("Run(...) stdout = %q, want the caddy command tree", stdout.String())
	}

	if stderr.String() != "" {
		t.Fatalf("Run(...) stderr = %q, want empty", stderr.String())
	}
}

func TestRunWithoutArgumentsPrintsHelp(t *testing.T) {
	t.Setenv("AGENT", "0")

	var stdout strings.Builder
	var stderr strings.Builder

	exitCode := Run([]string{}, "/tmp", &stdout, &stderr)

	if exitCode != 0 {
		t.Fatalf("Run(...) exit code = %d, want 0", exitCode)
	}

	if !strings.Contains(stdout.String(), "├─ start") {
		t.Fatalf("Run(...) stdout = %q, want the root command tree", stdout.String())
	}

	if stderr.String() != "" {
		t.Fatalf("Run(...) stderr = %q, want empty", stderr.String())
	}
}

func TestRunVersionPrintsBuildVersion(t *testing.T) {
	t.Parallel()

	var stdout strings.Builder
	var stderr strings.Builder

	exitCode := Run([]string{"--version"}, "/tmp", &stdout, &stderr)

	if exitCode != 0 {
		t.Fatalf("Run(...) exit code = %d, want 0", exitCode)
	}

	if stdout.String() != version.String()+"\n" {
		t.Fatalf("Run(...) stdout = %q, want %q", stdout.String(), version.String()+"\n")
	}

	if stderr.String() != "" {
		t.Fatalf("Run(...) stderr = %q, want empty", stderr.String())
	}
}

func TestRunShellCompletionSucceeds(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		rawArgs    []string
		wantStdout string
	}{
		{
			name:       "completion script",
			rawArgs:    []string{"completion", "bash"},
			wantStdout: "complete -o default -F __start_devhost devhost",
		},
		{
			name:       "completion request made by a script",
			rawArgs:    []string{"__complete", "caddy", ""},
			wantStdout: "trust-remote\t",
		},
	}

	for _, tt := range tests {
		tc := tt
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			var stdout strings.Builder
			var stderr strings.Builder

			exitCode := Run(tc.rawArgs, "/tmp", &stdout, &stderr)

			if exitCode != 0 {
				t.Fatalf("Run(%q) exit code = %d, want 0; stderr = %q", tc.rawArgs, exitCode, stderr.String())
			}

			if !strings.Contains(stdout.String(), tc.wantStdout) {
				t.Fatalf("Run(%q) stdout missing %q:\n%s", tc.rawArgs, tc.wantStdout, stdout.String())
			}
		})
	}
}

func TestRunPrintsTheSkill(t *testing.T) {
	for _, agent := range []string{"0", "1"} {
		t.Run("AGENT="+agent, func(t *testing.T) {
			t.Setenv("AGENT", agent)

			var stdout strings.Builder
			var stderr strings.Builder

			exitCode := Run([]string{"skill"}, "/tmp", &stdout, &stderr)

			if exitCode != 0 {
				t.Fatalf("Run(skill) exit code = %d, want 0; stderr = %q", exitCode, stderr.String())
			}

			if stdout.String() != skill.Document() {
				t.Fatalf("Run(skill) stdout is not the embedded SKILL.md byte for byte:\n%s", stdout.String())
			}

			if stderr.String() != "" {
				t.Fatalf("Run(skill) stderr = %q, want empty", stderr.String())
			}
		})
	}
}

func TestRunReportsFailuresForTheReader(t *testing.T) {
	missingManifestPath := filepath.Join(t.TempDir(), "devhost.toml")
	useSharedCaddyAdmin(t, caddytest.UnusedAdminAddress(t))
	manifestPath := writeDevtoolsDisabledProcessManifest(t, t.TempDir())

	// A .git directory ends the upward search, so no manifest above the temporary
	// directory can be found.
	repositoryPath := t.TempDir()
	projectPath := filepath.Join(repositoryPath, "project")
	for _, directoryPath := range []string{filepath.Join(repositoryPath, ".git"), projectPath} {
		if err := os.Mkdir(directoryPath, 0o755); err != nil {
			t.Fatal(err)
		}
	}

	tests := []struct {
		name       string
		agent      string
		rawArgs    []string
		wantStderr string
	}{
		{
			name:    "a person mistypes a command",
			agent:   "0",
			rawArgs: []string{"star"},
			wantStderr: "devhost | [ERROR] unknown command \"star\" for \"devhost\"; did you mean \"stack\" or \"start\" or \"stop\"?\n" +
				"devhost | [INFO] Run \"devhost --help\" for usage.\n",
		},
		{
			name:       "an agent mistypes a command",
			agent:      "1",
			rawArgs:    []string{"star"},
			wantStderr: "devhost: ERR: unknown command \"star\" for \"devhost\"; did you mean \"stack\" or \"start\" or \"stop\"?\n",
		},
		{
			name:    "a person names a manifest that does not exist",
			agent:   "0",
			rawArgs: []string{"start", "--manifest", missingManifestPath},
			wantStderr: "devhost | [ERROR] manifest file not found: " + missingManifestPath + "\n" +
				"devhost | [INFO] Check the path given with --manifest or DEVHOST_MANIFEST.\n",
		},
		{
			name:    "an agent names a manifest that does not exist",
			agent:   "1",
			rawArgs: []string{"start", "--manifest", missingManifestPath},
			wantStderr: "devhost: ERR: read manifest " + missingManifestPath + ": open " + missingManifestPath +
				": no such file or directory\n",
		},
		{
			name:    "a person runs outside a project",
			agent:   "0",
			rawArgs: []string{"stop"},
			wantStderr: "devhost | [ERROR] Could not find devhost.toml from " + projectPath + " upward.\n" +
				"devhost | [INFO] Run devhost from your project folder, or pass --manifest <path>.\n",
		},
		{
			name:       "an agent runs outside a project",
			agent:      "1",
			rawArgs:    []string{"stop"},
			wantStderr: "devhost: ERR: Could not find devhost.toml from " + projectPath + " upward.\n",
		},
		{
			name:    "a person names a service the manifest does not define",
			agent:   "0",
			rawArgs: []string{"start", "--manifest", manifestPath, "wroker"},
			wantStderr: "devhost | [ERROR] unknown service: \"wroker\"; the manifest defines: worker\n" +
				"devhost | [INFO] Run \"devhost service list\" to print the service names.\n",
		},
		{
			name:       "an agent names a service the manifest does not define",
			agent:      "1",
			rawArgs:    []string{"start", "--manifest", manifestPath, "wroker"},
			wantStderr: "devhost: ERR: unknown service: \"wroker\"; the manifest defines: worker\n",
		},
		{
			name:    "a person gives an idle timeout that is not a duration",
			agent:   "0",
			rawArgs: []string{"start", "--manifest", manifestPath, "--idle-timeout", "soon"},
			wantStderr: "devhost | [ERROR] the idle timeout \"soon\" is not a duration\n" +
				"devhost | [INFO] Set --idle-timeout or DEVHOST_IDLE_TIMEOUT to a value such as 30s or 1m.\n",
		},
		{
			name:       "an agent gives an idle timeout that is not a duration",
			agent:      "1",
			rawArgs:    []string{"start", "--manifest", manifestPath, "--idle-timeout", "soon"},
			wantStderr: "devhost: ERR: invalid idle-timeout: time: invalid duration \"soon\"\n",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("AGENT", tc.agent)

			var stdout strings.Builder
			var stderr strings.Builder

			exitCode := Run(tc.rawArgs, projectPath, &stdout, &stderr)

			if exitCode != 1 {
				t.Fatalf("Run(%q) exit code = %d, want 1", tc.rawArgs, exitCode)
			}

			if stderr.String() != tc.wantStderr {
				t.Fatalf("Run(%q) stderr = %q, want %q", tc.rawArgs, stderr.String(), tc.wantStderr)
			}

			if stdout.String() != "" {
				t.Fatalf("Run(%q) stdout = %q, want empty", tc.rawArgs, stdout.String())
			}
		})
	}
}

func TestRunExplicitManifestBypassesUpwardDiscovery(t *testing.T) {
	t.Setenv("AGENT", "1")
	stateDirectoryPath := t.TempDir()
	t.Setenv("DEVHOST_STATE_DIR", stateDirectoryPath)

	adminAddress := caddytest.StartAdminServer(t)

	manifestDirectoryPath := t.TempDir()
	useSharedCaddyAdmin(t, adminAddress)
	manifestPath := writeDevtoolsDisabledProcessManifest(t, manifestDirectoryPath)

	cwd := filepath.Join(t.TempDir(), "nested", "workspace")
	if err := os.MkdirAll(cwd, 0o755); err != nil {
		t.Fatalf("MkdirAll(...) error = %v", err)
	}

	var stdout strings.Builder
	var stderr strings.Builder

	exitCode := runUntilServiceExit(t, []string{"start", "--manifest", manifestPath}, cwd, &stdout, &stderr)

	if exitCode != 143 {
		t.Fatalf("Run(...) exit code = %d, want 143 with stderr %q", exitCode, stderr.String())
	}

	assertServiceExitOutput(t, stdout.String())

	if stderr.String() != "" {
		t.Fatalf("Run(...) stderr = %q, want empty", stderr.String())
	}
}

func TestRunManifestFromEnvironmentBypassesUpwardDiscovery(t *testing.T) {
	t.Setenv("AGENT", "1")
	stateDirectoryPath := t.TempDir()
	t.Setenv("DEVHOST_STATE_DIR", stateDirectoryPath)

	adminAddress := caddytest.StartAdminServer(t)

	manifestDirectoryPath := t.TempDir()
	useSharedCaddyAdmin(t, adminAddress)
	manifestPath := writeDevtoolsDisabledProcessManifest(t, manifestDirectoryPath)
	t.Setenv("DEVHOST_MANIFEST", manifestPath)

	cwd := filepath.Join(t.TempDir(), "nested", "workspace")
	if err := os.MkdirAll(cwd, 0o755); err != nil {
		t.Fatalf("MkdirAll(...) error = %v", err)
	}

	var stdout strings.Builder
	var stderr strings.Builder

	exitCode := runUntilServiceExit(t, []string{"start"}, cwd, &stdout, &stderr)

	if exitCode != 143 {
		t.Fatalf("Run(...) exit code = %d, want 143 with stderr %q", exitCode, stderr.String())
	}

	assertServiceExitOutput(t, stdout.String())

	if stderr.String() != "" {
		t.Fatalf("Run(...) stderr = %q, want empty", stderr.String())
	}
}

func TestRunManifestModeStartsStackWhenDevtoolsDisabled(t *testing.T) {
	t.Setenv("AGENT", "1")
	stateDirectoryPath := t.TempDir()
	t.Setenv("DEVHOST_STATE_DIR", stateDirectoryPath)

	adminAddress := caddytest.StartAdminServer(t)

	manifestDirectoryPath := t.TempDir()
	useSharedCaddyAdmin(t, adminAddress)
	manifestPath := writeDevtoolsDisabledProcessManifest(t, manifestDirectoryPath)

	var stdout strings.Builder
	var stderr strings.Builder

	exitCode := runUntilServiceExit(t, []string{"start", "--manifest", manifestPath}, manifestDirectoryPath, &stdout, &stderr)
	if exitCode != 143 {
		t.Fatalf("Run(...) exit code = %d, want 143 with stderr %q", exitCode, stderr.String())
	}

	assertServiceExitOutput(t, stdout.String())

	if stderr.String() != "" {
		t.Fatalf("Run(...) stderr = %q, want empty", stderr.String())
	}
}

func TestRunManifestModeStartsStackWithoutExplicitManifestPath(t *testing.T) {
	t.Setenv("AGENT", "1")
	stateDirectoryPath := t.TempDir()
	t.Setenv("DEVHOST_STATE_DIR", stateDirectoryPath)

	adminAddress := caddytest.StartAdminServer(t)

	manifestDirectoryPath := t.TempDir()
	useSharedCaddyAdmin(t, adminAddress)
	_ = writeDevtoolsDisabledProcessManifest(t, manifestDirectoryPath)

	var stdout strings.Builder
	var stderr strings.Builder

	exitCode := runUntilServiceExit(t, []string{"start"}, manifestDirectoryPath, &stdout, &stderr)
	if exitCode != 143 {
		t.Fatalf("Run(...) exit code = %d, want 143 with stderr %q", exitCode, stderr.String())
	}

	assertServiceExitOutput(t, stdout.String())

	if stderr.String() != "" {
		t.Fatalf("Run(...) stderr = %q, want empty", stderr.String())
	}
}

func TestRunManifestModeReportsExistingSameManifestFixedPortClaim(t *testing.T) {
	stateDirectoryPath := t.TempDir()
	t.Setenv("DEVHOST_STATE_DIR", stateDirectoryPath)

	adminAddress := caddytest.StartAdminServer(t)
	useSharedCaddyAdmin(t, adminAddress)

	manifestDirectoryPath := t.TempDir()
	manifestPath := filepath.Join(manifestDirectoryPath, "devhost.toml")
	manifestText := strings.Join([]string{
		`name = "hello-stack"`,
		`killZombies = false`,
		"",
		"[services.web]",
		`command = "bun run dev"`,
		"port = 3000",
	}, "\n")
	if err := os.WriteFile(manifestPath, []byte(manifestText), 0o644); err != nil {
		t.Fatalf("WriteFile(...) error = %v", err)
	}
	paths := caddy.CreateManagedCaddyPaths(stateDirectoryPath)
	settings := caddy.DefaultManagedCaddyGlobalSettings()
	settings.AdminAddress = adminAddress
	if err := caddy.EnsureManagedCaddyConfig(paths, settings, runtime.GOOS); err != nil {
		t.Fatalf("EnsureManagedCaddyConfig(...) error = %v", err)
	}
	if err := caddy.ClaimFixedPort(caddy.ClaimFixedPortOptions{
		BindHost:                "127.0.0.1",
		ManifestPath:            manifestPath,
		Port:                    3000,
		PortClaimsDirectoryPath: paths.PortClaimsDirectoryPath,
	}); err != nil {
		t.Fatalf("ClaimFixedPort(...) error = %v", err)
	}

	var stdout strings.Builder
	var stderr strings.Builder

	exitCode := Run([]string{"start", "--manifest", manifestPath}, manifestDirectoryPath, &stdout, &stderr)
	if exitCode != 1 {
		t.Fatalf("Run(...) exit code = %d, want 1", exitCode)
	}
	if stdout.String() != "" {
		t.Fatalf("Run(...) stdout = %q, want empty", stdout.String())
	}
	if !strings.Contains(stderr.String(), "127.0.0.1:3000 is already") || !strings.Contains(stderr.String(), "via "+manifestPath) {
		t.Fatalf("Run(...) stderr = %q, want same-directory fixed-port claim message", stderr.String())
	}
}

func TestRunPrintRootCertificateWritesRawCertificate(t *testing.T) {
	temporaryDirectoryPath := t.TempDir()
	t.Setenv("DEVHOST_STATE_DIR", temporaryDirectoryPath)
	rootCertificatePath := filepath.Join(temporaryDirectoryPath, "caddy", "storage", "pki", "authorities", "local", "root.crt")
	if err := os.MkdirAll(filepath.Dir(rootCertificatePath), 0o755); err != nil {
		t.Fatalf("MkdirAll(...) error = %v", err)
	}

	certificate := "-----BEGIN CERTIFICATE-----\nhello\n"
	if err := os.WriteFile(rootCertificatePath, []byte(certificate), 0o644); err != nil {
		t.Fatalf("WriteFile(...) error = %v", err)
	}

	var stdout strings.Builder
	var stderr strings.Builder

	exitCode := Run([]string{"caddy", "print-root-cert"}, temporaryDirectoryPath, &stdout, &stderr)
	if exitCode != 0 {
		t.Fatalf("Run(...) exit code = %d, want 0", exitCode)
	}

	if stdout.String() != certificate {
		t.Fatalf("Run(...) stdout = %q, want %q", stdout.String(), certificate)
	}

	if stderr.String() != "" {
		t.Fatalf("Run(...) stderr = %q, want empty", stderr.String())
	}
}

func TestRunTrustRemoteRejectsUnsupportedPlatform(t *testing.T) {
	t.Parallel()

	var stdout strings.Builder
	var stderr strings.Builder

	exitCode := Run([]string{"caddy", "trust-remote", "devbox"}, "/tmp", &stdout, &stderr)
	if exitCode != 1 {
		t.Fatalf("Run(...) exit code = %d, want 1", exitCode)
	}

	if stdout.String() != "" {
		t.Fatalf("Run(...) stdout = %q, want empty", stdout.String())
	}
}

func TestRunCaddyPrivilegedPortsUsesLifecyclePath(t *testing.T) {
	t.Setenv("AGENT", "0")
	if runtime.GOOS != "linux" {
		t.Skip("linux-specific privileged-ports behavior")
	}

	stateDirectoryPath := t.TempDir()
	t.Setenv("DEVHOST_STATE_DIR", stateDirectoryPath)
	managedCaddyPath := filepath.Join(stateDirectoryPath, "caddy", "caddy")
	if err := os.MkdirAll(filepath.Dir(managedCaddyPath), 0o755); err != nil {
		t.Fatalf("MkdirAll(...) error = %v", err)
	}
	if err := os.WriteFile(managedCaddyPath, []byte("#!/bin/sh\nexit 0\n"), 0o755); err != nil {
		t.Fatalf("WriteFile(...) error = %v", err)
	}

	binDirectoryPath := t.TempDir()
	argumentsPath := filepath.Join(t.TempDir(), "sudo-args.txt")
	t.Setenv("DEVHOST_TEST_ARGS_FILE", argumentsPath)
	t.Setenv("PATH", binDirectoryPath+string(os.PathListSeparator)+os.Getenv("PATH"))
	writeExecutable(t, filepath.Join(binDirectoryPath, "sudo"), strings.Join([]string{
		"#!/bin/sh",
		"printf '%s\\n' \"$@\" > \"$DEVHOST_TEST_ARGS_FILE\"",
		"exit 0",
	}, "\n"))

	var stdout strings.Builder
	var stderr strings.Builder
	exitCode := Run([]string{"caddy", "privileged-ports"}, stateDirectoryPath, &stdout, &stderr)
	if exitCode != 0 {
		t.Fatalf("Run(...) exit code = %d, want 0 with stderr %q", exitCode, stderr.String())
	}
	if stdout.String() != "" {
		t.Fatalf("Run(...) stdout = %q, want empty", stdout.String())
	}
	if !strings.Contains(stderr.String(), "devhost | managed caddy low-port binding enabled for "+managedCaddyPath) {
		t.Fatalf("Run(...) stderr = %q, want privileged-port success log", stderr.String())
	}

	arguments, err := os.ReadFile(argumentsPath)
	if err != nil {
		t.Fatalf("ReadFile(...) error = %v", err)
	}
	if string(arguments) != strings.Join([]string{"setcap", "cap_net_bind_service=+ep", managedCaddyPath, ""}, "\n") {
		t.Fatalf("sudo arguments = %q", string(arguments))
	}
}

func TestRunCaddyStartUsesSharedConfigSettings(t *testing.T) {
	t.Setenv("AGENT", "0")
	for _, tc := range []struct {
		name          string
		globalOptions []string
		want          []string
		wantMissing   []string
	}{
		{
			name:        "defaults",
			want:        []string{"https:// {", "default_bind 0.0.0.0 [::]"},
			wantMissing: []string{"http:// {"},
		},
		{
			name:          "custom HTTPS listener",
			globalOptions: []string{`bindHost = "::1"`, "httpPort = 18080", "httpsPort = 18443"},
			want:          []string{"    default_bind [::1]", "https://:18443 {"},
			wantMissing:   []string{"http://:18080 {", "https:// {"},
		},
		{
			name:          "custom HTTP and HTTPS listeners",
			globalOptions: []string{`bindHost = "0.0.0.0"`, "http = true", "httpPort = 18080", "httpsPort = 18443"},
			want:          []string{"    default_bind 0.0.0.0 [::]", "http://:18080 {", "https://:18443 {"},
			wantMissing:   []string{"http:// {", "https:// {"},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			stateDirectoryPath := t.TempDir()
			t.Setenv("DEVHOST_STATE_DIR", stateDirectoryPath)

			binDirectoryPath := t.TempDir()
			argumentsPath := filepath.Join(t.TempDir(), "caddy-args.txt")
			t.Setenv("DEVHOST_TEST_ARGS_FILE", argumentsPath)
			t.Setenv("PATH", binDirectoryPath+string(os.PathListSeparator)+os.Getenv("PATH"))
			writeExecutable(t, filepath.Join(binDirectoryPath, "caddy"), strings.Join([]string{
				"#!/bin/sh",
				"printf '%s\\n' \"$@\" > \"$DEVHOST_TEST_ARGS_FILE\"",
				"exit 0",
			}, "\n"))

			adminAddress := caddytest.UnusedAdminAddress(t)
			useSharedConfig(t, append([]string{`adminAddress = "` + adminAddress + `"`}, tc.globalOptions...)...)

			var stdout strings.Builder
			var stderr strings.Builder
			exitCode := Run([]string{"caddy", "start"}, t.TempDir(), &stdout, &stderr)
			if exitCode != 0 {
				t.Fatalf("Run(...) exit code = %d, want 0 with stderr %q", exitCode, stderr.String())
			}
			if stdout.String() != "" {
				t.Fatalf("Run(...) stdout = %q, want empty", stdout.String())
			}
			if !strings.Contains(stderr.String(), "devhost | managed caddy started with ") {
				t.Fatalf("Run(...) stderr = %q, want managed caddy start log", stderr.String())
			}

			caddyfilePath := filepath.Join(stateDirectoryPath, "caddy", "Caddyfile")
			caddyfile, err := os.ReadFile(caddyfilePath)
			if err != nil {
				t.Fatalf("ReadFile(...) error = %v", err)
			}
			if !strings.Contains(string(caddyfile), "    admin "+adminAddress) {
				t.Fatalf("Caddyfile = %q, want configured admin address", string(caddyfile))
			}
			for _, want := range tc.want {
				if !strings.Contains(string(caddyfile), want) {
					t.Errorf("Caddyfile = %q, want %q", string(caddyfile), want)
				}
			}
			for _, missing := range tc.wantMissing {
				if strings.Contains(string(caddyfile), missing) {
					t.Errorf("Caddyfile = %q, must not contain %q", string(caddyfile), missing)
				}
			}

			arguments, err := os.ReadFile(argumentsPath)
			if err != nil {
				t.Fatalf("ReadFile(...) error = %v", err)
			}
			if string(arguments) != strings.Join([]string{"start", "--pidfile", filepath.Join(stateDirectoryPath, "caddy", "caddy.pid"), "--config", caddyfilePath, "--adapter", "caddyfile", ""}, "\n") {
				t.Fatalf("caddy arguments = %q", string(arguments))
			}
		})
	}
}

func TestRunCaddyStopWithoutRunningProcess(t *testing.T) {
	t.Setenv("AGENT", "0")
	stateDirectoryPath := t.TempDir()
	t.Setenv("DEVHOST_STATE_DIR", stateDirectoryPath)
	useSharedCaddyAdmin(t, caddytest.UnusedAdminAddress(t))

	var stdout strings.Builder
	var stderr strings.Builder
	exitCode := Run([]string{"caddy", "stop"}, stateDirectoryPath, &stdout, &stderr)
	if exitCode != 0 {
		t.Fatalf("Run(...) exit code = %d, want 0", exitCode)
	}
	if stdout.String() != "" {
		t.Fatalf("Run(...) stdout = %q, want empty", stdout.String())
	}
	if !strings.Contains(stderr.String(), "devhost | managed caddy is not running.\n") {
		t.Fatalf("Run(...) stderr = %q, want managed caddy stop idle log", stderr.String())
	}
}

func TestRunCaddyTrustRequiresRunningManagedCaddy(t *testing.T) {
	t.Setenv("AGENT", "0")

	stateDirectoryPath := t.TempDir()
	t.Setenv("DEVHOST_STATE_DIR", stateDirectoryPath)
	useSharedCaddyAdmin(t, caddytest.UnusedAdminAddress(t))

	var stdout strings.Builder
	var stderr strings.Builder
	exitCode := Run([]string{"caddy", "trust"}, stateDirectoryPath, &stdout, &stderr)
	if exitCode != 1 {
		t.Fatalf("Run(...) exit code = %d, want 1", exitCode)
	}
	if stdout.String() != "" {
		t.Fatalf("Run(...) stdout = %q, want empty", stdout.String())
	}
	wantStderr := strings.Join([]string{
		"devhost | [ERROR] Managed Caddy is not running. Run 'devhost caddy start' first.",
		"",
	}, "\n")
	if stderr.String() != wantStderr {
		t.Fatalf("Run(...) stderr = %q, want %q", stderr.String(), wantStderr)
	}
}

func TestRunPreservesSignalExitCodes(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("signal exit parity is only exercised on POSIX platforms")
	}

	tests := []struct {
		name         string
		signal       syscall.Signal
		wantExitCode int
	}{
		{name: "sigint", signal: syscall.SIGINT, wantExitCode: 130},
		{name: "sighup", signal: syscall.SIGHUP, wantExitCode: 129},
		{name: "sigterm", signal: syscall.SIGTERM, wantExitCode: 143},
	}

	for _, tt := range tests {
		tc := tt
		t.Run(tc.name, func(t *testing.T) {
			stateDirectoryPath := t.TempDir()
			adminAddress := caddytest.StartAdminServer(t)

			manifestDirectoryPath := t.TempDir()
			startTracePath := filepath.Join(t.TempDir(), "signal-start.txt")
			stopTracePath := filepath.Join(t.TempDir(), "signal-stop.txt")
			useSharedCaddyAdmin(t, adminAddress)
			manifestPath := writeSignalProcessManifest(t, manifestDirectoryPath, startTracePath, stopTracePath)

			command := exec.Command(os.Args[0], "-test.run=TestRunSignalProcessHelper", "--")
			command.Env = append(os.Environ(),
				"GO_WANT_RUN_SIGNAL_HELPER=1",
				"DEVHOST_RUN_HELPER_MANIFEST="+manifestPath,
				"DEVHOST_RUN_HELPER_CWD="+manifestDirectoryPath,
				"DEVHOST_STATE_DIR="+stateDirectoryPath,
			)
			if err := command.Start(); err != nil {
				t.Fatalf("Start(...) error = %v", err)
			}

			waitForFile(t, startTracePath)

			if err := command.Process.Signal(tc.signal); err != nil {
				t.Fatalf("Signal(...) error = %v", err)
			}

			err := command.Wait()
			exitError, ok := err.(*exec.ExitError)
			if !ok {
				t.Fatalf("Wait(...) error = %v, want exit error", err)
			}
			if exitError.ExitCode() != tc.wantExitCode {
				t.Fatalf("ExitCode() = %d, want %d", exitError.ExitCode(), tc.wantExitCode)
			}

			waitForFile(t, stopTracePath)
		})
	}
}

func TestRunSignalProcessHelper(t *testing.T) {
	if os.Getenv("GO_WANT_RUN_SIGNAL_HELPER") != "1" {
		return
	}

	manifestPath := os.Getenv("DEVHOST_RUN_HELPER_MANIFEST")
	cwd := os.Getenv("DEVHOST_RUN_HELPER_CWD")
	exitCode := Run([]string{"start", "--manifest", manifestPath}, cwd, os.Stdout, os.Stderr)
	os.Exit(exitCode)
}

func TestRunSignalServiceHelperProcess(t *testing.T) {
	if os.Getenv("GO_WANT_RUN_SIGNAL_SERVICE_HELPER") != "1" {
		return
	}

	appendRunHelperTrace(os.Getenv("DEVHOST_SIGNAL_START_TRACE_PATH"), "worker-started")
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, syscall.SIGINT, syscall.SIGHUP, syscall.SIGTERM)
	<-signals
	appendRunHelperTrace(os.Getenv("DEVHOST_SIGNAL_STOP_TRACE_PATH"), "worker-stopped")
	os.Exit(0)
}

func writeExecutable(t *testing.T, path string, text string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(text), 0o755); err != nil {
		t.Fatalf("WriteFile(...) error = %v", err)
	}
}

// useSharedConfig points devhost at a config file of the test's own, so no test
// reads the machine's, with the given lines in its [caddy] table.
func useSharedConfig(t *testing.T, caddyLines ...string) {
	t.Helper()
	directoryPath := t.TempDir()
	t.Setenv("DEVHOST_CONFIG_DIR", directoryPath)
	text := strings.Join(append([]string{"[caddy]"}, caddyLines...), "\n") + "\n"
	if err := os.WriteFile(filepath.Join(directoryPath, "config.toml"), []byte(text), 0o644); err != nil {
		t.Fatalf("WriteFile(...) error = %v", err)
	}
}

// useSharedCaddyAdmin points devhost at a shared Caddy served on adminAddress.
func useSharedCaddyAdmin(t *testing.T, adminAddress string) {
	t.Helper()
	useSharedConfig(t, `adminAddress = "`+adminAddress+`"`)
}

func writeSignalProcessManifest(
	t *testing.T,
	directoryPath string,
	startTracePath string,
	stopTracePath string,
) string {
	t.Helper()

	manifestPath := filepath.Join(directoryPath, "devhost.toml")
	commandText := strings.Join([]string{
		os.Args[0],
		"-test.run=TestRunSignalServiceHelperProcess",
		"--",
	}, " ")
	manifestText := strings.Join([]string{
		`name = "hello-stack"`,
		"",
		"[devtools.editor]",
		"enabled = false",
		"",
		"[devtools.externalToolbars]",
		"enabled = false",
		"",
		"[devtools.minimap]",
		"enabled = false",
		"",
		"[devtools.status]",
		"enabled = false",
		"",
		"[services.worker]",
		`command = "` + commandText + `"`,
		"",
		"[services.worker.env]",
		`GO_WANT_RUN_SIGNAL_SERVICE_HELPER = "1"`,
		`DEVHOST_SIGNAL_START_TRACE_PATH = "` + startTracePath + `"`,
		`DEVHOST_SIGNAL_STOP_TRACE_PATH = "` + stopTracePath + `"`,
		"",
		"[services.worker.health]",
		"process = true",
	}, "\n")
	if err := os.WriteFile(manifestPath, []byte(manifestText), 0o644); err != nil {
		t.Fatalf("WriteFile(...) error = %v", err)
	}

	return manifestPath
}

func writeDevtoolsDisabledProcessManifest(t *testing.T, directoryPath string) string {
	t.Helper()

	manifestPath := filepath.Join(directoryPath, "devhost.toml")
	manifestText := strings.Join([]string{
		`name = "hello-stack"`,
		"",
		"[devtools.editor]",
		"enabled = false",
		"",
		"[devtools.externalToolbars]",
		"enabled = false",
		"",
		"[devtools.minimap]",
		"enabled = false",
		"",
		"[devtools.status]",
		"enabled = false",
		"",
		"[services.worker]",
		`command = "/bin/sh -c exit 0"`,
		"",
		"[services.worker.health]",
		"process = true",
	}, "\n")
	if err := os.WriteFile(manifestPath, []byte(manifestText), 0o644); err != nil {
		t.Fatalf("WriteFile(...) error = %v", err)
	}

	return manifestPath
}

func runUntilServiceExit(t *testing.T, args []string, cwd string, stdout, stderr *strings.Builder) int {
	t.Helper()
	return Run(args, cwd, &serviceExitShutdownWriter{writer: stdout}, stderr)
}

type serviceExitShutdownWriter struct {
	writer io.Writer
}

func (w *serviceExitShutdownWriter) Write(p []byte) (int, error) {
	n, err := w.writer.Write(p)
	if err == nil && strings.Contains(string(p), "exited with code") {
		err = syscall.Kill(os.Getpid(), syscall.SIGTERM)
	}
	return n, err
}

func assertServiceExitOutput(t *testing.T, output string) {
	t.Helper()
	want := strings.Join([]string{
		"hello-stack: worker exited with code 0; devhost is waiting for a restart.",
		"hello-stack: Received SIGTERM (signal 15); shutting down the stack.",
		"hello-stack: Stopping service worker...",
		"hello-stack: Stopped service worker.",
		"hello-stack: Stack stopped.",
		"",
	}, "\n")
	startupCrash := "hello-stack: Service worker exited before passing its health check with code 0.\n"
	if output != want && output != startupCrash+want {
		t.Fatalf("Run(...) stdout = %q, want service exit notification", output)
	}
}

func waitForFile(t *testing.T, filePath string) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if _, err := os.Stat(filePath); err == nil {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}

	t.Fatalf("file %q was not created before timeout", filePath)
}

func appendRunHelperTrace(filePath string, value string) {
	file, err := os.OpenFile(filePath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		panic(err)
	}
	defer file.Close()
	if _, err := file.WriteString(value + "\n"); err != nil {
		panic(err)
	}
}
