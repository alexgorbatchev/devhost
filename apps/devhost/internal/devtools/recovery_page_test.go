package devtools

import (
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRecoveryProbeWaitsForDocumentTransport(t *testing.T) {
	t.Parallel()
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		connection, _, err := w.(http.Hijacker).Hijack()
		if err != nil {
			t.Error(err)
			return
		}
		_ = connection.Close()
	}))
	t.Cleanup(backend.Close)
	address := backend.Listener.Addr().(*net.TCPAddr)
	server, err := StartDocumentInjectionServer(StartDocumentInjectionServerOptions{
		BackendHost: address.IP.String(), BackendPort: address.Port,
		GetRecovery: func() RecoveryState { return RecoveryState{Phase: "ready", Title: "web is ready", CanRestart: true} },
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = server.Stop() })
	for _, action := range []string{"", "probe"} {
		request, err := http.NewRequest(http.MethodGet, fmt.Sprintf("http://127.0.0.1:%d/deep", server.Port()), nil)
		if err != nil {
			t.Fatal(err)
		}
		request.Header.Set(recoveryHeader, action)
		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		body, err := io.ReadAll(response.Body)
		response.Body.Close()
		if err != nil {
			t.Fatal(err)
		}
		if response.StatusCode != http.StatusBadGateway || !strings.Contains(string(body), "could not load") || strings.Contains(string(body), "web is ready") {
			t.Fatalf("%s: recovery response = %d %s", action, response.StatusCode, body)
		}
	}
}

func TestMissingDocumentOffersRecoveryWithoutReloadLoop(t *testing.T) {
	t.Parallel()
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.NotFound(w, r)
	}))
	t.Cleanup(backend.Close)
	address := backend.Listener.Addr().(*net.TCPAddr)
	server, err := StartDocumentInjectionServer(StartDocumentInjectionServerOptions{
		BackendHost: address.IP.String(), BackendPort: address.Port, DisableInjection: true,
		GetRecovery: func() RecoveryState {
			return RecoveryState{Phase: "ready", Service: "web", Repositories: []WorktreeRepository{{ID: "repo", Name: "project", SelectedPath: "/main", Worktrees: []Worktree{{Path: "/main", Branch: "main", Available: true}, {Path: "/feature", Branch: "feature", Available: true}}}}}
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = server.Stop() })
	for _, kind := range []string{"document", "probe", "api"} {
		t.Run(kind, func(t *testing.T) {
			r, err := http.NewRequest(http.MethodGet, serverURL(server.Port(), "/missing?value=1"), nil)
			if err != nil {
				t.Fatal(err)
			}
			if kind == "document" {
				r.Header.Set("Sec-Fetch-Dest", "document")
			}
			if kind == "probe" {
				r.Header.Set(recoveryHeader, "probe")
			}
			response, err := http.DefaultClient.Do(r)
			if err != nil {
				t.Fatal(err)
			}
			defer response.Body.Close()
			body, err := io.ReadAll(response.Body)
			if err != nil {
				t.Fatal(err)
			}
			if response.StatusCode != http.StatusNotFound {
				t.Fatalf("status = %d, want 404", response.StatusCode)
			}
			if kind == "api" {
				if string(body) != "404 page not found\n" {
					t.Fatalf("API response changed: %s", body)
				}
				return
			}
			if !strings.Contains(string(body), "Switch worktree") || !strings.Contains(string(body), "/feature") || response.Header.Get("Cache-Control") != "no-store" {
				t.Fatalf("missing document has no checkout recovery: %s", body)
			}
		})
	}
}

func TestRecoveryKeepsEnabledToolbarAvailable(t *testing.T) {
	t.Parallel()
	server, err := StartDocumentInjectionServer(StartDocumentInjectionServerOptions{
		GetRecovery: func() RecoveryState { return RecoveryState{Phase: "unavailable", Title: "web exited"} },
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = server.Stop() })
	response, err := http.Get(serverURL(server.Port(), "/"))
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(body), injectedScriptPath) {
		t.Fatal("enabled toolbar is unavailable for checkout and stack recovery")
	}
}

func TestRecoveryDocumentsPreserveApplicationResponses(t *testing.T) {
	t.Parallel()
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		w.Header().Set("Content-Security-Policy", "default-src 'none'")
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = io.WriteString(w, "application error "+r.URL.RequestURI())
	}))
	t.Cleanup(backend.Close)
	for _, phase := range []string{"starting", "unavailable", "ready"} {
		t.Run(phase, func(t *testing.T) {
			address := backend.Listener.Addr().(*net.TCPAddr)
			server, err := StartDocumentInjectionServer(StartDocumentInjectionServerOptions{
				BackendHost: address.IP.String(), BackendPort: address.Port, DisableInjection: true,
				GetRecovery: func() RecoveryState {
					return RecoveryState{Service: "web", Phase: phase, Title: "Starting web", Message: "failure <script>alert(1)</script>", Logs: []string{"log <img src=x onerror=alert(1)>"}}
				},
			})
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = server.Stop() })
			for _, jsonResponse := range []bool{false, true} {
				request, err := http.NewRequest(http.MethodGet, serverURL(server.Port(), "/nested?value=1"), nil)
				if err != nil {
					t.Fatal(err)
				}
				if jsonResponse {
					request.Header.Set("Accept", "application/json")
				}
				response, err := http.DefaultClient.Do(request)
				if err != nil {
					t.Fatal(err)
				}
				body, err := io.ReadAll(response.Body)
				response.Body.Close()
				if err != nil {
					t.Fatal(err)
				}
				if phase == "ready" {
					if response.StatusCode != 500 || string(body) != "application error /nested?value=1" || response.Header.Get("Content-Security-Policy") != "default-src 'none'" {
						t.Fatalf("app response changed: %d %s", response.StatusCode, body)
					}
					continue
				}
				if response.StatusCode != 503 || response.Header.Get("Cache-Control") != "no-store" {
					t.Fatalf("recovery response = %d %v", response.StatusCode, response.Header)
				}
				if jsonResponse {
					var state RecoveryState
					if err := json.Unmarshal(body, &state); err != nil {
						t.Fatal(err)
					}
					if state.Phase != phase {
						t.Fatalf("phase = %s", state.Phase)
					}
				} else if !strings.Contains(string(body), "Starting web") || strings.Contains(string(body), "<img src=x") || strings.Contains(string(body), "<script>alert(1)") || strings.Contains(string(body), injectedScriptPath) {
					t.Fatalf("invalid recovery page: %s", body)
				}
			}
			request, err := http.NewRequest(http.MethodGet, serverURL(server.Port(), "/nested?value=1"), nil)
			if err != nil {
				t.Fatal(err)
			}
			request.Header.Set(recoveryHeader, "probe")
			response, err := http.DefaultClient.Do(request)
			if err != nil {
				t.Fatal(err)
			}
			response.Body.Close()
			want := http.StatusServiceUnavailable
			if phase == "ready" {
				want = http.StatusNoContent
			}
			if response.StatusCode != want {
				t.Fatalf("document probe = %d, want %d", response.StatusCode, want)
			}
		})
	}
}

func TestRecoveryControlsValidateMethodAndOrigin(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name, action, method, origin string
		want                         int
		restart                      bool
	}{
		{name: "status", action: "status", method: "GET", want: 200},
		{name: "foreign status", action: "status", method: "GET", origin: "https://foreign.test", want: 403},
		{name: "status method", action: "status", method: "POST", want: 405},
		{name: "restart", action: "restart", method: "POST", origin: "http://service.test", want: 204, restart: true},
		{name: "restart method", action: "restart", method: "GET", origin: "http://service.test", want: 405},
		{name: "missing origin", action: "restart", method: "POST", want: 403},
		{name: "foreign origin", action: "restart", method: "POST", origin: "https://foreign.test", want: 403},
		{name: "unknown", action: "unknown", method: "GET", want: 400},
		{name: "worktrees disabled", action: "worktrees", method: "GET", want: 501},
		{name: "worktree missing origin", action: "worktrees", method: "POST", want: 403},
		{name: "worktree foreign origin", action: "worktrees", method: "POST", origin: "https://foreign.test", want: 403},
	} {
		t.Run(tc.name, func(t *testing.T) {
			restarted := false
			request := httptest.NewRequest(tc.method, "http://service.test/nested", nil)
			request.Header.Set(recoveryHeader, tc.action)
			if tc.origin != "" {
				request.Header.Set("Origin", tc.origin)
			}
			response := httptest.NewRecorder()
			serveRecoveryControl(response, request, StartDocumentInjectionServerOptions{GetRecovery: func() RecoveryState { return RecoveryState{CanRestart: true} }, Restart: func() error { restarted = true; return nil }}, nil)
			if response.Code != tc.want || restarted != tc.restart {
				t.Fatalf("status = %d, restarted = %t", response.Code, restarted)
			}
		})
	}
}
