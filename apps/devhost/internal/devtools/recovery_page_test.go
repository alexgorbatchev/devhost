package devtools

import (
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
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
		BackendHost: address.IP.String(), BackendPort: address.Port, ShouldInject: alwaysInject,
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
		BackendHost: address.IP.String(), BackendPort: address.Port,
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
		ShouldInject: alwaysInject,
		GetRecovery:  func() RecoveryState { return RecoveryState{Phase: "unavailable", Title: "web exited"} },
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
				BackendHost: address.IP.String(), BackendPort: address.Port,
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
				want = http.StatusInternalServerError
			}
			if response.StatusCode != want {
				t.Fatalf("document probe = %d, want %d", response.StatusCode, want)
			}
		})
	}
}

func TestServerErrorDocumentsOfferRecoveryUntilRestart(t *testing.T) {
	t.Parallel()
	for _, status := range []int{500, 502, 503, 504, 599} {
		t.Run(fmt.Sprint(status), func(t *testing.T) {
			var recovered atomic.Bool
			backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if !recovered.Load() {
					w.WriteHeader(status)
					return // Reproduce a compiler failure with an empty response.
				}
				_, _ = io.WriteString(w, "application recovered")
			}))
			t.Cleanup(backend.Close)
			address := backend.Listener.Addr().(*net.TCPAddr)
			server, err := StartDocumentInjectionServer(StartDocumentInjectionServerOptions{
				BackendHost: address.IP.String(), BackendPort: address.Port,
				GetRecovery: func() RecoveryState {
					return RecoveryState{Service: "web", Phase: "ready", CanRestart: true, Logs: []string{"compiler could not resolve import"}}
				},
				Restart: func() error { recovered.Store(true); return nil },
			})
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = server.Stop() })
			for _, kind := range []string{"document", "probe", "api", "script"} {
				r, err := http.NewRequest(http.MethodGet, serverURL(server.Port(), "/nested?value=1"), nil)
				if err != nil {
					t.Fatal(err)
				}
				if kind == "probe" {
					r.Header.Set(recoveryHeader, kind)
				} else if kind != "api" {
					r.Header.Set("Sec-Fetch-Dest", kind)
				}
				response, err := http.DefaultClient.Do(r)
				if err != nil {
					t.Fatal(err)
				}
				body, err := io.ReadAll(response.Body)
				response.Body.Close()
				if err != nil {
					t.Fatal(err)
				}
				if response.StatusCode != status {
					t.Fatalf("%s: status = %d, want %d", kind, response.StatusCode, status)
				}
				if kind == "api" || kind == "script" {
					if len(body) != 0 {
						t.Fatalf("%s response changed: %s", kind, body)
					}
				} else if !strings.Contains(string(body), "Restart") || !strings.Contains(string(body), "compiler could not resolve import") || response.Header.Get("Cache-Control") != "no-store" {
					t.Fatalf("%s: server error has no recovery controls/logs: %d %s", kind, response.StatusCode, body)
				}
			}
			r, err := http.NewRequest(http.MethodPost, serverURL(server.Port(), "/nested?value=1"), nil)
			if err != nil {
				t.Fatal(err)
			}
			r.Header.Set("Origin", "http://"+r.URL.Host)
			r.Header.Set(recoveryHeader, "restart")
			response, err := http.DefaultClient.Do(r)
			if err != nil {
				t.Fatal(err)
			}
			response.Body.Close()
			if response.StatusCode != http.StatusNoContent || !recovered.Load() {
				t.Fatalf("restart = %d, recovered = %t", response.StatusCode, recovered.Load())
			}
			r.Method = http.MethodGet
			r.Header.Set(recoveryHeader, "probe")
			response, err = http.DefaultClient.Do(r)
			if err != nil {
				t.Fatal(err)
			}
			response.Body.Close()
			if response.StatusCode != http.StatusNoContent {
				t.Fatalf("recovered probe = %d", response.StatusCode)
			}
		})
	}
}

// Recovery controls refuse what the control server refuses: a state change a browser sends from another origin.
// Reading status changes nothing, and a tool that sends no browser headers is not a page on another site.
func TestRecoveryControlsValidateMethodAndOrigin(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name, action, method, origin, fetchSite string
		want                                    int
		restart                                 bool
	}{
		{name: "status", action: "status", method: "GET", want: 200},
		{name: "status read by another site", action: "status", method: "GET", origin: "https://foreign.test", want: 200},
		{name: "status method", action: "status", method: "POST", want: 405},
		{name: "restart", action: "restart", method: "POST", origin: "http://service.test", want: 204, restart: true},
		{name: "restart method", action: "restart", method: "GET", origin: "http://service.test", want: 405},
		{name: "restart from a tool", action: "restart", method: "POST", want: 204, restart: true},
		{name: "foreign origin", action: "restart", method: "POST", origin: "https://foreign.test", want: 403},
		{name: "cross-site fetch", action: "restart", method: "POST", fetchSite: "cross-site", want: 403},
		{name: "unknown", action: "unknown", method: "GET", want: 400},
		{name: "worktrees disabled", action: "worktrees", method: "GET", want: 501},
		{name: "worktree switch from a tool", action: "worktrees", method: "POST", want: 501},
		{name: "worktree foreign origin", action: "worktrees", method: "POST", origin: "https://foreign.test", want: 403},
	} {
		t.Run(tc.name, func(t *testing.T) {
			restarted := false
			request := httptest.NewRequest(tc.method, "http://service.test/nested", nil)
			request.Header.Set(recoveryHeader, tc.action)
			if tc.origin != "" {
				request.Header.Set("Origin", tc.origin)
			}
			if tc.fetchSite != "" {
				request.Header.Set("Sec-Fetch-Site", tc.fetchSite)
			}
			response := httptest.NewRecorder()
			serveRecoveryControl(response, request, StartDocumentInjectionServerOptions{GetRecovery: func() RecoveryState { return RecoveryState{CanRestart: true} }, Restart: func() error { restarted = true; return nil }}, nil)
			if response.Code != tc.want || restarted != tc.restart {
				t.Fatalf("status = %d, restarted = %t", response.Code, restarted)
			}
		})
	}
}
