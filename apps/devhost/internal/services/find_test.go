package services

import (
	"os"
	"path/filepath"
	"slices"
	"testing"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/nettest"
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
			got, err := FindRunningStacks(tc.query, root, environment)
			if err != nil || !slices.Equal(got, tc.want) {
				t.Fatalf("find = %#v, %v; want %#v", got, err, tc.want)
			}
		})
	}
	for _, query := range []string{"", " ", "https://", "ftp://engine.localhost", "https://%invalid"} {
		if _, err := FindRunningStacks(query, root, environment); err == nil {
			t.Fatalf("accepted invalid query %q", query)
		}
	}
}

// A query that names a stack's manifest finds it through any symbolic link to
// that file, as a detached start does. None of these paths contains the one
// the stack recorded.
func TestFindRunningStacksByManifestThroughSymbolicLinks(t *testing.T) {
	state := t.TempDir()
	environment := map[string]string{"DEVHOST_STATE_DIR": state}
	manifest := filepath.Join(t.TempDir(), "project", "devhost.toml")
	if err := os.MkdirAll(filepath.Dir(manifest), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(manifest, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	links := t.TempDir()
	alias := filepath.Join(links, "alias.toml")
	if err := os.Symlink(manifest, alias); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Dir(manifest), filepath.Join(links, "linked")); err != nil {
		t.Fatal(err)
	}
	other := filepath.Join(links, "other.toml")
	if err := os.WriteFile(other, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	owner := startStackOwner(t, state, stackOwnerOptions{ManifestPath: manifest, Port: nettest.ReservePort(t), Behavior: stackOwnerStopsOnRequest})
	want := []caddy.StackOwner{{ManifestPath: manifest, PID: owner.Process.Pid}}
	for _, tc := range []struct {
		name, query, directory string
		want                   []caddy.StackOwner
	}{
		{"file alias", alias, "", want},
		{"relative file alias", "alias.toml", links, want},
		{"directory alias", filepath.Join(links, "linked", "devhost.toml"), "", want},
		{"relative directory alias", filepath.Join("linked", "devhost.toml"), links, want},
		{"another file", other, "", nil},
		{"relative alias from another directory", "alias.toml", state, nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := FindRunningStacks(tc.query, tc.directory, environment)
			if err != nil || !slices.Equal(got, tc.want) {
				t.Fatalf("find %q in %q = %#v, %v; want %#v", tc.query, tc.directory, got, err, tc.want)
			}
		})
	}
}
