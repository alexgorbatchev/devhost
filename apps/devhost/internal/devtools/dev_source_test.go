package devtools

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

const (
	rebuiltBundleMarker    = "rebuilt from source"
	bundleFailureMarker    = "bundle build exploded"
	writeBundleRecipe      = "build-devtools-bundle:\n    mkdir -p internal/devtools/dist\n    printf '%s' \"console.log('" + rebuiltBundleMarker + "');\" > internal/devtools/dist/devtools.js\n"
	failingBundleRecipe    = "build-devtools-bundle:\n    echo '" + bundleFailureMarker + "' >&2\n    exit 1\n"
	silentBundleRecipe     = "build-devtools-bundle:\n    echo run >> build-runs.log\n"
	devSourceTestStackName = "dev-source-stack"
)

func TestControlServerDevSourceInjectedScript(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name          string
		recipe        string
		bundle        string
		bundleIsFresh bool
		wantContains  []string
	}{
		{
			name:         "rebuilds a missing bundle",
			recipe:       writeBundleRecipe,
			wantContains: []string{rebuiltBundleMarker},
		},
		{
			name:         "rebuilds a bundle older than the sources",
			recipe:       writeBundleRecipe,
			bundle:       "console.log('stale bundle');",
			wantContains: []string{rebuiltBundleMarker},
		},
		{
			name:          "serves a bundle newer than the sources without rebuilding",
			recipe:        failingBundleRecipe,
			bundle:        "console.log('fresh bundle');",
			bundleIsFresh: true,
			wantContains:  []string{"fresh bundle"},
		},
		{
			name:         "reports a failed rebuild in the page",
			recipe:       failingBundleRecipe,
			wantContains: []string{"DEVHOST COMPILATION ERROR", bundleFailureMarker},
		},
	}

	for _, tt := range tests {
		tc := tt
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			checkoutPath := writeDevSourceCheckout(t, tc.recipe)
			if tc.bundle != "" {
				writeDevSourceBundle(t, checkoutPath, tc.bundle, tc.bundleIsFresh)
			}

			controlServer := startDevSourceControlServer(t, checkoutPath)
			body := getControlServerText(t, controlServer, injectedScriptPath)

			if strings.Contains(body, controlServer.controlToken) {
				t.Fatal("development script contains instance credentials")
			}

			for _, want := range tc.wantContains {
				if !strings.Contains(body, want) {
					t.Fatalf("inject.js missing %q:\n%s", want, body)
				}
			}
		})
	}
}

func TestControlServerDevSourceRetriesBuildThatWritesNoBundle(t *testing.T) {
	t.Parallel()

	checkoutPath := writeDevSourceCheckout(t, silentBundleRecipe)
	controlServer := startDevSourceControlServer(t, checkoutPath)

	for range 2 {
		body := getControlServerText(t, controlServer, injectedScriptPath)
		for _, want := range []string{"DEVHOST COMPILATION ERROR", "devtools.js"} {
			if !strings.Contains(body, want) {
				t.Fatalf("inject.js missing %q:\n%s", want, body)
			}
		}
	}

	runs, err := os.ReadFile(filepath.Join(checkoutPath, "apps", "devhost", "build-runs.log"))
	if err != nil {
		t.Fatalf("read build log: %v", err)
	}

	if count := strings.Count(string(runs), "run"); count != 2 {
		t.Fatalf("bundle recipe ran %d times, want one run per request", count)
	}
}

func TestControlServerDevSourceServesXtermStylesheetFromCheckout(t *testing.T) {
	t.Parallel()

	checkoutPath := writeDevSourceCheckout(t, failingBundleRecipe)
	stylesheetPath := filepath.Join(checkoutPath, "apps", "devhost", "internal", "devtools", "dist", "xterm.css")
	writeTestFile(t, stylesheetPath, "/* css from checkout */")

	controlServer := startDevSourceControlServer(t, checkoutPath)

	if body := getControlServerText(t, controlServer, xtermStylesheetPath); body != "/* css from checkout */" {
		t.Fatalf("xterm.css = %q, want the checkout stylesheet", body)
	}
}

func TestNewDevSourceCheckoutRejectsIncompleteCheckouts(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name        string
		prepare     func(t *testing.T, checkoutPath string)
		wantMissing string
	}{
		{
			name:        "missing checkout",
			prepare:     func(t *testing.T, checkoutPath string) { t.Helper() },
			wantMissing: filepath.Join("packages", "devhost-ui", "src", "devtools"),
		},
		{
			name: "checkout without the app justfile",
			prepare: func(t *testing.T, checkoutPath string) {
				t.Helper()
				writeTestFile(t, filepath.Join(checkoutPath, "packages", "devhost-ui", "src", "devtools", "main.ts"), "export {};\n")
			},
			wantMissing: filepath.Join("apps", "devhost", "justfile"),
		},
	}

	for _, tt := range tests {
		tc := tt
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			checkoutPath := filepath.Join(t.TempDir(), "checkout")
			tc.prepare(t, checkoutPath)

			checkout, err := NewDevSourceCheckout(checkoutPath)
			if err == nil {
				t.Fatalf("NewDevSourceCheckout(%q) = %+v, want an error", checkoutPath, checkout)
			}

			if !strings.Contains(err.Error(), tc.wantMissing) {
				t.Fatalf("NewDevSourceCheckout(%q) error = %q, want it to name %q", checkoutPath, err, tc.wantMissing)
			}
		})
	}
}

// writeDevSourceCheckout lays out the parts of a devhost checkout that the dev
// source loop reads: one devtools source file and the app justfile whose
// build-devtools-bundle recipe is recipe.
func writeDevSourceCheckout(t *testing.T, recipe string) string {
	t.Helper()

	checkoutPath := t.TempDir()
	sourcePath := filepath.Join(checkoutPath, "packages", "devhost-ui", "src", "devtools", "main.ts")
	writeTestFile(t, sourcePath, "export {};\n")
	writeTestFile(t, filepath.Join(checkoutPath, "apps", "devhost", "justfile"), recipe)

	return checkoutPath
}

// writeDevSourceBundle writes a prebuilt bundle and dates it an hour after the
// sources when fresh, or an hour before them otherwise.
func writeDevSourceBundle(t *testing.T, checkoutPath string, content string, fresh bool) {
	t.Helper()

	bundlePath := filepath.Join(checkoutPath, "apps", "devhost", "internal", "devtools", "dist", "devtools.js")
	writeTestFile(t, bundlePath, content)

	sourceInfo, err := os.Stat(filepath.Join(checkoutPath, "packages", "devhost-ui", "src", "devtools", "main.ts"))
	if err != nil {
		t.Fatalf("stat source file: %v", err)
	}

	offset := -time.Hour
	if fresh {
		offset = time.Hour
	}

	bundleTime := sourceInfo.ModTime().Add(offset)
	if err := os.Chtimes(bundlePath, bundleTime, bundleTime); err != nil {
		t.Fatalf("set bundle modtime: %v", err)
	}
}

func writeTestFile(t *testing.T, path string, content string) {
	t.Helper()

	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("create %s: %v", filepath.Dir(path), err)
	}

	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}

func startDevSourceControlServer(t *testing.T, checkoutPath string) *ControlServer {
	t.Helper()

	checkout, err := NewDevSourceCheckout(checkoutPath)
	if err != nil {
		t.Fatalf("NewDevSourceCheckout(%q): %v", checkoutPath, err)
	}

	controlServer, err := StartControlServer(StartControlServerOptions{
		ComponentEditor: "vscode",
		DevSource:       checkout,
		FeatureToggles:  FeatureToggles{StatusEnabled: true},
		GetHealthResponse: func() (HealthResponse, error) {
			return HealthResponse{Services: []ServiceHealth{}}, nil
		},
		Position:        "bottom-right",
		ProjectRootPath: t.TempDir(),
		StackName:       devSourceTestStackName,
	})
	if err != nil {
		t.Fatalf("start control server: %v", err)
	}
	t.Cleanup(func() {
		_ = controlServer.Stop()
	})

	return controlServer
}

func getControlServerText(t *testing.T, controlServer *ControlServer, path string) string {
	t.Helper()

	response, err := http.Get(serverURL(controlServer.Port(), path))
	if err != nil {
		t.Fatalf("GET %s: %v", path, err)
	}
	defer response.Body.Close()

	return readResponseText(t, response)
}
