package manifest

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestAnnotationAgentShorthand(t *testing.T) {
	t.Parallel()
	for _, adapter := range []string{"pi", "claude-code", "opencode", "codex"} {
		t.Run(adapter, func(t *testing.T) {
			t.Parallel()
			path := filepath.Join(t.TempDir(), "devhost.toml")
			text := "name = \"test\"\n[services.web]\ncommand = \"server\"\nhealth.process = true\n[annotation]\nagent = \"" + adapter + "\"\n"
			if adapter == "codex" {
				text += "tempDir = \".tmp/annotations\"\n"
			}
			if err := os.WriteFile(path, []byte(text), 0o600); err != nil {
				t.Fatal(err)
			}
			raw, err := ReadManifest(path)
			if err != nil {
				t.Fatal(err)
			}
			got, err := ValidateManifest(path, raw)
			if err != nil {
				t.Fatal(err)
			}
			raw.value["annotation"] = map[string]any{
				"actions": []any{map[string]any{
					"id": defaultAnnotationActionID, "kind": "agent",
					"agent": map[string]any{"adapter": adapter},
				}},
			}
			if adapter == "codex" {
				raw.value["annotation"].(map[string]any)["tempDir"] = ".tmp/annotations"
			}
			want, err := ValidateManifest(path, raw)
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(got.Annotation, want.Annotation) {
				t.Fatalf("shorthand = %#v, expanded = %#v", got.Annotation, want.Annotation)
			}
		})
	}
}

func TestAnnotationAgentShorthandRejectsInvalidConfiguration(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name       string
		annotation map[string]any
		want       string
	}{
		{"unknown", map[string]any{"agent": "other"}, "annotation.agent must be one of"},
		{"empty", map[string]any{"agent": ""}, "non-empty string"},
		{"wrong type", map[string]any{"agent": true}, "string"},
		{"actions", map[string]any{"agent": "codex", "actions": []any{}}, "annotation.agent cannot be combined with annotation.actions"},
		{"default action", map[string]any{"agent": "codex", "defaultAction": "agent"}, "annotation.agent cannot be combined with annotation.defaultAction"},
		{"invalid temp dir", map[string]any{"agent": "codex", "tempDir": ""}, "non-empty string"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			raw := rawManifestWithServices(map[string]any{"annotation": tc.annotation})
			_, err := ValidateManifest(filepath.Join(t.TempDir(), "devhost.toml"), raw)
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("validation = %v, want %q", err, tc.want)
			}
		})
	}
}
