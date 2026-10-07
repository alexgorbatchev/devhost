package services

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/hashicorp/consul/sdk/freeport"
)

func TestStackRestartStartupDoesNotAcceptOccupiedAutoPort(t *testing.T) {
	external := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = io.WriteString(w, "external") }))
	t.Cleanup(external.Close)
	port := external.Listener.Addr().(*net.TCPAddr).Port
	host := "127.0.0.1"
	m := newResolvedManifest(t.TempDir(), "127.0.0.1:2019")
	m.Services["web"] = ResolvedService{
		Name: "web", BindHost: host, Port: &port, PortSource: "auto", Managed: true, InjectPort: true,
		Command: []string{os.Args[0], "-test.run=TestReloadServiceHelperProcess", "--"}, Cwd: m.ManifestDirectoryPath,
		Env:    map[string]string{"DEVHOST_RELOAD_HELPER": "1", "VALUE": "web"},
		Health: ResolvedHealthConfig{Kind: HealthKindTCP, Host: &host, Port: &port, Interval: defaultHealthInterval, Timeout: defaultHealthTimeout},
	}
	started, err := startServiceWithRetries(context.Background(), &m, serviceStartOptions{
		ServiceName: "web", AllowPortReassignment: true, Exits: make(chan serviceExitResult, 1), Environment: readCurrentEnvironment(),
		Stack: StartStackOptions{LogWriter: io.Discard, ServiceStdoutWriter: io.Discard, ServiceStderrWriter: io.Discard, ShutdownGracePeriod: 100 * time.Millisecond},
	})
	if started != nil {
		t.Cleanup(func() {
			if err := stopStartedService(started, 100*time.Millisecond); err != nil {
				t.Error(err)
			}
		})
	}
	if err != nil {
		t.Fatal(err)
	}
	if *m.Services["web"].Port == port {
		t.Fatal("startup accepted another process's listener as service health")
	}
	assertRestartResponse(t, serverURL(*m.Services["web"].Port, "/"), "web")
	assertRestartResponse(t, external.URL, "external")
}

func TestManualRestartPreservesAssignedPortAndStackRestartRecovers(t *testing.T) {
	external := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = io.WriteString(w, "external") }))
	t.Cleanup(external.Close)
	body := reloadServiceBody("web", "web", "reload.localhost") + reloadServiceBody("api", "api", "api.localhost") + "REFERENCE = \"{{ services.web.port }}\"\n"
	fixedPort := freeport.GetOne(t)
	body += strings.Replace(reloadServiceBody("worker", "worker", "worker.localhost"), "port = \"auto\"", fmt.Sprintf("port = %d", fixedPort), 1)
	body += fmt.Sprintf("\n[services.external]\nmanaged = false\nport = %d\n", external.Listener.Addr().(*net.TCPAddr).Port)
	f := startReloadStack(t, body)
	webPath := filepath.Join(f.paths.RegistrationsDirectoryPath, "reload.localhost_web_2f.json")
	apiPath := filepath.Join(f.paths.RegistrationsDirectoryPath, "api.localhost_api_2f.json")
	web, api := readRestartRoute(t, webPath), readRestartRoute(t, apiPath)
	apiPID := reloadPID(t, api.AppPort)
	workerPID := reloadPID(t, fixedPort)
	if err := f.control.RestartService([]string{"web"}); err != nil {
		t.Fatal(err)
	}
	if next := readRestartRoute(t, webPath); next.AppPort != web.AppPort {
		t.Fatal("ordinary restart changed assigned port")
	}
	if err := syscall.Kill(reloadPID(t, web.AppPort), syscall.SIGTERM); err != nil {
		t.Fatal(err)
	}
	waitForCondition(t, time.Second, func() bool { return !canConnectToPort(context.Background(), "127.0.0.1", web.AppPort, minProbeTimeout) })
	occupied, err := net.Listen("tcp", net.JoinHostPort("127.0.0.1", fmt.Sprint(web.AppPort)))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = occupied.Close() })
	if err := f.control.RestartService([]string{"web"}); err == nil || !strings.Contains(err.Error(), "Restart stack with new ports") {
		t.Fatalf("manual restart = %v, want assigned-port conflict with recovery action", err)
	}
	if next := readRestartRoute(t, webPath); next.AppPort != web.AppPort || reloadPID(t, api.AppPort) != apiPID {
		t.Fatal("failed manual restart changed port or restarted another service")
	}
	request, err := http.NewRequest(http.MethodPost, serverURL(f.controlPort, "/__devhost__/restart-stack"), nil)
	if err != nil {
		t.Fatal(err)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusNoContent {
		t.Fatalf("stack restart status = %d", response.StatusCode)
	}
	nextWeb, nextAPI := readRestartRoute(t, webPath), readRestartRoute(t, apiPath)
	if nextWeb.AppPort == web.AppPort || nextAPI.AppPort == api.AppPort || reloadPID(t, nextAPI.AppPort) == apiPID {
		t.Fatal("stack restart did not refresh all managed auto ports and processes")
	}
	if nextWeb.DocumentInjectionPort != web.DocumentInjectionPort || nextWeb.DevtoolsControlPort != f.controlPort {
		t.Fatal("stack restart replaced the recovery or control listener")
	}
	assertRestartResponse(t, serverURL(nextWeb.DocumentInjectionPort, "/"), "web")
	assertRestartResponse(t, serverURL(fixedPort, "/"), "worker")
	if reloadPID(t, fixedPort) == workerPID {
		t.Fatal("fixed-port managed service was not restarted")
	}
	assertRestartResponse(t, external.URL, "external")
	response, err = http.Get(serverURL(nextAPI.AppPort, "/env"))
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var env map[string]string
	if err := json.NewDecoder(response.Body).Decode(&env); err != nil {
		t.Fatal(err)
	}
	if want := fmt.Sprint(nextWeb.AppPort); env["WEB"] != want || env["REFERENCE"] != want {
		t.Fatalf("stack restart retained stale environment: %#v; want %s", env, want)
	}
	if occupied.Addr().(*net.TCPAddr).Port != web.AppPort {
		t.Fatal("stack restart interfered with another listener")
	}
}

func TestStackRestartFailureRemainsRetryableWithAcceptedManifest(t *testing.T) {
	for _, failure := range []string{"launch", "routing"} {
		t.Run(failure, func(t *testing.T) {
			f := startReloadStack(t, reloadServiceBody("web", "web", "reload.localhost")+reloadServiceBody("worker", "worker", "worker.localhost"))
			path := filepath.Join(f.paths.RegistrationsDirectoryPath, "reload.localhost_web_2f.json")
			previous := readRestartRoute(t, path)
			f.write(t, "\n[services.web]\ncommand = [")
			waitForCondition(t, 5*time.Second, func() bool { return f.logs.contains("configuration reload rejected") })
			marker := filepath.Join(filepath.Dir(f.path), "fail")
			if failure == "launch" {
				if err := os.WriteFile(marker, nil, 0600); err != nil {
					t.Fatal(err)
				}
			} else {
				marker = filepath.Join(f.paths.StateDirectoryPath, "route-rejected")
				script := fmt.Sprintf("#!/bin/sh\nif [ ! -e %q ]; then touch %q; echo rejected >&2; exit 1; fi\nexit 0\n", marker, marker)
				if err := os.WriteFile(f.paths.ExecutablePath, []byte(script), 0755); err != nil {
					t.Fatal(err)
				}
			}
			if err := f.control.RestartStack(); err == nil {
				t.Fatal("stack restart unexpectedly succeeded")
			}
			health, err := f.control.GetHealthResponse()
			if err != nil {
				t.Fatal(err)
			}
			for _, service := range health.Services {
				if service.Restarting {
					t.Fatal("failed stack restart retained pending state")
				}
			}
			if failure == "routing" {
				assertRestartResponse(t, serverURL(previous.DocumentInjectionPort, "/"), "web")
			} else {
				if err := os.Remove(marker); err != nil {
					t.Fatal(err)
				}
			}
			writeFakeCaddyExecutable(t, f.paths.ExecutablePath)
			if err := f.control.RestartStack(); err != nil {
				t.Fatal(err)
			}
			next := readRestartRoute(t, path)
			assertRestartResponse(t, serverURL(next.DocumentInjectionPort, "/"), "web")
			health, err = f.control.GetHealthResponse()
			if err != nil {
				t.Fatal(err)
			}
			for _, service := range health.Services {
				if !service.Status || service.Restarting {
					t.Fatalf("stack remains in recovery: %#v", health)
				}
			}
		})
	}
}

func TestStackRestartRejectsMissingSelectedCheckoutBeforeStoppingOtherServices(t *testing.T) {
	root, linked := createWorktreeRepository(t)
	web := strings.Replace(reloadServiceBody("web", "web", "reload.localhost"), "command = ", fmt.Sprintf("cwd = %q\ncommand = ", filepath.Join(root, "web")), 1)
	f := startReloadStackConfiguration(t, web+reloadServiceBody("worker", "worker", "worker.localhost"), true)
	health, err := f.control.GetHealthResponse()
	if err != nil || len(health.Repositories) != 1 {
		t.Fatalf("repositories: %#v, %v", health, err)
	}
	if err := f.control.SwitchWorktree(health.Repositories[0].ID, linked); err != nil {
		t.Fatal(err)
	}
	worker := readRestartRoute(t, filepath.Join(f.paths.RegistrationsDirectoryPath, "worker.localhost_worker_2f.json"))
	pid := reloadPID(t, worker.AppPort)
	runWorktreeGit(t, root, "worktree", "remove", "--force", linked)
	if err := f.control.RefreshWorktrees(); err != nil {
		t.Fatal(err)
	}
	if err := f.control.RestartStack(); err == nil {
		t.Fatal("stack restart reported success with a missing selected checkout")
	}
	if reloadPID(t, worker.AppPort) != pid {
		t.Fatal("invalid stack restart stopped an unrelated service")
	}
}
