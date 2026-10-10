package caddy

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestRecoveryRoutesAdaptWithRootAndMultiplePathServices(t *testing.T) {
	t.Parallel()
	executable, err := exec.LookPath("caddy")
	if err != nil {
		t.Skip("native Caddy is unavailable")
	}
	registrations := []routeRegistration{}
	for index, path := range []string{"/", "/one/*", "/two/*"} {
		registrations = append(registrations, routeRegistration{
			Host: "recovery.localhost", ServiceName: []string{"web", "one", "two"}[index], Path: path,
			AppBindHost: "127.0.0.1", AppPort: 3000 + index,
			DocumentInjectionPort: new(4000 + index), ProxyLocalOrigin: true,
		})
	}
	snippet, err := renderHostRouteSnippet(registrations, true, 8080, 4443, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "Caddyfile")
	if err := os.WriteFile(path, []byte(snippet), 0600); err != nil {
		t.Fatal(err)
	}
	if output, err := exec.Command(executable, "adapt", "--config", path, "--adapter", "caddyfile").CombinedOutput(); err != nil {
		t.Fatalf("Caddy could not adapt composed recovery routes: %v\n%s", err, output)
	}
}
