package services

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/nettest"
)

func TestFileServiceLifecycle(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "hello.txt")
	if err := os.WriteFile(file, []byte("first version"), 0o644); err != nil {
		t.Fatal(err)
	}
	service := ResolvedService{Name: "files", Serve: dir, Cwd: dir, BindHost: "127.0.0.1", Port: new(nettest.ReservePort(t)), Managed: true}
	url := fmt.Sprintf("http://127.0.0.1:%d/hello.txt", *service.Port)
	for _, version := range []string{"first version", "second version"} {
		if err := os.WriteFile(file, []byte(version), 0o644); err != nil {
			t.Fatal(err)
		}
		started, err := startServiceProcess(ResolvedManifest{}, service, processStartOptions{})
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() {
			if err := stopStartedService(started, time.Second); err != nil {
				t.Error(err)
			}
		})
		resp, err := http.Get(url)
		if err != nil {
			t.Fatal(err)
		}
		body, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil || string(body) != version {
			t.Fatalf("body = %q, error = %v", body, err)
		}
		if err := stopStartedServices([]*startedService{started}, time.Second, nil); err != nil {
			t.Fatal(err)
		}
		if started.ReadExitCode() == nil || !started.isStopped() {
			t.Fatal("file service did not exit")
		}
		resp, err = http.Get(url)
		if err == nil {
			resp.Body.Close()
			t.Fatal("stopped file server still answers")
		}
	}
}

func TestFileServicePreflight(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "file.txt")
	if err := os.WriteFile(file, []byte("file"), 0o644); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{filepath.Join(dir, "missing"), file} {
		if err := validateServiceWorkingDirectory(ResolvedService{Name: "files", Serve: path}); err == nil {
			t.Fatalf("accepted invalid directory %q", path)
		}
	}
}

func TestFileServiceReloadAndRestart(t *testing.T) {
	first, second := t.TempDir(), t.TempDir()
	for dir, body := range map[string]string{first: "first directory", second: "second directory"} {
		if err := os.WriteFile(filepath.Join(dir, "index.html"), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	body := func(dir string) string {
		return fmt.Sprintf("\n[services.files]\nserve = %q\nhost = 'files.localhost'\n", dir)
	}
	f := startReloadStack(t, body(first))
	routePath := filepath.Join(f.paths.RegistrationsDirectoryPath, "files.localhost_files_2f.json")
	original := readRestartRoute(t, routePath)
	assertRestartResponse(t, serverURL(original.AppPort, "/"), "first directory")
	if err := f.control.RestartService([]string{"files"}); err != nil {
		t.Fatal(err)
	}
	assertRestartResponse(t, serverURL(original.AppPort, "/"), "first directory")
	f.write(t, body(second))
	waitForCondition(t, stackChangeTimeout, func() bool { return f.logs.contains("configuration reloaded") })
	next := readRestartRoute(t, routePath)
	if next.AppPort != original.AppPort {
		t.Fatal("directory reload changed the automatic port")
	}
	assertRestartResponse(t, serverURL(next.AppPort, "/"), "second directory")
	f.write(t, body(filepath.Join(second, "missing")))
	waitForCondition(t, stackChangeTimeout, func() bool { return f.logs.contains("cannot access serve directory") })
	assertRestartResponse(t, serverURL(next.AppPort, "/"), "second directory")
	f.stop()
	resp, err := http.Get(serverURL(next.AppPort, "/"))
	if err == nil {
		resp.Body.Close()
		t.Fatal("stack shutdown left the file server running")
	}
}
