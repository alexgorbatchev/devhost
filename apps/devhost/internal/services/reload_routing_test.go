package services

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

func TestManifestReloadPublishesRoutingOnlyAfterAcceptance(t *testing.T) {
	f := startReloadStack(t, reloadServiceBody("web", "original", "reload.localhost"))
	marker := filepath.Join(f.paths.StateDirectoryPath, "route-pending")
	release := filepath.Join(f.paths.StateDirectoryPath, "release-route")
	script := fmt.Sprintf("#!/bin/sh\ntouch %q\nwhile [ ! -e %q ]; do sleep 0.01; done\nexit 0\n", marker, release)
	if err := os.WriteFile(f.paths.ExecutablePath, []byte(script), 0755); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.WriteFile(release, nil, 0600) })
	f.write(t, reloadServiceBody("web", "replacement", "new.localhost"))
	waitForCondition(t, stackChangeTimeout, func() bool { _, err := os.Stat(marker); return err == nil })
	health, err := f.control.GetHealthResponse()
	if err != nil {
		t.Fatal(err)
	}
	if health.Services[0].Status || !health.Services[0].Restarting {
		t.Fatalf("service reported ready before routes: %#v", health)
	}
	if routes := readInjectedRoutes(t, f); len(routes) != 1 || routes[0].Host != "reload.localhost" {
		t.Fatalf("unaccepted routes were published: %#v", routes)
	}
	if err := os.WriteFile(release, nil, 0600); err != nil {
		t.Fatal(err)
	}
	waitForCondition(t, stackChangeTimeout, func() bool { return f.logs.contains("configuration reloaded") })
	if routes := readInjectedRoutes(t, f); len(routes) != 1 || routes[0].Host != "new.localhost" {
		t.Fatalf("accepted routes were not published: %#v", routes)
	}
}
