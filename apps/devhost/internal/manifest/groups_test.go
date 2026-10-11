package manifest

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestGroupValidation(t *testing.T) {
	for _, tc := range []struct {
		name      string
		groups    any
		wantError string
	}{
		{name: "valid", groups: map[string]any{"app": []any{"web", "api"}}},
		{name: "empty table", groups: map[string]any{}},
		{name: "wrong table type", groups: "app", wantError: "groups must be a table"},
		{name: "invalid name", groups: map[string]any{"App": []any{"web"}}, wantError: "groups.App has an invalid name"},
		{name: "service collision", groups: map[string]any{"web": []any{"api"}}, wantError: "groups.web conflicts with a service name"},
		{name: "unknown member", groups: map[string]any{"app": []any{"missing"}}, wantError: "groups.app references an unknown service: missing"},
		{name: "nested group", groups: map[string]any{"app": []any{"other"}, "other": []any{"web"}}, wantError: "groups.app references an unknown service: other"},
		{name: "empty members", groups: map[string]any{"app": []any{}}, wantError: "groups.app must contain at least one string"},
		{name: "scalar members", groups: map[string]any{"app": "web"}, wantError: "groups.app must be a string array"},
		{name: "non-string member", groups: map[string]any{"app": []any{42}}, wantError: "groups.app must contain only non-empty strings"},
		{name: "blank member", groups: map[string]any{"app": []any{" "}}, wantError: "groups.app must contain only non-empty strings"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			raw := RawManifest{value: map[string]any{
				"name": "groups", "groups": tc.groups,
				"services": map[string]any{
					"web": map[string]any{"command": []any{"server"}, "port": "auto"},
					"api": map[string]any{"command": []any{"server"}, "port": "auto"},
				},
			}}
			_, err := ValidateManifest(filepath.Join(t.TempDir(), "devhost.toml"), raw)
			if tc.wantError == "" {
				if err != nil {
					t.Fatal(err)
				}
			} else if err == nil || !strings.Contains(err.Error(), tc.wantError) {
				t.Fatalf("validation = %v, want %q", err, tc.wantError)
			}
		})
	}
}

func TestReadIncludedGroups(t *testing.T) {
	for _, tc := range []struct {
		name        string
		rootGroups  string
		childGroups string
		groupName   string
		wantError   string
	}{
		{name: "recursive groups and cross-manifest members", rootGroups: "[groups]\nroot = [\"api\"]\n", childGroups: "[groups]\napp = [\"web\"]\n"},
		{name: "root contains only includes", childGroups: "[groups]\napp = [\"web\"]\n"},
		{name: "group name watch keeps service references", groupName: "watch", childGroups: "[groups]\nwatch = [\"web\"]\n"},
		{name: "collision with included service", rootGroups: "[groups]\nweb = [\"api\"]\n", childGroups: "[groups]\napp = [\"web\"]\n", wantError: "groups.web conflicts with a service name"},
		{name: "duplicate root and child", rootGroups: "[groups]\napp = [\"api\"]\n", childGroups: "[groups]\napp = [\"web\"]\n", wantError: "group \"app\" is defined multiple times"},
		{name: "duplicate sibling and nested", childGroups: "[groups]\ninfra = [\"web\"]\n", wantError: "group \"infra\" is defined multiple times"},
		{name: "malformed child", childGroups: "groups = 42\n", wantError: "groups"},
		{name: "malformed root", rootGroups: "groups = 42\n", childGroups: "[groups]\napp = [\"web\"]\n", wantError: "groups"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			root := t.TempDir()
			files := map[string]string{
				"devhost.toml":       "name = \"monorepo\"\nincludes = [\"app/devhost.toml\", \"infra/devhost.toml\"]\n" + tc.rootGroups,
				"app/devhost.toml":   "includes = [\"../infra/devhost.toml\"]\n" + tc.childGroups + "[services.web]\ncommand = [\"server\"]\nport = \"auto\"\ndependsOn = [\"api\"]\n",
				"infra/devhost.toml": "[groups]\ninfra = [\"api\"]\n[services.api]\ncommand = [\"server\"]\nport = \"auto\"\n",
			}
			for name, body := range files {
				path := filepath.Join(root, name)
				if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
					t.Fatal(err)
				}
			}
			path := filepath.Join(root, "devhost.toml")
			raw, err := ReadManifest(path)
			if err == nil {
				_, err = ValidateManifest(path, raw)
			}
			if tc.wantError != "" {
				if err == nil || !strings.Contains(err.Error(), tc.wantError) {
					t.Fatalf("load = %v, want %q", err, tc.wantError)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			groupName := tc.groupName
			if groupName == "" {
				groupName = "app"
			}
			want := map[string]any{groupName: []any{"web"}, "infra": []any{"api"}}
			if tc.rootGroups != "" {
				want["root"] = []any{"api"}
			}
			if !reflect.DeepEqual(raw.value["groups"], want) {
				t.Fatalf("merged groups = %#v, want %#v", raw.value["groups"], want)
			}
		})
	}
}
