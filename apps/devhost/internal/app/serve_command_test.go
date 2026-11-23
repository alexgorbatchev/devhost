package app

import (
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy"
)

func TestServeCommandHelper(t *testing.T) {
	if os.Getenv("DEVHOST_COMMAND_HELPER") != "1" {
		return
	}
	dir := os.Getenv("DEVHOST_COMMAND_HELPER_DIR")
	start := func(name string) *http.Server {
		listener, err := net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			os.Exit(2)
		}
		server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { fmt.Fprint(w, name) }), ReadHeaderTimeout: time.Second}
		go server.Serve(listener)
		if err := os.WriteFile(filepath.Join(dir, name), []byte(strconv.Itoa(listener.Addr().(*net.TCPAddr).Port)), 0o600); err != nil {
			os.Exit(2)
		}
		return server
	}
	first := start("first")
	var second *http.Server
	raw, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		os.Exit(2)
	}
	if err := os.WriteFile(filepath.Join(dir, "raw"), []byte(strconv.Itoa(raw.Addr().(*net.TCPAddr).Port)), 0o600); err != nil {
		os.Exit(2)
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "open-second")); err == nil && second == nil {
			second = start("second")
		}
		if _, err := os.Stat(filepath.Join(dir, "close-first")); err == nil {
			first.Close()
		}
		if _, err := os.Stat(filepath.Join(dir, "exit")); err == nil {
			os.Exit(7)
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func TestServeCommandDetachedDiscoveryAndCleanup(t *testing.T) {
	dir, state := t.TempDir(), t.TempDir()
	t.Setenv("DEVHOST_STATE_DIR", state)
	t.Setenv("DEVHOST_TEST_CLI", "1")
	t.Setenv("DEVHOST_COMMAND_HELPER", "1")
	t.Setenv("DEVHOST_COMMAND_HELPER_DIR", dir)
	t.Setenv("AGENT", "1")
	useSharedCaddy(t, state)
	paths := caddy.CreateManagedCaddyPaths(state)
	run := func(args ...string) string {
		var output strings.Builder
		if code := Run(args, dir, &output, &output); code != 0 {
			t.Fatalf("%v = %d: %s", args, code, output.String())
		}
		return output.String()
	}
	t.Cleanup(func() {
		stacks, err := caddy.ReadLiveStacks(paths)
		if err != nil {
			t.Error(err)
		}
		for _, stack := range stacks {
			var output strings.Builder
			if code := Run([]string{"stop", "--session", stack.Name}, dir, &output, &output); code != 0 {
				t.Errorf("cleanup: %s", output.String())
			}
		}
	})
	// The shell remains the root; the HTTP helper is a descendant.
	command := fmt.Sprintf("%q -test.run=^TestServeCommandHelper$ -- & wait", os.Args[0])
	output := run("serve", "--detach", "--name", "Example App", "--startup-timeout", "5s", command)
	stacks, err := caddy.ReadLiveStacks(paths)
	if err != nil || len(stacks) != 1 {
		t.Fatalf("stacks: %v %v", stacks, err)
	}
	stack := stacks[0]
	if !strings.HasPrefix(stack.Name, "example-app-") || !stack.Ready || stack.LogPath == "" || !strings.Contains(output, "Stop: devhost stop --session "+stack.Name) {
		t.Fatalf("stack/output: %#v\n%s", stack, output)
	}
	base := "https://" + stack.Name + ".localhost"
	if !slices.Equal(stack.URLs, []string{base}) {
		t.Fatalf("single URLs: %v", stack.URLs)
	}
	await := func(check func(caddy.LiveStack) bool) caddy.LiveStack {
		t.Helper()
		deadline := time.Now().Add(10 * time.Second)
		for time.Now().Before(deadline) {
			stacks, err := caddy.ReadLiveStacks(paths)
			if err == nil && len(stacks) == 1 && check(stacks[0]) {
				return stacks[0]
			}
			time.Sleep(20 * time.Millisecond)
		}
		t.Fatal("session did not publish the expected route change")
		return caddy.LiveStack{}
	}
	run("stack", "restart", "--all")
	stack = await(func(s caddy.LiveStack) bool {
		return s.PID != stack.PID && s.Name == stack.Name && s.Ready && slices.Equal(s.URLs, []string{base})
	})
	port := func(name string) string {
		data, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			t.Fatal(err)
		}
		return string(data)
	}
	first, raw := port("first"), port("raw")
	if strings.Contains(strings.Join(stack.URLs, " "), raw) {
		t.Fatal("non HTTP listener routed")
	}
	if !strings.Contains(run("stack", "list", "--sessions"), stack.Name) {
		t.Fatal("session missing from list")
	}
	if info := run("stack", "info", "--session", stack.Name); !strings.Contains(info, base) || !strings.Contains(info, "name=command") {
		t.Fatalf("info: %s", info)
	}
	if err := os.WriteFile(filepath.Join(dir, "open-second"), nil, 0o600); err != nil {
		t.Fatal(err)
	}
	await(func(s caddy.LiveStack) bool { return len(s.URLs) == 3 })
	second := port("second")
	await(func(s caddy.LiveStack) bool {
		return slices.Contains(s.URLs, "https://"+stack.Name+"-"+first+".localhost") && slices.Contains(s.URLs, "https://"+stack.Name+"-"+second+".localhost") && slices.Contains(s.URLs, base)
	})
	if err := os.WriteFile(filepath.Join(dir, "close-first"), nil, 0o600); err != nil {
		t.Fatal(err)
	}
	await(func(s caddy.LiveStack) bool {
		return slices.Equal(s.URLs, []string{"https://" + stack.Name + "-" + second + ".localhost"})
	})
	siblingDirectory := t.TempDir()
	t.Setenv("DEVHOST_COMMAND_HELPER_DIR", siblingDirectory)
	run("serve", "--detach", "--name", "Example App", "--", os.Args[0], "-test.run=^TestServeCommandHelper$", "--")
	concurrent, err := caddy.ReadLiveStacks(paths)
	if err != nil || len(concurrent) != 2 {
		t.Fatalf("concurrent sessions: %v %v", concurrent, err)
	}
	var sibling caddy.LiveStack
	for _, session := range concurrent {
		if session.Name != stack.Name {
			sibling = session
		}
	}
	if sibling.Name == "" || len(sibling.URLs) != 1 || sibling.URLs[0] == base {
		t.Fatalf("sibling: %#v", sibling)
	}
	run("stop", "--session", stack.Name)
	if !sibling.Alive() {
		t.Fatal("stopping one session stopped its sibling")
	}
	for _, port := range []string{first, second, raw} {
		conn, err := net.DialTimeout("tcp", net.JoinHostPort("127.0.0.1", port), 100*time.Millisecond)
		if err == nil {
			conn.Close()
			t.Errorf("listener %s survived stop", port)
		}
	}
	run("stop", "--session", sibling.Name)
	for _, directory := range []string{paths.StacksDirectoryPath, paths.HostClaimsDirectoryPath, paths.RegistrationsDirectoryPath} {
		entries, err := os.ReadDir(directory)
		if err != nil || len(entries) > 0 {
			t.Errorf("cleanup %s: %v %v", directory, entries, err)
		}
	}
}

func TestServeCommandFailuresCleanUp(t *testing.T) {
	for _, test := range []struct {
		name    string
		command []string
	}{
		{"launch", []string{"/missing/devhost-command"}},
		{"exit", []string{"/bin/sh", "-c", "exit 7"}},
		{"timeout", []string{"/bin/sh", "-c", "sleep 30"}},
	} {
		t.Run(test.name, func(t *testing.T) {
			dir, state := t.TempDir(), t.TempDir()
			t.Setenv("DEVHOST_STATE_DIR", state)
			t.Setenv("DEVHOST_TEST_CLI", "1")
			t.Setenv("AGENT", "1")
			useSharedCaddy(t, state)
			args := append([]string{"serve", "--detach", "--startup-timeout", "100ms", "--"}, test.command...)
			var output strings.Builder
			if code := Run(args, dir, &output, &output); code == 0 {
				t.Fatalf("failure accepted: %s", output.String())
			}
			paths := caddy.CreateManagedCaddyPaths(state)
			stacks, err := caddy.ReadLiveStacks(paths)
			if err != nil || len(stacks) != 0 {
				t.Fatalf("failed session survived: %v %v\n%s", stacks, err, output.String())
			}
		})
	}
}

func TestServeCommandForegroundExitCode(t *testing.T) {
	dir, state := t.TempDir(), t.TempDir()
	t.Setenv("DEVHOST_STATE_DIR", state)
	t.Setenv("DEVHOST_TEST_CLI", "1")
	t.Setenv("DEVHOST_COMMAND_HELPER", "1")
	t.Setenv("DEVHOST_COMMAND_HELPER_DIR", dir)
	useSharedCaddy(t, state)
	command := exec.Command(os.Args[0], "serve", "--", os.Args[0], "-test.run=^TestServeCommandHelper$", "--")
	command.Dir = dir
	command.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	var output strings.Builder
	command.Stdout, command.Stderr = &output, &output
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- command.Wait() }()
	joined := false
	t.Cleanup(func() {
		if joined {
			return
		}
		_ = command.Process.Signal(syscall.SIGTERM)
		select {
		case <-done:
		case <-time.After(15 * time.Second):
			_ = syscall.Kill(-command.Process.Pid, syscall.SIGKILL)
			<-done
		}
	})
	paths := caddy.CreateManagedCaddyPaths(state)
	deadline := time.Now().Add(10 * time.Second)
	ready := false
	for time.Now().Before(deadline) {
		stacks, err := caddy.ReadLiveStacks(paths)
		if err == nil && len(stacks) == 1 && stacks[0].Ready {
			ready = true
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if !ready {
		t.Fatal("foreground session did not become ready")
	}
	if err := os.WriteFile(filepath.Join(dir, "exit"), nil, 0o600); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-done:
		joined = true
		if err == nil || command.ProcessState.ExitCode() != 7 {
			t.Fatalf("exit=%v: %s", err, output.String())
		}
	case <-time.After(15 * time.Second):
		t.Fatal("foreground session kept running after command exit")
	}
	stacks, err := caddy.ReadLiveStacks(paths)
	if err != nil || len(stacks) != 0 {
		t.Fatalf("foreground cleanup: %v %v", stacks, err)
	}
}
