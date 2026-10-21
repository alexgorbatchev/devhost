package devtools

import (
	"context"
	"encoding/json"
	"fmt"
)

func configuredChatModel(ctx context.Context, process *chatProcess, cwd string) (string, error) {
	raw, err := process.call(ctx, "config/read", map[string]any{"cwd": cwd, "includeLayers": false})
	if err != nil {
		return "", err
	}
	var response struct {
		Config struct {
			Model string `json:"model"`
		} `json:"config"`
	}
	if err := json.Unmarshal(raw, &response); err != nil {
		return "", fmt.Errorf("read configured model: %w", err)
	}
	if response.Config.Model != "" {
		return response.Config.Model, nil
	}
	rows, err := readChatCodexModels(ctx, process)
	if err != nil {
		return "", err
	}
	for _, row := range rows {
		var model struct {
			Model     string `json:"model"`
			IsDefault bool   `json:"isDefault"`
		}
		if err := json.Unmarshal(row, &model); err != nil {
			return "", fmt.Errorf("read default model: %w", err)
		}
		if model.IsDefault && model.Model != "" {
			return model.Model, nil
		}
	}
	return "", fmt.Errorf("Codex returned no configured or catalog default model")
}

func readChatCodexModels(ctx context.Context, process *chatProcess) ([]json.RawMessage, error) {
	var rows []json.RawMessage
	cursor := ""
	seen := map[string]bool{}
	for {
		params := map[string]any{"includeHidden": false}
		if cursor != "" {
			params["cursor"] = cursor
		}
		raw, err := process.call(ctx, "model/list", params)
		if err != nil {
			return nil, err
		}
		var page struct {
			Data       []json.RawMessage `json:"data"`
			NextCursor *string           `json:"nextCursor"`
		}
		if err := json.Unmarshal(raw, &page); err != nil {
			return nil, err
		}
		rows = append(rows, page.Data...)
		if page.NextCursor == nil || *page.NextCursor == "" {
			return rows, nil
		}
		cursor = *page.NextCursor
		if seen[cursor] {
			return nil, fmt.Errorf("Codex returned a repeated model cursor")
		}
		seen[cursor] = true
	}
}
