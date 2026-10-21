package devtools

import (
	"context"
	"encoding/json"
	"os/exec"
	"slices"
	"testing"
	"time"
)

func TestChatModelSelectionResetsConfiguredDefault(t *testing.T) {
	for _, test := range []struct {
		name, harness, resumeID string
		catalogDefault          bool
		expected                any
	}{
		{"codex", chatCodex, "", false, "configured-codex"},
		{"codex-resume", chatCodex, "native-existing", false, "configured-codex"},
		{"codex-catalog-default", chatCodex, "", true, "native-first"},
		{"claude", chatClaude, "", false, nil},
		{"claude-resume", chatClaude, "native-existing", false, nil},
	} {
		t.Run(test.name, func(t *testing.T) {
			harness := test.harness
			store := chatTestStore(t)
			factory := store.command
			var arguments []string
			store.command = func(ctx context.Context, name string, args ...string) *exec.Cmd {
				arguments = args
				command := factory(ctx, name, args...)
				if test.catalogDefault {
					command.Env = append(command.Env, "DEVHOST_CHAT_UNSET_MODEL=1")
				}
				return command
			}
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			session, err := store.start(ctx, chatSessionRequest{Harness: harness, Model: "selected-model", ResumeID: test.resumeID}, t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			if harness == chatClaude {
				if slices.Contains(arguments, "--model") {
					t.Fatal("A startup model override replaces the configured session default")
				}
				if err := session.execute(ctx, chatCommand{Type: "respond", RequestID: json.RawMessage(`"inherited"`), Result: json.RawMessage(`{"behavior":"deny","message":"Declined"}`)}); err != nil {
					t.Fatal(err)
				}
			}
			for _, model := range []*string{nil, new("")} {
				if err := session.execute(ctx, chatCommand{Type: "send", Text: "model selection", Model: model}); err != nil {
					t.Fatal(err)
				}
				if harness == chatCodex {
					if err := session.execute(ctx, chatCommand{Type: "respond", RequestID: json.RawMessage(`"approval-one"`), Result: json.RawMessage(`{"decision":"decline"}`)}); err != nil {
						t.Fatal(err)
					}
				}
				if err := session.execute(ctx, chatCommand{Type: "interrupt"}); err != nil {
					t.Fatal(err)
				}
				waitChatState(t, session, "idle")
			}
			session.mu.Lock()
			defer session.mu.Unlock()
			var models []any
			for _, event := range session.events {
				var frame struct {
					Type    string `json:"type"`
					Model   any    `json:"model"`
					Request struct {
						Model any `json:"model"`
					} `json:"request"`
				}
				if err := json.Unmarshal(event.Payload, &frame); err != nil {
					t.Fatal(err)
				}
				if frame.Type == "fixture_model" {
					value := frame.Model
					if harness == chatClaude {
						value = frame.Request.Model
					}
					models = append(models, value)
				}
			}
			if len(models) != 2 || models[0] != "selected-model" {
				t.Fatalf("native model requests=%v", models)
			}
			if models[1] != test.expected {
				t.Fatalf("reset model=%v want=%v", models[1], test.expected)
			}
		})
	}
}
