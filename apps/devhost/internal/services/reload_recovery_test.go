package services

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestManifestReloadFailedRestorationRemainsManuallyRecoverable(t *testing.T) {
	body := strings.Replace(reloadServiceBody("web", "original", "reload.localhost"), "[services.web]", "[services.web]\nwatch = [\".\"]", 1)
	f := startReloadStack(t, body)
	marker := filepath.Join(filepath.Dir(f.path), "fail")
	if err := os.WriteFile(marker, nil, 0600); err != nil {
		t.Fatal(err)
	}
	f.write(t, reloadServiceBody("web", "replacement", "reload.localhost"))
	waitForCondition(t, 5*time.Second, func() bool { return f.logs.contains("restore previous services") })
	if _, err := f.control.GetToolContext("web"); err == nil {
		t.Fatal("failed restoration allowed a new tool launch")
	}
	f.write(t, body)
	if err := os.Remove(marker); err != nil {
		t.Fatal(err)
	}
	if err := f.control.RestartService([]string{"web"}); err != nil {
		t.Fatal(err)
	}
	health, err := f.control.GetHealthResponse()
	if err != nil || !health.Services[0].Status || health.Services[0].Restarting {
		t.Fatalf("manual recovery remained blocked: %#v, %v", health, err)
	}
	if _, err := f.control.GetToolContext("web"); err != nil {
		t.Fatalf("manual recovery left tool launches blocked: %v", err)
	}
	if err := os.WriteFile(filepath.Join(filepath.Dir(f.path), "watched.txt"), []byte("changed"), 0600); err != nil {
		t.Fatal(err)
	}
	waitForCondition(t, 3*time.Second, func() bool {
		health, err := f.control.GetHealthResponse()
		return err == nil && health.Services[0].Dirty
	})
}

func TestManifestReloadPreservesUnaffectedServiceRecoveryBlock(t *testing.T) {
	web := reloadServiceBody("web", "original", "reload.localhost")
	worker := strings.Replace(reloadServiceBody("worker", "original", "worker.localhost"), "command = ", "cwd = "+fmt.Sprintf("%q", t.TempDir())+"\ncommand = ", 1)
	body := web + worker
	f := startReloadStack(t, body)
	marker := filepath.Join(filepath.Dir(f.path), "fail")
	if err := os.WriteFile(marker, nil, 0600); err != nil {
		t.Fatal(err)
	}
	f.write(t, reloadServiceBody("web", "replacement", "reload.localhost")+worker)
	waitForCondition(t, 5*time.Second, func() bool { return f.logs.contains("restore previous services") })
	if _, err := f.control.GetToolContext("web"); err == nil {
		t.Fatal("failed restoration did not block tools")
	}
	f.write(t, web+strings.Replace(worker, "VALUE = \"original\"", "VALUE = \"replacement\"", 1))
	waitForCondition(t, 5*time.Second, func() bool { return f.logs.contains("configuration reloaded") })
	if _, err := f.control.GetToolContext("web"); err == nil {
		t.Fatal("unrelated accepted edit cleared the stopped service's recovery block")
	}
	if err := os.Remove(marker); err != nil {
		t.Fatal(err)
	}
	if err := f.control.RestartService([]string{"web"}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.control.GetToolContext("web"); err != nil {
		t.Fatalf("explicit recovery left tools blocked: %v", err)
	}
}
