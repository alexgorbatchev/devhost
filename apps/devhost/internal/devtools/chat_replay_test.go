package devtools

import (
	"context"
	"encoding/json"
	"io"
	"os"
	"os/exec"
	"reflect"
	"slices"
	"strings"
	"testing"
	"time"
)

// The caller holds the session lock, matching production snapshot publication.
func chatTestEvents(t *testing.T, session *chatSession) []chatEvent {
	t.Helper()
	var events []chatEvent
	reader := io.MultiReader(strings.NewReader("["), session.events.reader(), strings.NewReader("]"))
	if err := json.NewDecoder(reader).Decode(&events); err != nil {
		t.Errorf("read chat replay: %v", err)
	}
	return events
}

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
	for _, event := range chatTestEvents(t, session) {
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
	for _, event := range chatTestEvents(t, session) {
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
		{"refused", "DEVHOST_CHAT_LIFECYCLE=refused", "Claude did not run the user message: refused", "idle"},
		{"discarded", "DEVHOST_CHAT_LIFECYCLE=discarded", "Claude did not run the user message: discarded", "idle"},
		{"cancelled", "DEVHOST_CHAT_LIFECYCLE=cancelled", "Claude did not run the user message: cancelled", "idle"},
	} {
		t.Run(test.name, func(t *testing.T) {
			store := chatStoreWithEnvironment(t, test.environment)
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

func chatStoreWithEnvironment(t *testing.T, environment ...string) *chatStore {
	t.Helper()
	store := chatTestStore(t)
	factory := store.command
	store.command = func(ctx context.Context, name string, args ...string) *exec.Cmd {
		command := factory(ctx, name, args...)
		command.Env = append(command.Env, environment...)
		return command
	}
	return store
}

func startReadyClaudeSession(t *testing.T, ctx context.Context, store *chatStore) *chatSession {
	t.Helper()
	session, err := store.start(ctx, chatSessionRequest{Harness: chatClaude}, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if err := session.execute(ctx, chatCommand{Type: "respond", RequestID: json.RawMessage(`"inherited"`), Result: json.RawMessage(`{"behavior":"deny","message":"Declined"}`)}); err != nil {
		t.Fatal(err)
	}
	return session
}

func TestChatClaudeLifecycleSettlesBeforePickup(t *testing.T) {
	for _, test := range []struct {
		state string
		want  chatDelivery
	}{
		{"queued", chatDeliveryQueued},
		{"started", chatDeliveryStarted},
		{"completed", chatDeliveryStarted},
	} {
		t.Run(test.state, func(t *testing.T) {
			store := chatStoreWithEnvironment(t, "DEVHOST_CHAT_LIFECYCLE="+test.state)
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			session := startReadyClaudeSession(t, ctx, store)

			delivery, err := session.send(ctx, chatCommand{Type: "send", Text: "During a long tool"})
			if err != nil {
				t.Fatal(err)
			}
			if delivery != test.want {
				t.Fatalf("delivery=%s want=%s", delivery, test.want)
			}
		})
	}
}

func TestChatClaudeSendWithoutEvidenceIsUnconfirmed(t *testing.T) {
	store := chatStoreWithEnvironment(t, "DEVHOST_CHAT_SKIP_REPLAY=1")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	session := startReadyClaudeSession(t, ctx, store)
	const messageID = "22222222-2222-4222-8222-222222222222"

	sendContext, stop := context.WithTimeout(ctx, 50*time.Millisecond)
	defer stop()
	delivery, err := session.send(sendContext, chatCommand{Type: "send", CommandID: messageID, Text: "Written but never echoed"})
	if err != nil {
		t.Fatal(err)
	}
	if delivery != chatDeliveryUnconfirmed {
		t.Fatalf("delivery=%s want=%s", delivery, chatDeliveryUnconfirmed)
	}
	if status := session.snapshot().Status; status != "running" {
		t.Fatalf("status=%s: a message that may be running must keep the session running", status)
	}
	readPending := func() bool {
		session.process.mu.Lock()
		defer session.process.mu.Unlock()
		_, ok := session.process.pending[chatUserKey(messageID)]
		return ok
	}
	if !readPending() {
		t.Fatal("unconfirmed send dropped its pending entry")
	}
	session.process.resolve(json.RawMessage(`{"type":"user","isReplay":true,"uuid":"` + messageID + `"}`))
	if readPending() {
		t.Fatal("late echo did not settle the pending entry")
	}
}

func TestChatClaudeSendsTheBrowserCommandID(t *testing.T) {
	store := chatTestStore(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	session := startReadyClaudeSession(t, ctx, store)
	const commandID = "33333333-3333-4333-8333-333333333333"
	if _, err := session.send(ctx, chatCommand{Type: "send", CommandID: commandID, Text: "Find me on replay"}); err != nil {
		t.Fatal(err)
	}
	session.mu.Lock()
	defer session.mu.Unlock()
	for _, event := range chatTestEvents(t, session) {
		var frame chatNativeFrame
		if err := json.Unmarshal(event.Payload, &frame); err != nil {
			t.Fatal(err)
		}
		if frame.Type == "user" && frame.IsReplay && frame.UUID == commandID {
			return
		}
	}
	t.Fatal("native echo does not carry the browser command ID")
}

func TestChatClaudeInterruptCancelsQueuedMessages(t *testing.T) {
	for _, test := range []struct {
		name         string
		capabilities string
		want         string
	}{
		{"advertised", chatClaudeCancelQueued, `{"subtype":"interrupt","cancel_queued":true}`},
		{"not advertised", "msg_lifecycle_v1", `{"subtype":"interrupt"}`},
	} {
		t.Run(test.name, func(t *testing.T) {
			store := chatStoreWithEnvironment(t, "DEVHOST_CHAT_CAPABILITIES="+test.capabilities, "DEVHOST_CHAT_STILL_QUEUED=kept")
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			session := startReadyClaudeSession(t, ctx, store)
			if _, err := session.send(ctx, chatCommand{Type: "send", Text: "First"}); err != nil {
				t.Fatal(err)
			}
			if err := session.execute(ctx, chatCommand{Type: "interrupt"}); err != nil {
				t.Fatal(err)
			}
			session.mu.Lock()
			defer session.mu.Unlock()
			for _, event := range chatTestEvents(t, session) {
				var frame struct {
					Type    string          `json:"type"`
					Request json.RawMessage `json:"request"`
				}
				if err := json.Unmarshal(event.Payload, &frame); err != nil {
					t.Fatal(err)
				}
				if frame.Type == "fixture_interrupt" {
					var got, want any
					if err := json.Unmarshal(frame.Request, &got); err != nil {
						t.Fatal(err)
					}
					if err := json.Unmarshal([]byte(test.want), &want); err != nil {
						t.Fatal(err)
					}
					if !reflect.DeepEqual(got, want) {
						t.Fatalf("interrupt=%s want=%s", frame.Request, test.want)
					}
					return
				}
			}
			t.Fatal("no interrupt reached the harness")
		})
	}
}

func TestChatClaudeStateEventsOwnTheStatus(t *testing.T) {
	const running = `{"type":"system","subtype":"session_state_changed","state":"running"}`
	const idle = `{"type":"system","subtype":"session_state_changed","state":"idle"}`
	const result = `{"type":"result","subtype":"success"}`
	const failed = `{"type":"result","is_error":true,"result":"Turn failed"}`
	for _, test := range []struct {
		name   string
		frames []string
		want   string
	}{
		{"result without state events ends the turn", []string{result}, "idle"},
		{"queued message starts after the result", []string{running, result}, "running"},
		{"idle ends the turn", []string{running, result, idle}, "idle"},
		{"failure survives idle", []string{running, failed, idle}, "error"},
	} {
		t.Run(test.name, func(t *testing.T) {
			store := chatTestStore(t)
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			session := startReadyClaudeSession(t, ctx, store)
			for _, frame := range test.frames {
				session.receive(json.RawMessage(frame))
			}
			if status := session.snapshot().Status; status != test.want {
				t.Fatalf("status=%s want=%s", status, test.want)
			}
		})
	}
}

func TestChatClaudeRequestsStateEvents(t *testing.T) {
	store := chatTestStore(t)
	factory := store.command
	var started *exec.Cmd
	store.command = func(ctx context.Context, name string, args ...string) *exec.Cmd {
		started = factory(ctx, name, args...)
		return started
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if _, err := store.start(ctx, chatSessionRequest{Harness: chatClaude}, t.TempDir()); err != nil {
		t.Fatal(err)
	}
	if !slices.Contains(started.Env, chatClaudeStateEvents) {
		t.Fatal("Claude Code started without the state events variable")
	}
}

func TestChatCodexCorrelatesSends(t *testing.T) {
	store := chatTestStore(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	session, err := store.start(ctx, chatSessionRequest{Harness: chatCodex}, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	ids := []string{"44444444-4444-4444-8444-444444444444", "55555555-5555-4555-8555-555555555555"}
	for _, id := range ids {
		delivery, err := session.send(ctx, chatCommand{Type: "send", CommandID: id, Text: "Correlate"})
		if err != nil {
			t.Fatal(err)
		}
		if delivery != chatDeliveryQueued {
			t.Fatalf("delivery=%s: a Codex response means queued, not started", delivery)
		}
	}
	session.mu.Lock()
	defer session.mu.Unlock()
	var got []string
	for _, event := range chatTestEvents(t, session) {
		var frame struct {
			Type string `json:"type"`
			ID   string `json:"id"`
		}
		if json.Unmarshal(event.Payload, &frame) == nil && frame.Type == "fixture_client_id" {
			got = append(got, frame.ID)
		}
	}
	if !slices.Equal(got, ids) {
		t.Fatalf("client IDs=%v want=%v", got, ids)
	}
}

func TestChatCodexTimeoutIsUnconfirmed(t *testing.T) {
	store := chatStoreWithEnvironment(t, "DEVHOST_CHAT_HOLD_TURN=1")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	session, err := store.start(ctx, chatSessionRequest{Harness: chatCodex}, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	sendContext, stop := context.WithTimeout(ctx, 50*time.Millisecond)
	defer stop()
	delivery, err := session.send(sendContext, chatCommand{Type: "send", Text: "Never answered"})
	if err != nil {
		t.Fatal(err)
	}
	if delivery != chatDeliveryUnconfirmed {
		t.Fatalf("delivery=%s want=%s", delivery, chatDeliveryUnconfirmed)
	}
	if status := session.snapshot().Status; status != "running" {
		t.Fatalf("status=%s: a message that may be running must keep the session running", status)
	}
}
