package services

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/devtools"
	"github.com/gorilla/websocket"
)

func TestStackRestartRefreshesRoutesAfterAutoPortCollision(t *testing.T) {
	for _, failReload := range []bool{false, true} {
		t.Run(fmt.Sprintf("reloadFailure=%t", failReload), func(t *testing.T) {
			trigger := filepath.Join(t.TempDir(), "exit")
			pidPath := filepath.Join(t.TempDir(), "pid")
			collisionPath := filepath.Join(t.TempDir(), "collision")
			body := fmt.Sprintf("[services.web]\nprimary = true\ncommand = [%q, \"-test.run=TestRecoveryServiceHelperProcess\", \"--\"]\nport = \"auto\"\nhost = [\"recover.localhost\", \"alias.recover.localhost\"]\nproxyLocalOrigin = true\n[services.web.env]\nDEVHOST_RECOVERY_HELPER = \"1\"\nEXIT_PATH = %q\nPID_PATH = %q\nEXIT_CODE = \"7\"\nCOLLISION_PATH = %q\n", os.Args[0], trigger, pidPath, collisionPath)
			f := startReloadStack(t, body)
			paths, options, controlPort := f.paths, f.control, f.controlPort
			registrationPath := filepath.Join(paths.RegistrationsDirectoryPath, "recover.localhost_web_2f.json")
			waitForCondition(t, 5*time.Second, func() bool { _, err := os.Stat(registrationPath); return err == nil })
			registration := readRestartRoute(t, registrationPath)
			oldPort := registration.AppPort
			aliasPath := filepath.Join(paths.RegistrationsDirectoryPath, "alias.recover.localhost_web_2f.json")
			alias := readRestartRoute(t, aliasPath)
			if !registration.ProxyLocalOrigin || !alias.ProxyLocalOrigin {
				t.Fatal("startup lost local-origin routing")
			}
			if alias.AppPort != oldPort || alias.DocumentInjectionPort != registration.DocumentInjectionPort {
				t.Fatalf("alias registration = %#v", alias)
			}
			documentPort := registration.DocumentInjectionPort
			assertRestartResponse(t, serverURL(documentPort, "/"), fmt.Sprintf("ready on %d", oldPort))
			if err := os.WriteFile(trigger, nil, 0o600); err != nil {
				t.Fatal(err)
			}
			waitForCondition(t, 5*time.Second, func() bool { h, _ := options.GetHealthResponse(); return h.Services[0].ExitCode != nil })
			if err := os.Remove(trigger); err != nil {
				t.Fatal(err)
			}

			if err := os.WriteFile(collisionPath, nil, 0o600); err != nil {
				t.Fatal(err)
			}
			logs, _, err := websocket.DefaultDialer.Dial(fmt.Sprintf("ws://127.0.0.1:%d/__devhost__/ws/logs", controlPort), nil)
			if err != nil {
				t.Fatal(err)
			}
			defer logs.Close()
			if failReload {
				if err := restartWithRoutingGate(t, options, paths.ExecutablePath, true, documentPort); err == nil {
					t.Fatal("route refresh failure reported success")
				}
				h, _ := options.GetHealthResponse()
				if h.Services[0].Status || h.Services[0].Restarting || h.Services[0].ExitCode == nil {
					t.Fatalf("routing and restoration failures dismissed recovery: %#v", h.Services[0])
				}
				if route := readRestartRoute(t, registrationPath); route.AppPort != oldPort || route.DocumentInjectionPort != documentPort || !route.ProxyLocalOrigin {
					t.Fatalf("failed update changed registration: %#v", route)
				}
				if alias := readRestartRoute(t, aliasPath); alias.AppPort != oldPort || alias.DocumentInjectionPort != documentPort || !alias.ProxyLocalOrigin {
					t.Fatalf("failed update changed alias: %#v", alias)
				}
				waitForRestartLog(t, logs, "reload rejected")
				writeFakeCaddyExecutable(t, paths.ExecutablePath)
				if err := os.WriteFile(collisionPath, nil, 0o600); err != nil {
					t.Fatal(err)
				}
			}
			if err := restartWithRoutingGate(t, options, paths.ExecutablePath, false, documentPort); err != nil {
				t.Fatal(err)
			}
			registration = readRestartRoute(t, registrationPath)
			alias = readRestartRoute(t, aliasPath)
			if !registration.ProxyLocalOrigin || !alias.ProxyLocalOrigin {
				t.Fatal("restart lost local-origin routing")
			}
			if alias.AppPort != registration.AppPort || alias.DocumentInjectionPort != documentPort {
				t.Fatalf("alias did not follow restart: %#v", alias)
			}
			if registration.AppPort == oldPort {
				t.Fatal("proxy route retained the collided port")
			}
			if registration.DocumentInjectionPort != documentPort || registration.DevtoolsControlPort != controlPort {
				t.Fatal("restart replaced devtools listeners")
			}
			assertRestartResponse(t, serverURL(documentPort, "/"), fmt.Sprintf("ready on %d", registration.AppPort))
			routeText, err := os.ReadFile(filepath.Join(paths.RoutesDirectoryPath, "recover.localhost.caddy"))
			if err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(string(routeText), fmt.Sprintf("reverse_proxy 127.0.0.1:%d", registration.AppPort)) {
				t.Fatal("asset proxy retained old backend")
			}
			if !strings.Contains(string(routeText), fmt.Sprintf("header_up Host 127.0.0.1:%d", registration.AppPort)) || !strings.Contains(string(routeText), fmt.Sprintf(`header_up Origin "^.+$" "http://127.0.0.1:%d"`, registration.AppPort)) {
				t.Fatal("local-origin headers retained the collided port")
			}
			assertRestartResponse(t, serverURL(registration.AppPort, "/asset.js"), fmt.Sprintf("ready on %d", registration.AppPort))
			h, _ := options.GetHealthResponse()
			if !h.Services[0].Status || h.Services[0].Restarting || h.Services[0].ExitCode != nil {
				t.Fatalf("restart did not finish recovery: %#v", h.Services[0])
			}
			// The already-open log connection survives both failure and recovery.
			waitForRestartLog(t, logs, "service ready")
		})
	}
}

func restartWithRoutingGate(t *testing.T, options devtools.StartControlServerOptions, executablePath string, fail bool, documentPort int) error {
	t.Helper()
	dir := t.TempDir()
	gate, entered := filepath.Join(dir, "gate"), filepath.Join(dir, "entered")
	if err := os.WriteFile(gate, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	defer os.Remove(gate)
	result := "exit 0\n"
	if fail {
		result = "echo 'reload rejected' >&2\nexit 1\n"
	}
	script := fmt.Sprintf("#!/bin/sh\n: > %q\nwhile [ -e %q ]; do sleep 0.01; done\n%s", entered, gate, result)
	if err := os.WriteFile(executablePath, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- options.RestartStack() }()
	waitForCondition(t, 5*time.Second, func() bool { _, err := os.Stat(entered); return err == nil })
	select {
	case err := <-done:
		t.Fatalf("restart finished before routing completed: %v", err)
	default:
	}
	health, err := options.GetHealthResponse()
	if err != nil {
		t.Fatal(err)
	}
	if health.Services[0].Status || !health.Services[0].Restarting {
		t.Fatalf("recovery cleared before routing: %#v", health.Services[0])
	}
	// Documents already target the healthy replacement, while health remains pending.
	response, err := http.Get(serverURL(documentPort, "/"))
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("replacement document backend not ready: %d", response.StatusCode)
	}
	if err := os.Remove(gate); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-done:
		return err
	case <-time.After(5 * time.Second):
		t.Fatal("restart did not finish after routing")
		return nil
	}
}

type restartRoute struct {
	ProxyLocalOrigin      bool `json:"proxyLocalOrigin"`
	AppPort               int  `json:"appPort"`
	DocumentInjectionPort int  `json:"documentInjectionPort"`
	DevtoolsControlPort   int  `json:"devtoolsControlPort"`
}

func readRestartRoute(t *testing.T, path string) restartRoute {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var route restartRoute
	if err := json.Unmarshal(data, &route); err != nil {
		t.Fatal(err)
	}
	return route
}

func assertRestartResponse(t *testing.T, url, want string) {
	t.Helper()
	response, err := http.Get(url)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusOK || !strings.Contains(string(body), want) {
		t.Fatalf("GET %s: status %d, body %q", url, response.StatusCode, body)
	}
}

func waitForRestartLog(t *testing.T, connection *websocket.Conn, want string) {
	t.Helper()
	if err := connection.SetReadDeadline(time.Now().Add(5 * time.Second)); err != nil {
		t.Fatal(err)
	}
	for {
		_, data, err := connection.ReadMessage()
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(data), want) {
			return
		}
	}
}
