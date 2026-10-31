package devtools

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	parser "github.com/alexgorbatchev/agent-parser"
	watcher "github.com/alexgorbatchev/agent-watcher"
	"github.com/gorilla/websocket"
)

func agentActivityURL(s *ControlServer, scheme, path string) string {
	return fmt.Sprintf("%s://127.0.0.1:%d%s%s", scheme, s.Port(), path, chatTargetQuery("", chatTargetProject))
}

func dialAgentActivity(t *testing.T, s *ControlServer) *websocket.Conn {
	t.Helper()
	header := http.Header{"Origin": []string{s.controlOrigin()}}
	conn, _, err := websocket.DefaultDialer.Dial(agentActivityURL(s, "ws", agentActivityWebsocketPath), header)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = conn.Close() })
	return conn
}

func TestAgentActivityPageOpensOnlyOnTheDirectOrigin(t *testing.T) {
	s := startChatTargetServer(t, "", refuseChatHarness(t))
	direct, err := http.Get(agentActivityURL(s, "http", agentActivityPath))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = direct.Body.Close() }()
	if direct.StatusCode != http.StatusOK || direct.Header.Get("Cache-Control") != cacheControlNoStore {
		t.Fatalf("direct: status %d, cache %q", direct.StatusCode, direct.Header.Get("Cache-Control"))
	}

	routed, err := http.NewRequest(http.MethodGet, agentActivityURL(s, "http", agentActivityPath), nil)
	if err != nil {
		t.Fatal(err)
	}
	routed.Host = "app.localhost"
	response, err := http.DefaultClient.Do(routed)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusForbidden {
		t.Fatalf("routed host: status %d, want %d", response.StatusCode, http.StatusForbidden)
	}
}

func TestAgentActivityPageRefusesAProxiedClient(t *testing.T) {
	s := startChatTargetServer(t, "", refuseChatHarness(t))
	request, err := http.NewRequest(http.MethodGet, agentActivityURL(s, "http", agentActivityPath), nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("X-Forwarded-For", "203.0.113.5")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusForbidden {
		t.Fatalf("status = %d", response.StatusCode)
	}
}

func TestAgentActivityStreamRefusesApplicationPages(t *testing.T) {
	s := startChatTargetServer(t, "", refuseChatHarness(t))
	s.runAgentWatcher = func(context.Context, watcher.Config, watcher.Handler) error {
		t.Error("a refused socket started watching")
		return nil
	}
	for _, test := range []struct {
		name   string
		host   string
		origin string
	}{
		{"routed host", "app.localhost", "https://app.localhost"},
		{"another origin", "", "https://app.localhost"},
	} {
		t.Run(test.name, func(t *testing.T) {
			header := http.Header{"Origin": []string{test.origin}}
			if test.host != "" {
				header.Set("Host", test.host)
			}
			dialer := websocket.Dialer{}
			conn, response, err := dialer.Dial(agentActivityURL(s, "ws", agentActivityWebsocketPath), header)
			if err == nil {
				_ = conn.Close()
				t.Fatal("socket opened")
			}
			if response == nil || response.StatusCode != http.StatusForbidden {
				t.Fatalf("response = %+v, err = %v", response, err)
			}
		})
	}
}

func TestAgentActivityStreamsNormalizedEventsUntilThePageCloses(t *testing.T) {
	s := startChatTargetServer(t, "", refuseChatHarness(t))
	started := make(chan watcher.Config, 1)
	stopped := make(chan struct{})
	s.runAgentWatcher = func(ctx context.Context, cfg watcher.Config, handler watcher.Handler) error {
		defer close(stopped)
		started <- cfg
		content, role := "Fix the heading", "user"
		event := watcher.Event{Harness: watcher.HarnessCodex, PID: 7, ParsedEvent: parser.ParsedEvent{
			EventType: "turn_start", Timestamp: 5, Data: parser.EventData{Content: &content, Role: &role},
		}}
		acknowledged := false
		if err := handler(ctx, event, func() { acknowledged = true }); err != nil {
			t.Error(err)
		}
		if !acknowledged {
			t.Error("delivered event was not acknowledged")
		}
		<-ctx.Done()
		return nil
	}
	conn := dialAgentActivity(t, s)

	var cfg watcher.Config
	select {
	case cfg = <-started:
	case <-time.After(3 * time.Second):
		t.Fatal("no watcher started")
	}
	if !cfg.StartAtEnd {
		t.Fatal("opening the page would replay history")
	}
	if !cfg.SessionFilter(watcher.Session{CWD: filepath.Join(s.projectRootPath, "packages")}) {
		t.Fatal("filter refused a subdirectory of the checkout")
	}
	if cfg.SessionFilter(watcher.Session{CWD: s.projectRootPath + "-other"}) {
		t.Fatal("filter accepted a sibling directory")
	}
	if cfg.SessionFilter(watcher.Session{CWD: s.projectRootPath, Subagent: true}) {
		t.Fatal("filter accepted a subagent")
	}
	if _, err := os.Stat(filepath.Dir(cfg.CursorPath)); err != nil {
		t.Fatalf("state directory: %v", err)
	}

	if err := conn.SetReadDeadline(time.Now().Add(3 * time.Second)); err != nil {
		t.Fatal(err)
	}
	var received agentActivityEvent
	if err := conn.ReadJSON(&received); err != nil {
		t.Fatal(err)
	}
	want := agentActivityEvent{Harness: "codex", PID: 7, EventType: "turn_start", Timestamp: 5, Role: "user", Text: "Fix the heading"}
	if received != want {
		t.Fatalf("event = %+v, want %+v", received, want)
	}

	if err := conn.Close(); err != nil {
		t.Fatal(err)
	}
	select {
	case <-stopped:
	case <-time.After(3 * time.Second):
		t.Fatal("closing the page left the watcher running")
	}
	deadline := time.Now().Add(3 * time.Second)
	for {
		_, err := os.Stat(filepath.Dir(cfg.CursorPath))
		if os.IsNotExist(err) {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("state directory survived: %v", err)
		}
		time.Sleep(time.Millisecond)
	}
}

func TestAgentActivityReportsAFailedWatcher(t *testing.T) {
	s := startChatTargetServer(t, "", refuseChatHarness(t))
	s.runAgentWatcher = func(context.Context, watcher.Config, watcher.Handler) error {
		return fmt.Errorf("cannot watch")
	}
	conn := dialAgentActivity(t, s)
	if err := conn.SetReadDeadline(time.Now().Add(3 * time.Second)); err != nil {
		t.Fatal(err)
	}
	_, _, err := conn.ReadMessage()
	if !websocket.IsCloseError(err, websocket.CloseInternalServerErr) {
		t.Fatalf("close = %v", err)
	}
}

func TestNewAgentActivityEventReportsToolOutput(t *testing.T) {
	output, tool, isError := "file contents", "Read", true
	message := newAgentActivityEvent(watcher.Event{Harness: watcher.HarnessClaudeCode, ParsedEvent: parser.ParsedEvent{
		EventType: "tool_result", Data: parser.EventData{ToolOutput: &output, ToolName: &tool, IsError: &isError},
	}})
	if message.Text != output || message.ToolName != tool || !message.IsError {
		t.Fatalf("message = %+v", message)
	}
}

func TestLimitAgentActivityTextKeepsCharactersWhole(t *testing.T) {
	text := strings.Repeat("é", agentActivityTextLimit)
	limited := limitAgentActivityText(text)
	if !utf8.ValidString(limited) || !strings.HasSuffix(limited, "…") || len(limited) > agentActivityTextLimit+len("…") {
		t.Fatalf("limited to %d bytes, valid=%v", len(limited), utf8.ValidString(limited))
	}
	if short := limitAgentActivityText("short"); short != "short" {
		t.Fatalf("short text = %q", short)
	}
}

func TestInjectedConfigNamesTheDirectOrigin(t *testing.T) {
	s := startChatTargetServer(t, "", refuseChatHarness(t))
	encoded, err := s.renderInjectedConfig(s.currentSettings())
	if err != nil {
		t.Fatal(err)
	}
	var config injectedConfig
	if err := json.Unmarshal(encoded, &config); err != nil {
		t.Fatal(err)
	}
	if config.ControlOrigin != s.controlOrigin() {
		t.Fatalf("origin = %q", config.ControlOrigin)
	}
}
