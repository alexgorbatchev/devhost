package services

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy/caddytest"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/devtools"
)

type shutdownHealthWriter struct {
	stopped chan struct{}
	resume  chan struct{}
}

func TestRuntimeHealthDiscardsProbeCompletedDuringShutdown(t *testing.T) {
	probing := make(chan struct{})
	resume := make(chan struct{})
	release := sync.OnceFunc(func() { close(resume) })
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(probing)
		<-resume
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()
	defer release()
	m := newResolvedManifest(t.TempDir(), "")
	m.Services["web"] = ResolvedService{
		Name: "web", Health: ResolvedHealthConfig{Kind: HealthKindHTTP, URL: &server.URL, Interval: int(time.Minute / time.Millisecond)},
	}
	runtime := &stackRuntime{manifest: &m}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() {
		_, err := runtime.health(ctx)
		done <- err
	}()
	select {
	case <-probing:
	case <-time.After(5 * time.Second):
		t.Fatal("health probe did not start")
	}
	cancel()
	release()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("health probe completed during shutdown: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("health probe did not finish")
	}
}

func (w *shutdownHealthWriter) Write(data []byte) (int, error) {
	if strings.Contains(string(data), "Stopped service web.") {
		close(w.stopped)
		<-w.resume
	}
	return len(data), nil
}

func TestStackShutdownDoesNotPublishServiceCrash(t *testing.T) {
	for _, sig := range []syscall.Signal{syscall.SIGINT, syscall.SIGTERM, syscall.SIGHUP} {
		t.Run(sig.String(), func(t *testing.T) {
			originalStart := startDevtoolsControlServer
			originalRegister, originalUnregister := registerProcessSignals, unregisterProcessSignals
			t.Cleanup(func() {
				startDevtoolsControlServer = originalStart
				registerProcessSignals, unregisterProcessSignals = originalRegister, originalUnregister
			})
			signals := make(chan chan<- os.Signal, 1)
			registerProcessSignals = func(ch chan<- os.Signal) { signals <- ch }
			unregisterProcessSignals = func(chan<- os.Signal) {}
			controls := make(chan devtools.StartControlServerOptions, 1)
			servers := make(chan *devtools.ControlServer, 1)
			startDevtoolsControlServer = func(options devtools.StartControlServerOptions) (*devtools.ControlServer, error) {
				server, err := originalStart(options)
				if err == nil {
					controls <- options
					servers <- server
				}
				return server, err
			}
			paths := caddy.CreateManagedCaddyPaths(t.TempDir())
			writeFakeCaddyExecutable(t, paths.ExecutablePath)
			m := newResolvedManifest(t.TempDir(), caddytest.StartAdminServer(t))
			m.Devtools.Status.Enabled = true
			m.Services["web"] = ResolvedService{
				Name: "web", Cwd: t.TempDir(), Command: helperCommandWithMode("wait-for-termination"),
				Env: map[string]string{"GO_WANT_HELPER_PROCESS": "1"}, Health: ResolvedHealthConfig{Kind: "process"},
			}
			output := &shutdownHealthWriter{stopped: make(chan struct{}), resume: make(chan struct{})}
			done := make(chan error, 1)
			go func() {
				_, err := startTestStack(t, &m, []string{"web"}, StartStackOptions{
					CaddyPaths: paths, LogWriter: output, ServiceStdoutWriter: io.Discard, ServiceStderrWriter: io.Discard,
				})
				done <- err
			}()
			ch := <-signals
			stop := sync.OnceFunc(func() { ch <- sig })
			t.Cleanup(func() {
				close(output.resume)
				stop()
				select {
				case err := <-done:
					if err != nil {
						t.Errorf("shutdown: %v", err)
					}
				case <-time.After(10 * time.Second):
					t.Error("shutdown did not finish")
				}
			})
			control, server := <-controls, <-servers
			waitForCondition(t, stackChangeTimeout, func() bool { return control.RestartService(nil) == nil })
			health, err := control.GetHealthResponse()
			if err != nil || len(health.Services) != 1 || !health.Services[0].Status {
				t.Fatalf("initial health = %#v, %v", health, err)
			}
			stop()
			select {
			case <-output.stopped:
			case <-time.After(5 * time.Second):
				t.Fatal("service did not stop")
			}
			// Hold cleanup after the child exits, while the browser's health stream is still open.
			if err := server.PublishHealthResponse(); !errors.Is(err, context.Canceled) {
				health, healthError := control.GetHealthResponse()
				t.Fatalf("shutdown published recovery health: %#v, publish error = %v, health error = %v", health, err, healthError)
			}
		})
	}
}
