package devtools

import (
	"context"
	"encoding/json"
	"testing"
	"time"
)

func TestChatSendsAnnotationsDuringActiveTurn(t *testing.T) {
	for _, harness := range []string{chatCodex, chatClaude} {
		t.Run(harness, func(t *testing.T) {
			store := chatTestStore(t)
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			session, err := store.start(ctx, chatSessionRequest{Harness: harness}, t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			if harness == chatClaude {
				if err := session.execute(ctx, chatCommand{Type: "respond", RequestID: json.RawMessage(`"inherited"`), Result: json.RawMessage(`{}`)}); err != nil {
					t.Fatal(err)
				}
			}
			for _, text := range []string{"First annotation", "Second annotation", "Third annotation"} {
				if err := session.execute(ctx, chatCommand{Type: "send", Text: text}); err != nil {
					t.Fatalf("send %q while previous work remains active: %v", text, err)
				}
			}
		})
	}
}

func TestChatSteerRacingCompletionStartsNextTurn(t *testing.T) {
	t.Setenv("DEVHOST_CHAT_STEER_FINISH", "1")
	store := chatTestStore(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	session, err := store.start(ctx, chatSessionRequest{Harness: chatCodex}, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	for _, text := range []string{"first", "follow-up racing completion"} {
		if err := session.execute(ctx, chatCommand{Type: "send", Text: text}); err != nil {
			t.Fatal(err)
		}
	}
	waitChatState(t, session, "requires_action")
	session.mu.Lock()
	defer session.mu.Unlock()
	starts := 0
	for _, event := range session.events {
		var frame chatNativeFrame
		if err := json.Unmarshal(event.Payload, &frame); err != nil {
			t.Fatal(err)
		}
		if frame.Method == "turn/started" {
			starts++
		}
	}
	if starts != 2 {
		t.Fatalf("started %d turns, want 2", starts)
	}
}

func TestChatPendingSendDoesNotBlockApproval(t *testing.T) {
	t.Setenv("DEVHOST_CHAT_DELAY_REPLAY", "1")
	s := startChatControlServer(t, chatHelperCommand(t))
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	session, err := s.chat.start(ctx, chatSessionRequest{Harness: chatClaude}, s.projectRootPath)
	if err != nil {
		t.Fatal(err)
	}
	conn := connectChatAckTest(t, s, session)
	if err := conn.WriteJSON(chatCommand{Type: "send", CommandID: "pending", Text: "Annotation"}); err != nil {
		t.Fatal(err)
	}
	for {
		var message chatMessage
		if err := conn.ReadJSON(&message); err != nil {
			t.Fatal(err)
		}
		var frame chatNativeFrame
		if len(message.Payload) > 0 {
			if err := json.Unmarshal(message.Payload, &frame); err != nil {
				t.Fatal(err)
			}
		}
		if frame.RequestID == "delivery-approval" {
			break
		}
	}
	if err := conn.WriteJSON(chatCommand{Type: "respond", RequestID: json.RawMessage(`"delivery-approval"`), Result: json.RawMessage(`{"behavior":"deny","message":"Declined"}`)}); err != nil {
		t.Fatal(err)
	}
	if ack := readChatAckTest(t, conn); ack.CommandID != "pending" || ack.Error != "" {
		t.Fatalf("send after approval: %+v", ack)
	}
}
