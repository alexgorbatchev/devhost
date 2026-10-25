package devtools

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

type chatCodexActivityParams struct {
	TurnID string        `json:"turnId"`
	Turn   chatCodexTurn `json:"turn"`
	Item   struct {
		ID       string `json:"id"`
		Type     string `json:"type"`
		Tool     string `json:"tool"`
		Status   string `json:"status"`
		Path     string `json:"path"`
		Cwd      string `json:"cwd"`
		Duration *int64 `json:"durationMs"`
		ExitCode *int   `json:"exitCode"`
		Success  *bool  `json:"success"`
		Changes  []struct {
			Path string `json:"path"`
		} `json:"changes"`
	} `json:"item"`
	TokenUsage struct {
		Last struct {
			Input     int64  `json:"inputTokens"`
			Cached    int64  `json:"cachedInputTokens"`
			Output    int64  `json:"outputTokens"`
			Reasoning int64  `json:"reasoningOutputTokens"`
			Total     *int64 `json:"totalTokens"`
		} `json:"last"`
	} `json:"tokenUsage"`
	WillRetry bool `json:"willRetry"`
}

func fmtUsage(input, cached, output, reasoning, total int64) string {
	return fmt.Sprintf("input=%d cached_input=%d output=%d reasoning_output=%d total=%d", input, cached, output, reasoning, total)
}

func (s *chatSession) logCodexFrameLocked(now time.Time, frame chatNativeFrame) {
	var params chatCodexActivityParams
	if json.Unmarshal(frame.Params, &params) != nil {
		return
	}
	switch frame.Method {
	case "turn/started":
		s.startTurnLocked(now, params.Turn.ID)
	case "turn/completed":
		outcome := params.Turn.Status
		if outcome == "" {
			outcome = "completed"
		}
		s.finishTurnLocked(now, outcome)
		if s.activity.usage != "" {
			s.logLocked("usage turn=%q %s", params.Turn.ID, s.activity.usage)
		}
	case "thread/tokenUsage/updated":
		usage := params.TokenUsage.Last
		if usage.Total != nil {
			s.activity.usage = fmtUsage(usage.Input, usage.Cached, usage.Output, usage.Reasoning, *usage.Total)
			if s.activity.started.IsZero() {
				s.logLocked("usage turn=%q %s", params.TurnID, s.activity.usage)
			}
		}
	case "error":
		s.logLocked("native error turn=%q retry=%t", params.TurnID, params.WillRetry)
	case "item/started", "item/completed":
		item := params.Item
		switch item.Type {
		case "commandExecution", "fileChange", "mcpToolCall", "dynamicToolCall", "collabToolCall", "webSearch", "imageView":
		default:
			return
		}
		name := item.Type
		if item.Tool != "" {
			name += "/" + item.Tool
		}
		paths := make([]string, 0, len(item.Changes))
		for _, change := range item.Changes {
			paths = append(paths, change.Path)
		}
		path := item.Path
		if path == "" {
			path = item.Cwd
		}
		if len(paths) > 0 {
			path = strings.Join(paths, ",")
		}
		if frame.Method == "item/started" {
			s.startToolLocked(now, item.ID, name, path)
		}
		if frame.Method == "item/completed" {
			if s.activity.tools == nil {
				s.activity.tools = map[string]chatToolActivity{}
			}
			tool, exists := s.activity.tools[item.ID]
			if !exists {
				tool = chatToolActivity{name: name}
			}
			if path != "" {
				tool.path = path
			}
			if item.Duration != nil {
				tool.started = now.Add(-time.Duration(*item.Duration) * time.Millisecond)
			}
			s.activity.tools[item.ID] = tool
			outcome := item.Status
			if outcome == "" {
				outcome = "completed"
			}
			if (item.ExitCode != nil && *item.ExitCode != 0) || (item.Success != nil && !*item.Success) {
				outcome = "failed"
			}
			s.finishToolLocked(now, item.ID, outcome, item.ExitCode)
		}
	}
}
