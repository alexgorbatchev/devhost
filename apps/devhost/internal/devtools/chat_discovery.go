package devtools

import (
	"context"
	"encoding/json"
	"fmt"
)

func (s *chatStore) discover(ctx context.Context, harness, cwd string) chatHarness {
	result := chatHarness{ID: harness, Label: "Codex", Models: []chatModel{}}
	args := []string{"app-server"}
	if harness == chatClaude {
		result.Label = "Claude Code"
		args = []string{"-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--permission-prompt-tool=stdio"}
	}
	if !s.begin() {
		result.Error = "chat server is stopping"
		return result
	}
	defer s.wg.Done()
	processContext, cancel := context.WithCancel(s.ctx)
	defer cancel()
	stop := context.AfterFunc(ctx, cancel)
	defer stop()
	process, err := startChatProcess(processContext, harness, cwd, args, s.command, nil)
	if err != nil {
		result.Error = err.Error()
		return result
	}
	defer process.close()
	initialized, err := initializeChat(ctx, process)
	if err != nil {
		result.Error = err.Error()
		return result
	}
	var rows []json.RawMessage
	if harness == chatClaude {
		var response struct {
			Models []json.RawMessage `json:"models"`
		}
		if err = json.Unmarshal(initialized, &response); err != nil {
			result.Error = err.Error()
			return result
		}
		rows = response.Models
	} else {
		rows, err = readChatCodexModels(ctx, process)
		if err != nil {
			result.Error = err.Error()
			return result
		}
	}
	for _, raw := range rows {
		var model struct {
			Model       string `json:"model"`
			Value       string `json:"value"`
			DisplayName string `json:"displayName"`
			Description string `json:"description"`
		}
		if err = json.Unmarshal(raw, &model); err != nil {
			result.Error = fmt.Sprintf("read native model: %v", err)
			return result
		}
		id := model.Model
		if harness == chatClaude {
			id = model.Value
		}
		if id == "" {
			result.Error = "native model has no selectable ID"
			return result
		}
		result.Models = append(result.Models, chatModel{ID: id, Label: model.DisplayName, Description: model.Description, Metadata: raw})
	}
	result.Available = true
	return result
}
