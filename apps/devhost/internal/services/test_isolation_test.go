package services

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy"
)

// A stack given an environment that names no devhost config file still reads the test process's own, so it can
// never reach the shared Caddy of the machine running the tests.
func TestStackWithoutAConfigCannotReachTheMachinesCaddy(t *testing.T) {
	stateDirectoryPath := t.TempDir()
	m := newResolvedManifest(t.TempDir(), "")
	m.Services["web"] = ResolvedService{Command: helperCommand(), Cwd: t.TempDir(), DependsOn: []string{}, Name: "web"}
	_, err := StartStack(&m, []string{"web"}, StartStackOptions{
		CaddyPaths:  caddy.CreateManagedCaddyPaths(stateDirectoryPath),
		Environment: map[string]string{"DEVHOST_STATE_DIR": stateDirectoryPath},
		LogWriter:   ioDiscard{},
	})
	if err == nil || !strings.Contains(err.Error(), "127.0.0.1:1/") {
		t.Fatalf("StartStack(...) error = %v, want the unreachable test admin endpoint", err)
	}
}

func TestServiceHelpersKeepTheirOwnedHomeAndScratch(t *testing.T) {
	for _, override := range []bool{false, true} {
		t.Run(map[bool]string{false: "inherited", true: "explicit-state"}[override], func(t *testing.T) {
			scratch := t.TempDir()
			t.Setenv("TMPDIR", scratch)
			path := filepath.Join(scratch, "environment.json")
			environment := map[string]string{"TMPDIR": scratch}
			state := os.Getenv("DEVHOST_STATE_DIR")
			if override {
				state = filepath.Join(scratch, "state")
				environment["DEVHOST_STATE_DIR"] = state
			}
			service := ResolvedService{
				Name: "isolation", Cwd: scratch,
				Command: []string{os.Args[0], "-test.run=^TestIsolationServiceHelperProcess$"},
				Env:     map[string]string{"DEVHOST_ISOLATION_REPORT": path},
			}
			started, err := startTestServiceProcess(ResolvedManifest{}, service, processStartOptions{
				environment: environment, stdoutWriter: ioDiscard{}, stderrWriter: ioDiscard{},
			})
			if err != nil {
				t.Fatal(err)
			}
			stop := sync.OnceFunc(func() {
				if err := stopStartedService(started, time.Second); err != nil {
					t.Error(err)
				}
			})
			t.Cleanup(stop)
			waitForCondition(t, time.Second, func() bool { _, err := os.Stat(path); return err == nil })
			data, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			var reported map[string]string
			if err := json.Unmarshal(data, &reported); err != nil {
				t.Fatal(err)
			}
			for name, want := range map[string]string{
				"HOME": os.Getenv("HOME"), "TMPDIR": scratch, "DEVHOST_STATE_DIR": state, "DEVHOST_TEST_RUN_ID": os.Getenv("DEVHOST_TEST_RUN_ID"),
			} {
				if reported[name] != want {
					t.Errorf("helper %s = %q, want %q", name, reported[name], want)
				}
			}
			stop()
			entries, err := os.ReadDir(scratch)
			if err != nil {
				t.Fatal(err)
			}
			for _, entry := range entries {
				if strings.HasPrefix(entry.Name(), "devhost-home-") {
					t.Errorf("terminated helper left %s", entry.Name())
				}
			}
		})
	}
}

func TestIsolationServiceHelperProcess(t *testing.T) {
	path := os.Getenv("DEVHOST_ISOLATION_REPORT")
	if path == "" {
		return
	}
	data, err := json.Marshal(map[string]string{
		"HOME": os.Getenv("HOME"), "TMPDIR": os.Getenv("TMPDIR"), "DEVHOST_STATE_DIR": os.Getenv("DEVHOST_STATE_DIR"), "DEVHOST_TEST_RUN_ID": os.Getenv("DEVHOST_TEST_RUN_ID"),
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
	for {
		time.Sleep(time.Hour)
	}
}
