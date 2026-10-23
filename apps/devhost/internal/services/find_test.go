package services

import (
	"path/filepath"
	"slices"
	"testing"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy"
)

func TestFindRunningStacks(t *testing.T) {
	state := t.TempDir()
	environment := map[string]string{"DEVHOST_STATE_DIR": state}
	root := t.TempDir()
	manifest := filepath.Join(root, "engine-ui", "devhost.toml")
	first := startStackOwner(t, state, stackOwnerOptions{ManifestPath: manifest, ManifestFiles: []string{}, Host: "engine-ui--devbox.localhost", Port: 4101, Behavior: stackOwnerStopsOnRequest})
	secondManifest := filepath.Join(root, "engine-worker", "devhost.toml")
	second := startStackOwner(t, state, stackOwnerOptions{ManifestPath: secondManifest, Port: 4102, Behavior: stackOwnerStopsOnRequest})
	startStackOwner(t, state, stackOwnerOptions{ManifestPath: filepath.Join(root, "unrelated", "devhost.toml"), Host: "unrelated.localhost", Port: 4103, Behavior: stackOwnerStopsOnRequest})
	startStackOwner(t, state, stackOwnerOptions{ManifestPath: filepath.Join(root, "engine-dead", "devhost.toml"), Host: "engine-dead.localhost", Port: 4104, Behavior: stackOwnerCrashes})
	wantFirst := []caddy.StackOwner{{ManifestPath: manifest, PID: first.Process.Pid}}
	wantBoth := append(slices.Clone(wantFirst), caddy.StackOwner{ManifestPath: secondManifest, PID: second.Process.Pid})
	for _, tc := range []struct {
		query string
		want  []caddy.StackOwner
	}{
		{"https://engine-ui--devbox.localhost/path?x=1#section", wantFirst},
		{"http://engine-ui--devbox.localhost:8080", wantFirst},
		{"engine-ui--devbox.localhost", wantFirst},
		{"ENGINE-UI", wantFirst},
		{"engine", wantBoth},
		{"owner", wantFirst},
		{"https://engine.localhost", nil},
		{"absent", nil},
	} {
		t.Run(tc.query, func(t *testing.T) {
			got, err := FindRunningStacks(tc.query, environment)
			if err != nil || !slices.Equal(got, tc.want) {
				t.Fatalf("find = %#v, %v; want %#v", got, err, tc.want)
			}
		})
	}
	for _, query := range []string{"", " ", "https://", "ftp://engine.localhost", "https://%invalid"} {
		if _, err := FindRunningStacks(query, environment); err == nil {
			t.Fatalf("accepted invalid query %q", query)
		}
	}
}
