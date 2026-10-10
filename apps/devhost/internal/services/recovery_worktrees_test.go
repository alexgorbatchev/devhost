package services

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/devtools"
)

func TestRecoveryPageSwitchesCheckoutWithToolbarDisabled(t *testing.T) {
	root, linked := createWorktreeRepository(t)
	if err := os.WriteFile(filepath.Join(linked, "web", "route-ready"), nil, 0600); err != nil {
		t.Fatal(err)
	}
	body := strings.Replace(reloadServiceBody("web", "served", "recovery.localhost"), "command = ", fmt.Sprintf("cwd = %q\ncommand = ", filepath.Join(root, "web")), 1)
	body = "[devtools.status]\nenabled = false\n[devtools.editor]\nenabled = false\n[devtools.minimap]\nenabled = false\n[devtools.externalToolbars]\nenabled = false\n" + body
	f := startReloadStackConfiguration(t, body, true)
	route := readRestartRoute(t, filepath.Join(f.paths.RegistrationsDirectoryPath, "recovery.localhost_web_2f.json"))
	url := serverURL(route.DocumentInjectionPort, "/checkout-only?value=1")
	request := func(method, action, payload string) *http.Response {
		t.Helper()
		r, err := http.NewRequest(method, url, strings.NewReader(payload))
		if err != nil {
			t.Fatal(err)
		}
		r.Header.Set("Sec-Fetch-Dest", "document")
		r.Header.Set("X-Devhost-Recovery", action)
		r.Header.Set("Origin", serverURL(route.DocumentInjectionPort, ""))
		response, err := http.DefaultClient.Do(r)
		if err != nil {
			t.Fatal(err)
		}
		return response
	}
	response := request(http.MethodGet, "", "")
	page, err := io.ReadAll(response.Body)
	response.Body.Close()
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != 404 || !strings.Contains(string(page), "Switch worktree") || strings.Contains(string(page), "/__devhost__/inject.js") {
		t.Fatalf("missing path did not offer standalone checkout recovery: %d %s", response.StatusCode, page)
	}
	response = request(http.MethodGet, "worktrees", "")
	var health devtools.HealthResponse
	err = json.NewDecoder(response.Body).Decode(&health)
	response.Body.Close()
	if err != nil || response.StatusCode != 200 || len(health.Repositories) != 1 {
		t.Fatalf("worktree discovery: %#v, status %d, %v", health, response.StatusCode, err)
	}
	payload, err := json.Marshal(map[string]string{"repositoryId": health.Repositories[0].ID, "path": linked})
	if err != nil {
		t.Fatal(err)
	}
	response = request(http.MethodPost, "worktrees", string(payload))
	result, err := io.ReadAll(response.Body)
	response.Body.Close()
	if err != nil || response.StatusCode != 200 {
		t.Fatalf("switch: %d %s, %v", response.StatusCode, result, err)
	}
	assertRestartResponse(t, serverURL(route.DocumentInjectionPort, "/cwd"), filepath.Join(linked, "web"))
	response = request(http.MethodGet, "probe", "")
	response.Body.Close()
	if response.StatusCode != http.StatusNoContent {
		t.Fatalf("selected checkout still missing path: %d", response.StatusCode)
	}
	response = request(http.MethodGet, "", "")
	result, err = io.ReadAll(response.Body)
	response.Body.Close()
	if err != nil || response.StatusCode != 200 || string(result) != "served" {
		t.Fatalf("original URL did not recover: %d %s, %v", response.StatusCode, result, err)
	}
}
