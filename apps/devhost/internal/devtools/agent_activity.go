package devtools

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"time"
	"unicode/utf8"

	watcher "github.com/alexgorbatchev/agent-watcher"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/cliout"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/statuspage"
	"github.com/gorilla/websocket"
)

const (
	agentActivityPath          = controlPathPrefix + "/agents/activity"
	agentActivityWebsocketPath = controlPathPrefix + "/ws/agents/activity"
	agentActivityScanInterval  = 5 * time.Second
	// agentActivityTextLimit bounds one event, because a tool can return a whole file.
	agentActivityTextLimit = 4096
	agentActivityHost      = "127.0.0.1"
)

// agentActivityEvent is one normalized event an agent produced. It can hold
// anything the agent read, secrets included, so it reaches only the direct origin.
type agentActivityEvent struct {
	Harness   string `json:"harness"`
	PID       int    `json:"pid"`
	EventType string `json:"eventType"`
	Timestamp int64  `json:"timestamp"`
	Role      string `json:"role,omitempty"`
	ToolName  string `json:"toolName,omitempty"`
	Text      string `json:"text,omitempty"`
	IsError   bool   `json:"isError,omitempty"`
}

type agentWatcherFunc func(context.Context, watcher.Config, watcher.Handler) error

// controlOrigin is this server's own address, an origin no application page shares.
func (s *ControlServer) controlOrigin() string {
	return "http://" + net.JoinHostPort(agentActivityHost, strconv.Itoa(s.Port()))
}

// isDirectRequest reports a request made to this server's own address. Every routed
// host shares its origin with the application, whose scripts could read the
// response: the control API has no token, so the origin is the only boundary.
func (s *ControlServer) isDirectRequest(r *http.Request) bool {
	return r.Host == net.JoinHostPort(agentActivityHost, strconv.Itoa(s.Port())) && isLocalClient(r)
}

func (s *ControlServer) handleAgentActivityPage(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !s.isDirectRequest(r) {
		http.Error(w, "Agent activity opens from the running agents list.", http.StatusForbidden)
		return
	}
	if _, err := s.chatQueryRoot(r); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	document, err := statuspage.Render(statuspage.Page{
		Kind: "agent-activity", Status: http.StatusOK, Title: "Agent activity",
		Message: "What the agents in this checkout do from now on, including agents devhost did not start.",
	}, "")
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Cache-Control", cacheControlNoStore)
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("Content-Type", textHTMLContentType)
	_, _ = w.Write([]byte(document)) // Response failures cannot be recovered after writing headers.
}

func newAgentActivityEvent(event watcher.Event) agentActivityEvent {
	message := agentActivityEvent{Harness: string(event.Harness), PID: event.PID, EventType: event.EventType, Timestamp: event.Timestamp}
	data := event.Data
	if data.Role != nil {
		message.Role = *data.Role
	}
	if data.ToolName != nil {
		message.ToolName = *data.ToolName
	}
	if data.IsError != nil {
		message.IsError = *data.IsError
	}
	switch {
	case data.Content != nil:
		message.Text = limitAgentActivityText(*data.Content)
	case data.ToolOutput != nil:
		message.Text = limitAgentActivityText(*data.ToolOutput)
	}
	return message
}

func limitAgentActivityText(text string) string {
	if len(text) <= agentActivityTextLimit {
		return text
	}
	end := agentActivityTextLimit
	for end > 0 && !utf8.RuneStart(text[end]) {
		end--
	}
	return text[:end] + "…"
}

// handleAgentActivityWebsocket tails the checkout's agents for as long as the page
// is open. Each page has its own run, because a run needs its own state paths.
func (s *ControlServer) handleAgentActivityWebsocket(w http.ResponseWriter, r *http.Request) {
	if !s.isDirectRequest(r) {
		http.Error(w, "Agent activity opens from the running agents list.", http.StatusForbidden)
		return
	}
	root, err := s.chatQueryRoot(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	s.mu.Lock()
	if s.isStopped {
		s.mu.Unlock()
		http.Error(w, "Devhost is stopping", http.StatusServiceUnavailable)
		return
	}
	s.serverWG.Add(1)
	s.mu.Unlock()
	defer s.serverWG.Done()
	stateDirectory, err := os.MkdirTemp("", "devhost-agent-activity-*")
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer func() { _ = os.RemoveAll(stateDirectory) }() // Only this page's cursors; a leftover holds no transcript text.
	conn, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	s.tracker.IncrementActive()
	client := &websocketClient{conn: conn, writeTimeout: s.websocketWriteTimeout, tracker: s.tracker}
	ctx, cancel := context.WithCancel(s.ctx)
	defer cancel()
	go func() {
		defer cancel()
		for {
			if _, _, err := conn.NextReader(); err != nil {
				return
			}
		}
	}()
	err = s.runAgentWatcher(ctx, watcher.Config{
		ScanInterval:     agentActivityScanInterval,
		CursorPath:       filepath.Join(stateDirectory, "cursors.json"),
		SessionStatePath: filepath.Join(stateDirectory, "sessions.json"),
		StartAtEnd:       true,
		SessionFilter:    func(session watcher.Session) bool { return !session.Subagent && isInCheckout(session.CWD, root) },
		Logger:           cliout.NewLibraryLogger(s.chat.logLine),
	}, func(_ context.Context, event watcher.Event, acknowledge func()) error {
		client.writeMu.Lock()
		err := client.writeJSONMessagesLocked([]any{newAgentActivityEvent(event)})
		client.writeMu.Unlock()
		if err != nil {
			return fmt.Errorf("publish agent activity: %w", err)
		}
		if acknowledge != nil {
			acknowledge()
		}
		return nil
	})
	code, reason := websocket.CloseNormalClosure, "Agent activity ended"
	switch {
	case s.ctx.Err() != nil:
		code, reason = websocket.CloseGoingAway, "Devhost stopping"
	case err != nil && !errors.Is(err, context.Canceled):
		code, reason = websocket.CloseInternalServerErr, "Agent activity failed"
	}
	client.closeWith(code, reason)
}
