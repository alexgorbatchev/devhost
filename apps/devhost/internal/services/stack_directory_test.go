package services

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"slices"
	"strings"
	"testing"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy"
)

func TestDirectoryServicesUsesResolvedRoutesAndSelection(t *testing.T) {
	port := 3001
	m := ResolvedManifest{
		Caddy:        caddy.DefaultManagedCaddyGlobalSettings(),
		ServiceOrder: []string{"web", "omitted", "api", "worker"},
		Services: map[string]ResolvedService{
			"web":    {Name: "web", Cwd: "/project/web", Hosts: []string{"app.localhost", "alias.localhost"}, Path: new("/app/*"), Port: &port},
			"api":    {Name: "api", BindHost: "0.0.0.0", Port: &port},
			"worker": {Name: "worker", Command: []string{"worker"}},
		},
		Stopped: map[string]ResolvedService{"omitted": {Name: "omitted", Cwd: "/project/omitted", Hosts: []string{"omitted.localhost"}, Port: &port}},
	}
	m.Caddy.HTTPSPort = 8443
	r := stackRuntime{manifest: &m, routes: &stackRoutes{paths: caddy.CreateManagedCaddyPaths(t.TempDir())}, starting: map[string]bool{"worker": true}}
	services, err := r.directoryServices(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(services) != 4 || services[0].Name != "web" || services[0].Directory != "/project/web" || !slices.Equal(services[0].URLs, []string{"https://app.localhost:8443/app/", "https://alias.localhost:8443/app/"}) {
		t.Fatalf("resolved public routes: %+v", services)
	}
	if !slices.Equal(services[1].URLs, []string{"http://127.0.0.1:3001"}) || services[1].Status != "External" {
		t.Fatalf("direct service: %+v", services[1])
	}
	if services[2].Status != "Starting" || len(services[2].URLs) != 0 {
		t.Fatalf("worker state: %+v", services[2])
	}
	if services[3].Name != "omitted" || services[3].Status != "Not started" || services[3].Directory != "/project/omitted" || len(services[3].URLs) != 0 {
		t.Fatalf("unselected service: %+v", services[3])
	}
	r.starting = nil
	r.failures = map[string]string{"worker": "launch failed"}
	services, err = r.directoryServices(context.Background())
	if err != nil || services[2].Status != "Failed" {
		t.Fatalf("failed service: %+v, %v", services, err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := r.directoryServices(ctx); err == nil {
		t.Fatal("canceled stack returned a directory snapshot")
	}
}

func TestStackDirectoryReflectsManifestReload(t *testing.T) {
	f := startReloadStack(t, reloadServiceBody("web", "original", "original.localhost"))
	read := func(want string) {
		t.Helper()
		owners, err := caddy.ReadLiveStacks(f.paths)
		if err != nil || len(owners) != 1 || owners[0].ControlPort != f.controlPort {
			t.Fatalf("published directory control: %+v, %v", owners, err)
		}
		request, err := http.NewRequest(http.MethodGet, serverURL(f.controlPort, "/__devhost__/stacks"), nil)
		if err != nil {
			t.Fatal(err)
		}
		request.Host = caddy.StackDirectoryHost
		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		data, err := io.ReadAll(response.Body)
		if err != nil || response.StatusCode != http.StatusOK || !strings.Contains(string(data), fmt.Sprintf(`href="https://%s"`, want)) || !strings.Contains(string(data), f.path) || !strings.Contains(string(data), f.configPath) {
			t.Fatalf("live directory response: status %d, %v, %s", response.StatusCode, err, data)
		}
	}
	read("original.localhost")
	f.write(t, reloadServiceBody("web", "changed", "changed.localhost"))
	waitForCondition(t, stackChangeTimeout, func() bool { return f.logs.count("configuration reloaded") == 1 })
	read("changed.localhost")
	f.stop()
	if owners, err := caddy.ReadLiveStacks(f.paths); err != nil || len(owners) != 0 {
		t.Fatalf("stopped directory owner: %+v, %v", owners, err)
	}
}
