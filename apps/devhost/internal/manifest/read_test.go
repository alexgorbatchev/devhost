package manifest

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestReadManifestParsesFixtureShape(t *testing.T) {
	t.Parallel()

	manifestPath := filepath.Join("..", "..", "devhost.example.toml")
	rawManifest, error := ReadManifest(manifestPath)
	if error != nil {
		t.Fatalf("ReadManifest(...) unexpected error = %v", error)
	}

	name, ok := rawManifest.value["name"].(string)
	if !ok || name != "hello-stack" {
		t.Fatalf("raw manifest name = %#v, want %q", rawManifest.value["name"], "hello-stack")
	}

	servicesValue, ok := rawManifest.value["services"].(map[string]any)
	if !ok {
		t.Fatalf("raw manifest services = %#v, want map", rawManifest.value["services"])
	}

	if _, ok := servicesValue["web"]; !ok {
		t.Fatalf("raw manifest services missing %q", "web")
	}

	if len(rawManifest.serviceOrder) == 0 || rawManifest.serviceOrder[0] != "web" {
		t.Fatalf("serviceOrder = %#v, want first service %q", rawManifest.serviceOrder, "web")
	}
}

func TestReadManifestWrapsParseFailures(t *testing.T) {
	t.Parallel()

	temporaryDirectoryPath := t.TempDir()
	manifestPath := filepath.Join(temporaryDirectoryPath, "devhost.toml")
	if error := os.WriteFile(manifestPath, []byte("name = [\n"), 0o644); error != nil {
		t.Fatalf("WriteFile(...) error = %v", error)
	}

	_, error := ReadManifest(manifestPath)
	if error == nil {
		t.Fatal("ReadManifest(...) error = nil, want parse error")
	}

	if !strings.HasPrefix(error.Error(), "Failed to parse "+manifestPath+":") {
		t.Fatalf("ReadManifest(...) error = %q, want prefix %q", error.Error(), "Failed to parse "+manifestPath+":")
	}
}

func TestReadManifestExplainsDuplicateTables(t *testing.T) {
	t.Parallel()

	temporaryDirectoryPath := t.TempDir()
	manifestPath := filepath.Join(temporaryDirectoryPath, "devhost.toml")
	manifestText := strings.Join([]string{
		"[services.devhost-www]",
		`command = "bun dev"`,
		`cwd = "/tmp/react-starter-kit"`,
		`host = "test.localhost"`,
		"",
		"[services.devhost-www]",
		"primary = true",
		`command = "bun dev"`,
	}, "\n")
	if error := os.WriteFile(manifestPath, []byte(manifestText), 0o644); error != nil {
		t.Fatalf("WriteFile(...) error = %v", error)
	}

	_, error := ReadManifest(manifestPath)
	if error == nil {
		t.Fatal("ReadManifest(...) error = nil, want duplicate table error")
	}

	want := "Failed to parse " + manifestPath + ": TOML table [services.devhost-www] is declared more than once (lines 1 and 6). Merge those settings into a single table instead of repeating the header."
	if error.Error() != want {
		t.Fatalf("ReadManifest(...) error = %q, want %q", error.Error(), want)
	}
}
