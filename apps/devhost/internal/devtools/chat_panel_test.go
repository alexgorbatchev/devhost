package devtools

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func startChatPanelServer(t *testing.T, file string) *ControlServer {
	t.Helper()
	s, err := StartControlServer(StartControlServerOptions{
		chatCommand:       refuseChatHarness(t),
		ChatPanelFile:     file,
		FeatureToggles:    FeatureToggles{ChatEnabled: true},
		ProjectRootPath:   t.TempDir(),
		GetHealthResponse: func() (HealthResponse, error) { return HealthResponse{}, nil },
	})
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

func chatPanelRequest(t *testing.T, s *ControlServer, method, body string) (int, string) {
	t.Helper()
	base := fmt.Sprintf("http://127.0.0.1:%d", s.Port())
	request, err := http.NewRequest(method, base+chatPanelPath, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	if method != http.MethodGet {
		request.Header.Set("Origin", base)
		request.Header.Set("Content-Type", "application/json")
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = response.Body.Close() }()
	data, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	return response.StatusCode, strings.TrimSpace(string(data))
}

func TestChatPanelPositionSurvivesARestartOfTheStack(t *testing.T) {
	file := filepath.Join(t.TempDir(), "state", "chat-panel.json")
	first := startChatPanelServer(t, file)
	if status, body := chatPanelRequest(t, first, http.MethodGet, ""); status != http.StatusOK || body != `{"position":null}` {
		t.Fatalf("before saving: %d %s", status, body)
	}
	if status, body := chatPanelRequest(t, first, http.MethodPut, `{"position":{"left":12,"top":34}}`); status != http.StatusNoContent {
		t.Fatalf("save: %d %s", status, body)
	}

	second := startChatPanelServer(t, file)
	if status, body := chatPanelRequest(t, second, http.MethodGet, ""); status != http.StatusOK || body != `{"position":{"left":12,"top":34}}` {
		t.Fatalf("after restart: %d %s", status, body)
	}
}

func TestChatPanelPositionClears(t *testing.T) {
	s := startChatPanelServer(t, filepath.Join(t.TempDir(), "chat-panel.json"))
	chatPanelRequest(t, s, http.MethodPut, `{"position":{"left":12,"top":34}}`)
	if status, _ := chatPanelRequest(t, s, http.MethodPut, `{"position":null}`); status != http.StatusNoContent {
		t.Fatalf("clear status = %d", status)
	}
	if _, body := chatPanelRequest(t, s, http.MethodGet, ""); body != `{"position":null}` {
		t.Fatalf("after clearing: %s", body)
	}
}

func TestChatPanelRejectsBadPositions(t *testing.T) {
	s := startChatPanelServer(t, filepath.Join(t.TempDir(), "chat-panel.json"))
	for _, body := range []string{`{"position":{"left":-1,"top":0}}`, `{"position":{"left":"a"}}`, `{"other":1}`, `not json`} {
		if status, _ := chatPanelRequest(t, s, http.MethodPut, body); status != http.StatusBadRequest {
			t.Errorf("%s: status = %d", body, status)
		}
	}
}

func TestChatPanelRequiresAPageToSave(t *testing.T) {
	s := startChatPanelServer(t, filepath.Join(t.TempDir(), "chat-panel.json"))
	url := fmt.Sprintf("http://127.0.0.1:%d%s", s.Port(), chatPanelPath)
	request, err := http.NewRequest(http.MethodPut, url, strings.NewReader(`{"position":null}`))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", response.StatusCode, http.StatusForbidden)
	}
}

func TestChatPanelWithoutAManifestHasNoRoute(t *testing.T) {
	s := startChatPanelServer(t, "")
	if status, _ := chatPanelRequest(t, s, http.MethodGet, ""); status != http.StatusNotFound {
		t.Fatalf("status = %d", status)
	}
}

func TestChatPanelIgnoresADamagedFile(t *testing.T) {
	file := filepath.Join(t.TempDir(), "chat-panel.json")
	for _, content := range []string{"not json", `{"position":{"left":-5,"top":1}}`} {
		if err := os.WriteFile(file, []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
		layout, err := readChatPanelLayout(file)
		if err != nil {
			t.Fatal(err)
		}
		if layout.Position != nil {
			t.Fatalf("%s: position = %+v", content, layout.Position)
		}
	}
}

func TestChatPanelReportsAnUnreadableFile(t *testing.T) {
	if _, err := readChatPanelLayout(t.TempDir()); err == nil {
		t.Fatal("reading a directory succeeded")
	}
}

func TestChatPanelLeavesNoTemporaryFiles(t *testing.T) {
	directory := t.TempDir()
	file := filepath.Join(directory, "chat-panel.json")
	if err := writeChatPanelLayout(file, chatPanelLayout{Position: &chatPanelPosition{Left: 1, Top: 2}}); err != nil {
		t.Fatal(err)
	}
	entries, err := os.ReadDir(directory)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 {
		t.Fatalf("entries = %v", entries)
	}
	var layout chatPanelLayout
	data, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(data, &layout); err != nil || layout.Position == nil {
		t.Fatalf("saved %s: %v", data, err)
	}
}
