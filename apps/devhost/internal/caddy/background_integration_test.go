package caddy

import (
	"fmt"
	"net"
	"os/exec"
	"strings"
	"testing"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/nettest"
)

func TestNativeCaddyStartupDiagnostics(t *testing.T) {
	executable, err := exec.LookPath("caddy")
	if err != nil {
		t.Skip("native Caddy is unavailable")
	}
	for _, occupied := range []bool{false, true} {
		t.Run(fmt.Sprintf("occupied=%t", occupied), func(t *testing.T) {
			ports := nettest.ReservePorts(t, 2)
			admin := fmt.Sprintf("127.0.0.1:%d", ports[0])
			paths := CreateManagedCaddyPaths(t.TempDir())
			if err := EnsureManagedCaddyConfig(paths, ManagedCaddyConfigFallback{AdminAddress: admin, HTTPSPort: ports[1]}); err != nil {
				t.Fatal(err)
			}
			if occupied {
				listener, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", ports[1]))
				if err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() { listener.Close() })
			}
			t.Cleanup(func() {
				if err := EnsureManagedCaddyAdminAvailable(CreateCaddyAdminAPIURL(admin), AdminAvailabilityDependencies{}); err != nil {
					return
				}
				result := RunCommand([]string{executable, "stop", "--address", admin}, RunCommandOptions{})
				if !result.Success {
					t.Errorf("stop Caddy: %s", result.Stderr)
				}
			})
			result := RunCommand([]string{executable, "start", "--pidfile", paths.PidFilePath, "--config", paths.CaddyfilePath, "--adapter", "caddyfile"}, RunCommandOptions{Background: true, WorkingDir: paths.CaddyDirectoryPath})
			if occupied {
				if result.Success || !strings.Contains(string(result.Stderr), "address already in use") {
					t.Fatalf("missing listener failure: %+v", result)
				}
			} else {
				if !result.Success || !strings.Contains(string(result.Stdout), "Successfully started Caddy") {
					t.Fatalf("startup failed: %+v", result)
				}
				if err := EnsureManagedCaddyAdminAvailable(CreateCaddyAdminAPIURL(admin), AdminAvailabilityDependencies{}); err != nil {
					t.Fatal(err)
				}
			}
			if !strings.Contains(string(result.Stderr), "admin endpoint started") {
				t.Fatalf("runtime diagnostics missing: %s", result.Stderr)
			}
		})
	}
}
