package devtools

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/browsertest"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/statuspage"
	"github.com/chromedp/cdproto/emulation"
	"github.com/chromedp/chromedp"
)

func startDirectoryServer(t *testing.T) (*ControlServer, caddy.Paths) {
	t.Helper()
	paths := caddy.CreateManagedCaddyPaths(t.TempDir())
	manifest := filepath.Join(t.TempDir(), "devhost.toml")
	include := filepath.Join(filepath.Dir(manifest), "backend.toml")
	writeTestFile(t, manifest, "name = \"project\"\n# <script>alert('source')</script>\n")
	writeTestFile(t, include, "[services.backend]\nport = 3001\n")
	s, err := StartControlServer(StartControlServerOptions{
		StackDirectoryPaths: paths,
		StackName:           "project",
		ProjectRootPath:     filepath.Dir(manifest),
		GetHealthResponse:   func() (HealthResponse, error) { return HealthResponse{}, nil },
		GetStackServices: func() ([]statuspage.StackService, error) {
			return []statuspage.StackService{
				{Name: "web", Status: "Running", URLs: []string{"https://project.localhost:4443/", "https://alias.localhost:4443/"}},
				{Name: "api", Status: "External", URLs: []string{"http://127.0.0.1:3001"}},
				{Name: "worker", Status: "Running"},
			}, nil
		},
		ListConfigFiles: func() ([]ConfigFileRef, error) {
			return []ConfigFileRef{{Path: manifest, Kind: ConfigFileKindManifest}, {Path: include, Kind: ConfigFileKindInclude}, {Path: filepath.Join(filepath.Dir(manifest), "config.toml"), Kind: ConfigFileKindConfig}}, nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := s.Stop(); err != nil {
			t.Error(err)
		}
	})
	if err := caddy.RegisterStack(caddy.RegisterStackOptions{ManifestPath: manifest, ManifestFiles: []string{include}, StackName: "project", ControlPort: s.Port(), StacksDirectoryPath: paths.StacksDirectoryPath}); err != nil {
		t.Fatal(err)
	}
	return s, paths
}

func directoryText(t *testing.T, s *ControlServer, query string) string {
	t.Helper()
	r, err := http.NewRequest(http.MethodGet, serverURL(s.Port(), stackDirectoryPath)+query, nil)
	if err != nil {
		t.Fatal(err)
	}
	r.Host = caddy.StackDirectoryHost
	response, err := http.DefaultClient.Do(r)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK || response.Header.Get("Cache-Control") != cacheControlNoStore {
		t.Fatalf("directory: status %d, headers %v", response.StatusCode, response.Header)
	}
	data, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

func TestStackDirectoryCollectsSourcesAndURLs(t *testing.T) {
	s, paths := startDirectoryServer(t)
	body := directoryText(t, s, "")
	for _, want := range []string{`href="https://project.localhost:4443/"`, `href="https://alias.localhost:4443/"`, `href="http://127.0.0.1:3001"`, "backend.toml", "[services.backend]", "File does not exist", "&lt;script&gt;", "No HTTP URL"} {
		if !strings.Contains(body, want) {
			t.Errorf("directory missing %q", want)
		}
	}
	if strings.Contains(body, "<script>alert") {
		t.Fatal("TOML became executable HTML")
	}
	if got := directoryText(t, s, "?q=alias.localhost"); !strings.Contains(got, "Root manifest:") {
		t.Fatal("URL filter omitted stack")
	}
	if got := directoryText(t, s, "?q=missing"); !strings.Contains(got, "No matching stacks") || strings.Contains(got, "Root manifest:") {
		t.Fatal("unmatched filter returned stack")
	}
	if err := caddy.UnregisterStack(paths.StacksDirectoryPath); err != nil {
		t.Fatal(err)
	}
	if got := directoryText(t, s, ""); !strings.Contains(got, "No stacks running") {
		t.Fatal("stopped stack remains listed")
	}
}

func TestStackDirectoryGuardsConfiguration(t *testing.T) {
	s, _ := startDirectoryServer(t)
	for _, tc := range []struct {
		name, method, path, host string
		header                   http.Header
		want                     int
	}{
		{"dedicated hostname", "GET", stackDirectoryPath, caddy.StackDirectoryHost, nil, 200},
		{"head", "HEAD", stackDirectoryPath, caddy.StackDirectoryHost, nil, 200},
		{"rebound hostname", "GET", stackDirectoryPath, "rebound.example", nil, 403},
		{"cross-origin", "GET", stackSnapshotPath, caddy.StackDirectoryHost, http.Header{"Origin": {"https://other.example"}, "Sec-Fetch-Site": {"cross-site"}}, 403},
		{"remote client", "GET", stackSnapshotPath, caddy.StackDirectoryHost, http.Header{"X-Forwarded-For": {"192.0.2.1"}}, 403},
		{"read-only", "POST", stackDirectoryPath, "", nil, 405},
		{"unrelated controls", "POST", restartStackPath, caddy.StackDirectoryHost, http.Header{"Origin": {"https://" + caddy.StackDirectoryHost}}, 403},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := sendGuardTestRequest(t, s.Port(), tc.method, tc.path, tc.host, tc.header, ""); got != tc.want {
				t.Fatalf("status %d, want %d", got, tc.want)
			}
		})
	}
}

func TestStackDirectoryKeepsUnavailableStacksVisible(t *testing.T) {
	s, paths := startDirectoryServer(t)
	data, err := json.Marshal(map[string]any{"createdAt": "2026-10-25T00:00:00Z", "manifestPath": "/other/devhost.toml", "ownerPid": os.Getppid(), "stackName": "other"})
	if err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(paths.StacksDirectoryPath, "other.json"), string(data))
	body := directoryText(t, s, "")
	if !strings.Contains(body, "other") || !strings.Contains(body, "Stack details unavailable") || !strings.Contains(body, "https://project.localhost:4443/") {
		t.Fatal("unavailable stack hid directory details")
	}
}

func TestStackDirectoryInBrowser(t *testing.T) {
	s, _ := startDirectoryServer(t)
	chromium := browsertest.Locate(t)
	run := browsertest.RunDirectory(t, "stack-directory")
	allocator, stop := chromedp.NewExecAllocator(context.Background(), chromium.AllocatorOptions(filepath.Join(run, "profile"))...)
	defer stop()
	browser, closeBrowser := chromedp.NewContext(allocator)
	defer closeBrowser()
	ctx, cancel := context.WithTimeout(browser, 30*time.Second)
	defer cancel()
	for _, theme := range []string{"dark", "light"} {
		t.Run(theme, func(t *testing.T) {
			if _, err := chromedp.Call(ctx, emulation.SetEmulatedMedia, emulation.SetEmulatedMediaParams{Features: []*emulation.MediaFeature{{Name: "prefers-color-scheme", Value: theme}}}); err != nil {
				t.Fatal(err)
			}
			if err := chromedp.Do(ctx, chromedp.EmulateViewport(360, 800), chromedp.Navigate(serverURL(s.Port(), stackDirectoryPath)), chromedp.WaitVisible(chromedp.CSS(".url"))); err != nil {
				t.Fatalf("navigate: %v", err)
			}
			if err := chromedp.Do(ctx, chromedp.Click(chromedp.CSS("article > details > summary"))); err != nil {
				t.Fatalf("expand configuration: %v", err)
			}
			if err := chromedp.Do(ctx, chromedp.Click(chromedp.CSS("article details details summary")), chromedp.WaitVisible(chromedp.CSS("pre"))); err != nil {
				t.Fatalf("expand file: %v", err)
			}
			fits, err := chromedp.Run(ctx, chromedp.Evaluate[bool](`document.documentElement.scrollWidth <= innerWidth && document.querySelector('pre').textContent.includes('<script>')`))
			if err != nil || !fits {
				t.Fatalf("configuration content is missing or overflows the viewport: %v", err)
			}
			ratio, err := chromedp.Run(ctx, chromedp.Evaluate[float64](fmt.Sprintf("(%s)(document.querySelector('.url'))", chromium.Contrast)))
			if err != nil || ratio < 4.5 {
				t.Fatalf("URL contrast %f: %v", ratio, err)
			}
		})
	}
}
