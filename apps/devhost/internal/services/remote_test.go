package services

import (
	"bytes"
	"reflect"
	"strings"
	"testing"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/manifest"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/nettest"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/remote"
)

func TestRemoteHostSelectionPrecedesTemplatesAndSurvivesResolution(t *testing.T) {
	settings := remote.Settings{DomainSuffix: "--laptop.preview.example.com"}
	port := nettest.ReservePort(t)
	configuration := manifest.Manifest{ManifestPath: "/project/devhost.toml", ServiceOrder: []string{"web", "api", "worker"}, Services: map[string]manifest.ValidatedService{
		"web":    {Name: "web", Hosts: []string{"app.localhost", "alias.localhost"}, Path: copyStringPointer("/*"), BindHost: "127.0.0.1", Port: &manifest.PortConfig{Auto: true}, Command: []string{"server", "--host", "{{ services.web.host }}"}},
		"api":    {Name: "api", Hosts: []string{"app.localhost"}, Path: copyStringPointer("/api/*"), BindHost: "127.0.0.1", Port: &manifest.PortConfig{Number: port}, Env: map[string]string{"PUBLIC_ORIGIN": "https://{{ services.web.host }}"}, Command: []string{"api"}},
		"worker": {Name: "worker", Command: []string{"worker"}, Health: &manifest.HealthConfig{Process: true}, Env: map[string]string{"PUBLIC_ORIGIN": "https://{{ services.web.host }}"}},
	}}
	resolved, err := ResolveRemoteServicePorts(configuration, []string{"web", "api"}, settings)
	if err != nil {
		t.Fatal(err)
	}
	verify := func(t *testing.T, got ResolvedManifest) {
		t.Helper()
		want := "app" + settings.DomainSuffix
		if got.Services["web"].Command[2] != want || got.Services["api"].Env["PUBLIC_ORIGIN"] != "https://"+want || got.Stopped["worker"].Env["PUBLIC_ORIGIN"] != "https://"+want {
			t.Fatalf("templates kept local hosts: %#v", got)
		}
		if !reflect.DeepEqual(got.Services["web"].Hosts, []string{want, "alias" + settings.DomainSuffix}) || got.Services["api"].Hosts[0] != want {
			t.Fatalf("public host groups = %#v", got.Services)
		}
		if got.Remote == nil || *got.Remote != settings {
			t.Fatalf("remote settings were lost: %#v", got.Remote)
		}
	}
	verify(t, resolved)
	if configuration.Services["web"].Hosts[0] != "app.localhost" || resolved.configuration.Services["web"].Hosts[0] != "app.localhost" {
		t.Fatal("remote resolution mutated the accepted local configuration")
	}
	for _, tc := range []struct {
		name    string
		resolve func(manifest.Manifest, ResolvedManifest, []string) (ResolvedManifest, error)
	}{
		{"reload", resolveReloadPorts},
		{"restart and worktree", resolveStackRestartPorts},
	} {
		t.Run(tc.name, func(t *testing.T) {
			next, err := tc.resolve(configuration, resolved, resolved.requested)
			if err != nil {
				t.Fatal(err)
			}
			verify(t, next)
		})
	}
	_, retried, err := ReassignAutoPort(resolved, "web")
	if err != nil {
		t.Fatal(err)
	}
	verify(t, retried)
}

func TestRemoteManifestHostValidation(t *testing.T) {
	for _, tc := range []struct {
		name, host, localSuffix, want, failure string
	}{
		{name: "default suffix", host: "app.localhost", want: "app--machine.example.com"},
		{name: "machine suffix", host: "app--local.example.com", localSuffix: "--local.example.com", want: "app--machine.example.com"},
		{name: "already public", host: "app--machine.example.com", want: "app--machine.example.com"},
		{name: "foreign hostname", host: "app.other.example.com", failure: "must end with remote.localSuffix"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			m := manifest.Manifest{Services: map[string]manifest.ValidatedService{"web": {Hosts: []string{tc.host}, Path: copyStringPointer("/*")}}}
			got, err := remoteManifestHosts(m, remote.Settings{DomainSuffix: "--machine.example.com", LocalSuffix: tc.localSuffix})
			if tc.failure != "" {
				if err == nil || !strings.Contains(err.Error(), tc.failure) {
					t.Fatalf("error = %v, want %s", err, tc.failure)
				}
				return
			}
			if err != nil || got.Services["web"].Hosts[0] != tc.want {
				t.Fatalf("hosts = %#v, error = %v", got.Services, err)
			}
		})
	}
	m := manifest.Manifest{Services: map[string]manifest.ValidatedService{
		"first":  {Hosts: []string{"app.localhost"}, Path: copyStringPointer("/*")},
		"second": {Hosts: []string{"app--machine.example.com"}, Path: copyStringPointer("/*")},
	}}
	if _, err := remoteManifestHosts(m, remote.Settings{DomainSuffix: "--machine.example.com"}); err == nil || !strings.Contains(err.Error(), "duplicated") {
		t.Fatalf("colliding remote origins accepted: %v", err)
	}
	if _, err := ResolveRemoteServicePorts(manifest.Manifest{}, nil, remote.Settings{DomainSuffix: "--machine.example.com"}); err == nil || !strings.Contains(err.Error(), "at least one selected service") {
		t.Fatalf("unrouted remote stack accepted: %v", err)
	}
}

func TestRemotePreviewURLsIgnoreLocalCaddyPort(t *testing.T) {
	t.Setenv("AGENT", "1")
	port := nettest.ReservePort(t)
	m := ResolvedManifest{Remote: &remote.Settings{}, Name: "preview", Caddy: caddy.ManagedCaddyGlobalSettings{HTTPSPort: 8443}, Services: map[string]ResolvedService{
		"web":    {Name: "web", Hosts: []string{"app.example.com"}, Path: copyStringPointer("/preview/*"), Port: &port},
		"worker": {Name: "worker", BindHost: "127.0.0.1", Port: &port},
	}}
	var output bytes.Buffer
	LogServiceURLs(m, &output)
	if output.String() != "[preview] web: https://app.example.com/preview/\n" {
		t.Fatalf("remote output = %q", output.String())
	}
	output.Reset()
	if err := reportDetachedStack(&output, caddy.LiveStack{Remote: true, Name: "preview", PID: 42, URLs: []string{"https://app.example.com"}}, true); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(output.String(), "Already running") || !strings.Contains(output.String(), "https://app.example.com") {
		t.Fatalf("repeated start omitted the remote URL: %s", &output)
	}
}

func TestRemoteSettingsChangesRequireRestart(t *testing.T) {
	settings := remote.Settings{DomainSuffix: "--machine.example.com"}
	r := &stackRuntime{manifest: &ResolvedManifest{Remote: &settings}}
	if err := r.checkRemoteSettings(&settings); err != nil {
		t.Fatal(err)
	}
	for _, next := range []*remote.Settings{nil, {DomainSuffix: "--other.example.com"}} {
		if err := r.checkRemoteSettings(next); err == nil || !strings.Contains(err.Error(), "stop all remote stacks") {
			t.Fatalf("changed settings accepted: %v", err)
		}
	}
}
