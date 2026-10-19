package services

import (
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy/caddytest"
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

func TestStackRoutesRestoresDocumentBackendOnReloadFailure(t *testing.T) {
	paths := caddy.CreateManagedCaddyPaths(t.TempDir())
	admin := caddytest.StartAdminServer(t)
	writeFakeCaddyExecutable(t, paths.ExecutablePath)
	if err := caddy.EnsureManagedCaddyConfig(paths, testCaddySettings(admin), runtime.GOOS); err != nil {
		t.Fatal(err)
	}
	m := newResolvedManifest(t.TempDir(), admin)
	routes := stackRoutes{manifest: m, paths: paths, runtime: &stackRuntime{manifest: &m}, documentServers: map[string]*devtools.DocumentInjectionServer{}, active: map[string]caddy.ActivateRouteOptions{}}
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
	service.Health = ResolvedHealthConfig{Kind: HealthKindTCP, Host: stringPointer("127.0.0.1"), Port: service.Port}
	m.Services[service.Name] = service
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
