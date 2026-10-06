package services

import (
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/devtools"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/manifest"
)

func TestProxyLocalOriginResolution(t *testing.T) {
	for _, enabled := range []bool{false, true} {
		value := manifest.Manifest{Services: map[string]manifest.ValidatedService{
			"web": {Name: "web", BindHost: "127.0.0.1", Hosts: []string{"app.example.test"}, Port: &manifest.PortConfig{Number: 3000}, ProxyLocalOrigin: enabled},
		}}
		resolved, err := ResolveServicePorts(value)
		if err != nil {
			t.Fatal(err)
		}
		routes := stackRoutes{manifest: resolved}
		options := routes.options(resolved.Services["web"])
		if options.ProxyLocalOrigin != enabled {
			t.Fatalf("route proxyLocalOrigin = %v, want %v", options.ProxyLocalOrigin, enabled)
		}
	}
}

func TestStackRoutesPreservesExplicitManagementVotes(t *testing.T) {
	paths := caddy.CreateManagedCaddyPaths(t.TempDir())
	fallback := caddy.ManagedCaddyConfigFallback{AdminAddress: "127.0.0.1:44723", BindHost: "0.0.0.0", HTTPPort: 36009, HTTPSPort: 43273}
	if err := caddy.EnsureManagedCaddyConfig(paths, fallback); err != nil {
		t.Fatal(err)
	}
	settings, err := caddy.ReadManagedCaddyGlobalSettings(paths, fallback)
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name    string
		request manifest.CaddyGlobalConfig
		want    caddy.ManagedCaddyGlobalSettings
	}{
		{name: "sparse defaults inherit binding", request: manifest.CaddyGlobalConfig{AdminAddress: caddy.DefaultManagedCaddyAdminAddress, BindHost: "127.0.0.1", HTTPPort: 80, HTTPSPort: 443}, want: settings},
		{name: "explicit differing votes retained", request: manifest.CaddyGlobalConfig{AdminAddress: "127.0.0.1:44724", BindHost: "::1", HTTPPort: 36010, HTTPSPort: 43274}, want: caddy.ManagedCaddyGlobalSettings{AdminAddress: "127.0.0.1:44724", BindHost: "::1", HTTPPort: 36010, HTTPSPort: 43274}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			routes := stackRoutes{manifest: ResolvedManifest{Caddy: manifest.CaddyConfig{Global: tc.request}}, settings: settings}
			options := routes.options(ResolvedService{Name: "web", Hosts: []string{"sibling.localhost"}, BindHost: "127.0.0.1", Port: intPointer(3000)})
			if options.CaddyAdminAddress != tc.want.AdminAddress || options.CaddyBindHost != tc.want.BindHost || options.CaddyHTTPPort != tc.want.HTTPPort || options.CaddyHTTPSPort != tc.want.HTTPSPort {
				t.Fatalf("actual route management votes = %#v, want %#v", options, tc.want)
			}
			if options.HTTPEnabled {
				t.Fatal("false manifest inherited a true runtime HTTP vote")
			}
		})
	}
}

func TestStackRoutesRestoresDocumentBackendOnReloadFailure(t *testing.T) {
	paths := caddy.CreateManagedCaddyPaths(t.TempDir())
	admin, stopAdmin := startTestAdminServer(t)
	defer stopAdmin()
	writeFakeCaddyExecutable(t, paths.ExecutablePath)
	if err := caddy.EnsureManagedCaddyConfig(paths, caddy.ManagedCaddyConfigFallback{AdminAddress: admin}); err != nil {
		t.Fatal(err)
	}
	m := newResolvedManifest(t.TempDir(), admin)
	control, err := devtools.StartControlServer(devtools.StartControlServerOptions{GetHealthResponse: func() (devtools.HealthResponse, error) { return collectServicesHealth(m, nil, nil), nil }})
	if err != nil {
		t.Fatal(err)
	}
	defer control.Stop()
	routes := stackRoutes{manifest: m, paths: paths, controlServer: control, documentServers: map[string]*devtools.DocumentInjectionServer{}, active: map[string]caddy.ActivateRouteOptions{}}
	routes.settings, err = caddy.ReadManagedCaddyGlobalSettings(paths, caddy.ManagedCaddyConfigFallback{AdminAddress: admin})
	if err != nil {
		t.Fatal(err)
	}
	backend := func(text string) *httptest.Server {
		return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("content-type", "text/html")
			_, _ = w.Write([]byte(text))
		}))
	}
	oldBackend, newBackend := backend("original"), backend("replacement")
	defer oldBackend.Close()
	defer newBackend.Close()
	service := ResolvedService{Name: "web", Hosts: []string{"recover.localhost", "alias.recover.localhost"}, BindHost: "127.0.0.1", Port: intPointer(oldBackend.Listener.Addr().(*net.TCPAddr).Port), ProxyLocalOrigin: true}
	if err := routes.activate(service); err != nil {
		t.Fatal(err)
	}
	document := routes.documentServers[service.Name]
	defer document.Stop()
	assertRestartResponse(t, serverURL(document.Port(), "/"), "original")
	for _, host := range service.Hosts {
		registration := readRestartRoute(t, filepath.Join(paths.RegistrationsDirectoryPath, host+"_web_2f.json"))
		if registration.AppPort != *service.Port {
			t.Fatalf("initial registration = %#v", registration)
		}
		if !registration.ProxyLocalOrigin {
			t.Fatal("route lost proxyLocalOrigin")
		}
	}
	service.Port = intPointer(newBackend.Listener.Addr().(*net.TCPAddr).Port)
	if err := os.WriteFile(paths.ExecutablePath, []byte("#!/bin/sh\nexit 1\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := routes.activate(service); err == nil {
		t.Fatal("reload failure reported success")
	}
	if routes.documentServers[service.Name] != document {
		t.Fatal("route refresh replaced the document listener")
	}
	assertRestartResponse(t, serverURL(document.Port(), "/"), "original")
	for _, host := range service.Hosts {
		registration := readRestartRoute(t, filepath.Join(paths.RegistrationsDirectoryPath, host+"_web_2f.json"))
		if registration.AppPort != oldBackend.Listener.Addr().(*net.TCPAddr).Port {
			t.Fatalf("failed update changed registration = %#v", registration)
		}
		if !registration.ProxyLocalOrigin {
			t.Fatal("rollback lost proxyLocalOrigin")
		}
	}
}
