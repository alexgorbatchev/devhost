package devtools

import (
	"context"
	"encoding/json"
	"testing"
	"time"
)

func TestChatCodexCompletionPreservesOutcome(t *testing.T) {
	for _, test := range []struct {
		name   string
		turn   string
		status string
		err    string
	}{
		{"failure", `{"id":"turn-one","status":"failed","error":{"message":"Not logged in"}}`, "error", "Not logged in"},
		{"missing error", `{"id":"turn-one","status":"failed"}`, "error", "Native Codex turn failed"},
		{"empty error", `{"id":"turn-one","status":"failed","error":{"message":""}}`, "error", "Native Codex turn failed"},
		{"completed", `{"id":"turn-one","status":"completed","error":null}`, "idle", ""},
		{"interrupted", `{"id":"turn-one","status":"interrupted","error":null}`, "idle", ""},
	} {
		t.Run(test.name, func(t *testing.T) {
			store := chatTestStore(t)
			session, err := store.start(context.Background(), chatSessionRequest{Harness: chatCodex}, t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			session.receive(json.RawMessage(`{"method":"turn/started","params":{"turn":{"id":"turn-one","status":"inProgress"}}}`))
			// Retriable errors do not determine the final turn outcome.
			session.receive(json.RawMessage(`{"method":"error","params":{"turnId":"turn-one","willRetry":true,"error":{"message":"Temporary transport error"}}}`))
			if info := session.snapshot(); info.Status != "running" || info.Error != "" {
				t.Fatalf("retry changed turn outcome: %+v", info)
			}
			session.receive(json.RawMessage(`{"method":"turn/completed","params":{"turn":` + test.turn + `}}`))
			if info := session.snapshot(); info.Status != test.status || info.Error != test.err {
				t.Fatalf("completion state=%+v, want status=%s error=%q", info, test.status, test.err)
			}
			session.mu.Lock()
			active, turnID := session.active, session.turnID
			session.mu.Unlock()
			if active || turnID != "" {
				t.Fatalf("completed turn still active: active=%t turn=%q", active, turnID)
			}
		})
	}
}

func TestChatCodexFailurePublishesErrorAndAllowsNextTurn(t *testing.T) {
	s, session, conn := startChatAckTest(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := session.execute(ctx, chatCommand{Type: "send", Text: "First turn"}); err != nil {
		t.Fatal(err)
	}
	waitChatState(t, session, "requires_action")
	session.receive(json.RawMessage(`{"id":"approval-two","method":"item/tool/requestUserInput","params":{}}`))
	// Failure is authoritative even before the native prompt cleanup arrives.
	session.receive(json.RawMessage(`{"method":"turn/completed","params":{"turn":{"id":"turn-one","status":"failed","error":{"message":"Native inference failed"}}}}`))
	completed := false
	for {
		var message chatMessage
		if err := conn.ReadJSON(&message); err != nil {
			t.Fatal(err)
		}
		if message.Type == "event" {
			var frame chatNativeFrame
			if err := json.Unmarshal(message.Payload, &frame); err != nil {
				t.Fatal(err)
			}
			completed = frame.Method == "turn/completed"
		}
		if completed && message.Type == "state" {
			if message.Session == nil || message.Session.Status != "error" || message.Session.Error != "Native inference failed" {
				t.Fatalf("browser failure state=%+v", message.Session)
			}
			break
		}
	}
	if s.HasActiveChatSessions() {
		t.Fatal("failed turn still keeps the stack active")
	}
	session.receive(json.RawMessage(`{"method":"serverRequest/resolved","params":{"requestId":"approval-one"}}`))
	if info := session.snapshot(); info.Status != "error" || info.Error != "Native inference failed" {
		t.Fatalf("partial prompt cleanup erased failure: %+v", info)
	}
	if err := session.execute(ctx, chatCommand{Type: "respond", RequestID: json.RawMessage(`"approval-two"`), Result: json.RawMessage(`{}`)}); err != nil {
		t.Fatal(err)
	}
	if info := session.snapshot(); info.Status != "error" || info.Error != "Native inference failed" {
		t.Fatalf("response to last pending prompt erased failure: %+v", info)
	}
	if err := session.execute(ctx, chatCommand{Type: "send", Text: "Try again"}); err != nil {
		t.Fatal(err)
	}
	waitChatState(t, session, "requires_action")
	if info := session.snapshot(); info.Error != "" {
		t.Fatalf("next turn kept the previous failure: %+v", info)
	}
	session.mu.Lock()
	events := chatTestEvents(t, session)
	session.mu.Unlock()
	starts := 0
	for _, event := range events {
		var frame chatNativeFrame
		if err := json.Unmarshal(event.Payload, &frame); err != nil {
			t.Fatal(err)
		}
		if frame.Method == "turn/started" {
			starts++
		}
	}
	if starts != 2 {
		t.Fatalf("next send started %d turns total, want 2", starts)
	}
}
