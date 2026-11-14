package app

import (
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"testing"
	"time"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/nettest"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/services"
)

type detachedFixture struct {
	directory string
	manifest  string
	state     string
	health    *httptest.Server
	healthy   atomic.Bool
	probed    chan struct{}
}

func newDetachedFixture(t *testing.T, timeout int) *detachedFixture {
	t.Helper()
	f := &detachedFixture{directory: t.TempDir(), state: t.TempDir(), probed: make(chan struct{}, 1)}
	t.Setenv("DEVHOST_STATE_DIR", f.state)
	t.Setenv("DEVHOST_TEST_CLI", "1")
	t.Setenv("AGENT", "1")
	useSharedCaddy(t, f.state)
	f.health = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		select {
		case f.probed <- struct{}{}:
		default:
		}
		if !f.healthy.Load() {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		_, _ = io.WriteString(w, "ready")
	}))
	t.Cleanup(f.health.Close)
	f.manifest = filepath.Join(f.directory, "devhost.toml")
	content := fmt.Sprintf(`name = "detached-test"
[worktrees]
enabled = false
[services.web]
command = %q
host = "detached-test.localhost"
port = "auto"
[services.web.health]
http = %q
interval = 20
timeout = %d
[services.web.env]
DEVHOST_DETACHED_SERVICE = "1"
DEVHOST_DETACHED_DIRECTORY = %q
[services.unselected]
command = "false"
[services.unselected.health]
process = true
`, os.Args[0]+" -test.run=TestDetachedServiceHelper --", f.health.URL, timeout, f.directory)
	if err := os.WriteFile(f.manifest, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		var output strings.Builder
		if code := Run([]string{"stop", "--manifest", f.manifest}, f.directory, &output, &output); code != 0 {
			t.Errorf("cleanup: %s", output.String())
		}
	})
	return f
}

func (f *detachedFixture) run(t *testing.T, args ...string) string {
	t.Helper()
	var output strings.Builder
	if code := Run(args, f.directory, &output, &output); code != 0 {
		t.Fatalf("Run(%v) = %d: %s", args, code, output.String())
	}
	return output.String()
}

func (f *detachedFixture) stack(t *testing.T) caddy.LiveStack {
	t.Helper()
	stacks, err := caddy.ReadLiveStacks(caddy.CreateManagedCaddyPaths(f.state))
	if err != nil || len(stacks) != 1 {
		t.Fatalf("stacks = %v, err = %v", stacks, err)
	}
	return stacks[0]
}

func TestDetachedStartWaitsForHealthAndSupportsConcurrentIdempotence(t *testing.T) {
	f := newDetachedFixture(t, 10000)
	type result struct {
		code   int
		output string
	}
	results := make(chan result, 2)
	var callers sync.WaitGroup
	t.Cleanup(func() { f.healthy.Store(true); callers.Wait() })
	start := func() {
		defer callers.Done()
		var output strings.Builder
		code := Run([]string{"start", "--detach", "web"}, f.directory, &output, &output)
		results <- result{code, output.String()}
	}
	callers.Add(1)
	go start()
	select {
	case <-f.probed:
	case <-time.After(10 * time.Second):
		t.Fatal("no health probe")
	}
	select {
	case result := <-results:
		t.Fatalf("returned before health passed: %+v", result)
	default:
	}
	stack := f.stack(t)
	if stack.Ready {
		t.Fatal("unhealthy stack marked ready")
	}
	// The log descriptor and session belong to the supervisor, not the caller.
	if group, err := syscall.Getpgid(stack.PID); err != nil || group != stack.PID {
		t.Fatalf("process group = %d, err = %v", group, err)
	}
	callers.Add(1)
	go start()
	f.healthy.Store(true)
	outputs := ""
	for range 2 {
		select {
		case result := <-results:
			if result.code != 0 {
				t.Fatalf("start = %+v", result)
			}
			outputs += result.output
		case <-time.After(15 * time.Second):
			t.Fatal("start did not complete")
		}
	}
	stack = f.stack(t)
	if !stack.Ready || stack.LogPath == "" || !strings.Contains(outputs, "Started detached-test") || !strings.Contains(outputs, "Already running detached-test") || !strings.Contains(outputs, "https://detached-test.localhost") {
		t.Fatalf("stack = %+v, output = %s", stack, outputs)
	}
	if info, err := os.Stat(stack.LogPath); err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("log permissions: %v, %v", info, err)
	}
	if got := f.run(t, "stack", "find", "detached-test"); !strings.Contains(got, strconv.Itoa(stack.PID)) {
		t.Fatal(got)
	}
	alias := filepath.Join(t.TempDir(), "devhost.toml")
	if err := os.Symlink(f.manifest, alias); err != nil {
		t.Fatal(err)
	}
	if got := f.run(t, "start", "--detach", "--manifest", alias, "web"); !strings.Contains(got, "Already running") {
		t.Fatal(got)
	}
	if after := f.stack(t); after.PID != stack.PID {
		t.Fatal("idempotence replaced supervisor")
	}
	f.run(t, "stop")
	assertDetachedStopped(t, f)
}

func TestDetachedFailureCleansServicesRoutesAndRegistration(t *testing.T) {
	f := newDetachedFixture(t, 200)
	var output strings.Builder
	code := Run([]string{"start", "--detach", "web"}, f.directory, &output, &output)
	if code == 0 || !strings.Contains(output.String(), "Startup log tail:") || !strings.Contains(output.String(), "health check") || !strings.Contains(output.String(), "detached child output") {
		t.Fatalf("code %d: %s", code, output.String())
	}
	assertDetachedStopped(t, f)
	waitForFile(t, filepath.Join(f.directory, "stopped"))
}

func TestDetachedRestartPreservesSelectionAndUpdatesLog(t *testing.T) {
	f := newDetachedFixture(t, 10000)
	f.healthy.Store(true)
	f.run(t, "start", "--detach", "web")
	first := f.stack(t)
	f.run(t, "stack", "restart")
	replacement := f.stack(t)
	if replacement.PID == first.PID || replacement.LogPath == first.LogPath || replacement.LogPath == "" {
		t.Fatalf("replacement = %+v", replacement)
	}
	deadline := time.Now().Add(10 * time.Second)
	for !replacement.Ready {
		if time.Now().After(deadline) {
			t.Fatal("replacement did not become ready")
		}
		time.Sleep(20 * time.Millisecond)
		replacement = f.stack(t)
	}
	f.run(t, "stop")
	assertDetachedStopped(t, f)
}

func TestDetachedStackSurvivesCallingProcessGroup(t *testing.T) {
	f := newDetachedFixture(t, 10000)
	f.healthy.Store(true)
	log, err := os.Create(filepath.Join(f.directory, "parent.log"))
	if err != nil {
		t.Fatal(err)
	}
	defer log.Close()
	parent := exec.Command(os.Args[0], "-test.run=TestDetachedParentHelper", "--")
	parent.Dir = f.directory
	parent.Env = append(os.Environ(), "DEVHOST_DETACHED_PARENT=1")
	parent.Stdout, parent.Stderr = log, log
	parent.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := parent.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if parent.ProcessState == nil {
			_ = syscall.Kill(-parent.Process.Pid, syscall.SIGKILL)
			_ = parent.Wait()
		}
	})
	waitForFile(t, filepath.Join(f.directory, "parent-ready"))
	stack := f.stack(t)
	if err := syscall.Kill(-parent.Process.Pid, syscall.SIGKILL); err != nil {
		t.Fatal(err)
	}
	_ = parent.Wait()
	if !stack.Alive() {
		t.Fatal("detached supervisor died with parent process group")
	}
	if got := f.run(t, "start", "--detach", "web"); !strings.Contains(got, "Already running") {
		t.Fatal(got)
	}
	f.run(t, "stop")
	assertDetachedStopped(t, f)
}

func assertDetachedStopped(t *testing.T, f *detachedFixture) {
	t.Helper()
	paths := caddy.CreateManagedCaddyPaths(f.state)
	if stacks, err := caddy.ReadLiveStacks(paths); err != nil || len(stacks) != 0 {
		t.Fatalf("leftover stacks %v, err %v", stacks, err)
	}
	for _, directory := range []string{paths.StacksDirectoryPath, paths.RegistrationsDirectoryPath, paths.PortClaimsDirectoryPath} {
		entries, err := os.ReadDir(directory)
		if err != nil && !os.IsNotExist(err) {
			t.Fatal(err)
		}
		for _, entry := range entries {
			if strings.HasSuffix(entry.Name(), ".json") {
				t.Errorf("leftover registration: %s", filepath.Join(directory, entry.Name()))
			}
		}
	}
}

func TestDetachedParentHelper(t *testing.T) {
	if os.Getenv("DEVHOST_DETACHED_PARENT") != "1" {
		return
	}
	cwd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	if code := Run([]string{"start", "--detach", "web"}, cwd, os.Stdout, os.Stderr); code != 0 {
		os.Exit(code)
	}
	if err := os.WriteFile("parent-ready", nil, 0o600); err != nil {
		t.Fatal(err)
	}
	select {}
}

func TestDetachedServiceHelper(t *testing.T) {
	if os.Getenv("DEVHOST_DETACHED_SERVICE") != "1" {
		return
	}
	directory := os.Getenv("DEVHOST_DETACHED_DIRECTORY")
	if os.Getenv(services.DetachedLogEnvironment) != "" {
		t.Fatal("private startup metadata leaked to service")
	}
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, syscall.SIGTERM, syscall.SIGINT, syscall.SIGHUP)
	fmt.Println("detached child output")
	if err := os.WriteFile(filepath.Join(directory, "started"), []byte(strconv.Itoa(os.Getpid())), 0o600); err != nil {
		t.Fatal(err)
	}
	<-signals
	if err := os.WriteFile(filepath.Join(directory, "stopped"), nil, 0o600); err != nil {
		t.Fatal(err)
	}
	os.Exit(0)
}

func TestDetachedCancellationCleansAttempt(t *testing.T) {
	f := newDetachedFixture(t, 10000)
	log, err := os.Create(filepath.Join(f.directory, "caller.log"))
	if err != nil {
		t.Fatal(err)
	}
	defer log.Close()
	caller := exec.Command(os.Args[0], "start", "--detach", "web")
	caller.Dir, caller.Env = f.directory, os.Environ()
	caller.Stdout, caller.Stderr = log, log
	if err := caller.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = caller.Process.Signal(syscall.SIGTERM); _ = caller.Wait() })
	select {
	case <-f.probed:
	case <-time.After(10 * time.Second):
		t.Fatal("no health probe")
	}
	if err := caller.Process.Signal(syscall.SIGTERM); err != nil {
		t.Fatal(err)
	}
	if err := caller.Wait(); err == nil {
		t.Fatal("cancelled startup succeeded")
	}
	assertDetachedStopped(t, f)
	data, err := os.ReadFile(log.Name())
	if err != nil || !strings.Contains(string(data), "context canceled") || !strings.Contains(string(data), "Startup log tail:") {
		t.Fatalf("log %s, err %v", data, err)
	}
}

func TestDetachedLogsAppendAcrossStarts(t *testing.T) {
	f := newDetachedFixture(t, 10000)
	f.healthy.Store(true)
	f.run(t, "start", "--detach", "web")
	first := f.stack(t)
	f.run(t, "stop")
	f.run(t, "start", "--detach", "web")
	second := f.stack(t)
	f.run(t, "stop")
	data, err := os.ReadFile(first.LogPath)
	if err != nil || first.LogPath != second.LogPath || strings.Count(string(data), "detached child output") != 2 {
		t.Fatalf("log path %s -> %s, contents %s, err %v", first.LogPath, second.LogPath, data, err)
	}
}

func TestDetachedLaunchErrorAndExternalHealthFailureLeaveNoStack(t *testing.T) {
	for _, service := range []string{
		"[services.broken]\ncommand = [\"/nonexistent/devhost-test-command\"]\nhealth = { process = true }\n",
		"[services.external]\nmanaged = false\nport = %d\nhealth = { http = %q, timeout = 100, interval = 20 }\n",
	} {
		t.Run(strings.Split(service, "\n")[0], func(t *testing.T) {
			f := newDetachedFixture(t, 1000)
			if strings.Contains(service, "%q") {
				service = fmt.Sprintf(service, nettest.ReservePort(t), f.health.URL)
			}
			if err := os.WriteFile(f.manifest, []byte("name = \"failure-test\"\n[worktrees]\nenabled = false\n"+service), 0o600); err != nil {
				t.Fatal(err)
			}
			var output strings.Builder
			if code := Run([]string{"start", "--detach"}, f.directory, &output, &output); code == 0 || !strings.Contains(output.String(), "Startup log tail:") {
				t.Fatalf("code %d: %s", code, output.String())
			}
			assertDetachedStopped(t, f)
		})
	}
}

func TestDetachedReadinessAndLogSurviveManifestReload(t *testing.T) {
	f := newDetachedFixture(t, 10000)
	f.healthy.Store(true)
	f.run(t, "start", "--detach", "web")
	first := f.stack(t)
	data, err := os.ReadFile(f.manifest)
	if err != nil {
		t.Fatal(err)
	}
	data = []byte(strings.Replace(string(data), `name = "detached-test"`, `name = "detached-reloaded"`, 1))
	if err := os.WriteFile(f.manifest, data, 0o600); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(10 * time.Second)
	for {
		updated := f.stack(t)
		if updated.Name == "detached-reloaded" {
			if !updated.Ready || updated.LogPath != first.LogPath || updated.PID != first.PID {
				t.Fatalf("reload lost detached ownership metadata: %+v", updated)
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("manifest reload did not finish")
		}
		time.Sleep(20 * time.Millisecond)
	}
	if got := f.run(t, "start", "--detach", "web"); !strings.Contains(got, first.LogPath) {
		t.Fatal(got)
	}
}
