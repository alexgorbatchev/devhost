package services

import (
	"strings"
	"testing"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/config"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/manifest"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/remote"
)

func TestLocalLabelsPrecedeTemplatesAndSurviveResolution(t *testing.T) {
	for _, suffix := range []string{".localhost", "--devbox.example.com"} {
		t.Run(suffix, func(t *testing.T) {
			source := manifest.Manifest{ServiceOrder: []string{"web", "api", "worker"}, Services: map[string]manifest.ValidatedService{
				"web":    {Name: "web", Health: &manifest.HealthConfig{Process: true}, Hosts: []string{"app", "alias"}, Path: copyStringPointer("/"), BindHost: "127.0.0.1", Port: &manifest.PortConfig{Auto: true}, Command: []string{"server", "{{ services.web.host }}"}},
				"api":    {Name: "api", Health: &manifest.HealthConfig{Process: true}, Hosts: []string{"app"}, Path: copyStringPointer("/api/*"), Env: map[string]string{"ORIGIN": "https://{{ services.web.host }}"}},
				"worker": {Name: "worker", Health: &manifest.HealthConfig{Process: true}, Hosts: []string{"fixed.example.com"}},
			}}
			resolved, err := ResolveLocalServicePorts(source, []string{"web", "api"}, suffix)
			if err != nil {
				t.Fatal(err)
			}
			verify := func(value ResolvedManifest) {
				t.Helper()
				if value.Remote != nil || value.DomainSuffix != suffix || value.Services["web"].Command[1] != "app"+suffix || value.Services["api"].Env["ORIGIN"] != "https://app"+suffix || value.Services["web"].Hosts[1] != "alias"+suffix || value.Stopped["worker"].Hosts[0] != "fixed.example.com" {
					t.Fatalf("local host resolution: %#v", value)
				}
			}
			verify(resolved)
			if source.Services["web"].Hosts[0] != "app" || resolved.configuration.Services["web"].Hosts[0] != "app" {
				t.Fatal("source manifest was mutated")
			}
			for _, resolve := range []func(manifest.Manifest, ResolvedManifest, []string) (ResolvedManifest, error){resolveReloadPorts, resolveStackRestartPorts} {
				next, err := resolve(source, resolved, resolved.requested)
				if err != nil {
					t.Fatal(err)
				}
				verify(next)
			}
			_, retry, err := ReassignAutoPort(resolved, "web")
			if err != nil {
				t.Fatal(err)
			}
			verify(retry)
		})
	}
}

func TestLocalHostDefaultsAndExpandedCollision(t *testing.T) {
	source := manifest.Manifest{ServiceOrder: []string{"web"}, Services: map[string]manifest.ValidatedService{"web": {Name: "web", Health: &manifest.HealthConfig{Process: true}, Hosts: []string{"web"}, Path: copyStringPointer("/")}}}
	got, err := ResolveServicePorts(source)
	if err != nil || got.Services["web"].Hosts[0] != "web.localhost" {
		t.Fatalf("default local hosts: %#v, %v", got, err)
	}
	source.Services["other"] = manifest.ValidatedService{Hosts: []string{"web.localhost"}, Path: copyStringPointer("/")}
	if _, err := ResolveServicePorts(source); err == nil || !strings.Contains(err.Error(), "overlaps") {
		t.Fatalf("expanded collision: %v", err)
	}
}

func TestLocalRoutingSettingsStayLocalAndRequireRestartForNewSuffix(t *testing.T) {
	state := &stackRuntime{manifest: &ResolvedManifest{DomainSuffix: ".localhost"}}
	next := config.Config{DomainSuffix: ".localhost", Remote: &remote.Settings{DomainSuffix: ".preview.example.com"}}
	if err := state.checkRoutingSettings(next); err != nil {
		t.Fatalf("enrollment changed a local run: %v", err)
	}
	next.DomainSuffix = "--devbox.example.com"
	if err := state.checkRoutingSettings(next); err == nil || !strings.Contains(err.Error(), "stop this stack") {
		t.Fatalf("suffix change silently accepted: %v", err)
	}
}

func TestExpandedHostRouteConflicts(t *testing.T) {
	for _, tc := range []struct {
		name, left, right string
		wantError         bool
	}{
		{name: "nested prefixes", left: "/api/*", right: "/api/v2/*", wantError: true},
		{name: "prefix and exact", left: "/api/*", right: "/api/users", wantError: true},
		{name: "separate prefixes", left: "/api/*", right: "/assets/*"},
		{name: "root and prefix", left: "/", right: "/api/*"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			source := manifest.Manifest{Services: map[string]manifest.ValidatedService{
				"api":   {Hosts: []string{"web"}, Path: &tc.left},
				"other": {Hosts: []string{"web.localhost"}, Path: &tc.right},
			}}
			_, err := resolveManifestHosts(source, ".localhost", false)
			if (err != nil) != tc.wantError {
				t.Fatalf("expanded route validation = %v, want error %v", err, tc.wantError)
			}
		})
	}
}

func TestExpandedHostDNSLength(t *testing.T) {
	for _, remoteMode := range []bool{false, true} {
		for _, size := range []int{55, 56} {
			source := manifest.Manifest{Services: map[string]manifest.ValidatedService{
				"web": {Hosts: []string{strings.Repeat("a", size)}},
			}}
			_, err := resolveManifestHosts(source, "--laptop.example.com", remoteMode)
			if (err != nil) != (size == 56) {
				t.Fatalf("remote=%v, label size=%d: %v", remoteMode, size, err)
			}
		}
	}
}
