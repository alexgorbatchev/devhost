package manifest

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestNativeBrowserManifest(t *testing.T) {
	t.Parallel()
	for _, endpoint := range []string{"", "http://127.0.0.1:9222", "http://[::1]:9223/", "ws://127.0.0.1:9222/devtools/browser/real-browser"} {
		t.Run(endpoint, func(t *testing.T) {
			validated, err := ValidateManifest(filepath.Join(t.TempDir(), "devhost.toml"), rawManifestWithServices(map[string]any{
				"devtools": map[string]any{"browser": map[string]any{"endpoint": endpoint, "reactExtensionId": "fmkadmapgofadopljbjfkapdkoienihi"}},
			}))
			if err != nil {
				t.Fatalf("explicit native browser setup was rejected: %v", err)
			}
			if validated.Devtools.Browser.Endpoint != endpoint || validated.Devtools.Browser.ReactExtensionID != defaultReactExtensionID {
				t.Fatalf("validated native setup = %#v, want endpoint %q and official extension ID", validated.Devtools.Browser, endpoint)
			}
		})
	}
}

func TestNativeBrowserManifestDefaultsAndRejectsInvalidFields(t *testing.T) {
	t.Parallel()
	validated, err := ValidateManifest(filepath.Join(t.TempDir(), "devhost.toml"), rawManifestWithServices(nil))
	if err != nil {
		t.Fatal(err)
	}
	if validated.Devtools.Browser.Endpoint != "" || validated.Devtools.Browser.ReactExtensionID != defaultReactExtensionID {
		t.Fatalf("native browser default=%#v", validated.Devtools.Browser)
	}
	for _, tc := range []struct {
		name    string
		browser any
	}{
		{"wrong browser type", false},
		{"wrong endpoint type", map[string]any{"endpoint": 42}},
		{"wrong extension type", map[string]any{"reactExtensionId": 42}},
		{"invalid extension alphabet", map[string]any{"reactExtensionId": "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz"}},
		{"invalid extension length", map[string]any{"reactExtensionId": "a"}},
		{"unknown credential field", map[string]any{"token": "not-a-contract"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := ValidateManifest(filepath.Join(t.TempDir(), "devhost.toml"), rawManifestWithServices(map[string]any{"devtools": map[string]any{"browser": tc.browser}}))
			if err == nil {
				t.Fatalf("invalid native setup accepted: %#v", tc.browser)
			}
		})
	}
}

func TestNativeBrowserManifestRejectsEscapingEndpoint(t *testing.T) {
	t.Parallel()
	for _, endpoint := range []string{"http://localhost:9222", "http://example.com:9222", "http://0.0.0.0:9222", "http://127.0.0.1", "http://127.0.0.1:0", "http://127.0.0.1:9222/other", "http://user:pass@127.0.0.1:9222", "http://127.0.0.1:9222/?x=y", "http://127.0.0.1:9222/#x", "ws://127.0.0.1:9222/devtools/page/host", "wss://127.0.0.1:9222/devtools/browser/host"} {
		t.Run(endpoint, func(t *testing.T) {
			_, err := ValidateManifest(filepath.Join(t.TempDir(), "devhost.toml"), rawManifestWithServices(map[string]any{
				"devtools": map[string]any{"browser": map[string]any{"endpoint": endpoint}},
			}))
			if err == nil || !strings.Contains(err.Error(), "devtools.browser.endpoint") {
				t.Fatalf("unsafe native endpoint should be rejected at its own field: %v", err)
			}
		})
	}
}
