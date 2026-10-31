package devtools

import (
	"crypto/rand"
	"fmt"
	"regexp"
)

var chatUUIDPattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// chatMessageID is the native ID of a sent message. Using the browser's command ID
// when it is a UUID lets a page find the message in replayed native frames.
func chatMessageID(commandID string) (string, error) {
	if chatUUIDPattern.MatchString(commandID) {
		return commandID, nil
	}
	id := make([]byte, 16)
	if _, err := rand.Read(id); err != nil {
		return "", fmt.Errorf("create native user message ID: %w", err)
	}
	id[6] = (id[6] & 0x0f) | 0x40
	id[8] = (id[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", id[:4], id[4:6], id[6:8], id[8:10], id[10:]), nil
}
