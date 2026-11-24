package caddy

import (
	"bytes"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSiteRefreshPreservesInFlightFileReaders(t *testing.T) {
	t.Parallel()
	for _, test := range []struct {
		name string
		mode os.FileMode
	}{
		{"index.html", 0o644},
		{"devhost-route-not-found.css", 0o644},
		{"stacks.html", 0o600},
	} {
		t.Run(test.name, func(t *testing.T) {
			paths := CreateManagedCaddyPaths(t.TempDir())
			if err := os.MkdirAll(paths.RegistrationsDirectoryPath, 0o755); err != nil {
				t.Fatal(err)
			}
			settings := DefaultManagedCaddyGlobalSettings()
			if err := syncManagedCaddyNotFoundSite(paths.RoutesDirectoryPath, settings); err != nil {
				t.Fatal(err)
			}
			site := createManagedCaddyNotFoundSitePaths(paths.CaddyDirectoryPath)
			path := filepath.Join(site.DirectoryPath, test.name)
			replacement, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			original := append(bytes.Clone(replacement), []byte("\n/* previous generation */")...)
			if err := os.WriteFile(path, original, test.mode); err != nil {
				t.Fatal(err)
			}
			reader, err := os.Open(path)
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = reader.Close() })
			if err := syncManagedCaddyNotFoundSite(paths.RoutesDirectoryPath, settings); err != nil {
				t.Fatal(err)
			}
			served, err := io.ReadAll(reader)
			if err != nil || !bytes.Equal(served, original) {
				t.Fatalf("in-flight reader got %d bytes, want %d; error=%v", len(served), len(original), err)
			}
			current, err := os.ReadFile(path)
			if err != nil || !bytes.Equal(current, replacement) {
				t.Fatalf("replacement mismatch; error=%v", err)
			}
			info, err := os.Stat(path)
			if err != nil {
				t.Fatal(err)
			}
			if info.Mode().Perm() != test.mode {
				t.Fatalf("mode=%o, want %o", info.Mode().Perm(), test.mode)
			}
			entries, err := os.ReadDir(site.DirectoryPath)
			if err != nil || len(entries) != 3 {
				t.Fatalf("site has %d entries, want 3; error=%v", len(entries), err)
			}
		})
	}
}

func TestSyncManagedCaddyNotFoundSite(t *testing.T) {
	t.Parallel()

	temporaryDirectoryPath := t.TempDir()
	paths := CreateManagedCaddyPaths(temporaryDirectoryPath)
	sitePaths := createManagedCaddyNotFoundSitePaths(paths.CaddyDirectoryPath)
	if err := os.MkdirAll(paths.RegistrationsDirectoryPath, 0o755); err != nil {
		t.Fatalf("MkdirAll(...) error = %v", err)
	}
	if err := os.MkdirAll(paths.RoutesDirectoryPath, 0o755); err != nil {
		t.Fatalf("MkdirAll(...) error = %v", err)
	}

	writeRegistration(t, filepath.Join(paths.RegistrationsDirectoryPath, "hello.localhost_web.json"), `{"appBindHost":"127.0.0.1","host":"hello.localhost","path":"/"}`)
	writeRegistration(t, filepath.Join(paths.RegistrationsDirectoryPath, "api.localhost_api.json"), `{"appBindHost":"127.0.0.1","host":"api.localhost","path":"/v1"}`)
	writeRegistration(t, filepath.Join(paths.RegistrationsDirectoryPath, "legacy.localhost_legacy.json"), `{"host":"legacy.localhost"}`)
	writeRegistration(t, filepath.Join(paths.RegistrationsDirectoryPath, "pending.localhost_pending.json"), `{"appBindHost":"127.0.0.1","host":"pending.localhost","path":"/pending"}`)
	writeRegistration(t, filepath.Join(paths.RegistrationsDirectoryPath, "ignored.json"), `{"host":"ignored.localhost","path":"/"}`)
	writeRouteFile(t, filepath.Join(paths.RoutesDirectoryPath, "hello.localhost.caddy"))
	writeRouteFile(t, filepath.Join(paths.RoutesDirectoryPath, "api.localhost.caddy"))
	writeRouteFile(t, filepath.Join(paths.RoutesDirectoryPath, "legacy.localhost_legacy.caddy"))

	if err := syncManagedCaddyNotFoundSite(paths.RoutesDirectoryPath, ManagedCaddyGlobalSettings{HTTPSPort: 4443}); err != nil {
		t.Fatalf("syncManagedCaddyNotFoundSite(...) unexpected error = %v", err)
	}

	pageTextBytes, err := os.ReadFile(sitePaths.PagePath)
	if err != nil {
		t.Fatalf("ReadFile(...) error = %v", err)
	}
	pageText := string(pageTextBytes)
	if !strings.Contains(pageText, `<link rel="stylesheet" href="/devhost-route-not-found.css"`) {
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

	stylesheetText, err := os.ReadFile(sitePaths.StylesheetPath)
	if err != nil {
		t.Fatalf("ReadFile(...) error = %v", err)
	}
	if string(stylesheetText) != managedCaddyNotFoundPageCSS {
		t.Fatalf("stylesheetText length = %d, want exact managed caddy stylesheet", len(stylesheetText))
	}
}

func TestSyncManagedCaddyNotFoundSiteEmptyState(t *testing.T) {
	t.Parallel()

	temporaryDirectoryPath := t.TempDir()
	paths := CreateManagedCaddyPaths(temporaryDirectoryPath)
	if err := os.MkdirAll(paths.RegistrationsDirectoryPath, 0o755); err != nil {
		t.Fatalf("MkdirAll(...) error = %v", err)
	}
	if err := os.MkdirAll(paths.RoutesDirectoryPath, 0o755); err != nil {
		t.Fatalf("MkdirAll(...) error = %v", err)
	}

	if err := syncManagedCaddyNotFoundSite(paths.RoutesDirectoryPath, DefaultManagedCaddyGlobalSettings()); err != nil {
		t.Fatalf("syncManagedCaddyNotFoundSite(...) unexpected error = %v", err)
	}

	sitePaths := createManagedCaddyNotFoundSitePaths(paths.CaddyDirectoryPath)
	pageText, err := os.ReadFile(sitePaths.PagePath)
	if err != nil {
		t.Fatalf("ReadFile(...) error = %v", err)
	}
	if !strings.Contains(string(pageText), "No devhost hostnames are active right now.") {
		t.Fatalf("pageText = %q, want empty-state copy", string(pageText))
	}
}

func writeRegistration(t *testing.T, path string, text string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("MkdirAll(...) error = %v", err)
	}
	if err := os.WriteFile(path, []byte(text), 0o644); err != nil {
		t.Fatalf("WriteFile(...) error = %v", err)
	}
}

func writeRouteFile(t *testing.T, path string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("MkdirAll(...) error = %v", err)
	}
	if err := os.WriteFile(path, []byte("route"), 0o644); err != nil {
		t.Fatalf("WriteFile(...) error = %v", err)
	}
}
