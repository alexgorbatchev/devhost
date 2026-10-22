package devtools

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/gorilla/websocket"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

func startChatControlServer(t *testing.T) *ControlServer {
	t.Helper()
	s, err := StartControlServer(StartControlServerOptions{
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

func TestChatWebsocketReplayPendingResponsesAndShutdown(t *testing.T) {
	s := startChatControlServer(t)
	fixture := chatTestStore(t)
	s.chat.command = fixture.command
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	session, err := s.chat.start(ctx, chatSessionRequest{Harness: chatCodex}, s.projectRootPath)
	if err != nil {
		t.Fatal(err)
	}
	if err = session.execute(ctx, chatCommand{Type: "send", Text: "test turn"}); err != nil {
		t.Fatal(err)
	}
	waitChatState(t, session, "requires_action")
	base := fmt.Sprintf("http://127.0.0.1:%d", s.Port())
	url := "ws" + strings.TrimPrefix(base, "http") + chatWebsocketPath + chatTargetQuery("", chatTargetProject) + "&sessionId=" + session.snapshot().ID
	connect := func() *websocket.Conn {
		t.Helper()
		conn, _, err := websocket.DefaultDialer.Dial(url, http.Header{"Origin": []string{base}})
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = conn.Close() })
		if err = conn.SetReadDeadline(time.Now().Add(5 * time.Second)); err != nil {
			t.Fatal(err)
		}
		return conn
	}
	conn := connect()
	var first chatMessage
	if err = conn.ReadJSON(&first); err != nil {
		t.Fatal(err)
	}
	if first.Type != "snapshot" || len(first.Events) < 4 || first.PendingRequestIDs == nil || len(*first.PendingRequestIDs) != 1 {
		t.Fatalf("snapshot lost pending native request: %+v", first)
	}
	if err = conn.WriteJSON(chatCommand{Type: "respond", RequestID: json.RawMessage(`"approval-one"`), Result: json.RawMessage(`{"decision":"decline"}`)}); err != nil {
		t.Fatal(err)
	}
	for {
		var message chatMessage
		if err = conn.ReadJSON(&message); err != nil {
			t.Fatal(err)
		}
		if message.Type == "state" && message.PendingRequestIDs != nil && len(*message.PendingRequestIDs) == 0 {
			break
		}
	}
	_ = conn.Close()
	reconnect := connect()
	var replay chatMessage
	if err = reconnect.ReadJSON(&replay); err != nil {
		t.Fatal(err)
	}
	if replay.Type != "snapshot" || replay.PendingRequestIDs == nil || len(*replay.PendingRequestIDs) != 0 {
		t.Fatalf("replay resurrected resolved native permission: %+v", replay)
	}
	if err = s.Stop(); err != nil {
		t.Fatal(err)
	}
	for {
		_, _, err = reconnect.ReadMessage()
		if err != nil {
			break
		}
	}
	if !websocket.IsCloseError(err, websocket.CloseGoingAway) {
		t.Fatalf("stack stop close=%v", err)
	}
	select {
	case <-session.process.done:
	default:
		t.Fatal("native child still running after Stop")
	}
}

func TestChatRoutesValidateRequestsBeforeStartingClients(t *testing.T) {
	t.Parallel()
	s := startChatControlServer(t)
	base := fmt.Sprintf("http://127.0.0.1:%d", s.Port())
	tests := []struct {
		name, method, path, origin, body string
		status                           int
	}{
		{"list sessions", http.MethodGet, "/__devhost__/chat/sessions?chatTarget=project", "", "", http.StatusOK},
		{"foreign origin", http.MethodPost, "/__devhost__/chat/sessions", "https://example.com", `{"harness":"codex"}`, http.StatusForbidden},
		{"missing mutation origin", http.MethodPost, "/__devhost__/chat/sessions", "", `{"harness":"codex"}`, http.StatusForbidden},
		{"unknown harness", http.MethodPost, "/__devhost__/chat/sessions", base, `{"harness":"unknown"}`, http.StatusBadRequest},
		{"browser executable override", http.MethodPost, "/__devhost__/chat/sessions", base, `{"harness":"codex","executable":"/bin/sh"}`, http.StatusBadRequest},
		{"close missing session", http.MethodPost, "/__devhost__/chat/sessions/missing/close?chatTarget=project", base, "", http.StatusNotFound},
		{"close with another method", http.MethodDelete, "/__devhost__/chat/sessions/missing/close?chatTarget=project", base, "", http.StatusMethodNotAllowed},
		{"delete is not a session route", http.MethodDelete, "/__devhost__/chat/sessions/missing?chatTarget=project", base, "", http.StatusNotFound},
		{"missing websocket session", http.MethodGet, "/__devhost__/ws/chat", base, "", http.StatusBadRequest},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r, err := http.NewRequest(tt.method, base+tt.path, strings.NewReader(tt.body))
			if err != nil {
				t.Fatal(err)
			}
			if tt.origin != "" {
				r.Header.Set("Origin", tt.origin)
			}
			r.Header.Set("Content-Type", "application/json")
			response, err := http.DefaultClient.Do(r)
			if err != nil {
				t.Fatal(err)
			}
			body, readErr := io.ReadAll(response.Body)
			closeErr := response.Body.Close()
			if readErr != nil || closeErr != nil {
				t.Fatalf("read=%v close=%v", readErr, closeErr)
			}
			if response.StatusCode != tt.status {
				t.Fatalf("status=%d want=%d body=%s", response.StatusCode, tt.status, body)
			}
		})
	}
}

// A session socket streams and steers a coding agent, so a client that sends no Origin, which no browser page
// does, cannot open one.
func TestChatSessionSocketRequiresAPageOrigin(t *testing.T) {
	s, session, _ := startChatAckTest(t)
	url := fmt.Sprintf("ws://127.0.0.1:%d%s?sessionId=%s", s.Port(), chatWebsocketPath, session.snapshot().ID)
	conn, response, err := websocket.DefaultDialer.Dial(url, nil)
	if conn != nil {
		_ = conn.Close() // The assertions below report the unexpected upgrade.
	}
	if err == nil || response == nil || response.StatusCode != http.StatusForbidden {
		t.Fatalf("dial without Origin = %v, %v, want %d", response, err, http.StatusForbidden)
	}
}

func TestChatReplacesObsoleteTerminalRoutes(t *testing.T) {
	s := startChatControlServer(t)
	for _, path := range []string{"/terminal-sessions", "/ws/terminal", "/xterm.css", "/annotation-queues", "/ws/annotation-queues"} {
		response := mustGet(t, serverURL(s.Port(), controlPathPrefix+path))
		body := readResponseText(t, response)
		if response.StatusCode != http.StatusNotFound {
			t.Fatalf("obsolete route %s: status=%d body=%s", path, response.StatusCode, body)
		}
	}
}

func TestChatDisabledDoesNotExposeNativeEndpoints(t *testing.T) {
	s := startAssetTestServer(t)
	for _, path := range []string{chatHarnessesPath, chatSessionsPath, chatWebsocketPath} {
		response := mustGet(t, serverURL(s.Port(), path))
		body := readResponseText(t, response)
		if response.StatusCode != http.StatusNotFound {
			t.Fatalf("disabled native endpoint %s: %d %s", path, response.StatusCode, body)
		}
	}
}
