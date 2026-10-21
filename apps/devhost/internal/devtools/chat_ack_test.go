package devtools

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

type chatAckTestMessage struct {
	Type      string `json:"type"`
	SessionID string `json:"sessionId"`
	CommandID string `json:"commandId"`
	Error     string `json:"error"`
}

func connectChatAckTest(t *testing.T, s *ControlServer, session *chatSession) *websocket.Conn {
	t.Helper()
	base := fmt.Sprintf("http://127.0.0.1:%d", s.Port())
	url := "ws" + strings.TrimPrefix(base, "http") + chatWebsocketPath + "?sessionId=" + session.snapshot().ID
	conn, _, err := websocket.DefaultDialer.Dial(url, http.Header{"Origin": []string{base}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = conn.Close() })
	if err := conn.SetReadDeadline(time.Now().Add(3 * time.Second)); err != nil {
		t.Fatal(err)
	}
	var snapshot chatAckTestMessage
	if err := conn.ReadJSON(&snapshot); err != nil {
		t.Fatal(err)
	}
	if snapshot.Type != "snapshot" {
		t.Fatalf("first frame=%+v, want snapshot", snapshot)
	}
	return conn
}

func startChatAckTest(t *testing.T) (*ControlServer, *chatSession, *websocket.Conn) {
	t.Helper()
	s := startChatControlServer(t)
	fixture := chatTestStore(t)
	s.chat.command = fixture.command
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	session, err := s.chat.start(ctx, chatSessionRequest{Harness: chatCodex}, s.projectRootPath)
	if err != nil {
		t.Fatal(err)
	}
	return s, session, connectChatAckTest(t, s, session)
}

func readChatAckTest(t *testing.T, conn *websocket.Conn) chatAckTestMessage {
	t.Helper()
	for {
		var message chatAckTestMessage
		if err := conn.ReadJSON(&message); err != nil {
			t.Fatal(err)
		}
		if message.Type == "command_result" || message.Type == "error" {
			return message
		}
	}
}

func TestChatSendAcknowledgesNativeAcceptance(t *testing.T) {
	_, session, conn := startChatAckTest(t)
	if err := conn.WriteJSON(map[string]any{"type": "send", "commandId": "accepted-send", "text": "Native turn"}); err != nil {
		t.Fatal(err)
	}
	message := readChatAckTest(t, conn)
	if message.Type != "command_result" || message.CommandID != "accepted-send" || message.SessionID != session.snapshot().ID || message.Error != "" {
		t.Fatalf("native acceptance acknowledgement=%+v", message)
	}
	waitChatState(t, session, "requires_action")
	session.mu.Lock()
	pendingCount := len(session.pending)
	session.mu.Unlock()
	if pendingCount != 1 {
		t.Fatal("send acknowledgement must not approve the native request")
	}
}

func TestChatSendRejectsInvalidMessageWithCorrelation(t *testing.T) {
	s, session, conn := startChatAckTest(t)
	observer := connectChatAckTest(t, s, session)
	if err := conn.WriteJSON(map[string]any{"type": "send", "commandId": "empty-send", "text": ""}); err != nil {
		t.Fatal(err)
	}
	message := readChatAckTest(t, conn)
	if message.Type != "command_result" || message.CommandID != "empty-send" || message.SessionID != session.snapshot().ID || message.Error != "message is empty" {
		t.Fatalf("invalid send acknowledgement=%+v", message)
	}
	if state := session.snapshot().Status; state != "idle" {
		t.Fatalf("rejected send started native work: %s", state)
	}
	if err := observer.SetReadDeadline(time.Now().Add(100 * time.Millisecond)); err != nil {
		t.Fatal(err)
	}
	for {
		var frame chatAckTestMessage
		err := observer.ReadJSON(&frame)
		if err != nil {
			var timeout net.Error
			if !errors.As(err, &timeout) || !timeout.Timeout() {
				t.Fatalf("observer read: %v", err)
			}
			break
		}
		if frame.Type == "command_result" || frame.Type == "error" {
			t.Fatalf("send acknowledgement leaked to another browser: %+v", frame)
		}
	}
}

func TestChatSendAcknowledgesNativeRejection(t *testing.T) {
	t.Setenv("DEVHOST_CHAT_REJECT_TURN", "1")
	_, session, conn := startChatAckTest(t)
	if err := conn.WriteJSON(map[string]any{"type": "send", "commandId": "native-rejection", "text": "Rejected turn"}); err != nil {
		t.Fatal(err)
	}
	message := readChatAckTest(t, conn)
	if message.Type != "command_result" || message.CommandID != "native-rejection" || message.SessionID != session.snapshot().ID || message.Error != `codex request failed: {"code":-32602,"message":"Native turn rejected"}` {
		t.Fatalf("native rejection acknowledgement=%+v", message)
	}
	if state := session.snapshot().Status; state != "idle" {
		t.Fatalf("native rejection left session unusable: %s", state)
	}
}

func TestChatSendRequiresCommandIDBeforeExecution(t *testing.T) {
	_, session, conn := startChatAckTest(t)
	if err := conn.WriteJSON(map[string]any{"type": "send", "text": "Must not execute"}); err != nil {
		t.Fatal(err)
	}
	var message chatAckTestMessage
	if err := conn.ReadJSON(&message); err != nil {
		t.Fatal(err)
	}
	if message.Type != "error" || message.Error != "send command requires commandId" {
		t.Fatalf("missing commandId response=%+v", message)
	}
	if state := session.snapshot().Status; state != "idle" {
		t.Fatalf("missing commandId started native work: %s", state)
	}
}

func TestChatOtherCommandsRetainGenericErrors(t *testing.T) {
	_, _, conn := startChatAckTest(t)
	for _, command := range []map[string]any{
		{"type": "interrupt"},
		{"type": "respond", "requestId": "not-pending", "result": map[string]any{}},
	} {
		if err := conn.WriteJSON(command); err != nil {
			t.Fatal(err)
		}
		message := readChatAckTest(t, conn)
		if message.Type != "error" || message.CommandID != "" || message.Error == "" {
			t.Fatalf("non-send command lost generic error: %+v", message)
		}
	}
}

func TestChatSendMalformedShapeRetainsCorrelation(t *testing.T) {
	_, session, conn := startChatAckTest(t)
	if err := conn.WriteJSON(map[string]any{"type": "send", "commandId": "unknown-field", "text": "Must not execute", "unexpected": true}); err != nil {
		t.Fatal(err)
	}
	message := readChatAckTest(t, conn)
	if message.Type != "command_result" || message.CommandID != "unknown-field" || message.Error != `json: unknown field "unexpected"` {
		t.Fatalf("malformed shape acknowledgement=%+v", message)
	}
	if state := session.snapshot().Status; state != "idle" {
		t.Fatalf("malformed send started native work: %s", state)
	}
	if err := conn.WriteJSON(map[string]any{"type": "send", "commandId": 17, "text": "Must not execute"}); err != nil {
		t.Fatal(err)
	}
	message = readChatAckTest(t, conn)
	if message.Type != "error" || message.CommandID != "" || message.Error == "" {
		t.Fatalf("non-string commandId response=%+v", message)
	}
	if state := session.snapshot().Status; state != "idle" {
		t.Fatalf("non-string commandId started native work: %s", state)
	}
}

func TestChatSendWireLimitClosesBeforeNativeExecution(t *testing.T) {
	_, session, conn := startChatAckTest(t)
	if err := conn.WriteJSON(map[string]any{"type": "send", "commandId": "oversized", "text": strings.Repeat("x", chatMessageLimit)}); err != nil {
		t.Fatal(err)
	}
	for {
		_, _, err := conn.ReadMessage()
		if err == nil {
			continue
		}
		if !websocket.IsCloseError(err, websocket.CloseMessageTooBig) {
			t.Fatalf("oversized send close=%v, want native message-too-big close", err)
		}
		break
	}
	if state := session.snapshot().Status; state != "idle" {
		t.Fatalf("oversized frame reached native execution: %s", state)
	}
}
