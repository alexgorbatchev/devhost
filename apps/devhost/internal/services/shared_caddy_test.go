package services

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy/caddytest"
)

func TestSharedConfigEditsApplyToTheRunningStack(t *testing.T) {
	f := startReloadStack(t, reloadServiceBody("web", "original", "reload.localhost"))
	running, ok, err := caddy.ReadAppliedManagedCaddySettings(f.paths)
	if err != nil || !ok {
		t.Fatalf("startup applied no shared settings: %v, %v", ok, err)
	}
	addressesPath := f.paths.ExecutablePath + ".addresses"
	recordAddresses := "#!/bin/sh\nwhile [ $# -gt 0 ]; do if [ \"$1\" = --address ]; then echo \"$2\" >> " + addressesPath + "; fi; shift; done\n"
	if err := os.WriteFile(f.paths.ExecutablePath, []byte(recordAddresses+"exit 0\n"), 0o755); err != nil {
		t.Fatal(err)
	}

	moved := running
	moved.AdminAddress, moved.HTTPSPort = caddytest.StartAdminServer(t), 8443
	writeTestSharedConfigFile(t, f.configPath, moved)
	waitForCondition(t, stackChangeTimeout, func() bool {
		applied, _, err := caddy.ReadAppliedManagedCaddySettings(f.paths)
		return err == nil && applied == moved
	})
	addresses, err := os.ReadFile(addressesPath)
	if err != nil || strings.TrimSpace(string(addresses)) != running.AdminAddress {
		t.Fatalf("Caddy reloads went to %q, %v; want only the admin address it ran, %s", addresses, err, running.AdminAddress)
	}
	waitForCondition(t, stackChangeTimeout, func() bool { return f.logs.contains("https://reload.localhost:8443") })
	assertHealthURL(t, f, "https://reload.localhost:8443")
	assertFileHas(t, filepath.Join(f.paths.RoutesDirectoryPath, "reload.localhost.caddy"), "https://reload.localhost:8443 {")
	assertFileHas(t, f.paths.CaddyfilePath, "admin "+moved.AdminAddress)

	// Caddy rejects the next listener, as it does one another program holds.
	if err := os.WriteFile(f.paths.ExecutablePath, []byte("#!/bin/sh\necho 'listen tcp :9443: bind: address already in use' >&2\nexit 1\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	rejected := moved
	rejected.HTTPSPort = 9443
	writeTestSharedConfigFile(t, f.configPath, rejected)
	waitForCondition(t, stackChangeTimeout, func() bool { return f.logs.contains("shared Caddy settings rejected") })
	if !f.logs.contains("address already in use") {
		t.Fatal("the rejection does not say why Caddy rejected the settings")
	}
	if applied, _, _ := caddy.ReadAppliedManagedCaddySettings(f.paths); applied != moved {
		t.Fatalf("a rejected change was recorded as applied: %#v", applied)
	}
	assertHealthURL(t, f, "https://reload.localhost:8443")
	assertFileHas(t, filepath.Join(f.paths.RoutesDirectoryPath, "reload.localhost.caddy"), "https://reload.localhost:8443 {")

	// An invalid file leaves the running settings alone too.
	if err := os.WriteFile(f.configPath, []byte("[caddy]\nhttpsPort = 0\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	waitForCondition(t, stackChangeTimeout, func() bool { return f.logs.contains("caddy.httpsPort must be an integer between 1 and 65535.") })
	assertHealthURL(t, f, "https://reload.localhost:8443")
}

func assertHealthURL(t *testing.T, f *reloadStackFixture, want string) {
	t.Helper()
	health, err := f.control.GetHealthResponse()
	if err != nil {
		t.Fatal(err)
	}
	for _, service := range health.Services {
		if service.Name == "web" && service.URL != nil && strings.HasPrefix(*service.URL, want) {
			return
		}
	}
	t.Fatalf("health services = %#v, want web at %s", health.Services, want)
}

func assertFileHas(t *testing.T, path string, want string) {
	t.Helper()
	text, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(text), want) {
		t.Fatalf("%s = %q, want it to contain %q", path, text, want)
	}
}
