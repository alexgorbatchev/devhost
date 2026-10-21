package devtools

import (
	"encoding/json"
	"net/http"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
)

func TestDevelopmentPagePreviews(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	server := startDevSourceControlServer(t, root)
	for _, tc := range []struct {
		path   string
		status int
		text   string
	}{
		{"", 200, "Standalone page previews"},
		{"route-not-found", 404, "Active hostnames"},
		{"route-not-found-empty", 404, "No devhost hostnames are active"},
		{"starting", 503, "Starting web"},
		{"failed", 503, "web exited"},
		{"404", 404, "Page not found"},
		{"500", 500, "web could not load"},
		{"502", 502, "web could not load"},
		{"503", 503, "web could not load"},
		{"504", 504, "web could not load"},
		{"external", 503, "External service unavailable"},
		{"worktrees", 500, "Switch worktree"},
		{"backend-unavailable", 502, "Service unavailable"},
		{"files/", 200, "Directory listing"},
		{"files/notes.md", 200, "Show source"},
		{"unknown", 404, "404 page not found"},
	} {
		t.Run(tc.path, func(t *testing.T) {
			response, err := http.Get(serverURL(server.Port(), "/__devhost__/pages/"+tc.path))
			if err != nil {
				t.Fatal(err)
			}
			defer response.Body.Close()
			body := readResponseText(t, response)
			if response.StatusCode != tc.status || !strings.Contains(body, tc.text) {
				t.Fatalf("preview %s = %d, missing %q: %s", tc.path, response.StatusCode, tc.text, body)
			}
			if cache := response.Header.Get("Cache-Control"); cache != "no-store" && cache != "no-cache" {
				t.Fatal("preview must be uncached")
			}
			if strings.Contains(body, `src="/__devhost__/inject.js"`) {
				t.Fatal("preview exposes live toolbar")
			}
		})
	}
	request, err := http.NewRequest(http.MethodGet, serverURL(server.Port(), "/__devhost__/pages/500"), nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set(recoveryHeader, "status")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var state RecoveryState
	if err := json.NewDecoder(response.Body).Decode(&state); err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != 200 || state.Phase == "ready" || !state.CanRestart {
		t.Fatalf("unexpected preview status: %+v", state)
	}
	request.Method = http.MethodPost
	request.Header.Set(recoveryHeader, "restart")
	response, err = http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusConflict || !strings.Contains(readResponseText(t, response), "Preview only") {
		t.Fatal("preview restart must remain isolated")
	}
}

func TestPagePreviewsRequireDevelopmentMode(t *testing.T) {
	server, err := StartControlServer(StartControlServerOptions{GetHealthResponse: func() (HealthResponse, error) { return HealthResponse{}, nil }})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = server.Stop() })
	response, err := http.Get(serverURL(server.Port(), "/__devhost__/pages/"))
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusNotFound {
		t.Fatalf("production preview status = %d", response.StatusCode)
	}
}

func TestPagePreviewControlsLeaveLiveServicesAlone(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	checkout, err := NewDevSourceCheckout(root)
	if err != nil {
		t.Fatal(err)
	}
	var mutations atomic.Int32
	server, err := StartControlServer(StartControlServerOptions{
		DevSource:         checkout,
		GetHealthResponse: func() (HealthResponse, error) { return HealthResponse{}, nil },
		RestartService:    func([]string) error { mutations.Add(1); return nil },
		RestartStack:      func() error { mutations.Add(1); return nil },
		SwitchWorktree:    func(string, string) error { mutations.Add(1); return nil },
		RefreshWorktrees:  func() error { mutations.Add(1); return nil },
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = server.Stop() })
	for _, tc := range []struct {
		method, path, action string
		status               int
	}{
		{"POST", "worktrees", "worktrees", 409},
		{"POST", "500", "restart", 409},
		{"GET", "worktrees", "worktrees", 200},
		{"HEAD", "500", "", 500},
		{"GET", "500", "invalid", 400},
		{"GET", "500", "probe", 500},
		{"DELETE", "500", "", 405},
		{"GET", "status.css", "", 200},
	} {
		request, err := http.NewRequest(tc.method, serverURL(server.Port(), pagePreviewPath+tc.path), nil)
		if err != nil {
			t.Fatal(err)
		}
		request.Header.Set(recoveryHeader, tc.action)
		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		body := readResponseText(t, response)
		response.Body.Close()
		if response.StatusCode != tc.status {
			t.Errorf("%s %s (%s): status = %d, want %d", tc.method, tc.path, tc.action, response.StatusCode, tc.status)
		}
		if tc.method == http.MethodHead && body != "" {
			t.Error("HEAD response contains a body")
		}
	}
	if got := mutations.Load(); got != 0 {
		t.Fatalf("preview invoked %d live mutations", got)
	}
}
