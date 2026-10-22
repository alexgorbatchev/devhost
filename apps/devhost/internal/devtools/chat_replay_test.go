package devtools

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"testing"
	"time"
)

func TestChatClaudeSendRetainsNativeUserReplay(t *testing.T) {
	store := chatTestStore(t)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	session, err := store.start(ctx, chatSessionRequest{Harness: chatClaude}, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if err := session.execute(ctx, chatCommand{Type: "respond", RequestID: json.RawMessage(`"inherited"`), Result: json.RawMessage(`{"behavior":"deny","message":"Declined"}`)}); err != nil {
		t.Fatal(err)
	}
	if err := session.execute(ctx, chatCommand{Type: "send", Text: "Keep this native user message"}); err != nil {
		t.Fatal(err)
	}
	session.mu.Lock()
	defer session.mu.Unlock()
	var replays []chatNativeFrame
	for _, event := range session.events {
		var frame chatNativeFrame
		if err := json.Unmarshal(event.Payload, &frame); err != nil {
			t.Fatal(err)
		}
		if frame.Type == "user" {
			replays = append(replays, frame)
		}
	}
	if len(replays) != 1 {
		t.Fatalf("Send returned before a native user replay: %d replays", len(replays))
	}
	replay := replays[0]
	if !replay.IsReplay || len(replay.UUID) != 36 {
		t.Fatalf("Native UUID/replay missing: %+v", replay)
	}
	var message struct {
		Role    string `json:"role"`
		Content []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
	}
	if err := json.Unmarshal(replay.Message, &message); err != nil {
		t.Fatal(err)
	}
	if message.Role != "user" || len(message.Content) != 1 || message.Content[0].Text != "Keep this native user message" {
		t.Fatalf("Native replay changed the message: %s", replay.Message)
	}
}

func TestChatInstalledClaudeUserReplay(t *testing.T) {
	if os.Getenv("DEVHOST_TEST_CHAT_INFERENCE") != "1" {
		t.Skip("explicit native input acknowledgment integration")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	store := newChatStore(ctx, exec.CommandContext)
	defer store.close()
	cwd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	session, err := store.start(ctx, chatSessionRequest{Harness: chatClaude}, cwd)
	if err != nil {
		t.Fatal(err)
	}
	if err := session.execute(ctx, chatCommand{Type: "send", Text: "Reply with exactly DEVHOST_CHAT_ECHO_OK. Do not use any tools or modify files."}); err != nil {
		t.Fatal(err)
	}
	session.mu.Lock()
	defer session.mu.Unlock()
	var echoed bool
	for _, event := range session.events {
		var frame chatNativeFrame
		if err := json.Unmarshal(event.Payload, &frame); err != nil {
			t.Fatal(err)
		}
		if frame.Type == "user" && frame.IsReplay && len(frame.UUID) == 36 {
			echoed = true
			t.Logf("Native CLI acknowledged user UUID %s before execute returned; session=%s", frame.UUID, session.info.Status)
		}
	}
	if !echoed {
		t.Fatal("The native CLI did not acknowledge the submitted user message")
	}
}

func TestChatClaudeSendRejectsUnconfirmedInput(t *testing.T) {
	for _, test := range []struct{ name, environment, errorText, status string }{
		{"wrong-replay-and-native-error", "DEVHOST_CHAT_USER_REJECT=1", `Claude rejected the user message: "Native input rejected"`, "error"},
		{"no-native-replay", "DEVHOST_CHAT_SKIP_REPLAY=1", context.DeadlineExceeded.Error(), "idle"},
	} {
		t.Run(test.name, func(t *testing.T) {
			store := chatTestStore(t)
			factory := store.command
			store.command = func(ctx context.Context, name string, args ...string) *exec.Cmd {
				command := factory(ctx, name, args...)
				command.Env = append(command.Env, test.environment)
				return command
			}
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()
			session, err := store.start(ctx, chatSessionRequest{Harness: chatClaude}, t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			if err := session.execute(ctx, chatCommand{Type: "respond", RequestID: json.RawMessage(`"inherited"`), Result: json.RawMessage(`{"behavior":"deny","message":"Declined"}`)}); err != nil {
				t.Fatal(err)
			}
			sendContext, stop := context.WithTimeout(ctx, 200*time.Millisecond)
			defer stop()
			err = session.execute(sendContext, chatCommand{Type: "send", Text: "Must not confirm a pipe write"})
			if err == nil || err.Error() != test.errorText {
				t.Fatalf("send error=%v want=%s", err, test.errorText)
			}
			if actual := session.snapshot().Status; actual != test.status {
				t.Fatalf("state=%s want=%s", actual, test.status)
			}
		})
	}
}
