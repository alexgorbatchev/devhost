package caddy

import (
	"bytes"
	"fmt"
	"io"
	"testing"
)

func TestConfigureManagedCaddyPrivilegedPorts(t *testing.T) {
	t.Parallel()

	tests := []struct {
		isRootUser      bool
		managedBinary   bool
		name            string
		runtimeArch     string
		runtimeOS       string
		runSuccess      bool
		wantCommands    []string
		wantDownloadLog string
		wantError       string
		wantLog         string
	}{
		{
			isRootUser:      false,
			managedBinary:   false,
			name:            "configures linux capability with sudo",
			runtimeArch:     "amd64",
			runtimeOS:       "linux",
			runSuccess:      true,
			wantCommands:    []string{"sudo", "setcap", "cap_net_bind_service=+ep", "/tmp/caddy/caddy"},
			wantDownloadLog: "[devhost] download invoked\n",
			wantLog:         "[devhost] managed caddy binary not found at /tmp/caddy/caddy. Downloading it first.\n[devhost] download invoked\n[devhost] managed caddy privileged-port setup may prompt for your password because granting low-port bind capability is privileged.\n[devhost] managed caddy low-port binding enabled for /tmp/caddy/caddy\n",
		},
		{
			isRootUser:    true,
			managedBinary: true,
			name:          "configures linux capability without sudo when root",
			runtimeArch:   "amd64",
			runtimeOS:     "linux",
			runSuccess:    true,
			wantCommands:  []string{"setcap", "cap_net_bind_service=+ep", "/tmp/caddy/caddy"},
			wantLog:       "[devhost] managed caddy privileged-port setup may prompt for your password because granting low-port bind capability is privileged.\n[devhost] managed caddy low-port binding enabled for /tmp/caddy/caddy\n",
		},
		{
			name:      "skips setup on macos",
			runtimeOS: "darwin",
			wantLog:   "[devhost] managed caddy does not need privileged-port setup on macOS.\n",
		},
		{
			name:      "rejects unsupported platform",
			runtimeOS: "windows",
			wantError: "Managed Caddy privileged-port setup is currently supported on Linux only.",
		},
		{
			managedBinary: true,
			name:          "explains setup command failures",
			runtimeOS:     "linux",
			runSuccess:    false,
			wantCommands:  []string{"sudo", "setcap", "cap_net_bind_service=+ep", "/tmp/caddy/caddy"},
			wantError:     "Managed Caddy privileged-port setup failed. Check that `sudo` and `setcap` are available, then try again.",
		},
	}

	for _, tt := range tests {
		tc := tt
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			paths := Paths{CaddyDirectoryPath: "/tmp/caddy", ExecutablePath: "/tmp/caddy/caddy"}
			commands := [][]string{}
			var logOutput bytes.Buffer

			exitCode, error := ConfigureManagedCaddyPrivilegedPorts(&logOutput, tc.runtimeOS, tc.runtimeArch, paths, PrivilegedPortsDependencies{
				DownloadCaddy: func(logWriter io.Writer, runtimeOS string, runtimeArch string, paths Paths, dependencies DownloadDependencies) error {
					_, error := io.WriteString(logWriter, "[devhost] download invoked\n")
					return error
				},
				HasManagedCaddyBinary: func(string) bool {
					return tc.managedBinary
				},
				IsRootUser: func() bool {
					return tc.isRootUser
				},
				RunCommand: func(arguments []string, options RunCommandOptions) CommandResult {
					commands = append(commands, arguments)
					return CommandResult{Success: tc.runSuccess}
				},
			})

			if tc.wantError != "" {
				if error == nil {
					t.Fatalf("ConfigureManagedCaddyPrivilegedPorts(...) error = nil, want %q", tc.wantError)
				}

				if error.Error() != tc.wantError {
					t.Fatalf("ConfigureManagedCaddyPrivilegedPorts(...) error = %q, want %q", error.Error(), tc.wantError)
				}
				return
			}

			if error != nil {
				t.Fatalf("ConfigureManagedCaddyPrivilegedPorts(...) unexpected error = %v", error)
			}

			if exitCode != 0 {
				t.Fatalf("ConfigureManagedCaddyPrivilegedPorts(...) exit code = %d, want 0", exitCode)
			}

			if len(tc.wantCommands) == 0 {
				if len(commands) != 0 {
					t.Fatalf("ConfigureManagedCaddyPrivilegedPorts(...) commands = %#v, want none", commands)
				}
			} else if fmt.Sprintf("%q", commands[0]) != fmt.Sprintf("%q", tc.wantCommands) {
				t.Fatalf("ConfigureManagedCaddyPrivilegedPorts(...) command = %#v, want %#v", commands[0], tc.wantCommands)
			}

			if logOutput.String() != tc.wantLog {
				t.Fatalf("ConfigureManagedCaddyPrivilegedPorts(...) log = %q, want %q", logOutput.String(), tc.wantLog)
			}
		})
	}
}
