package caddy

import (
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/browsertest"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/nettest"
)

func TestStackDirectorySurvivesBackendWithdrawal(t *testing.T) {
	executable, err := exec.LookPath("caddy")
	if err != nil {
		t.Skip("native Caddy is unavailable")
	}
	paths := CreateManagedCaddyPaths(browsertest.RunDirectory(t, "stack-directory-caddy"))
	ports := nettest.ReservePorts(t, 2)
	settings := DefaultManagedCaddyGlobalSettings()
	settings.AdminAddress = fmt.Sprintf("127.0.0.1:%d", ports[0])
	settings.HTTPSPort = ports[1]
	if err := EnsureManagedCaddyConfig(paths, settings, runtime.GOOS); err != nil {
		t.Fatal(err)
	}
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/__devhost__/stacks" || r.URL.Query().Get("q") != "api" || r.Host != fmt.Sprintf("%s:%d", StackDirectoryHost, settings.HTTPSPort) {
			t.Errorf("unexpected directory forwarding: %s %s", r.Host, r.URL)
		}
		fmt.Fprint(w, "running project")
	}))
	defer backend.Close()
	port, err := strconv.Atoi(strings.TrimPrefix(backend.URL, "http://127.0.0.1:"))
	if err != nil {
		t.Fatal(err)
	}
	if err := RegisterStack(RegisterStackOptions{StackName: "project", ManifestPath: filepath.Join(paths.StateDirectoryPath, "devhost.toml"), ControlPort: port, StacksDirectoryPath: paths.StacksDirectoryPath}); err != nil {
		t.Fatal(err)
	}
	if err := syncStackDirectorySite(paths, settings.HTTPSPort); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		result := RunCommand([]string{executable, "stop", "--address", settings.AdminAddress}, RunCommandOptions{})
		if !result.Success {
			t.Errorf("stop owned Caddy: %s", result.Stderr)
		}
	})
	result := RunCommand([]string{executable, "start", "--pidfile", paths.PidFilePath, "--config", paths.CaddyfilePath, "--adapter", "caddyfile"}, RunCommandOptions{Background: true, WorkingDir: paths.CaddyDirectoryPath})
	if !result.Success {
		t.Fatalf("start Caddy: %s", result.Stderr)
	}
	if err := writeAppliedManagedCaddySettings(paths, settings); err != nil {
		t.Fatal(err)
	}
	client := &http.Client{Transport: &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}}, Timeout: 5 * time.Second}
	defer client.CloseIdleConnections()
	read := func(path string, want int) string {
		t.Helper()
		r, err := http.NewRequest(http.MethodGet, fmt.Sprintf("https://127.0.0.1:%d%s", settings.HTTPSPort, path), nil)
		if err != nil {
			t.Fatal(err)
		}
		r.Host = fmt.Sprintf("%s:%d", StackDirectoryHost, settings.HTTPSPort)
		response, err := client.Do(r)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		if response.StatusCode != want {
			t.Fatalf("status %d, want %d", response.StatusCode, want)
		}
		data, err := io.ReadAll(response.Body)
		if err != nil {
			t.Fatal(err)
		}
		return string(data)
	}
	if got := read("/?q=api", http.StatusOK); got != "running project" {
		t.Fatalf("directory response: %q", got)
	}
	read("/__devhost__/restart-stack", http.StatusNotFound)
	request, err := http.NewRequest(http.MethodPost, fmt.Sprintf("https://127.0.0.1:%d/", settings.HTTPSPort), nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Host = fmt.Sprintf("%s:%d", StackDirectoryHost, settings.HTTPSPort)
	response, err := client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusMethodNotAllowed || response.Header.Get("Allow") != "GET, HEAD" {
		t.Fatalf("unsafe directory method: %d, %v", response.StatusCode, response.Header)
	}
	second := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, "other project")
	}))
	defer second.Close()
	secondPort, err := strconv.Atoi(strings.TrimPrefix(second.URL, "http://127.0.0.1:"))
	if err != nil {
		t.Fatal(err)
	}
	other := stackRecord{StackName: "z-other", ManifestPath: "/other/devhost.toml", OwnerPID: os.Getppid(), ControlPort: secondPort}
	data, err := json.Marshal(other)
	if err != nil {
		t.Fatal(err)
	}
	otherPath := filepath.Join(paths.StacksDirectoryPath, "other.json")
	if err := os.WriteFile(otherPath, data, 0600); err != nil {
		t.Fatal(err)
	}
	if err := SyncStackDirectory(paths, RouteCommandOutputWriters{}); err != nil {
		t.Fatal(err)
	}
	backend.Close()
	if got := read("/?q=api", http.StatusOK); got != "other project" {
		t.Fatalf("directory did not fail over: %q", got)
	}
	second.Close()
	if got := read("/", http.StatusServiceUnavailable); !strings.Contains(got, "Start or restart a devhost stack") {
		t.Fatalf("missing unavailable-directory recovery instruction: %q", got)
	}
	if err := SetStackControlPort(paths, 0); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(otherPath); err != nil {
		t.Fatal(err)
	}
	if err := SyncStackDirectory(paths, RouteCommandOutputWriters{}); err != nil {
		t.Fatal(err)
	}
	if body := read("/", http.StatusOK); !strings.Contains(body, "No stacks running") {
		t.Fatal("last backend withdrawal did not serve the empty directory")
	}
	if err := ClaimHost(ClaimHostOptions{Host: StackDirectoryHost, ManifestPath: "other.toml", RegistrationsDirectoryPath: paths.RegistrationsDirectoryPath}); err == nil {
		t.Fatal("project claimed directory hostname")
	}
}

func TestReadLiveStacksSkipsStaleOwners(t *testing.T) {
	paths := newManagedCaddyPaths(t)
	if err := RegisterStack(RegisterStackOptions{StackName: "live", ManifestPath: "/project/devhost.toml", ControlPort: 3000, StacksDirectoryPath: paths.StacksDirectoryPath}); err != nil {
		t.Fatal(err)
	}
	data := fmt.Sprintf(`{"createdAt":"2026-10-25T00:00:00Z","manifestPath":"/stale/devhost.toml","ownerPid":%d,"ownerStartIdentity":"a-different-process","stackName":"stale"}`, os.Getpid())
	if err := os.WriteFile(filepath.Join(paths.StacksDirectoryPath, "stale.json"), []byte(data), 0600); err != nil {
		t.Fatal(err)
	}
	stacks, err := ReadLiveStacks(paths)
	if err != nil || len(stacks) != 1 || stacks[0].Name != "live" || stacks[0].ControlPort != 3000 {
		t.Fatalf("live stacks: %+v, %v", stacks, err)
	}
}
