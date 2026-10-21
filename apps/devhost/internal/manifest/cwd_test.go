package manifest

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestValidateManifestResolvesWorkingDirectories(t *testing.T) {
	root := filepath.Join(t.TempDir(), "project")
	child := filepath.Join(root, "app")
	tests := []struct {
		name    string
		cwd     string
		want    string
		outside bool
	}{
		{name: "relative root", cwd: ".", want: root},
		{name: "relative child", cwd: "app", want: child},
		{name: "absolute root", cwd: root, want: root},
		{name: "absolute child", cwd: child, want: child},
		{name: "absolute cleaned child", cwd: child + string(filepath.Separator) + ".", want: child},
		{name: "relative outside", cwd: "../outside", outside: true},
		{name: "absolute outside", cwd: filepath.Join(filepath.Dir(root), "outside"), want: filepath.Join(filepath.Dir(root), "outside")},
		{name: "absolute sibling sharing prefix", cwd: root + "-other", want: root + "-other"},
		{name: "absolute parent", cwd: root + string(filepath.Separator) + "..", want: filepath.Dir(root)},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			raw := RawManifest{value: map[string]any{
				"name": "cwd-test",
				"services": map[string]any{"web": map[string]any{
					"command": []any{"web"}, "cwd": tt.cwd, "port": int64(3000),
				}},
			}}
			got, err := ValidateManifest(filepath.Join(root, "devhost.toml"), raw)
			if tt.outside {
				if err == nil {
					t.Fatal("expected outside working directories to be rejected")
				}
				for _, field := range []string{"services.web.cwd"} {
					if !strings.Contains(err.Error(), field+" must stay within "+root) {
						t.Errorf("error %q does not identify outside path for %s", err, field)
					}
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			for _, cwd := range []string{got.Services["web"].Cwd} {
				if cwd != tt.want {
					t.Errorf("resolved cwd = %q, want %q", cwd, tt.want)
				}
			}
		})
	}
}
