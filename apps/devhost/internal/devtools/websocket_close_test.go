package devtools

import (
	"errors"
	"testing"
	"time"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/manifest"
	"github.com/gorilla/websocket"
)

// A browser decides from the close code whether to reopen a connection: it reopens one that ended while the stack
// was stopping, and leaves one that ended on purpose closed. Without a close frame it sees every end as a failure.

func TestControlServerStopTellsStreamClientsItIsGoingAway(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		path string
		// countClients reads how many connections the server holds for the stream. The caller holds the server lock.
		countClients func(s *ControlServer) int
	}{
		{"health", healthWebsocketPath, func(s *ControlServer) int { return len(s.healthClients) }},
		{"logs", logsWebsocketPath, func(s *ControlServer) int { return len(s.logsClients) }},
		{"annotation queues", annotationQueuesWebsocketPath, func(s *ControlServer) int { return len(s.annotationQueueClients) }},
		{"react highlight", reactHighlightWebsocketPath, func(s *ControlServer) int { return len(s.reactHighlightClients) }},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			controlServer := startStreamTestControlServer(t)
			connection := mustDialWebsocket(t, websocketURL(controlServer.Port(), tt.path))
			defer connection.Close()
			awaitWebsocketClients(t, controlServer, 1, tt.countClients)

			if err := controlServer.Stop(); err != nil {
				t.Fatalf("Stop() error = %v", err)
			}

			if code := readWebsocketCloseCode(t, connection); code != websocket.CloseGoingAway {
				t.Fatalf("close code = %d, want %d", code, websocket.CloseGoingAway)
			}
		})
	}
}

func TestControlServerEndsTerminalConnectionsNormallyWithTheirSession(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		end  func(t *testing.T, controlServer *ControlServer, attached *websocket.Conn)
	}{
		{"a page closes the session", func(t *testing.T, _ *ControlServer, attached *websocket.Conn) {
			t.Helper()
			if err := attached.WriteMessage(websocket.TextMessage, []byte(`{"type":"close"}`)); err != nil {
				t.Fatalf("WriteMessage(close) error = %v", err)
			}
		}},
		{"the stack stops", func(t *testing.T, controlServer *ControlServer, _ *websocket.Conn) {
			t.Helper()
			if err := controlServer.Stop(); err != nil {
				t.Fatalf("Stop() error = %v", err)
			}
		}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			controlServer := startTerminalTestControlServer(t, newTestTerminalStarter(), time.Hour)
			sessionID := startTerminalTestSession(t, controlServer, editorTerminalTestRequest)
			first := mustDialWebsocket(t, terminalWebsocketURL(controlServer.Port(), sessionID))
			defer first.Close()
			second := mustDialWebsocket(t, terminalWebsocketURL(controlServer.Port(), sessionID))
			defer second.Close()
			awaitWebsocketClients(t, controlServer, 2, func(s *ControlServer) int {
				return len(s.terminalSessions[sessionID].clients)
			})

			tt.end(t, controlServer, first)

			for _, connection := range []*websocket.Conn{first, second} {
				if code := readWebsocketCloseCode(t, connection); code != websocket.CloseNormalClosure {
					t.Fatalf("close code = %d, want %d", code, websocket.CloseNormalClosure)
				}
			}
		})
	}
}

func startStreamTestControlServer(t *testing.T) *ControlServer {
	t.Helper()

	controlServer, err := StartControlServer(StartControlServerOptions{
		AnnotationActions: []manifest.ValidatedAnnotationAction{{
			Agent: manifest.ValidatedAgent{Kind: "pi"},
			Label: "Pi",
			ID:    defaultAnnotationActionID,
			Kind:  "agent",
		}},
		AnnotationDefaultActionID: defaultAnnotationActionID,
		FeatureToggles: FeatureToggles{
			AnnotationEnabled:      true,
			AnnotationQueueEnabled: true,
			StatusEnabled:          true,
			TerminalEnabled:        true,
		},
		GetHealthResponse: func() (HealthResponse, error) {
			return HealthResponse{Services: []ServiceHealth{}}, nil
		},
		Position:             "bottom-right",
		ProjectRootPath:      t.TempDir(),
		StackName:            "hello-stack",
		StartTerminalSession: newTestTerminalStarter().start,
		StateDirectoryPath:   t.TempDir(),
	})
	if err != nil {
		t.Fatalf("StartControlServer(...) error = %v", err)
	}
	t.Cleanup(func() {
		_ = controlServer.Stop() // already stopped by the test; stopping twice is a no-op
	})

	return controlServer
}

// awaitWebsocketClients returns once the server holds want connections. The server learns of a connection after the
// handshake a dial waits for, so a test that ends connections right after dialing can find none.
func awaitWebsocketClients(t *testing.T, controlServer *ControlServer, want int, countClients func(s *ControlServer) int) {
	t.Helper()

	deadline := time.Now().Add(5 * time.Second)
	for {
		controlServer.mu.Lock()
		got := countClients(controlServer)
		controlServer.mu.Unlock()
		if got == want {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("server holds %d connections, want %d", got, want)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

// readWebsocketCloseCode reads past whatever the server still sends and returns the code of its close frame.
func readWebsocketCloseCode(t *testing.T, connection *websocket.Conn) int {
	t.Helper()

	if err := connection.SetReadDeadline(time.Now().Add(5 * time.Second)); err != nil {
		t.Fatalf("SetReadDeadline(...) error = %v", err)
	}
	for {
		_, _, err := connection.ReadMessage()
		if err == nil {
			continue
		}

		var closeError *websocket.CloseError
		if !errors.As(err, &closeError) {
			t.Fatalf("connection ended without a close frame: %v", err)
		}
		return closeError.Code
	}
}
