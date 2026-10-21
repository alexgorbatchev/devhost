package services

import (
	"context"
	"errors"
	"fmt"
	"html"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/nettest"
)

func TestWorktreeRecoveryAfterBindHostMismatch(t *testing.T) {
	for _, host := range []string{"127.0.0.1", "::1"} {
		t.Run(host, func(t *testing.T) {
			f, url, bindFile := startWorktreeRecoveryStack(t, host, readAlternativeBindHost(host), 1000)
			route := readRestartRoute(t, filepath.Join(f.paths.RegistrationsDirectoryPath, "api.recovery.localhost_api_2f.json"))
			address := net.JoinHostPort(host, fmt.Sprint(route.AppPort))
			alternative := net.JoinHostPort(readAlternativeBindHost(host), fmt.Sprint(route.AppPort))
			failure := fmt.Sprintf("Service api did not pass its health check within 1000ms. TCP health check could not connect to %s. A TCP connection to %s succeeded instead. Set services.api.bindHost = %q in your manifest, or configure the app to listen on %s.", address, alternative, readAlternativeBindHost(host), address)
			assertWorktreeRecoveryFailure(t, f, url, failure)
			if !f.logs.contains("Stopping repository shop services (api, web) because service api failed to start.") {
				t.Fatal("startup failure did not explain why sibling services stop")
			}
			client := &http.Client{Timeout: 5 * time.Second}
			restart := func() (int, string) {
				t.Helper()
				request, err := http.NewRequest(http.MethodPost, url, nil)
				if err != nil {
					t.Fatal(err)
				}
				request.Header.Set("X-Devhost-Recovery", "restart")
				request.Header.Set("Origin", "http://"+request.Host)
				response, err := client.Do(request)
				if err != nil {
					t.Fatalf("recovery restart failed to return: %v", err)
				}
				defer response.Body.Close()
				body, err := io.ReadAll(response.Body)
				if err != nil {
					t.Fatal(err)
				}
				return response.StatusCode, string(body)
			}
			for range 2 {
				status, body := restart()
				if status != http.StatusServiceUnavailable || strings.TrimSpace(body) != failure {
					t.Fatalf("failed restart = %d %q", status, body)
				}
				assertWorktreeRecoveryFailure(t, f, url, failure)
			}
			if err := os.WriteFile(bindFile, []byte(host), 0600); err != nil {
				t.Fatal(err)
			}
			if status, body := restart(); status != http.StatusNoContent {
				t.Fatalf("restart after correcting listener = %d %q", status, body)
			}
			state := readStartupRecoveryState(t, url)
			if state.Phase != "ready" || state.Message != "" {
				t.Fatalf("successful restart retained recovery: %#v", state)
			}
			assertRestartResponse(t, url, "web")
			health, err := f.control.GetHealthResponse()
			if err != nil {
				t.Fatal(err)
			}
			for _, service := range health.Services {
				if !service.Status || service.Restarting {
					t.Fatalf("successful restart left invalid health: %#v", health)
				}
			}
		})
	}
}

func TestShutdownCancelsWorktreeBindHostHealthWait(t *testing.T) {
	f, url, bindFile := startWorktreeRecoveryStack(t, "127.0.0.1", "127.0.0.1", 60000)
	if err := os.WriteFile(bindFile, []byte("::1"), 0600); err != nil {
		t.Fatal(err)
	}
	health, err := f.control.GetHealthResponse()
	if err != nil {
		t.Fatal(err)
	}
	repo := health.Repositories[0]
	api := readRestartRoute(t, filepath.Join(f.paths.RegistrationsDirectoryPath, "api.recovery.localhost_api_2f.json"))
	path := filepath.Join(repo.SelectedPath, "devhost.toml")
	configuration, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(strings.Replace(string(configuration), "port = \"auto\"", fmt.Sprintf("port = %d", api.AppPort), 1)), 0600); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- f.control.SwitchWorktree(repo.ID, repo.SelectedPath) }()
	waitForCondition(t, stackChangeTimeout, func() bool {
		return canConnectToPort(context.Background(), "::1", api.AppPort, minProbeTimeout)
	})
	state := readStartupRecoveryState(t, url)
	if state.Phase != "starting" || state.CanRestart {
		t.Fatalf("active group health wait has invalid recovery: %#v", state)
	}
	f.signalStop()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("shutdown did not cancel worktree health polling: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("shutdown deadlocked during worktree health polling")
	}
	f.stop()
	for _, host := range []string{"127.0.0.1", "::1"} {
		if canConnectToPort(context.Background(), host, api.AppPort, minProbeTimeout) {
			t.Fatalf("shutdown left a service listening on %s:%d", host, api.AppPort)
		}
	}
}

func startWorktreeRecoveryStack(t *testing.T, host, listenHost string, timeout int) (*reloadStackFixture, string, string) {
	t.Helper()
	port := nettest.ReservePort(t)
	listener, err := net.Listen("tcp6", net.JoinHostPort("::1", fmt.Sprint(port)))
	if err != nil {
		t.Skipf("IPv6 loopback unavailable: %v", err)
	}
	if err := listener.Close(); err != nil {
		t.Fatal(err)
	}
	root, _ := createWorktreeRepository(t)
	bindFile := filepath.Join(root, "api", "listen-host")
	if err := os.WriteFile(bindFile, []byte(listenHost), 0600); err != nil {
		t.Fatal(err)
	}
	api := strings.Replace(reloadServiceBody("api", "api", "api.recovery.localhost"), "command = ", fmt.Sprintf("cwd = %q\nbindHost = %q\nhealth.timeout = %d\ncommand = ", filepath.Join(root, "api"), host, timeout), 1)
	api += fmt.Sprintf("BIND_HOST_FILE = %q\n", bindFile)
	web := strings.Replace(reloadServiceBody("web", "web", "web.recovery.localhost"), "command = ", fmt.Sprintf("cwd = %q\ndependsOn = [\"api\"]\ncommand = ", filepath.Join(root, "web")), 1)
	f := startReloadStackConfiguration(t, api+web, true)
	if err := os.WriteFile(filepath.Join(root, "devhost.toml"), []byte(f.header+api+web), 0600); err != nil {
		t.Fatal(err)
	}
	route := readRestartRoute(t, filepath.Join(f.paths.RegistrationsDirectoryPath, "web.recovery.localhost_web_2f.json"))
	return f, serverURL(route.DocumentInjectionPort, "/review?example=review"), bindFile
}

func assertWorktreeRecoveryFailure(t *testing.T, f *reloadStackFixture, url, failure string) {
	t.Helper()
	state := readStartupRecoveryState(t, url)
	if state.Phase != "unavailable" || !state.CanRestart || state.Message != failure {
		t.Fatalf("failed repository recovery state = %#v", state)
	}
	if page := readStartupRecoveryPage(t, url); !strings.Contains(html.UnescapeString(page), failure) {
		t.Fatalf("recovery page hides repository failure: %s", page)
	}
	health, err := f.control.GetHealthResponse()
	if err != nil {
		t.Fatal(err)
	}
	if len(health.Repositories) != 1 || health.Repositories[0].Switching || health.Repositories[0].Error != failure {
		t.Fatalf("failed repository health = %#v", health.Repositories)
	}
	for _, service := range health.Services {
		if service.Status || service.Restarting {
			t.Fatalf("failed restart retained active service state: %#v", health.Services)
		}
	}
}
