package devtools

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
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
	writeTestFile(t, manifest, "name = \"project\"\n# <script>alert('source')</script>\n# "+strings.Repeat("long-configuration-value", 80)+"\n")
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
	page := decodeDirectoryPage(t, body)
	if page.Kind != "stacks" || len(page.Stacks) != 1 {
		t.Fatalf("missing stack directory data: %+v", page)
	}
	stack := page.Stacks[0]
	if len(stack.Services) != 3 || !reflect.DeepEqual(stack.Services[0].URLs, []string{"https://project.localhost:4443/", "https://alias.localhost:4443/"}) || !reflect.DeepEqual(stack.Services[1].URLs, []string{"http://127.0.0.1:3001"}) || len(stack.Services[2].URLs) != 0 {
		t.Fatalf("directory lost service URLs: %+v", stack.Services)
	}
	if len(stack.Configs) != 3 || !strings.HasSuffix(stack.Configs[1].Path, "backend.toml") || stack.Configs[1].Content != "[services.backend]\nport = 3001\n" || stack.Configs[2].Error != "File does not exist; defaults apply." || !strings.Contains(stack.Configs[0].Content, "<script>") {
		t.Fatalf("directory lost source configuration: %+v", stack.Configs)
	}
	if strings.Contains(body, "<script>alert") {
		t.Fatal("TOML became executable HTML")
	}
	if got := decodeDirectoryPage(t, directoryText(t, s, "?q=alias.localhost")); len(got.Stacks) != 1 || got.Query != "alias.localhost" {
		t.Fatal("URL filter omitted stack")
	}
	if got := decodeDirectoryPage(t, directoryText(t, s, "?q=missing")); len(got.Stacks) != 0 || got.Query != "missing" {
		t.Fatal("unmatched filter returned stack")
	}
	if err := caddy.UnregisterStack(paths.StacksDirectoryPath); err != nil {
		t.Fatal(err)
	}
	if got := decodeDirectoryPage(t, directoryText(t, s, "")); len(got.Stacks) != 0 {
		t.Fatal("stopped stack remains listed")
	}
}

func decodeDirectoryPage(t *testing.T, document string) statuspage.Page {
	t.Helper()
	payload := regexp.MustCompile(`(?s)<script id="devhost-status-data" type="application/json">(.*?)</script>`).FindStringSubmatch(document)
	if len(payload) != 2 {
		t.Fatal("missing embedded directory data")
	}
	var page statuspage.Page
	if err := json.Unmarshal([]byte(payload[1]), &page); err != nil {
		t.Fatal(err)
	}
	return page
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

func TestStackDirectoryGuardFollowsAppliedHostname(t *testing.T) {
	s, paths := startDirectoryServer(t)
	for _, host := range []string{"stacks.custom.localhost", "stacks.next.localhost"} {
		writeTestFile(t, paths.AppliedSettingsPath, fmt.Sprintf(`{"stackDirectoryHost":%q}`, host))
		if got := sendGuardTestRequest(t, s.Port(), "GET", stackDirectoryPath, host, nil, ""); got != http.StatusOK {
			t.Fatalf("configured hostname %s: status %d", host, got)
		}
		if got := sendGuardTestRequest(t, s.Port(), "GET", stackDirectoryPath, caddy.StackDirectoryHost, nil, ""); got != http.StatusForbidden {
			t.Fatalf("old directory hostname retained access: %d", got)
		}
		if got := sendGuardTestRequest(t, s.Port(), "POST", restartStackPath, host, http.Header{"Origin": {"https://" + host}}, ""); got != http.StatusForbidden {
			t.Fatalf("directory hostname gained stack controls: %d", got)
		}
	}
}

func TestStackDirectoryRemoteAccessIsExplicitAndReadOnly(t *testing.T) {
	s, paths := startDirectoryServer(t)
	host := "stacks.custom.localhost"
	for _, allowRemote := range []bool{false, true, false} {
		writeTestFile(t, paths.AppliedSettingsPath, fmt.Sprintf(`{"stackDirectoryHost":%q,"stackDirectoryAllowRemote":%t}`, host, allowRemote))
		for _, tc := range []struct {
			name, method, path string
			header             http.Header
			remoteStatus       int
		}{
			{"directory", "GET", stackDirectoryPath, nil, http.StatusOK},
			{"head", "HEAD", stackDirectoryPath, nil, http.StatusOK},
			{"snapshot stays private", "GET", stackSnapshotPath, nil, http.StatusForbidden},
			{"write rejected", "POST", stackDirectoryPath, nil, http.StatusForbidden},
			{"cross-origin rejected", "GET", stackDirectoryPath, http.Header{"Origin": {"https://other.localhost"}}, http.StatusForbidden},
		} {
			t.Run(fmt.Sprintf("%t/%s", allowRemote, tc.name), func(t *testing.T) {
				header := tc.header.Clone()
				if header == nil {
					header = make(http.Header)
				}
				header.Set("X-Forwarded-For", "192.0.2.1")
				want := http.StatusForbidden
				if allowRemote {
					want = tc.remoteStatus
				}
				if got := sendGuardTestRequest(t, s.Port(), tc.method, tc.path, host, header, ""); got != want {
					t.Fatalf("status %d, want %d", got, want)
				}
			})
		}
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
			linkSelector := `a[href="https://project.localhost:4443/"]`
			if err := chromedp.Do(ctx, chromedp.EmulateViewport(360, 800), chromedp.Navigate(serverURL(s.Port(), stackDirectoryPath)), chromedp.WaitVisible(chromedp.CSS(linkSelector))); err != nil {
				t.Fatalf("navigate: %v", err)
			}
			if err := chromedp.Do(ctx, chromedp.Click(chromedp.CSS(`[data-testid="StackDirectoryCard--configuration-toggle"]`))); err != nil {
				t.Fatalf("expand configuration: %v", err)
			}
			if err := chromedp.Do(ctx, chromedp.Click(chromedp.CSS(`[data-testid="StackDirectoryCard--file-toggle"]`)), chromedp.WaitVisible(chromedp.CSS("pre"))); err != nil {
				t.Fatalf("expand file: %v", err)
			}
			fits, err := chromedp.Run(ctx, chromedp.Evaluate[bool](`document.documentElement.scrollWidth <= innerWidth && document.querySelector('pre').textContent.includes('<script>')`))
			if err != nil || !fits {
				t.Fatalf("configuration content is missing or overflows the viewport: %v", err)
			}
			ratio, err := chromedp.Run(ctx, chromedp.Evaluate[float64](fmt.Sprintf("(%s)(document.querySelector(%q))", chromium.Contrast, linkSelector)))
			if err != nil || ratio < 4.5 {
				t.Fatalf("URL contrast %f: %v", ratio, err)
			}
			if err := chromedp.Do(ctx, chromedp.SendKeys(chromedp.CSS(`input[name="q"]`), "missing"), chromedp.Click(chromedp.CSS(`button[type="submit"]`)), chromedp.WaitVisible(chromedp.CSS(`a[href="?"]`))); err != nil {
				t.Fatalf("filter stacks: %v", err)
			}
			filtered, err := chromedp.Run(ctx, chromedp.Evaluate[bool](`location.search === '?q=missing' && !document.querySelector('[data-testid="StackDirectoryCard"]') && document.body.textContent.includes('No matching stacks')`))
			if err != nil || !filtered {
				t.Fatalf("native filter form did not navigate to empty results: %v", err)
			}
			if err := chromedp.Do(ctx, chromedp.Click(chromedp.CSS(`a[href="?"]`)), chromedp.WaitVisible(chromedp.CSS(linkSelector))); err != nil {
				t.Fatalf("clear filter: %v", err)
			}
		})
	}
	if _, err := chromedp.Call(ctx, emulation.SetEmulatedMedia, emulation.SetEmulatedMediaParams{Features: []*emulation.MediaFeature{{Name: "prefers-color-scheme", Value: "dark"}}}); err != nil {
		t.Fatal(err)
	}
	if _, err := chromedp.Run(ctx, chromedp.Poll[bool](fmt.Sprintf(`document.documentElement.dataset.theme === 'dark' && (%s)(document.querySelector('a[href="https://project.localhost:4443/"]')) >= 4.5`, chromium.Contrast))); err != nil {
		t.Fatalf("system theme change did not preserve readable URLs: %v", err)
	}
}
