package devtools

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
)

// Preserve JSON-RPC integer precision and compare string IDs by value, including
// equivalent escaped representations sent by a different JSON encoder.
func chatRequestKey(raw json.RawMessage) (string, error) {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var id any
	if err := decoder.Decode(&id); err != nil {
		return "", fmt.Errorf("invalid native request ID: %w", err)
	}
	var extra any
	if decoder.Decode(&extra) != io.EOF {
		return "", fmt.Errorf("expected one native request ID")
	}
	switch id.(type) {
	case string, json.Number:
	default:
		return "", fmt.Errorf("native request ID must be a string or number")
	}
	encoded, err := json.Marshal(id)
	if err != nil {
		return "", fmt.Errorf("encode native request ID: %w", err)
	}
	return string(encoded), nil
}
