package devtools

import (
	"encoding/json"
	"time"
)

type chatClaudeToolBlock struct {
	Type      string `json:"type"`
	ID        string `json:"id"`
	Name      string `json:"name"`
	ToolUseID string `json:"tool_use_id"`
	IsError   bool   `json:"is_error"`
	Input     struct {
		FilePath string `json:"file_path"`
	} `json:"input"`
}

type chatClaudeActivityFrame struct {
	Event struct {
		Type         string              `json:"type"`
		ContentBlock chatClaudeToolBlock `json:"content_block"`
	} `json:"event"`
	ParentToolUseID *string `json:"parent_tool_use_id"`
	Message         struct {
		Model   string                `json:"model"`
		Content []chatClaudeToolBlock `json:"content"`
	} `json:"message"`
	Usage *struct {
		Input      int64 `json:"input_tokens"`
		Output     int64 `json:"output_tokens"`
		CacheRead  int64 `json:"cache_read_input_tokens"`
		CacheWrite int64 `json:"cache_creation_input_tokens"`
	} `json:"usage"`
	Cost     *float64 `json:"total_cost_usd"`
	Duration *int64   `json:"duration_ms"`
}

func (s *chatSession) logClaudeFrameLocked(now time.Time, frame chatNativeFrame, raw json.RawMessage) {
	var event chatClaudeActivityFrame
	if json.Unmarshal(raw, &event) != nil {
		return
	}
	if frame.Type == "assistant" && event.ParentToolUseID == nil && event.Message.Model != "" && event.Message.Model != s.activity.nativeModel {
		s.activity.nativeModel = event.Message.Model
		s.logLocked("native model=%q", event.Message.Model)
	}
	// Subagent results are tool activity, not completion of the parent turn.
	if frame.Type == "stream_event" && event.Event.Type == "message_start" && event.ParentToolUseID == nil {
		s.startTurnLocked(now, "")
	}
	if frame.Type == "stream_event" && event.Event.Type == "content_block_start" {
		s.logClaudeBlockLocked(now, event.Event.ContentBlock)
	}
	if frame.Type == "assistant" || frame.Type == "user" {
		if frame.Type == "assistant" && event.ParentToolUseID == nil {
			s.startTurnLocked(now, "")
		}
		for _, block := range event.Message.Content {
			s.logClaudeBlockLocked(now, block)
		}
	}
	if frame.Type != "result" || event.ParentToolUseID != nil {
		return
	}
	outcome := "completed"
	if frame.IsError {
		outcome = "failed"
	}
	s.finishTurnLocked(now, outcome)
	if event.Usage != nil {
		u := event.Usage
		s.logLocked("usage turn=%q input=%d output=%d cache_read=%d cache_write=%d", s.activity.turn, u.Input, u.Output, u.CacheRead, u.CacheWrite)
	}
	if event.Cost != nil {
		s.logLocked("cost turn=%q estimate_usd=%.6f", s.activity.turn, *event.Cost)
	}
	if event.Duration != nil {
		s.logLocked("native duration turn=%q duration=%s", s.activity.turn, chatDuration(time.Duration(*event.Duration)*time.Millisecond))
	}
}

func (s *chatSession) logClaudeBlockLocked(now time.Time, block chatClaudeToolBlock) {
	switch block.Type {
	case "tool_use":
		s.startToolLocked(now, block.ID, block.Name, block.Input.FilePath)
	case "tool_result":
		outcome := "completed"
		if block.IsError {
			outcome = "failed"
		}
		s.finishToolLocked(now, block.ToolUseID, outcome, nil)
	}
}

func chatClaudeRequestKind(frame chatNativeFrame) string {
	var request struct {
		Subtype string `json:"subtype"`
	}
	if json.Unmarshal(frame.Request, &request) != nil || request.Subtype == "" {
		return "control_request"
	}
	return request.Subtype
}
