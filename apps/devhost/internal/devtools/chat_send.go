package devtools

import (
	"context"
	"errors"
	"fmt"
	"time"
)

func (s *chatSession) send(ctx context.Context, command chatCommand) (err error) {
	started := time.Now()
	defer func() { s.logCommand(command, chatCommandOutcome(err), time.Since(started), err) }()
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
	s.mu.Lock()
	if command.Model != nil {
		s.model = *command.Model
	}
	model := s.model
	if model == "" && info.Harness == chatCodex {
		model = s.configuredModel
	}
	wasActive, turnID := s.active, s.turnID
	if !wasActive {
		s.activity.interrupted = false
		s.activity.dispatched = time.Now()
		s.activity.lastEvent = s.activity.dispatched
		s.activity.lastHeartbeat = s.activity.dispatched
		s.activity.turn = ""
		if info.Harness == chatClaude {
			s.activity.turnSequence++
			s.activity.turn = fmt.Sprintf("local-%d", s.activity.turnSequence)
		}
	}
	mode := "new_turn"
	if wasActive {
		mode = "steer"
	}
	s.logLocked("message dispatching command=%q mode=%s model=%q", command.CommandID, mode, model)
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
		if turnID != "" {
			params["expectedTurnId"] = turnID
			_, err = s.process.call(ctx, "turn/steer", params)
			// A completed turn can race a follow-up. Only retry a rejected steer
			// after native completion, never an ambiguous transport failure.
			var rejected *chatNativeError
			s.mu.Lock()
			turnCompleted := !s.active && s.turnID == "" && (s.info.Status == "idle" || s.info.Status == "error")
			s.mu.Unlock()
			if errors.As(err, &rejected) && turnCompleted {
				s.mu.Lock()
				s.logLocked("message retrying command=%q mode=new_turn reason=%q", command.CommandID, "native turn completed before steer")
				s.mu.Unlock()
				delete(params, "expectedTurnId")
				params["model"] = model
				_, err = s.process.call(ctx, "turn/start", params)
			}
		} else {
			params["model"] = model
			_, err = s.process.call(ctx, "turn/start", params)
		}
	} else {
		var nativeModel any
		if model != "" {
			nativeModel = model
		}
		if !wasActive {
			_, err = s.process.call(ctx, "set_model", map[string]any{"model": nativeModel})
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
		s.activity.dispatched = time.Time{}
		s.broadcastLocked(chatMessage{Type: "state", Session: s.infoCopyLocked()})
		s.mu.Unlock()
	}
	return err
}
