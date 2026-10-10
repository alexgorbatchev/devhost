package services

import (
	"bytes"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy/caddytest"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/nettest"
)

type shutdownOutput struct {
	mu sync.Mutex
	bytes.Buffer
}

func (w *shutdownOutput) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.Buffer.Write(p)
}

func (w *shutdownOutput) snapshot() string {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.Buffer.String()
}

func playgroundShutdownService(t *testing.T, app string, port int) ResolvedService {
	t.Helper()
	cwd, err := filepath.Abs(filepath.Join("../../../..", "packages/playground", app))
	if err != nil {
		t.Fatal(err)
	}
	return ResolvedService{
		Name: "playground-" + app, Cwd: cwd, Command: []string{"just", "dev"},
		BindHost: "127.0.0.1", Port: &port, InjectPort: true,
		Env:    map[string]string{"NODE_ENV": "development"},
		Health: ResolvedHealthConfig{Kind: "tcp", Host: stringPointer("127.0.0.1"), Port: &port, Timeout: 5000},
	}
}

func TestPlaygroundStackShutdownOutput(t *testing.T) {
	for _, sig := range []syscall.Signal{syscall.SIGINT, syscall.SIGTERM} {
		t.Run(sig.String(), func(t *testing.T) {
			originalRegister, originalUnregister := registerProcessSignals, unregisterProcessSignals
			defer func() { registerProcessSignals, unregisterProcessSignals = originalRegister, originalUnregister }()
			signals := make(chan chan<- os.Signal, 1)
			registerProcessSignals = func(ch chan<- os.Signal) { signals <- ch }
			unregisterProcessSignals = func(chan<- os.Signal) {}

			paths := caddy.CreateManagedCaddyPaths(t.TempDir())
			writeFakeCaddyExecutable(t, paths.ExecutablePath)
			m := newResolvedManifest(t.TempDir(), caddytest.StartAdminServer(t))
			ports := nettest.ReservePorts(t, 2)
			order := []string{"playground-backend", "playground-frontend"}
			for i, name := range order {
				m.Services[name] = playgroundShutdownService(t, strings.TrimPrefix(name, "playground-"), ports[i])
			}
			var output shutdownOutput
			finished := make(chan error, 1)
			go func() {
				code, err := StartStack(&m, order, StartStackOptions{
					CaddyPaths: paths, LogWriter: &output, ServiceStdoutWriter: &output, ServiceStderrWriter: &output,
				})
				if err == nil && code != readSignalExitCode(sig) {
					err = fmt.Errorf("exit code = %d, want %d", code, readSignalExitCode(sig))
				}
				finished <- err
			}()
			ch := <-signals
			defer func() {
				if ch != nil {
					ch <- sig
					<-finished
				}
			}()
			waitForCondition(t, 10*time.Second, func() bool {
				for _, port := range ports {
					if !CheckServiceHealth(ResolvedHealthConfig{Kind: "tcp", Host: stringPointer("127.0.0.1"), Port: &port, Timeout: 100}) {
						return false
					}
				}
				return true
			})
			ch <- sig
			err := <-finished
			ch = nil
			if err != nil {
				t.Fatalf("shutdown: %v\n%s", err, output.snapshot())
			}
			logs := output.snapshot()
			t.Logf("shutdown output:\n%s", logs)
			if strings.Contains(strings.ToLower(logs), "error: recipe") {
				t.Errorf("normal shutdown reported a recipe error:\n%s", logs)
			}
			if strings.Count(logs, "[hello-stack] Stack stopped.\n") != 1 {
				t.Errorf("want exactly one stack completion line:\n%s", logs)
			}
			for _, name := range order {
				for _, message := range []string{"Stopping service " + name + "...", "Stopped service " + name + "."} {
					if strings.Count(logs, "[hello-stack] "+message+"\n") != 1 {
						t.Errorf("want exactly one %q line:\n%s", message, logs)
					}
				}
				if CheckServiceHealth(m.Services[name].Health) {
					t.Errorf("%s still accepts connections after shutdown", name)
				}
			}
		})
	}
}

func TestPlaygroundStartupFailureKeepsDiagnostics(t *testing.T) {
	for _, app := range []string{"backend", "frontend"} {
		t.Run(app, func(t *testing.T) {
			port := nettest.ReservePort(t)
			// Bun listens on the IPv4 wildcard address. Occupy that same address:
			// macOS can allow a wildcard listener alongside a loopback-only listener.
			listener, err := net.Listen("tcp4", fmt.Sprintf("0.0.0.0:%d", port))
			if err != nil {
				t.Fatal(err)
			}
			defer listener.Close()
			var output shutdownOutput
			service := playgroundShutdownService(t, app, port)
			started, err := startServiceProcess(ResolvedManifest{}, service, processStartOptions{
				environment: readCurrentEnvironment(), stdoutWriter: &output, stderrWriter: &output,
			})
			if err != nil {
				t.Fatal(err)
			}
			defer func() {
				if err := stopStartedService(started, time.Second); err != nil {
					t.Error(err)
				}
			}()
			if !waitForExitWithinGracePeriod(started, 5*time.Second) {
				t.Fatalf("service did not exit after its port collision:\n%s", output.snapshot())
			}
			started.wait()
			if started.exitCodeValue() == 0 || !strings.Contains(output.snapshot(), "EADDRINUSE") {
				t.Fatalf("startup failure lost its exit code or diagnostics: code=%d\n%s", started.exitCodeValue(), output.snapshot())
			}
		})
	}
}

func TestDaemonShutdownProgressReportsOnlySuccessfulCleanup(t *testing.T) {
	for _, mode := range []string{"exit-immediately", "exit-1"} {
		t.Run(mode, func(t *testing.T) {
			var output shutdownOutput
			service := ResolvedService{
				Name: "daemon", Cwd: t.TempDir(),
				Env:       map[string]string{"GO_WANT_HELPER_PROCESS": "1"},
				Lifecycle: ResolvedServiceLifecycle{Mode: "daemon", Stop: helperCommandWithMode(mode)},
			}
			options := StartStackOptions{
				LogWriter: &output, ServiceStdoutWriter: &output, ServiceStderrWriter: &output,
			}
			err := stopDaemonLifecycleServices(ResolvedManifest{Name: "test-stack"}, []daemonLifecycleService{{service: service}}, options, readCurrentEnvironment(), nil)
			logs := output.snapshot()
			if strings.Count(logs, "[test-stack] Stopping service daemon...\n") != 1 {
				t.Fatalf("missing daemon shutdown announcement:\n%s", logs)
			}
			wantSuccess := mode == "exit-immediately"
			if (err == nil) != wantSuccess || strings.Contains(logs, "Stopped service daemon.") != wantSuccess {
				t.Fatalf("cleanup result and progress disagree: error=%v\n%s", err, logs)
			}
		})
	}
}

func TestShutdownProgressGroupsProcessesOfOneService(t *testing.T) {
	var output shutdownOutput
	progress := newShutdownProgress(&output, "test-stack")
	var processes []*startedService
	defer func() {
		for _, started := range processes {
			if err := stopStartedService(started, time.Second); err != nil {
				t.Error(err)
			}
		}
	}()
	for range 2 {
		service := ResolvedService{
			Name: "worker", Cwd: t.TempDir(), Command: helperCommandWithMode("exit-immediately"),
			Env: map[string]string{"GO_WANT_HELPER_PROCESS": "1"},
		}
		started, err := startServiceProcess(ResolvedManifest{}, service, processStartOptions{stdoutWriter: &output, stderrWriter: &output})
		if err != nil {
			t.Fatal(err)
		}
		processes = append(processes, started)
		started.wait()
		progress.stopping(started.service.Name)
	}
	if err := stopStartedServices(processes, time.Second, progress.stopped); err != nil {
		t.Fatal(err)
	}
	want := "[test-stack] Stopping service worker...\n[test-stack] Stopped service worker.\n"
	if logs := output.snapshot(); logs != want {
		t.Fatalf("shutdown progress = %q, want %q", logs, want)
	}
}
