package devtools

import (
	"context"
	"crypto/rand"
	"fmt"
)

func (p *chatProcess) sendUser(ctx context.Context, sessionID string, content []any) error {
	id := make([]byte, 16)
	if _, err := rand.Read(id); err != nil {
		return fmt.Errorf("create native user message ID: %w", err)
	}
	id[6] = (id[6] & 0x0f) | 0x40
	id[8] = (id[8] & 0x3f) | 0x80
	uuid := fmt.Sprintf("%x-%x-%x-%x-%x", id[:4], id[4:6], id[6:8], id[8:10], id[10:])
	// The CLI's replay acknowledges this exact native message before the browser's send is confirmed.
	request := map[string]any{
		"type": "user", "uuid": uuid, "session_id": sessionID,
		"message": map[string]any{"role": "user", "content": content}, "parent_tool_use_id": nil,
	}
	_, err := p.exchange(ctx, "user:"+uuid, request)
	return err
}
