package caddy

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSyncManagedCaddyNotFoundSite(t *testing.T) {
	t.Parallel()

	temporaryDirectoryPath := t.TempDir()
	paths := CreateManagedCaddyPaths(temporaryDirectoryPath)
	sitePaths := createManagedCaddyNotFoundSitePaths(paths.CaddyDirectoryPath)
	if error := os.MkdirAll(paths.RegistrationsDirectoryPath, 0o755); error != nil {
		t.Fatalf("MkdirAll(...) error = %v", error)
	}
	if error := os.MkdirAll(paths.RoutesDirectoryPath, 0o755); error != nil {
		t.Fatalf("MkdirAll(...) error = %v", error)
	}

	writeRegistration(t, filepath.Join(paths.RegistrationsDirectoryPath, "hello.localhost_web.json"), `{"appBindHost":"127.0.0.1","host":"hello.localhost","path":"/"}`)
	writeRegistration(t, filepath.Join(paths.RegistrationsDirectoryPath, "api.localhost_api.json"), `{"appBindHost":"127.0.0.1","host":"api.localhost","path":"/v1"}`)
	writeRegistration(t, filepath.Join(paths.RegistrationsDirectoryPath, "legacy.localhost_legacy.json"), `{"host":"legacy.localhost"}`)
	writeRegistration(t, filepath.Join(paths.RegistrationsDirectoryPath, "pending.localhost_pending.json"), `{"appBindHost":"127.0.0.1","host":"pending.localhost","path":"/pending"}`)
	writeRegistration(t, filepath.Join(paths.RegistrationsDirectoryPath, "ignored.json"), `{"host":"ignored.localhost","path":"/"}`)
	writeRouteFile(t, filepath.Join(paths.RoutesDirectoryPath, "hello.localhost.caddy"))
	writeRouteFile(t, filepath.Join(paths.RoutesDirectoryPath, "api.localhost.caddy"))
	writeRouteFile(t, filepath.Join(paths.RoutesDirectoryPath, "legacy.localhost_legacy.caddy"))

	if error := syncManagedCaddyNotFoundSite(paths.RoutesDirectoryPath, 4443); error != nil {
		t.Fatalf("syncManagedCaddyNotFoundSite(...) unexpected error = %v", error)
	}

	pageTextBytes, error := os.ReadFile(sitePaths.PagePath)
	if error != nil {
		t.Fatalf("ReadFile(...) error = %v", error)
	}
	pageText := string(pageTextBytes)
	if !strings.Contains(pageText, `<link rel="stylesheet" href="/devhost-route-not-found.css">`) {
		t.Fatalf("pageText missing stylesheet link: %q", pageText)
	}
	if !strings.Contains(pageText, `href="https://api.localhost:4443/v1"`) || !strings.Contains(pageText, `href="https://hello.localhost:4443/"`) || !strings.Contains(pageText, `href="https://legacy.localhost:4443/"`) {
		t.Fatalf("pageText missing expected route links: %q", pageText)
	}
	if strings.Contains(pageText, "pending.localhost") || strings.Contains(pageText, "ignored.localhost") {
		t.Fatalf("pageText included inactive routes: %q", pageText)
	}
	if strings.Index(pageText, "api.localhost</span>") >= strings.Index(pageText, "hello.localhost</span>") {
		t.Fatalf("pageText route order = %q, want api before hello", pageText)
	}

	stylesheetText, error := os.ReadFile(sitePaths.StylesheetPath)
	if error != nil {
		t.Fatalf("ReadFile(...) error = %v", error)
	}
	if string(stylesheetText) != managedCaddyNotFoundPageCSS {
		t.Fatalf("stylesheetText length = %d, want exact managed caddy stylesheet", len(stylesheetText))
	}
}

func TestSyncManagedCaddyNotFoundSiteEmptyState(t *testing.T) {
	t.Parallel()

	temporaryDirectoryPath := t.TempDir()
	paths := CreateManagedCaddyPaths(temporaryDirectoryPath)
	if error := os.MkdirAll(paths.RegistrationsDirectoryPath, 0o755); error != nil {
		t.Fatalf("MkdirAll(...) error = %v", error)
	}
	if error := os.MkdirAll(paths.RoutesDirectoryPath, 0o755); error != nil {
		t.Fatalf("MkdirAll(...) error = %v", error)
	}

	if error := syncManagedCaddyNotFoundSite(paths.RoutesDirectoryPath, defaultManagedCaddyHTTPSPort); error != nil {
		t.Fatalf("syncManagedCaddyNotFoundSite(...) unexpected error = %v", error)
	}

	sitePaths := createManagedCaddyNotFoundSitePaths(paths.CaddyDirectoryPath)
	pageText, error := os.ReadFile(sitePaths.PagePath)
	if error != nil {
		t.Fatalf("ReadFile(...) error = %v", error)
	}
	if !strings.Contains(string(pageText), "No devhost hostnames are active right now.") {
		t.Fatalf("pageText = %q, want empty-state copy", string(pageText))
	}
}

func writeRegistration(t *testing.T, path string, text string) {
	t.Helper()
	if error := os.MkdirAll(filepath.Dir(path), 0o755); error != nil {
		t.Fatalf("MkdirAll(...) error = %v", error)
	}
	if error := os.WriteFile(path, []byte(text), 0o644); error != nil {
		t.Fatalf("WriteFile(...) error = %v", error)
	}
}

func writeRouteFile(t *testing.T, path string) {
	t.Helper()
	if error := os.MkdirAll(filepath.Dir(path), 0o755); error != nil {
		t.Fatalf("MkdirAll(...) error = %v", error)
	}
	if error := os.WriteFile(path, []byte("route"), 0o644); error != nil {
		t.Fatalf("WriteFile(...) error = %v", error)
	}
}
