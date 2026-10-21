package services

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/devtools"
)

type configEditorRequest struct {
	Path        string `json:"path"`
	Content     string `json:"content"`
	BaseVersion string `json:"baseVersion"`
}

type configEditorFile struct {
	Path    string `json:"path"`
	Version string `json:"version"`
}

// sendConfigEditorRequest sends a request to the stack's control server with the headers Caddy forwards from a page.
func sendConfigEditorRequest(t *testing.T, f *reloadStackFixture, route string, body any, headers map[string]string) (int, string) {
	t.Helper()
	var payload io.Reader = http.NoBody
	method := http.MethodGet
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		payload, method = bytes.NewReader(data), http.MethodPost
	}
	request, err := http.NewRequest(method, fmt.Sprintf("http://127.0.0.1:%d/__devhost__/config/%s", f.controlPort, route), payload)
	if err != nil {
		t.Fatal(err)
	}
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	request.Header.Set("Origin", fmt.Sprintf("http://127.0.0.1:%d", f.controlPort))
	request.Header.Set("Sec-Fetch-Site", "same-origin")
	request.Header.Set("X-Forwarded-For", "127.0.0.1")
	for name, value := range headers {
		request.Header.Set(name, value)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	text, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	return response.StatusCode, string(text)
}

func readConfigEditorVersion(t *testing.T, f *reloadStackFixture, path string) string {
	t.Helper()
	status, body := sendConfigEditorRequest(t, f, "files", nil, nil)
	if status != http.StatusOK {
		t.Fatalf("files = %d %s", status, body)
	}
	var listing struct {
		Files []configEditorFile `json:"files"`
	}
	if err := json.Unmarshal([]byte(body), &listing); err != nil {
		t.Fatal(err)
	}
	for _, file := range listing.Files {
		if file.Path == path {
			return file.Version
		}
	}
	t.Fatalf("files %s omit %s", body, path)
	return ""
}

// A save travels the whole way a page's save does: through the control server's request guard and checks, onto disk,
// and through the stack's own reload, whose count tells the page the save was applied.
func TestConfigEditorSaveIsAppliedByTheStacksReload(t *testing.T) {
	body := reloadServiceBody("web", "original", "reload.localhost")
	f := startReloadStack(t, body)
	f.header += "[devtools.configEditor]\nenabled = true\n"
	f.write(t, body)
	waitForCondition(t, stackChangeTimeout, func() bool {
		return string(readInjectedConfig(t, f)["configEditorEnabled"]) == "true"
	})
	rootPath, err := filepath.Abs(f.path)
	if err != nil {
		t.Fatal(err)
	}
	original, err := os.ReadFile(rootPath)
	if err != nil {
		t.Fatal(err)
	}
	version := readConfigEditorVersion(t, f, rootPath)
	renamed := configEditorRequest{Path: rootPath, Content: "name = \"renamed\"\n" + string(original[len("name = \"reload\"\n"):]), BaseVersion: version}

	for _, tc := range []struct {
		name    string
		request configEditorRequest
		headers map[string]string
		want    int
	}{
		{"a page on another site", renamed, map[string]string{"Origin": "https://foreign.test", "Sec-Fetch-Site": "cross-site"}, http.StatusForbidden},
		{"a browser on another machine", renamed, map[string]string{"X-Forwarded-For": "10.20.0.1"}, http.StatusForbidden},
		{"a file changed since it was opened", configEditorRequest{Path: rootPath, Content: renamed.Content, BaseVersion: "stale"}, nil, http.StatusConflict},
		{"content a reload would reject", configEditorRequest{Path: rootPath, Content: string(original) + "[services.web.lifecycle]\nmode = \"x\"\n", BaseVersion: version}, nil, http.StatusUnprocessableEntity},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if status, response := sendConfigEditorRequest(t, f, "save", tc.request, tc.headers); status != tc.want {
				t.Fatalf("save = %d %s, want %d", status, response, tc.want)
			}
			if current, err := os.ReadFile(rootPath); err != nil || !bytes.Equal(current, original) {
				t.Fatalf("a refused save changed the file: %q, %v", current, err)
			}
		})
	}

	before := readConfigurationStatus(t, f, devtools.ConfigurationSourceManifest)
	if status, response := sendConfigEditorRequest(t, f, "save", renamed, nil); status != http.StatusOK {
		t.Fatalf("save = %d %s", status, response)
	}
	waitForCondition(t, stackChangeTimeout, func() bool {
		status := readConfigurationStatus(t, f, devtools.ConfigurationSourceManifest)
		return status.Reloads > before.Reloads && status.Error == ""
	})
	if stackName := string(readInjectedConfig(t, f)["stackName"]); stackName != `"renamed"` {
		t.Fatalf("stackName = %s after the save was applied", stackName)
	}
}
