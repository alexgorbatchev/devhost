package services

import (
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/devtools"
	"github.com/gorilla/websocket"
)

func TestStartStackKeepsExitedServicesRestartable(t *testing.T) {
	for _, code := range []int{0, 7} {
		t.Run(strconv.Itoa(code), func(t *testing.T) {
			statePath := t.TempDir()
			paths := caddy.CreateManagedCaddyPaths(statePath)
			admin, stopAdmin := startTestAdminServer(t)
			defer stopAdmin()
			writeFakeCaddyExecutable(t, paths.ExecutablePath)

			originalStart, originalRegister, originalUnregister := startDevtoolsControlServer, registerProcessSignals, unregisterProcessSignals
			defer func() {
				startDevtoolsControlServer, registerProcessSignals, unregisterProcessSignals = originalStart, originalRegister, originalUnregister
			}()
			signals := make(chan chan<- os.Signal, 1)
			registerProcessSignals = func(ch chan<- os.Signal) { signals <- ch }
			unregisterProcessSignals = func(chan<- os.Signal) {}
			controlOptions := make(chan devtools.StartControlServerOptions, 1)
			controlPorts := make(chan int, 1)
			startDevtoolsControlServer = func(options devtools.StartControlServerOptions) (*devtools.ControlServer, error) {
				server, err := devtools.StartControlServer(options)
				if err == nil {
					controlOptions <- options
					controlPorts <- server.Port()
				}
				return server, err
			}

			triggerPath := filepath.Join(t.TempDir(), "exit")
			pidPath := filepath.Join(t.TempDir(), "pid")
			failPath := filepath.Join(t.TempDir(), "fail")
			servicePort := mustReservePort(t)
			m := newResolvedManifest(t.TempDir(), admin)
			m.PrimaryService = "web"
			m.ServiceOrder = []string{"web", "worker"}
			m.Devtools.Status.Enabled = true
			m.Services["web"] = ResolvedService{
				Name: "web", BindHost: "127.0.0.1", Cwd: t.TempDir(),
				Command: []string{os.Args[0], "-test.run=TestRecoveryServiceHelperProcess", "--"},
				Env:     map[string]string{"DEVHOST_RECOVERY_HELPER": "1", "EXIT_PATH": triggerPath, "PID_PATH": pidPath, "FAIL_PATH": failPath, "EXIT_CODE": strconv.Itoa(code)},
				Health:  ResolvedHealthConfig{Kind: "tcp", Host: stringPointer("127.0.0.1"), Port: intPointer(servicePort), Timeout: 2000, Interval: 20},
				Hosts:   []string{"recover.localhost"}, Port: intPointer(servicePort), PortSource: "fixed", InjectPort: true,
			}
			m.Services["worker"] = ResolvedService{Name: "worker", Cwd: t.TempDir(), Command: helperCommandWithMode("graceful-signal-waiter"), Env: map[string]string{"GO_WANT_HELPER_PROCESS": "1", "STOP_TRACE_PATH": filepath.Join(t.TempDir(), "worker-stop"), "STOP_TRACE_VALUE": "stopped"}, Health: ResolvedHealthConfig{Kind: "process"}}

			done := make(chan error, 1)
			go func() {
				_, err := StartStack(&m, m.ServiceOrder, StartStackOptions{CaddyPaths: paths, Environment: map[string]string{"DEVHOST_STATE_DIR": statePath}, LogWriter: io.Discard, ServiceStdoutWriter: io.Discard, ServiceStderrWriter: io.Discard, ShutdownGracePeriod: 100 * time.Millisecond})
				done <- err
			}()
			signalChannel := <-signals
			defer func() {
				signalChannel <- syscall.SIGTERM
				select {
				case err := <-done:
					if err != nil {
						t.Errorf("shutdown: %v", err)
					}
				case <-time.After(5 * time.Second):
					t.Error("stack did not shut down")
				}
			}()
			options, port := <-controlOptions, <-controlPorts
			waitForCondition(t, 5*time.Second, func() bool { _, err := os.Stat(pidPath); return err == nil })
			firstPID, err := os.ReadFile(pidPath)
			if err != nil {
				t.Fatal(err)
			}
			waitForCondition(t, 5*time.Second, func() bool {
				_, err := os.Stat(filepath.Join(paths.RoutesDirectoryPath, "recover.localhost.caddy"))
				return err == nil
			})
			waitForCondition(t, 5*time.Second, func() bool {
				h, _ := options.GetHealthResponse()
				return h.Services[0].Status && h.Services[1].Status
			})
			if err := os.WriteFile(triggerPath, nil, 0o600); err != nil {
				t.Fatal(err)
			}
			waitForCondition(t, 5*time.Second, func() bool { h, _ := options.GetHealthResponse(); return h.Services[0].ExitCode != nil })
			select {
			case err := <-done:
				t.Fatalf("stack exited after service exit: %v", err)
			default:
			}
			h, err := options.GetHealthResponse()
			if err != nil {
				t.Fatal(err)
			}
			if h.Services[0].ExitCode == nil || *h.Services[0].ExitCode != code {
				t.Fatalf("exit code missing from health: %#v", h.Services[0])
			}
			if !h.Services[1].Status {
				t.Fatal("worker stopped after web exited")
			}
			if _, err := os.Stat(filepath.Join(paths.RoutesDirectoryPath, "recover.localhost.caddy")); err != nil {
				t.Fatalf("route removed: %v", err)
			}
			logs, _, err := websocket.DefaultDialer.Dial(fmt.Sprintf("ws://127.0.0.1:%d/__devhost__/ws/logs", port), nil)
			if err != nil {
				t.Fatal(err)
			}
			defer logs.Close()
			if err := logs.SetReadDeadline(time.Now().Add(5 * time.Second)); err != nil {
				t.Fatal(err)
			}
			_, data, err := logs.ReadMessage()
			if err != nil {
				t.Fatal(err)
			}
			var snapshot struct {
				Entries []devtools.ServiceLogEntry `json:"entries"`
			}
			if err := json.Unmarshal(data, &snapshot); err != nil {
				t.Fatal(err)
			}
			found := false
			for _, entry := range snapshot.Entries {
				if entry.ServiceName == "web" && entry.Line == "[web] service ready" {
					found = true
				}
			}
			if !found {
				t.Fatalf("service logs unavailable: %s", data)
			}
			response, err := http.Get(serverURL(port, "/__devhost__/inject.js"))
			if err != nil {
				t.Fatal(err)
			}
			response.Body.Close()
			if response.StatusCode != http.StatusOK {
				t.Fatalf("injected UI unavailable: %d", response.StatusCode)
			}
			if err := os.Remove(triggerPath); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(failPath, nil, 0o600); err != nil {
				t.Fatal(err)
			}
			if err := options.RestartService([]string{"web"}); err == nil {
				t.Fatal("failed restart unexpectedly succeeded")
			}
			h, err = options.GetHealthResponse()
			if err != nil {
				t.Fatal(err)
			}
			if h.Services[0].Restarting || h.Services[0].Status || h.Services[0].ExitCode == nil {
				t.Fatalf("failed restart left invalid health: %#v", h.Services[0])
			}
			if err := os.Remove(failPath); err != nil {
				t.Fatal(err)
			}
			if err := options.RestartService([]string{"web"}); err != nil {
				t.Fatalf("restart exited service: %v", err)
			}
			waitForCondition(t, 5*time.Second, func() bool { pid, _ := os.ReadFile(pidPath); return string(pid) != string(firstPID) })
			h, err = options.GetHealthResponse()
			if err != nil {
				t.Fatal(err)
			}
			if !h.Services[0].Status || !h.Services[1].Status {
				t.Fatalf("services after restart: %#v", h.Services)
			}
			if h.Services[0].ExitCode != nil {
				t.Fatalf("recovered service retains exit code: %#v", h.Services[0])
			}
		})
	}
}

func TestRecoveryServiceHelperProcess(t *testing.T) {
	if os.Getenv("DEVHOST_RECOVERY_HELPER") != "1" {
		return
	}
	if _, err := os.Stat(os.Getenv("FAIL_PATH")); err == nil {
		os.Exit(1)
	}
	listener, err := net.Listen("tcp", net.JoinHostPort("127.0.0.1", os.Getenv("PORT")))
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}
	if path := os.Getenv("COLLISION_PATH"); path != "" {
		if _, err := os.Stat(path); err == nil {
			// Force a real bind collision for exactly one startup attempt.
			_, collisionError := net.Listen("tcp", listener.Addr().String())
			fmt.Fprintln(os.Stderr, collisionError)
			if err := os.Remove(path); err != nil {
				os.Exit(3)
			}
			os.Exit(2)
		}
	}
	go func() {
		_ = http.Serve(listener, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/asset.js" {
				w.Header().Set("content-type", "application/javascript")
			} else {
				w.Header().Set("content-type", "text/html")
			}
			_, _ = fmt.Fprintf(w, "ready on %s", os.Getenv("PORT"))
		}))
	}()
	if err := os.WriteFile(os.Getenv("PID_PATH"), []byte(strconv.Itoa(os.Getpid())), 0o600); err != nil {
		os.Exit(2)
	}
	fmt.Println("service ready")
	for {
		if _, err := os.Stat(os.Getenv("EXIT_PATH")); err == nil {
			fmt.Fprintln(os.Stderr, "service exited")
			code, _ := strconv.Atoi(os.Getenv("EXIT_CODE"))
			os.Exit(code)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

// Existing route/startup tests stop the supervisor explicitly after observing a child exit.
func startStackUntilServiceExit(t *testing.T, m *ResolvedManifest, order []string, options StartStackOptions) (int, error) {
	t.Helper()
	originalRegister, originalUnregister := registerProcessSignals, unregisterProcessSignals
	defer func() { registerProcessSignals, unregisterProcessSignals = originalRegister, originalUnregister }()
	var signals chan<- os.Signal
	registerProcessSignals = func(ch chan<- os.Signal) { signals = ch }
	unregisterProcessSignals = func(chan<- os.Signal) {}
	options.LogWriter = &exitShutdownWriter{writer: options.LogWriter, signal: func() { signals <- syscall.SIGTERM }}
	return StartStack(m, order, options)
}

type exitShutdownWriter struct {
	writer io.Writer
	signal func()
	once   sync.Once
}

func (w *exitShutdownWriter) Write(p []byte) (int, error) {
	n, err := w.writer.Write(p)
	if strings.Contains(string(p), "exited with code") {
		w.once.Do(w.signal)
	}
	return n, err
}
