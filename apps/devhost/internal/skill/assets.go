package skill

import (
	_ "embed"
	"fmt"
)

//go:embed SKILL.md
var markdown string

func ReadMarkdown() (string, error) {
	if markdown == "" {
		return "", fmt.Errorf("embedded skill markdown is empty")
	}

	return markdown, nil
}
