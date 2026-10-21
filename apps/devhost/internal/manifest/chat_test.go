package manifest

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestChatConfigurationReplacesTerminalAdapters(t *testing.T) {
	for _, test := range []struct {
		name    string
		fields  map[string]any
		valid   bool
		message string
	}{
		{"chat selector toggles", map[string]any{"devtools": map[string]any{"chat": map[string]any{"enabled": false}, "annotations": map[string]any{"enabled": false}}}, true, ""},
		{"old agent shorthand", map[string]any{"annotation": map[string]any{"agent": "codex"}}, false, "annotation"},
		{"old adapter actions", map[string]any{"annotation": map[string]any{"actions": []any{map[string]any{"id": "agent", "kind": "agent", "agent": map[string]any{"adapter": "claude-code"}}}}}, false, "annotation"},
		{"vim launcher", map[string]any{"devtools": map[string]any{"editor": map[string]any{"ide": "neovim"}}}, false, "devtools.editor.ide"},
		{"external IDE", map[string]any{"devtools": map[string]any{"editor": map[string]any{"ide": "vscode"}}}, true, ""},
	} {
		t.Run(test.name, func(t *testing.T) {
			_, err := ValidateManifest(filepath.Join(t.TempDir(), "devhost.toml"), rawManifestWithServices(test.fields))
			if test.valid && err != nil {
				t.Fatal(err)
			}
			if !test.valid && (err == nil || !strings.Contains(err.Error(), test.message)) {
				t.Fatalf("validation=%v", err)
			}
		})
	}
}
