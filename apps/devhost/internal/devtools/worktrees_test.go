package devtools

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestWorktreeOwnerStopEndpointValidatesSelection(t *testing.T) {
	var stopped atomic.Bool
	server, err := StartControlServer(StartControlServerOptions{
		GetHealthResponse: func() (HealthResponse, error) { return HealthResponse{}, nil },
		RefreshWorktrees:  func() error { return nil },
		SwitchWorktree:    func(string, string) error { return fmt.Errorf("unexpected switch") },
		StopWorktreeOwner: func(_ context.Context, id, path, owner string) error {
			if id != "shop" || path != "/feature" || owner != "owner-instance" {
				return fmt.Errorf("ownership changed")
			}
			stopped.Store(true)
			return nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := server.Stop(); err != nil {
			t.Error(err)
		}
	})
	for _, tc := range []struct {
		name, payload string
		status        int
		stops         bool
	}{
		{"arbitrary PID", `{"repositoryId":"shop","path":"/feature","stopOwnerId":"owner-instance","pid":123}`, http.StatusBadRequest, false},
		{"missing checkout", `{"repositoryId":"shop","stopOwnerId":"owner-instance"}`, http.StatusBadRequest, false},
		{"stale owner", `{"repositoryId":"shop","path":"/feature","stopOwnerId":"old-instance"}`, http.StatusInternalServerError, false},
		{"current owner", `{"repositoryId":"shop","path":"/feature","stopOwnerId":"owner-instance"}`, http.StatusOK, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			response := worktreeHTTPResponse(t, server, http.MethodPost, tc.payload)
			response.Body.Close()
			if response.StatusCode != tc.status || stopped.Load() != tc.stops {
				t.Fatalf("stop response %d, stopped %v", response.StatusCode, stopped.Load())
			}
		})
	}
}

func TestWorktreesEndpointPublishesSelectionToAllClients(t *testing.T) {
	var mu sync.Mutex
	repo := WorktreeRepository{ID: "shop", Name: "shop", ConfiguredPath: "/main", SelectedPath: "/main", RunningPath: "/main", ServiceNames: []string{"web"}, Worktrees: []Worktree{}}
	var server *ControlServer
	var err error
	refreshes := 0
	server, err = StartControlServer(StartControlServerOptions{
		GetHealthResponse: func() (HealthResponse, error) {
			mu.Lock()
			defer mu.Unlock()
			return HealthResponse{Services: []ServiceHealth{{Name: "web", Managed: true}}, Repositories: []WorktreeRepository{repo}}, nil
		},
		RefreshWorktrees: func() error { mu.Lock(); defer mu.Unlock(); refreshes++; return nil },
		SwitchWorktree: func(id, path string) error {
			if id != "shop" {
				return fmt.Errorf("unknown repository")
			}
			mu.Lock()
			repo.SelectedPath, repo.RunningPath = path, path
			mu.Unlock()
			return server.PublishHealthResponse()
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := server.Stop(); err != nil {
			t.Error(err)
		}
	})
	for _, tc := range []struct {
		name, method, body string
		status             int
	}{
		{name: "wrong method", method: http.MethodDelete, status: http.StatusMethodNotAllowed},
		{name: "invalid payload", method: http.MethodPost, body: `{"repositoryId":"shop"}`, status: http.StatusBadRequest},
		{name: "unknown fields", method: http.MethodPost, body: `{"repositoryId":"shop","path":"/feature","command":["unsafe"]}`, status: http.StatusBadRequest},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := worktreeHTTPResponse(t, server, tc.method, tc.body)
			defer r.Body.Close()
			if r.StatusCode != tc.status {
				t.Fatalf("status = %d, want %d", r.StatusCode, tc.status)
			}
		})
	}
	if refreshes != 0 {
		t.Fatal("invalid request reached worktree discovery")
	}
	clients := make([]*websocket.Conn, 2)
	for i := range clients {
		client, _, err := websocket.DefaultDialer.Dial(fmt.Sprintf("ws://127.0.0.1:%d%s", server.Port(), healthWebsocketPath), nil)
		if err != nil {
			t.Fatal(err)
		}
		clients[i] = client
		defer client.Close()
		if err := client.SetReadDeadline(time.Now().Add(5 * time.Second)); err != nil {
			t.Fatal(err)
		}
		var initial HealthResponse
		if err := client.ReadJSON(&initial); err != nil {
			t.Fatal(err)
		}
		if initial.Repositories[0].SelectedPath != "/main" {
			t.Fatal("initial selection missing")
		}
	}
	response := worktreeHTTPResponse(t, server, http.MethodPost, `{"repositoryId":"shop","path":"/feature"}`)
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("switch status = %d", response.StatusCode)
	}
	for _, client := range clients {
		var updated HealthResponse
		if err := client.ReadJSON(&updated); err != nil {
			t.Fatal(err)
		}
		if updated.Repositories[0].SelectedPath != "/feature" {
			t.Fatalf("client retained stale checkout: %#v", updated)
		}
	}
	response = worktreeHTTPResponse(t, server, http.MethodGet, "")
	defer response.Body.Close()
	var refreshed HealthResponse
	if err := json.NewDecoder(response.Body).Decode(&refreshed); err != nil {
		t.Fatal(err)
	}
	if refreshed.Repositories[0].SelectedPath != "/feature" || refreshes != 1 {
		t.Fatalf("refresh = %#v, calls=%d", refreshed, refreshes)
	}
}

func worktreeHTTPResponse(t *testing.T, server *ControlServer, method, body string) *http.Response {
	t.Helper()
	r, err := http.NewRequest(method, serverURL(server.Port(), worktreesPath), strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	r.Header.Set("Content-Type", jsonMediaType)
	response, err := http.DefaultClient.Do(r)
	if err != nil {
		t.Fatal(err)
	}
	return response
}

func TestWorktreesEndpointReportsDiscoveryAndSwitchFailures(t *testing.T) {
	for _, method := range []string{http.MethodGet, http.MethodPost} {
		t.Run(method, func(t *testing.T) {
			s := &ControlServer{refreshWorktrees: func() error { return fmt.Errorf("Git unavailable") }, switchWorktree: func(string, string) error { return fmt.Errorf("Service web failed") }}
			response := httptest.NewRecorder()
			r := httptest.NewRequest(method, worktreesPath, strings.NewReader(`{"repositoryId":"shop","path":"/feature"}`))
			s.handleWorktrees(response, r)
			if response.Code != http.StatusInternalServerError {
				t.Fatalf("failure status=%d", response.Code)
			}
			body, err := io.ReadAll(response.Result().Body)
			if err != nil {
				t.Fatal(err)
			}
			want := "Git unavailable\n"
			if method == http.MethodPost {
				want = "Service web failed\n"
			}
			if string(body) != want {
				t.Fatalf("failure body=%q", body)
			}
		})
	}
}
