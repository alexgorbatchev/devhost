package devtools

import (
	"bytes"
	"compress/gzip"
	"io"
	"net/http"
	"regexp"
	"strings"
	"testing"
)

func TestControlServerAssetCompression(t *testing.T) {
	t.Parallel()
	s := startAssetTestServer(t)
	client := &http.Client{Transport: &http.Transport{DisableCompression: true}}
	t.Cleanup(client.CloseIdleConnections)
	for _, path := range []string{injectedScriptPath, xtermStylesheetPath} {
		plain := getControlServerText(t, s, path)
		for _, tc := range []struct {
			name, method, accept, encoding string
			status                         int
		}{
			{"gzip", http.MethodGet, "gzip", "gzip", http.StatusOK},
			{"weighted gzip", http.MethodGet, "br, gzip;q=0.8, identity;q=0.5", "gzip", http.StatusOK},
			{"wildcard", http.MethodGet, "*;q=1", "gzip", http.StatusOK},
			{"identity", http.MethodGet, "", "", http.StatusOK},
			{"gzip rejected", http.MethodGet, "gzip;q=0, *;q=1", "", http.StatusOK},
			{"prefer identity", http.MethodGet, "gzip;q=0.5, identity;q=1", "", http.StatusOK},
			{"unsupported encoding", http.MethodGet, "br", "", http.StatusOK},
			{"nothing acceptable", http.MethodGet, "gzip;q=0, identity;q=0", "", http.StatusNotAcceptable},
			{"wildcard rejected", http.MethodGet, "*;q=0", "", http.StatusNotAcceptable},
			{"head", http.MethodHead, "gzip", "gzip", http.StatusOK},
			{"post", http.MethodPost, "gzip", "", http.StatusMethodNotAllowed},
		} {
			t.Run(path+"/"+tc.name, func(t *testing.T) {
				request, err := http.NewRequest(tc.method, serverURL(s.Port(), path), nil)
				if err != nil {
					t.Fatal(err)
				}
				request.Header.Set("Accept-Encoding", tc.accept)
				response, err := client.Do(request)
				if err != nil {
					t.Fatal(err)
				}
				defer response.Body.Close()
				if response.StatusCode != tc.status {
					t.Fatalf("status = %d, want %d", response.StatusCode, tc.status)
				}
				if encoding := response.Header.Get("Content-Encoding"); encoding != tc.encoding {
					t.Fatalf("encoding = %q, want %q", encoding, tc.encoding)
				}
				if tc.status != http.StatusOK {
					return
				}
				if response.Header.Get("Vary") != "Accept-Encoding" {
					t.Fatal("missing encoding variation")
				}
				body, err := io.ReadAll(response.Body)
				if err != nil {
					t.Fatal(err)
				}
				if tc.method == http.MethodHead {
					if len(body) != 0 {
						t.Fatal("HEAD returned a body")
					}
					return
				}
				if tc.encoding == "gzip" {
					if len(body) >= len(plain) {
						t.Fatal("compression did not reduce response size")
					}
					reader, err := gzip.NewReader(bytes.NewReader(body))
					if err != nil {
						t.Fatal(err)
					}
					defer reader.Close()
					body, err = io.ReadAll(reader)
					if err != nil {
						t.Fatal(err)
					}
				}
				if string(body) != plain {
					t.Fatal("response changed asset contents or instance configuration")
				}
			})
		}
	}
}

func TestControlServerServesSplitAssets(t *testing.T) {
	t.Parallel()
	s := startAssetTestServer(t)
	script := getControlServerText(t, s, injectedScriptPath)
	if strings.Contains(script, "Invalid hook call. Hooks can only be called") {
		t.Fatal("injected script contains React development diagnostics")
	}
	if strings.Contains(script, "xterm-viewport") {
		t.Fatal("xterm is eagerly included in the entry script")
	}
	imports := regexp.MustCompile(`import\("([^"]+\.js)"\)`).FindAllStringSubmatch(script, -1)
	if len(imports) == 0 {
		t.Fatal("injected script has no lazy module imports")
	}
	for _, match := range imports {
		response, err := http.Get(serverURL(s.Port(), match[1]))
		if err != nil {
			t.Fatal(err)
		}
		body := readResponseText(t, response)
		response.Body.Close()
		if response.StatusCode != http.StatusOK || len(body) == 0 || response.Header.Get("Content-Type") != applicationJavascriptContentType {
			t.Fatalf("chunk %s is not a served JavaScript module", match[1])
		}
		if response.Header.Get("Cache-Control") != cacheControlImmutable {
			t.Fatal("lazy chunk is not cacheable")
		}
	}
	fonts := regexp.MustCompile(`/__devhost__/assets/[^"\\]+\.woff2`).FindAllString(script, -1)
	if len(fonts) != 6 {
		t.Fatalf("font asset references = %d, want six subsets", len(fonts))
	}
	for _, path := range fonts {
		response, err := http.Get(serverURL(s.Port(), path))
		if err != nil {
			t.Fatal(err)
		}
		body := readResponseText(t, response)
		response.Body.Close()
		if response.StatusCode != http.StatusOK || !strings.HasPrefix(body, "wOF2") {
			t.Fatalf("font %s is not a served WOFF2 file", path)
		}
		if response.Header.Get("Content-Type") != "font/woff2" {
			t.Fatal("incorrect font content type")
		}
		if response.Header.Get("Cache-Control") != "public, max-age=31536000, immutable" {
			t.Fatal("hashed font is not cacheable")
		}
	}
	for _, path := range []string{"/__devhost__/assets/missing.js", "/__devhost__/assets/devtools.js.gz", "/__devhost__/assets/%2e%2e/devtools.js"} {
		response, err := http.Get(serverURL(s.Port(), path))
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		if response.StatusCode != http.StatusNotFound {
			t.Fatalf("%s status = %d, want 404", path, response.StatusCode)
		}
	}
}

func TestControlServerDevSourceAssetIsolation(t *testing.T) {
	t.Parallel()
	for _, content := range []string{"first checkout", "second checkout"} {
		checkout := writeDevSourceCheckout(t, failingBundleRecipe)
		writeTestFile(t, checkout+"/apps/devhost/internal/devtools/dist/assets/chunk-test.js", content)
		s := startDevSourceControlServer(t, checkout)
		if got := getControlServerText(t, s, "/__devhost__/assets/chunk-test.js"); got != content {
			t.Fatalf("asset = %q, want %q", got, content)
		}
	}
}

func TestControlServerCachesStaticEntryAndSeparatesConfig(t *testing.T) {
	t.Parallel()
	first, second := startAssetTestServer(t), startAssetTestServer(t)
	client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	var versions []string
	for _, s := range []*ControlServer{first, second} {
		response, err := client.Get(serverURL(s.Port(), injectedScriptPath))
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		location := response.Header.Get("Location")
		if response.StatusCode != http.StatusTemporaryRedirect || !strings.HasPrefix(location, injectedScriptPath+"?v=") {
			t.Fatal("entry URL is not versioned")
		}
		if response.Header.Get("Cache-Control") != cacheControlNoStore {
			t.Fatal("entry discovery must not cache an old instance")
		}
		versions = append(versions, location)
		cached, err := http.Get(serverURL(s.Port(), location))
		if err != nil {
			t.Fatal(err)
		}
		cached.Body.Close()
		if cached.Header.Get("Cache-Control") != "public, max-age=31536000, immutable" {
			t.Fatal("versioned entry is not browser-cacheable")
		}
	}
	if versions[0] != versions[1] {
		t.Fatal("identical bundles have different cache URLs")
	}
	firstScript := getControlServerText(t, first, injectedScriptPath)
	secondScript := getControlServerText(t, second, injectedScriptPath)
	if firstScript != secondScript || strings.Contains(firstScript, first.projectRootPath) {
		t.Fatal("entry contains instance-specific configuration")
	}
	firstConfig := getControlServerText(t, first, "/__devhost__/config.json")
	secondConfig := getControlServerText(t, second, "/__devhost__/config.json")
	if firstConfig == secondConfig || !strings.Contains(firstConfig, first.projectRootPath) || !strings.Contains(secondConfig, second.projectRootPath) {
		t.Fatal("configuration is not instance-isolated")
	}
	configResponse, err := http.Get(serverURL(first.Port(), injectedConfigPath))
	if err != nil {
		t.Fatal(err)
	}
	configResponse.Body.Close()
	if configResponse.Header.Get("Cache-Control") != cacheControlNoStore {
		t.Fatal("instance configuration must never be cached")
	}
	response, err := http.Get(serverURL(second.Port(), injectedScriptPath+"?v=unknown"))
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusNotFound {
		t.Fatal("an unknown entry version was served")
	}
	checkout := writeDevSourceCheckout(t, failingBundleRecipe)
	writeDevSourceBundle(t, checkout, "console.log('development');", true)
	s := startDevSourceControlServer(t, checkout)
	response, err = client.Get(serverURL(s.Port(), injectedScriptPath))
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusOK || response.Header.Get("Cache-Control") != cacheControlNoStore {
		t.Fatal("development entry must stay uncached")
	}
}

func startAssetTestServer(t *testing.T) *ControlServer {
	t.Helper()
	s, err := StartControlServer(StartControlServerOptions{ProjectRootPath: t.TempDir(), StackName: t.Name(), GetHealthResponse: func() (HealthResponse, error) { return HealthResponse{}, nil }})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := s.Stop(); err != nil {
			t.Error(err)
		}
	})
	return s
}
