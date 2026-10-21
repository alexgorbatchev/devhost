package services

import (
	"strings"
	"testing"

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
