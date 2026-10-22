package devtools

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func startChatTargetServer(t *testing.T, devSourceRootPath string) *ControlServer {
	t.Helper()
	options := StartControlServerOptions{
		FeatureToggles:    FeatureToggles{ChatEnabled: true},
		ProjectRootPath:   t.TempDir(),
		GetHealthResponse: func() (HealthResponse, error) { return HealthResponse{}, nil },
	}
	if devSourceRootPath != "" {
		checkout, err := NewDevSourceCheckout(devSourceRootPath)
		if err != nil {
			t.Fatal(err)
		}
		options.DevSource = checkout
	}
	s, err := StartControlServer(options)
	if err != nil {
		t.Fatal(err)
	}
	s.chat.command = refuseChatHarness(t)
	t.Cleanup(func() {
		if err := s.Stop(); err != nil {
			t.Error(err)
		}
	})
	return s
}

func chatTargetQuery(pageURL, target string) string {
	return "?" + url.Values{"pageURL": {pageURL}, "chatTarget": {target}}.Encode()
}

func TestChatDevhostTargetRunsInTheDevSourceCheckout(t *testing.T) {
	devhostRoot := writeDevSourceCheckout(t, "")
	s := startChatTargetServer(t, devhostRoot)
	s.chat.command = chatTestStore(t).command
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	projectSession, err := s.chat.start(ctx, chatSessionRequest{Harness: chatCodex}, s.projectRootPath)
	if err != nil {
		t.Fatal(err)
	}
	base := fmt.Sprintf("http://127.0.0.1:%d", s.Port())
	pageURL := "https://shop.localhost/page"

	body, err := json.Marshal(chatSessionRequest{Harness: chatCodex, PageURL: pageURL, Target: chatTargetDevhost})
	if err != nil {
		t.Fatal(err)
	}
	request, err := http.NewRequest(http.MethodPost, base+chatSessionsPath, strings.NewReader(string(body)))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Origin", base)
	request.Header.Set("Content-Type", jsonMediaType)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	var devhostSession chatSessionInfo
	if err := json.Unmarshal([]byte(readResponseText(t, response)), &devhostSession); err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusOK || devhostSession.ProjectRootPath != devhostRoot {
		t.Fatalf("devhost session status=%d root=%q, want root %q", response.StatusCode, devhostSession.ProjectRootPath, devhostRoot)
	}

	for _, tc := range []struct{ target, wantID string }{
		{chatTargetProject, projectSession.snapshot().ID},
		{chatTargetDevhost, devhostSession.ID},
	} {
		listed := mustGet(t, base+chatSessionsPath+chatTargetQuery(pageURL, tc.target))
		var result struct {
			Sessions []chatSessionInfo `json:"sessions"`
		}
		if err := json.Unmarshal([]byte(readResponseText(t, listed)), &result); err != nil {
			t.Fatal(err)
		}
		if len(result.Sessions) != 1 || result.Sessions[0].ID != tc.wantID {
			t.Fatalf("%s target sessions=%+v, want only %s", tc.target, result.Sessions, tc.wantID)
		}
	}

	address := "ws" + strings.TrimPrefix(base, "http") + chatWebsocketPath + chatTargetQuery(pageURL, chatTargetProject) + "&sessionId=" + devhostSession.ID
	conn, attach, err := websocket.DefaultDialer.Dial(address, http.Header{"Origin": []string{base}})
	if conn != nil {
		defer conn.Close()
	}
	if attach != nil {
		defer attach.Body.Close()
	}
	if err == nil || attach == nil || attach.StatusCode != http.StatusNotFound {
		t.Fatalf("project-target attach to a devhost session response=%v error=%v", attach, err)
	}
}

func TestChatTargetIsValidatedBeforeStartingClients(t *testing.T) {
	t.Parallel()
	pageURL := "https://shop.localhost/page"
	tests := []struct {
		name, target string
		hasDevSource bool
		wantBody     string
	}{
		{name: "missing target", target: "", hasDevSource: true, wantBody: "unknown chat target"},
		{name: "unknown target", target: "home", hasDevSource: true, wantBody: "unknown chat target"},
		{name: "devhost target without a source checkout", target: chatTargetDevhost, wantBody: "no devhost source checkout"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			devSourceRootPath := ""
			if tc.hasDevSource {
				devSourceRootPath = writeDevSourceCheckout(t, "")
			}
			s := startChatTargetServer(t, devSourceRootPath)
			base := fmt.Sprintf("http://127.0.0.1:%d", s.Port())
			for _, path := range []string{chatHarnessesPath, chatSessionsPath} {
				response := mustGet(t, base+path+chatTargetQuery(pageURL, tc.target))
				body := readResponseText(t, response)
				if response.StatusCode != http.StatusBadRequest || !strings.Contains(body, tc.wantBody) {
					t.Fatalf("GET %s status=%d body=%q, want 400 naming %q", path, response.StatusCode, body, tc.wantBody)
				}
			}
		})
	}
}

func TestInjectedConfigNamesTheDevhostSourceCheckout(t *testing.T) {
	t.Parallel()
	devhostRoot := writeDevSourceCheckout(t, "")
	tests := []struct {
		name, devSourceRootPath, want string
	}{
		{name: "with a source checkout", devSourceRootPath: devhostRoot, want: devhostRoot},
		{name: "without a source checkout", devSourceRootPath: "", want: ""},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			s := startChatTargetServer(t, tc.devSourceRootPath)
			var config injectedConfig
			if err := json.Unmarshal([]byte(getControlServerText(t, s, injectedConfigPath)), &config); err != nil {
				t.Fatal(err)
			}
			if config.DevhostSourceRootPath != tc.want {
				t.Fatalf("devhostSourceRootPath=%q, want %q", config.DevhostSourceRootPath, tc.want)
			}
		})
	}
}
