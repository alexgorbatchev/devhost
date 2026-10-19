package services

import (
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/manifest"
)

func TestStartStackRejectsOverlappingManifestInputs(t *testing.T) {
	for _, included := range []bool{false, true} {
		t.Run(map[bool]string{false: "root", true: "nested glob include"}[included], func(t *testing.T) {
			root := t.TempDir()
			path, child, nested := filepath.Join(root, "devhost.toml"), filepath.Join(root, "child.toml"), filepath.Join(root, "nested.toml")
			files := map[string]string{
				path:   "name = \"candidate\"\nincludes = [\"child.toml\"]\n[worktrees]\nenabled = false\n",
				child:  "includes = [\"nest*.toml\"]\n",
				nested: "[services.worker]\ncommand = [\"sh\", \"-c\", \"sleep 60\"]\n[services.worker.health]\nprocess = true\n",
			}
			for file, text := range files {
				if err := os.WriteFile(file, []byte(text), 0o600); err != nil {
					t.Fatal(err)
				}
			}
			paths := caddy.CreateManagedCaddyPaths(t.TempDir())
			ownerPath := path
			if included {
				ownerPath = nested
			}
			owner := startStackOwner(t, paths.StateDirectoryPath, stackOwnerOptions{ManifestPath: ownerPath, ManifestFiles: []string{ownerPath}, Port: 4010, Behavior: stackOwnerStopsOnRequest})
			raw, err := manifest.ReadManifest(path)
			if err != nil {
				t.Fatal(err)
			}
			configuration, err := manifest.ValidateManifest(path, raw)
			if err != nil {
				t.Fatal(err)
			}
			resolved, err := ResolveServicePorts(configuration)
			if err != nil {
				t.Fatal(err)
			}
			_, err = startTestStack(t, &resolved, []string{"worker"}, StartStackOptions{Configuration: &configuration, CaddyPaths: paths, LogWriter: io.Discard})
			if err == nil || !strings.Contains(err.Error(), "already running") || !strings.Contains(err.Error(), ownerPath) {
				t.Fatalf("overlapping startup error: %v", err)
			}
			if !processExists(owner.Process.Pid) {
				t.Fatal("duplicate startup terminated the existing stack")
			}
		})
	}
}

func registeredManifestFiles(t *testing.T, paths caddy.Paths) []string {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(paths.StacksDirectoryPath, strconv.Itoa(os.Getpid())+".json"))
	if err != nil {
		t.Fatal(err)
	}
	var record struct {
		ManifestFiles []string `json:"manifestFiles"`
	}
	if err := json.Unmarshal(data, &record); err != nil {
		t.Fatal(err)
	}
	return record.ManifestFiles
}

func TestManifestReloadReservesAcceptedIncludes(t *testing.T) {
	body := reloadServiceBody("web", "original", "reload.localhost")
	f := startReloadStack(t, body)
	header := f.header
	child, added := filepath.Join(filepath.Dir(f.path), "child.toml"), filepath.Join(filepath.Dir(f.path), "added.toml")
	for _, path := range []string{child, added} {
		if err := os.WriteFile(path, nil, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	f.header = "includes = [\"child.toml\"]\n" + header
	f.write(t, body)
	waitForCondition(t, 5*time.Second, func() bool { return f.logs.count("configuration reloaded") == 1 })
	if files := registeredManifestFiles(t, f.paths); !slices.Contains(files, child) {
		t.Fatalf("accepted include is unreserved: %v", files)
	}
	// A valid candidate that fails to launch must restore the prior ownership set.
	f.header = "includes = [\"added.toml\"]\n" + header
	broken := "[services.web]\ncommand = [\"devhost-nonexistent-test-command\"]\nport = \"auto\"\nhost = \"reload.localhost\"\n"
	f.write(t, broken)
	waitForCondition(t, 5*time.Second, func() bool { return f.logs.contains("configuration reload rejected") })
	if files := registeredManifestFiles(t, f.paths); !slices.Contains(files, child) || slices.Contains(files, added) {
		t.Fatalf("failed reload changed reservations: %v", files)
	}
	route := readRestartRoute(t, filepath.Join(f.paths.RegistrationsDirectoryPath, "reload.localhost_web_2f.json"))
	assertRestartResponse(t, serverURL(route.DocumentInjectionPort, "/"), "original")
	f.header = header
	f.write(t, body)
	waitForCondition(t, 5*time.Second, func() bool { return f.logs.count("configuration reloaded") == 2 })
	if files := registeredManifestFiles(t, f.paths); slices.Contains(files, child) || slices.Contains(files, added) {
		t.Fatalf("removed includes remain reserved: %v", files)
	}
}

func TestManifestReloadRejectsIncludeOwnedByAnotherStack(t *testing.T) {
	f := startReloadStack(t, reloadServiceBody("web", "original", "reload.localhost"))
	child := filepath.Join(filepath.Dir(f.path), "child.toml")
	if err := os.WriteFile(child, []byte("[services.worker]\ncommand = [\"sh\", \"-c\", \"sleep 60\"]\n[services.worker.health]\nprocess = true\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	owner := startStackOwner(t, f.paths.StateDirectoryPath, stackOwnerOptions{ManifestPath: child, ManifestFiles: []string{child}, Port: 4010, Behavior: stackOwnerStopsOnRequest})
	f.header = "includes = [\"child.toml\"]\n" + f.header
	f.write(t, reloadServiceBody("web", "replacement", "reload.localhost"))
	waitForCondition(t, 5*time.Second, func() bool { return f.logs.contains("configuration reload rejected") })
	if !f.logs.contains("already running") || !processExists(owner.Process.Pid) {
		t.Fatal("reload failed to preserve the other stack")
	}
	health, err := f.control.GetHealthResponse()
	if err != nil || len(health.Services) != 1 {
		t.Fatalf("rejected reload changed services: %#v, %v", health, err)
	}
	route := readRestartRoute(t, filepath.Join(f.paths.RegistrationsDirectoryPath, "reload.localhost_web_2f.json"))
	assertRestartResponse(t, serverURL(route.DocumentInjectionPort, "/"), "original")
}
