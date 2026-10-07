package manifest

import (
	"path/filepath"
	"reflect"
	"testing"
)

func TestValidateCodexAnnotationAction(t *testing.T) {
	t.Parallel()
	for _, args := range [][]any{nil, {}, {"--model", "example-model", "-c", "model_reasoning_effort=high"}} {
		t.Run("args", func(t *testing.T) {
			t.Parallel()
			agent := map[string]any{"adapter": "codex"}
			if args != nil {
				agent["args"] = args
			}
			raw := rawManifestWithServices(map[string]any{
				"annotation": map[string]any{"actions": []any{map[string]any{
					"agent": agent, "id": "ask-codex", "kind": "agent",
				}}},
			})
			m, err := ValidateManifest(filepath.Join(t.TempDir(), "devhost.toml"), raw)
			if err != nil {
				t.Fatal(err)
			}
			action := m.Annotation.Actions[0]
			if action.Agent.Kind != "codex" || action.Label != "Codex" || action.ID != m.Annotation.DefaultActionID {
				t.Fatalf("normalized Codex action = %#v, default = %q", action, m.Annotation.DefaultActionID)
			}
			want := make([]string, len(args))
			if args == nil {
				want = nil
			}
			for i, arg := range args {
				want[i] = arg.(string)
			}
			if !reflect.DeepEqual(action.Agent.Args, want) {
				t.Fatalf("args = %#v, want %#v", action.Agent.Args, want)
			}
		})
	}
}
