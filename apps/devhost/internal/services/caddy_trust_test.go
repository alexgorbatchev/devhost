package services

import (
	"os"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy/caddytest"
)

func TestStartStackWarnsOnceAboutAnUntrustedLocalCA(t *testing.T) {
	t.Setenv("AGENT", "0")
	originalRegister, originalUnregister := registerProcessSignals, unregisterProcessSignals
	t.Cleanup(func() { registerProcessSignals, unregisterProcessSignals = originalRegister, originalUnregister })
	signals := make(chan chan<- os.Signal, 1)
	registerProcessSignals = func(ch chan<- os.Signal) { signals <- ch }
	unregisterProcessSignals = func(chan<- os.Signal) {}

	paths := caddy.CreateManagedCaddyPaths(t.TempDir())
	writeFakeCaddyExecutable(t, paths.ExecutablePath)
	caddytest.WriteUntrustedRootCertificate(t, paths.RootCertificatePath)
	m := newResolvedManifest(t.TempDir(), caddytest.StartAdminServer(t))
	m.Services["web"] = ResolvedService{
		Name: "web", Cwd: t.TempDir(), Command: helperCommandWithMode("exit-immediately"),
		Env: map[string]string{"GO_WANT_HELPER_PROCESS": "1"}, Health: ResolvedHealthConfig{Kind: "process"},
	}
	var output shutdownOutput
	finished := make(chan error, 1)
	go func() {
		_, err := startTestStack(t, &m, []string{"web"}, StartStackOptions{CaddyPaths: paths, LogWriter: &output})
		finished <- err
	}()
	ch := <-signals
	warning := "[hello-stack] [WARN] " + caddy.UntrustedRootCertificateWarning + "\n"
	waitForCondition(t, stackChangeTimeout, func() bool {
		return strings.Contains(output.snapshot(), warning)
	})
	ch <- syscall.SIGTERM
	select {
	case err := <-finished:
		if err != nil {
			t.Fatalf("StartStack: %v", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("shutdown did not finish")
	}
	if logs := output.snapshot(); strings.Count(logs, warning) != 1 {
		t.Fatalf("want exactly one untrusted local CA warning:\n%s", logs)
	}
}
