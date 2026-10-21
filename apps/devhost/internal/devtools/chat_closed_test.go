package devtools

import (
	"context"
	"encoding/json"
	"os/exec"
	"testing"
	"time"
)

func TestChatClosedStateSurvivesFinalNativeProcessFrames(t *testing.T) {
	for _, harness := range []string{chatCodex, chatClaude} {
		t.Run(harness, func(t *testing.T) {
			store := chatTestStore(t)
			factory := store.command
			store.command = func(ctx context.Context, name string, args ...string) *exec.Cmd {
				command := factory(ctx, name, args...)
				command.Env = append(command.Env, "DEVHOST_CHAT_FINAL_FRAME_ON_STOP=1", "DEVHOST_CHAT_FINAL_HARNESS="+harness)
				return command
			}
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			session, err := store.start(ctx, chatSessionRequest{Harness: harness}, t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			session.close()
			if actual := session.snapshot().Status; actual != "closed" {
				t.Fatalf("Final native process frame changed closed state to %s", actual)
			}
			session.mu.Lock()
			defer session.mu.Unlock()
			if len(session.events) == 0 {
				t.Fatal("The final native frame was lost")
			}
			var final chatNativeFrame
			if err := json.Unmarshal(session.events[len(session.events)-1].Payload, &final); err != nil {
				t.Fatal(err)
			}
			if harness == chatCodex && final.Method != "turn/completed" {
				t.Fatalf("Final Codex frame=%s", session.events[len(session.events)-1].Payload)
			}
			if harness == chatClaude && (final.Type != "result" || session.info.NativeSessionID != "closed-native-session") {
				t.Fatalf("Final Claude identity/result lost: %+v", session.info)
			}
		})
	}
}
