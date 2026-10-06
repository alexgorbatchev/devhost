package services

import (
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/devtools"
)

func TestStackSwitchesWholeRepositoryAndRecoversFailedSwitch(t *testing.T) {
	root, linked := createWorktreeRepository(t)
	m := worktreeTestManifest(root)
	admin, stopAdmin := startTestAdminServer(t)
	defer stopAdmin()
	base := newResolvedManifest(root, admin)
	m.Caddy, m.Devtools, m.Name = base.Caddy, base.Devtools, "worktrees"
	m.Devtools.Status.Enabled, m.PrimaryService = true, "web"
	state := t.TempDir()
	trace := filepath.Join(state, "trace")
	paths := caddy.CreateManagedCaddyPaths(state)
	writeFakeCaddyExecutable(t, paths.ExecutablePath)
	for name, service := range m.Services {
		port := mustReservePort(t)
		service.Command = []string{os.Args[0], "-test.run=TestWorktreeServiceHelperProcess", "--"}
		service.BindHost, service.Port, service.PortSource, service.InjectPort = "127.0.0.1", &port, "fixed", true
		service.Health = ResolvedHealthConfig{Kind: "tcp", Host: stringPointer("127.0.0.1"), Port: &port, Interval: 10, Timeout: 1000}
		service.Env = map[string]string{"DEVHOST_WORKTREE_HELPER": "1", "TRACE_PATH": trace}
		service.Watch = []string{"."}
		if name == "web" {
			service.Hosts = []string{"worktree.localhost"}
		}
		m.Services[name] = service
	}
	configured := m
	originalStart, originalRegister, originalUnregister := startDevtoolsControlServer, registerProcessSignals, unregisterProcessSignals
	defer func() {
		startDevtoolsControlServer, registerProcessSignals, unregisterProcessSignals = originalStart, originalRegister, originalUnregister
	}()
	controls := make(chan devtools.StartControlServerOptions, 1)
	signals := make(chan chan<- os.Signal, 1)
	startDevtoolsControlServer = func(options devtools.StartControlServerOptions) (*devtools.ControlServer, error) {
		s, err := devtools.StartControlServer(options)
		if err == nil {
			controls <- options
		}
		return s, err
	}
	registerProcessSignals = func(ch chan<- os.Signal) { signals <- ch }
	unregisterProcessSignals = func(chan<- os.Signal) {}
	launch := func() (devtools.StartControlServerOptions, func()) {
		done := make(chan error, 1)
		go func() {
			_, err := StartStack(&m, m.ServiceOrder, StartStackOptions{CaddyPaths: paths, Environment: map[string]string{"DEVHOST_STATE_DIR": state}, LogWriter: io.Discard, ServiceStdoutWriter: io.Discard, ServiceStderrWriter: io.Discard, ShutdownGracePeriod: time.Second})
			done <- err
		}()
		ch := <-signals
		options := <-controls
		waitForCondition(t, 5*time.Second, func() bool {
			h, _ := options.GetHealthResponse()
			return len(h.Repositories) == 1 && (h.Repositories[0].RunningPath != "" || h.Repositories[0].Error != "") && options.RestartService(nil) == nil
		})
		return options, func() {
			ch <- syscall.SIGTERM
			select {
			case err := <-done:
				if err != nil {
					t.Error(err)
				}
			case <-time.After(5 * time.Second):
				t.Error("shutdown timed out")
			}
		}
	}
	options, stop := launch()
	defer func() {
		if stop != nil {
			stop()
		}
	}()
	health, err := options.GetHealthResponse()
	if err != nil {
		t.Fatal(err)
	}
	id := health.Repositories[0].ID
	if err := os.RemoveAll(filepath.Join(linked, "api")); err != nil {
		t.Fatal(err)
	}
	if err := options.SwitchWorktree(id, linked); err == nil {
		t.Fatal("missing service directory accepted")
	}
	for _, name := range m.ServiceOrder {
		assertRestartResponse(t, serverURL(*m.Services[name].Port, "/"), filepath.Join(root, name))
	}
	runWorktreeGit(t, linked, "restore", "api")
	if err := options.SwitchWorktree(id, linked); err != nil {
		t.Fatal(err)
	}
	for _, name := range m.ServiceOrder {
		assertRestartResponse(t, serverURL(*m.Services[name].Port, "/"), filepath.Join(linked, name))
	}
	traceBytes, err := os.ReadFile(trace)
	if err != nil {
		t.Fatal(err)
	}
	want := fmt.Sprintf("start api %s\nstart web %s\nstop web %s\nstop api %s\nstart api %s\nstart web %s\n", filepath.Join(root, "api"), filepath.Join(root, "web"), filepath.Join(root, "web"), filepath.Join(root, "api"), filepath.Join(linked, "api"), filepath.Join(linked, "web"))
	if string(traceBytes) != want {
		t.Fatalf("dependency lifecycle:\n%s\nwant:\n%s", traceBytes, want)
	}
	if err := os.WriteFile(filepath.Join(linked, "web", "source.txt"), []byte("changed"), 0o600); err != nil {
		t.Fatal(err)
	}
	waitForCondition(t, time.Second, func() bool { h, _ := options.GetHealthResponse(); return h.Services[1].Dirty })
	if err := options.RestartService([]string{"web"}); err != nil {
		t.Fatal(err)
	}
	assertRestartResponse(t, serverURL(*m.Services["web"].Port, "/"), filepath.Join(linked, "web"))
	if err := os.WriteFile(filepath.Join(root, "web", "fail"), nil, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := options.SwitchWorktree(id, root); err == nil {
		t.Fatal("failed launch reported success")
	}
	health, _ = options.GetHealthResponse()
	if health.Repositories[0].SelectedPath != root || health.Repositories[0].RunningPath != "" || health.Repositories[0].Switching || health.Repositories[0].Error == "" {
		t.Fatalf("failed switch = %#v", health.Repositories)
	}
	for _, service := range health.Services {
		if service.Status || service.Restarting {
			t.Fatalf("failed switch left a partial group running: %#v", health.Services)
		}
	}
	if err := os.Remove(filepath.Join(root, "web", "fail")); err != nil {
		t.Fatal(err)
	}
	if err := options.SwitchWorktree(id, linked); err != nil {
		t.Fatal(err)
	}
	stop()
	stop = nil
	m = configured
	options, stop = launch()
	for _, name := range m.ServiceOrder {
		assertRestartResponse(t, serverURL(*m.Services[name].Port, "/"), filepath.Join(linked, name))
	}
	health, _ = options.GetHealthResponse()
	if health.Repositories[0].SelectedPath != linked || health.Services[1].ProjectRootPath != linked {
		t.Fatalf("restart lost selected checkout: %#v", health)
	}
	stop()
	stop = nil
	if err := os.RemoveAll(linked); err != nil {
		t.Fatal(err)
	}
	m = configured
	options, stop = launch()
	health, _ = options.GetHealthResponse()
	if health.Repositories[0].SelectedPath != linked || health.Repositories[0].Error == "" {
		t.Fatalf("missing saved checkout silently replaced: %#v", health)
	}
	for _, service := range health.Services {
		if service.Status {
			t.Fatalf("missing saved checkout started a fallback: %#v", health.Services)
		}
	}
	if err := options.SwitchWorktree(id, root); err != nil {
		t.Fatalf("recover missing selection: %v", err)
	}
	for _, name := range m.ServiceOrder {
		assertRestartResponse(t, serverURL(*m.Services[name].Port, "/"), filepath.Join(root, name))
	}
}

func TestWorktreeServiceHelperProcess(t *testing.T) {
	if os.Getenv("DEVHOST_WORKTREE_HELPER") != "1" {
		return
	}
	cwd, err := os.Getwd()
	if err != nil {
		os.Exit(2)
	}
	if _, err := os.Stat("fail"); err == nil {
		os.Exit(7)
	}
	ch := make(chan os.Signal, 1)
	signal.Notify(ch, syscall.SIGTERM, syscall.SIGINT)
	listener, err := net.Listen("tcp", net.JoinHostPort("127.0.0.1", os.Getenv("PORT")))
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}
	appendTrace := func(event string) {
		f, err := os.OpenFile(os.Getenv("TRACE_PATH"), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
		if err != nil {
			os.Exit(3)
		}
		if _, err := fmt.Fprintf(f, "%s %s %s\n", event, os.Getenv("DEVHOST_SERVICE_NAME"), cwd); err != nil {
			os.Exit(3)
		}
		if err := f.Close(); err != nil {
			os.Exit(3)
		}
	}
	appendTrace("start")
	go func() {
		_ = http.Serve(listener, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = io.WriteString(w, cwd) }))
	}()
	<-ch
	appendTrace("stop")
	if err := listener.Close(); err != nil && !strings.Contains(err.Error(), "closed") {
		os.Exit(4)
	}
	os.Exit(0)
}

func TestWorktreeDaemonStopUsesItsLaunchCheckout(t *testing.T) {
	root, linked := createWorktreeRepository(t)
	m := worktreeTestManifest(root)
	trace := filepath.Join(t.TempDir(), "trace")
	stopCwd := filepath.Join(t.TempDir(), "stop-cwd")
	port := mustReservePort(t)
	service := m.Services["api"]
	service.Command = nil
	service.BindHost, service.Port, service.InjectPort = "127.0.0.1", &port, true
	service.Health = ResolvedHealthConfig{Kind: "tcp", Host: stringPointer("127.0.0.1"), Port: &port, Interval: 10, Timeout: 2000}
	service.Env = map[string]string{"GO_WANT_HELPER_PROCESS": "1", "LIFECYCLE_TRACE_PATH": trace, "STOP_CWD_PATH": stopCwd, "HELPER_BINARY": os.Args[0]}
	service.Lifecycle = ResolvedServiceLifecycle{Mode: "daemon", Start: helperCommandWithMode("daemon-start-server"), Stop: []string{"sh", "-c", `pwd > "$STOP_CWD_PATH"; exec "$HELPER_BINARY" -test.run=TestServiceHelperProcess -- daemon-stop-server`}}
	m.Services["api"] = service
	options := StartStackOptions{LogWriter: io.Discard, ServiceStdoutWriter: io.Discard, ServiceStderrWriter: io.Discard}
	runtime := &stackRuntime{manifest: &m, options: options, environment: readCurrentEnvironment(), gracePeriod: time.Second}
	t.Cleanup(func() {
		if err := stopDaemonLifecycleService(m, service, options, runtime.environment, nil); err != nil {
			t.Error(err)
		}
	})
	if err := runtime.start("api", false); err != nil {
		t.Fatal(err)
	}
	assertRestartResponse(t, serverURL(port, "/"), "ok")
	next := service
	next.Cwd = filepath.Join(linked, "api")
	m.Services["api"] = next
	if err := runtime.stop("api"); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(trace)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "start\nstop\n" {
		t.Fatalf("daemon lifecycle = %q", data)
	}
	cwd, err := os.ReadFile(stopCwd)
	if err != nil {
		t.Fatal(err)
	}
	if string(cwd) != service.Cwd+"\n" {
		t.Fatalf("stop cwd = %q, want %q", cwd, service.Cwd)
	}
	if canConnectToPort("127.0.0.1", port) {
		t.Fatal("daemon remained alive after changing effective cwd")
	}
}
