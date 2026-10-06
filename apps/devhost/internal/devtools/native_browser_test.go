package devtools

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/manifest"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/nativebrowser"
	"github.com/gorilla/websocket"
)

func TestNativeRequestOrigin(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name, host string
		origins    []string
		want       string
	}{
		{"HTTPS", "project.localhost:4443", []string{"https://project.localhost:4443"}, "https://project.localhost:4443"},
		{"HTTP", "project.localhost:8080", []string{"http://project.localhost:8080"}, "http://project.localhost:8080"},
		{"missing", "project.localhost", nil, ""},
		{"opaque", "project.localhost", []string{"null"}, ""},
		{"duplicate", "project.localhost", []string{"https://project.localhost", "https://project.localhost"}, ""},
		{"other host", "project.localhost", []string{"https://other.localhost"}, ""},
		{"other port", "project.localhost:4443", []string{"https://project.localhost"}, ""},
		{"credentials", "project.localhost", []string{"https://user@project.localhost"}, ""},
		{"path", "project.localhost", []string{"https://project.localhost/"}, ""},
		{"query", "project.localhost", []string{"https://project.localhost?x=y"}, ""},
		{"fragment", "project.localhost", []string{"https://project.localhost#x"}, ""},
		{"empty fragment", "project.localhost", []string{"https://project.localhost#"}, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodGet, "http://"+tc.host+nativeBrowserWebsocketPath, nil)
			r.Header["Origin"] = tc.origins
			r.Header.Set("Forwarded", "proto=https;host=project.localhost")
			r.Header.Set("X-Forwarded-Host", "project.localhost")
			r.Header.Set("X-Forwarded-Proto", "https")
			got, err := nativeRequestOrigin(r)
			if got != tc.want || (err == nil) != (tc.want != "") {
				t.Fatalf("origin = %q, %v; want %q", got, err, tc.want)
			}
		})
	}
}

func startNativeBoundaryServer(t *testing.T) (*ControlServer, string, *atomic.Int64) {
	t.Helper()
	requests := new(atomic.Int64)
	endpoint := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		http.Error(w, "Native browser fixture is deliberately unavailable", http.StatusServiceUnavailable)
	}))
	t.Cleanup(endpoint.Close)
	s, err := StartControlServer(StartControlServerOptions{
		NativeBrowser:     manifest.DevtoolsBrowserConfig{Endpoint: endpoint.URL},
		FeatureToggles:    FeatureToggles{ExternalToolbarsEnabled: true},
		GetHealthResponse: func() (HealthResponse, error) { return HealthResponse{}, nil },
		AllowsNativeBrowserURL: func(port int, href string) (bool, error) {
			return href == serverURL(port, "/") || href == serverURL(port, "/owned"), nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	origin := serverURL(s.Port(), "")
	t.Cleanup(func() {
		if err := s.Stop(); err != nil {
			t.Errorf("stop native boundary server: %v", err)
		}
	})
	return s, origin, requests
}

func TestNativeBrowserWebsocketRejectsOriginAndProtocolBeforeDiscovery(t *testing.T) {
	for _, tc := range []struct {
		name, origin string
		protocols    []string
	}{
		{"missing origin", "", []string{nativeBrowserProtocol}},
		{"foreign origin", "https://other.localhost", []string{nativeBrowserProtocol}},
		{"missing protocol", "same", nil},
		{"unknown protocol", "same", []string{"other"}},
		{"extra protocol", "same", []string{nativeBrowserProtocol, "devhost-token.credential"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s, origin, requests := startNativeBoundaryServer(t)
			value := tc.origin
			if value == "same" {
				value = origin
			}
			dialer := websocket.Dialer{Subprotocols: tc.protocols, HandshakeTimeout: time.Second}
			conn, response, err := dialer.Dial(websocketURL(s.Port(), nativeBrowserWebsocketPath), http.Header{"Origin": []string{value}, "X-Forwarded-Host": []string{strings.TrimPrefix(origin, "http://")}})
			if conn != nil {
				_ = conn.Close() /* unexpected upgrade; assertions below report it */
			}
			if err == nil || response == nil {
				t.Fatalf("rejected handshake returned conn=%v response=%v err=%v", conn, response, err)
			}
			if err := response.Body.Close(); err != nil {
				t.Fatal(err)
			}
			if response.StatusCode != http.StatusForbidden {
				t.Fatalf("handshake status=%d, want403", response.StatusCode)
			}
			if requests.Load() != 0 {
				t.Fatalf("rejected handshake contacted browser %d times", requests.Load())
			}
		})
	}
}

func TestNativeBrowserWebsocketRejectsStaleOrForeignBindingBeforeDiscovery(t *testing.T) {
	for _, tc := range []struct{ name, command, instance, path, id string }{
		{"stale instance", "connect", "00000000000000000000000000000000", "/owned", "connect_1"},
		{"foreign document path", "connect", "current", "/foreign", "connect_1"},
		{"foreign document origin", "connect", "current", "https://foreign.localhost/", "connect_1"},
		{"action before connect", "open-react", "current", "/owned", "open_1"},
		{"invalid correlation", "connect", "current", "/owned", "invalid id"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s, origin, requests := startNativeBoundaryServer(t)
			instance := tc.instance
			if instance == "current" {
				instance = s.nativeBrowserInstanceID
			}
			href := origin + tc.path
			if strings.HasPrefix(tc.path, "https://") {
				href = tc.path
			}
			dialer := websocket.Dialer{Subprotocols: []string{nativeBrowserProtocol}, HandshakeTimeout: time.Second}
			conn, _, err := dialer.Dial(websocketURL(s.Port(), nativeBrowserWebsocketPath), http.Header{"Origin": []string{origin}})
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = conn.Close() /* socket may already be closed by the rejected request */ })
			if err := conn.WriteJSON(nativebrowser.Request{ID: tc.id, Command: tc.command, Binding: nativebrowser.Binding{InstanceID: instance, DocumentID: "11111111111111111111111111111111", Href: href}}); err != nil {
				t.Fatal(err)
			}
			if err := conn.SetReadDeadline(time.Now().Add(time.Second)); err != nil {
				t.Fatal(err)
			}
			_, _, err = conn.ReadMessage()
			if err == nil {
				t.Fatal("invalid binding received a native browser message")
			}
			if timeout, ok := err.(interface{ Timeout() bool }); ok && timeout.Timeout() {
				t.Fatalf("invalid binding was not closed: %v", err)
			}
			if requests.Load() != 0 {
				t.Fatalf("invalid binding contacted browser %d times", requests.Load())
			}
		})
	}
}

func TestNativeBrowserWebsocketReportsRealDiscoveryFailureAndJoins(t *testing.T) {
	s, origin, requests := startNativeBoundaryServer(t)
	dialer := websocket.Dialer{Subprotocols: []string{nativeBrowserProtocol}, HandshakeTimeout: time.Second}
	conn, _, err := dialer.Dial(websocketURL(s.Port(), nativeBrowserWebsocketPath), http.Header{"Origin": []string{origin}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = conn.Close() /* handler closure may have already released it */ })
	if err := conn.WriteJSON(nativebrowser.Request{ID: "connect_1", Command: "connect", Binding: nativebrowser.Binding{InstanceID: s.nativeBrowserInstanceID, DocumentID: "11111111111111111111111111111111", Href: origin + "/owned"}}); err != nil {
		t.Fatal(err)
	}
	if err := conn.SetReadDeadline(time.Now().Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	var update nativebrowser.Update
	if err := conn.ReadJSON(&update); err != nil {
		t.Fatal(err)
	}
	if update.Type != "error" || update.ID != "connect_1" || update.Error != "Browser discovery failed. Check the configured loopback endpoint and running dedicated profile." {
		t.Fatalf("unexpected discovery failure: %#v", update)
	}
	if requests.Load() != 1 {
		t.Fatalf("discovery requests=%d, want1", requests.Load())
	}
	if err := s.Stop(); err != nil {
		t.Fatal(err)
	}
	_, _, err = conn.ReadMessage()
	if err == nil {
		t.Fatal("stopped native control connection remained open")
	}
}

func TestNativeBrowserConfigKeepsEndpointServerOnly(t *testing.T) {
	t.Parallel()
	var ids []string
	for range 2 {
		s, err := StartControlServer(StartControlServerOptions{
			NativeBrowser:     manifest.DevtoolsBrowserConfig{Endpoint: "http://127.0.0.1:9222", ReactExtensionID: "fmkadmapgofadopljbjfkapdkoienihi"},
			GetHealthResponse: func() (HealthResponse, error) { return HealthResponse{}, nil },
			StackName:         "native-config-test",
		})
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() {
			if err := s.Stop(); err != nil {
				t.Errorf("stop: %v", err)
			}
		})
		response, err := http.Get(serverURL(s.Port(), injectedConfigPath))
		if err != nil {
			t.Fatal(err)
		}
		data := []byte(readResponseText(t, response))
		if err := response.Body.Close(); err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(data), "9222") || strings.Contains(string(data), "fmkadmap") {
			t.Fatalf("server-only browser setup leaked: %s", data)
		}
		var cfg injectedConfig
		if err := json.Unmarshal(data, &cfg); err != nil {
			t.Fatal(err)
		}
		if !cfg.NativeBrowserConfigured || !nativeIdentityPattern.MatchString(cfg.NativeBrowserInstanceID) {
			t.Fatalf("invalid runtime native configuration: %s", data)
		}
		ids = append(ids, cfg.NativeBrowserInstanceID)
	}
	if ids[0] == ids[1] {
		t.Fatal("separate control servers reused an instance identity")
	}
}

func TestNativeBrowserWebsocketOwnsIdleProtectionUntilStop(t *testing.T) {
	s, origin, _ := startNativeBoundaryServer(t)
	dialer := websocket.Dialer{Subprotocols: []string{nativeBrowserProtocol}, HandshakeTimeout: time.Second}
	conn, _, err := dialer.Dial(websocketURL(s.Port(), nativeBrowserWebsocketPath), http.Header{"Origin": []string{origin}})
	if err != nil {
		t.Fatal(err)
	}
	if err := conn.SetReadDeadline(time.Now().Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	pong := make(chan struct{})
	readDone := make(chan struct{})
	conn.SetPongHandler(func(string) error { close(pong); return nil })
	go func() {
		defer close(readDone)
		_, _, _ = conn.ReadMessage() // The terminal socket close is expected; the real Pong handler proves handshake readiness.
	}()
	defer func() { _ = conn.Close(); /* stop or a failed assertion already ends this owned lease */ <-readDone }()
	if err := conn.WriteControl(websocket.PingMessage, []byte("activity"), time.Now().Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	select {
	case <-pong:
	case <-time.After(time.Second):
		t.Fatal("native handshake did not process its real ping")
	}
	if s.Tracker().IsIdle(time.Nanosecond) {
		t.Fatal("live native control socket did not protect the stack from idle shutdown")
	}
	if err := s.Stop(); err != nil {
		t.Fatal(err)
	}
	<-readDone
	if !s.Tracker().IsIdle(time.Nanosecond) {
		t.Fatal("stopped native control socket retained idle protection")
	}
}
