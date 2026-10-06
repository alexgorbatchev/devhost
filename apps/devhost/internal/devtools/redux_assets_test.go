package devtools

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestControlServerServesReduxBrowserInspector(t *testing.T) {
	t.Parallel()
	s, err := StartControlServer(StartControlServerOptions{
		ProjectRootPath:   t.TempDir(),
		GetHealthResponse: func() (HealthResponse, error) { return HealthResponse{}, nil },
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := s.Stop(); err != nil {
			t.Errorf("stop control server: %v", err)
		}
	})

	for _, tt := range []struct {
		path         string
		contentType  string
		content      string
		cacheControl string
	}{
		{"/__devhost__/redux", "text/html; charset=utf-8", `<script type="module" src="/__devhost__/redux-monitor.js"></script>`, cacheControlNoStore},
		{"/__devhost__/redux", "text/html; charset=utf-8", `<link rel="stylesheet" href="/__devhost__/redux-monitor.css">`, cacheControlNoStore},
		{"/__devhost__/redux.js", "text/javascript; charset=utf-8", "registerReduxDevtoolsStore", cacheControlImmutable},
		{"/__devhost__/redux-monitor.js", "text/javascript; charset=utf-8", "DEVHOST_REDUX_HELLO", cacheControlImmutable},
		{"/__devhost__/redux-monitor.css", textCSSContentType, "@font-face", cacheControlImmutable},
	} {
		t.Run(tt.path, func(t *testing.T) {
			resp, err := http.Get(serverURL(s.Port(), tt.path))
			if err != nil {
				t.Fatal(err)
			}
			defer resp.Body.Close()
			if resp.StatusCode != http.StatusOK {
				t.Fatalf("GET %s status = %d, want %d", tt.path, resp.StatusCode, http.StatusOK)
			}
			if got := resp.Header.Get("Content-Type"); got != tt.contentType {
				t.Errorf("content type = %q, want %q", got, tt.contentType)
			}
			if got := resp.Header.Get("Cache-Control"); got != tt.cacheControl {
				t.Errorf("cache control = %q, want %q", got, tt.cacheControl)
			}
			if body := readResponseText(t, resp); !strings.Contains(body, tt.content) {
				t.Errorf("GET %s does not deliver the browser inspector entrypoint", tt.path)
			}
		})
	}
}

func TestReduxSourceModulesRejectFailedBuildAndRecover(t *testing.T) {
	t.Parallel()
	for _, filename := range []string{"redux.js", "redux-monitor.js", "redux-monitor.css"} {
		t.Run(filename, func(t *testing.T) {
			t.Parallel()
			checkoutPath := writeDevSourceCheckout(t, failingBundleRecipe)
			writeDevSourceBundle(t, checkoutPath, "console.log('old injected bundle');", false)
			assetPath := filepath.Join(checkoutPath, "apps", "devhost", "internal", "devtools", "dist", filename)
			writeTestFile(t, assetPath, "export const stale = true;")
			oldTime := time.Now().Add(-time.Hour)
			if err := os.Chtimes(assetPath, oldTime, oldTime); err != nil {
				t.Fatal(err)
			}
			server := startDevSourceControlServer(t, checkoutPath)
			resp, err := http.Get(serverURL(server.Port(), controlPathPrefix+"/"+filename))
			if err != nil {
				t.Fatal(err)
			}
			defer resp.Body.Close()
			if resp.StatusCode != http.StatusServiceUnavailable {
				t.Fatalf("failed source module status = %d, want %d", resp.StatusCode, http.StatusServiceUnavailable)
			}
			if body := readResponseText(t, resp); !strings.Contains(body, bundleFailureMarker) {
				t.Fatalf("source failure did not explain compilation: %s", body)
			}
			recipe := "build-devtools-bundle:\n    mkdir -p internal/devtools/dist\n    printf '%s' 'export const recovered = true;' > internal/devtools/dist/" + filename + "\n"
			writeTestFile(t, filepath.Join(checkoutPath, "apps", "devhost", "justfile"), recipe)
			// Remove the stale asset so the actual recipe's successful replacement is required.
			if err := os.Remove(assetPath); err != nil {
				t.Fatal(err)
			}
			recovered, err := http.Get(serverURL(server.Port(), controlPathPrefix+"/"+filename))
			if err != nil {
				t.Fatal(err)
			}
			defer recovered.Body.Close()
			if recovered.StatusCode != http.StatusOK {
				t.Fatalf("recovered source module status = %d", recovered.StatusCode)
			}
			if body := readResponseText(t, recovered); body != "export const recovered = true;" {
				t.Fatalf("recovered module = %q", body)
			}
		})
	}
}

func TestReduxBrowserAssetsUseContentVersions(t *testing.T) {
	t.Parallel()
	first, second := startAssetTestServer(t), startAssetTestServer(t)
	client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	for _, path := range []string{reduxRegistrationScriptPath, reduxMonitorScriptPath, reduxMonitorStylesheetPath} {
		t.Run(path, func(t *testing.T) {
			var locations []string
			for _, server := range []*ControlServer{first, second} {
				response, err := client.Get(serverURL(server.Port(), path))
				if err != nil {
					t.Fatal(err)
				}
				response.Body.Close()
				location := response.Header.Get("Location")
				if response.StatusCode != http.StatusTemporaryRedirect || !strings.HasPrefix(location, path+"?v=") {
					t.Fatalf("asset discovery did not return a content-versioned URL: status %d, location %q", response.StatusCode, location)
				}
				if response.Header.Get("Cache-Control") != cacheControlNoStore {
					t.Fatal("asset discovery must remain uncached")
				}
				locations = append(locations, location)
			}
			if locations[0] != locations[1] {
				t.Fatal("identical Redux assets have instance-dependent cache URLs")
			}
			response, err := http.Get(serverURL(first.Port(), path+"?v=unknown"))
			if err != nil {
				t.Fatal(err)
			}
			response.Body.Close()
			if response.StatusCode != http.StatusNotFound || response.Header.Get("Cache-Control") != cacheControlNoStore {
				t.Fatal("an unknown Redux asset version was served or cached")
			}
		})
	}
}
