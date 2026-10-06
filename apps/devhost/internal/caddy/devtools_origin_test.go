package caddy

import (
	"os"
	"path/filepath"
	"testing"
)

func TestAllowsDevtoolsURLUsesCurrentSharedRoutes(t *testing.T) {
	t.Parallel()
	paths := CreateManagedCaddyPaths(t.TempDir())
	if err := os.MkdirAll(paths.RegistrationsDirectoryPath, 0o755); err != nil {
		t.Fatal(err)
	}
	owner := DevtoolsRouteOwner{ManifestPath: "/project/devhost.toml", ControlPort: 43001}
	root := ActivateRouteOptions{AppBindHost: "127.0.0.1", AppPort: 3000, Host: "project.localhost", Path: "/", ServiceName: "web", DevtoolsControlPort: owner.ControlPort}
	rootFile := filepath.Join(paths.RegistrationsDirectoryPath, "root.json")
	writeRegistration(t, rootFile, createRouteRegistrationText(root, owner.ManifestPath))
	other := ActivateRouteOptions{AppBindHost: "127.0.0.1", AppPort: 3001, Host: "project.localhost", Path: "/api/*", ServiceName: "api", DevtoolsControlPort: 43002, HTTPEnabled: true, CaddyHTTPPort: 8080, CaddyHTTPSPort: 4443}
	otherFile := filepath.Join(paths.RegistrationsDirectoryPath, "other.json")
	writeRegistration(t, otherFile, createRouteRegistrationText(other, "/other/devhost.toml"))
	for _, tt := range []struct {
		text string
		want bool
	}{
		{"http://project.localhost:8080/", true},
		{"https://project.localhost:4443/nested?query=1#fragment", true},
		{"http://project.localhost/", false},
		{"https://project.localhost/", false},
		{"http://project.localhost:4443/", false},
		{"https://other.localhost:4443/", false},
		{"https://project.localhost:4443/api/records", false},
		{"https://project.localhost:4443/API/records", false},
		{"https://project.localhost:4443/api%2Frecords", false},
		{"https://project.localhost:4443/x/../api/records", false},
		{"https://project.localhost:4443/api", true},
		{"https://project.localhost:4443/__devhost__/config", false},
		{"https://user@project.localhost:4443/", false},
	} {
		t.Run(tt.text, func(t *testing.T) {
			got, err := AllowsDevtoolsURL(paths, owner, tt.text)
			if err != nil || got != tt.want {
				t.Fatalf("AllowsDevtoolsURL(%q) = %v, %v; want %v", tt.text, got, err, tt.want)
			}
		})
	}
	// Withdrawal changes both path ownership and effective global ports immediately.
	if err := os.Remove(otherFile); err != nil {
		t.Fatal(err)
	}
	for _, tt := range []struct {
		text string
		want bool
	}{
		{"http://project.localhost:8080/", false},
		{"https://project.localhost:4443/", false},
		{"https://project.localhost/api/records", true},
	} {
		got, err := AllowsDevtoolsURL(paths, owner, tt.text)
		if err != nil || got != tt.want {
			t.Fatalf("after route withdrawal: %q = %v, %v; want %v", tt.text, got, err, tt.want)
		}
	}
	if err := os.Remove(rootFile); err != nil {
		t.Fatal(err)
	}
	got, err := AllowsDevtoolsURL(paths, owner, "https://project.localhost/")
	if err != nil || got {
		t.Fatalf("withdrawn control route = %v, %v", got, err)
	}
}
