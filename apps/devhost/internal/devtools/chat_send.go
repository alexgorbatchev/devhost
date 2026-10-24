package devtools

import (
	"context"
	"errors"
	"fmt"
)

func (s *chatSession) send(ctx context.Context, command chatCommand) error {
	images, err := validateChatImages(command.Images)
	if err != nil {
		return err
	}
	if command.Text == "" && len(images) == 0 {
		return fmt.Errorf("message is empty")
	}
	s.operation.Lock()
	defer s.operation.Unlock()
	info := s.snapshot()
	if info.Status == "closed" || info.Status == "starting" {
		return fmt.Errorf("chat session is %s", info.Status)
	}
	if command.Model != nil {
		s.model = *command.Model
	}
	s.mu.Lock()
	wasActive, turnID := s.active, s.turnID
	if len(s.pending) == 0 {
		s.info.Status = "running"
	}
	s.info.Error = ""
	s.active = true
	s.broadcastLocked(chatMessage{Type: "state", Session: s.infoCopyLocked()})
	s.mu.Unlock()
	if info.Harness == chatCodex {
		input := []any{}
		if command.Text != "" {
			input = append(input, map[string]string{"type": "text", "text": command.Text})
		}
		for _, image := range images {
			input = append(input, map[string]string{"type": "image", "url": image.dataURL})
		}
		params := map[string]any{"threadId": info.NativeSessionID, "input": input}
		model := s.model
		if model == "" {
			model = s.configuredModel
		}
		if turnID != "" {
			params["expectedTurnId"] = turnID
			_, err = s.process.call(ctx, "turn/steer", params)
			// A completed turn can race a follow-up. Only retry a rejected steer
			// after native completion, never an ambiguous transport failure.
			var rejected *chatNativeError
			if errors.As(err, &rejected) && s.snapshot().Status == "idle" {
				delete(params, "expectedTurnId")
				params["model"] = model
				_, err = s.process.call(ctx, "turn/start", params)
			}
		} else {
			params["model"] = model
			_, err = s.process.call(ctx, "turn/start", params)
		}
	} else {
		var model any
		if s.model != "" {
			model = s.model
		}
		if !wasActive {
			_, err = s.process.call(ctx, "set_model", map[string]any{"model": model})
		}
		content := []any{}
		if command.Text != "" {
			content = append(content, map[string]string{"type": "text", "text": command.Text})
		}
		for _, image := range images {
			content = append(content, map[string]any{"type": "image", "source": map[string]string{"type": "base64", "media_type": image.mediaType, "data": image.data}})
		}
		if err == nil {
			err = s.process.sendUser(ctx, info.NativeSessionID, content)
		}
	}
	if err != nil && !wasActive {
		s.mu.Lock()
		if s.info.Status == "running" {
			s.info.Status = "idle"
		}
		s.active = false
		s.broadcastLocked(chatMessage{Type: "state", Session: s.infoCopyLocked()})
		s.mu.Unlock()
	}
	return err
}
