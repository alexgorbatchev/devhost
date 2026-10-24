package devtools

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/manifest"
)

func TestChatPromptReloadReachesExistingSession(t *testing.T) {
	s, session, conn := startChatAckTest(t)
	for index, prompt := range []string{manifest.DefaultDevtools().Chat.Prompt, "Review only.", ""} {
		settings := s.currentSettings()
		settings.ChatPrompt = prompt
		if err := s.UpdateSettings(settings); err != nil {
			t.Fatal(err)
		}
		text := fmt.Sprintf("Annotation %d", index)
		if err := conn.WriteJSON(chatCommand{Type: "send", CommandID: text, Text: text}); err != nil {
			t.Fatal(err)
		}
		if result := readChatAckTest(t, conn); result.Error != "" {
			t.Fatal(result.Error)
		}
		want := text
		if prompt != "" {
			want += "\n\nDevhost workflow instructions:\n" + prompt
		}
		session.mu.Lock()
		events := append([]chatEvent{}, session.events...)
		session.mu.Unlock()
		found := false
		for _, event := range events {
			var frame struct {
				Input []struct {
					Text string `json:"text"`
				} `json:"input"`
				Result struct {
					Input []struct {
						Text string `json:"text"`
					} `json:"input"`
				} `json:"result"`
			}
			if err := json.Unmarshal(event.Payload, &frame); err != nil {
				t.Fatal(err)
			}
			for _, input := range append(frame.Input, frame.Result.Input...) {
				if input.Text == want {
					found = true
				}
			}
		}
		if !found {
			t.Fatalf("native input missing %q", want)
		}
	}
}

func TestChatPromptPreservesSendValidation(t *testing.T) {
	for _, test := range []struct{ name, text, prompt, message string }{
		{"empty request", "", "Use a worktree", "message is empty"},
		{"oversized prompt", "Small request", strings.Repeat("x", chatMessageLimit), "message including workflow instructions exceeds 8 MiB"},
	} {
		t.Run(test.name, func(t *testing.T) {
			s, session, conn := startChatAckTest(t)
			settings := s.currentSettings()
			settings.ChatPrompt = test.prompt
			if err := s.UpdateSettings(settings); err != nil {
				t.Fatal(err)
			}
			if err := conn.WriteJSON(chatCommand{Type: "send", CommandID: "invalid", Text: test.text}); err != nil {
				t.Fatal(err)
			}
			if ack := readChatAckTest(t, conn); ack.Error != test.message {
				t.Fatalf("send validation: %+v", ack)
			}
			if session.snapshot().Status != "idle" {
				t.Fatal("invalid send started native work")
			}
		})
	}
}
