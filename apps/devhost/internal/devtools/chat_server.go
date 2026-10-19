package devtools

import (
	"encoding/json"
	"fmt"
	"github.com/gorilla/websocket"
	"io"
	"net/http"
	"strings"
)

func chatOrigin(w http.ResponseWriter, r *http.Request, required bool) bool {
	if !required && len(r.Header.Values("Origin")) == 0 && r.Header.Get("Sec-Fetch-Site") != "cross-site" {
		return true
	}
	if _, err := nativeRequestOrigin(r); err != nil {
		http.Error(w, err.Error(), http.StatusForbidden)
		return false
	}
	return true
}

// whileChatEnabled answers 404 while chat is off, so the routes follow the toggle across hot reloads. Running
// sessions keep running; a page reaches them again once chat is back on.
func (s *ControlServer) whileChatEnabled(handler http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.currentSettings().FeatureToggles.ChatEnabled {
			http.NotFound(w, r)
			return
		}
		handler(w, r)
	}
}
func chatJSON(w http.ResponseWriter, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	if err := json.NewEncoder(w).Encode(value); err != nil {
		return
	}
}

func (s *ControlServer) handleChatHarnesses(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", 405)
		return
	}
	if !chatOrigin(w, r, false) {
		return
	}
	tool, err := s.toolContext(r.URL.Query().Get("pageURL"))
	if err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	ctx, cancel := chatCallContext(r.Context())
	defer cancel()
	results := []chatHarness{s.chat.discover(ctx, chatCodex, tool.ProjectRootPath), s.chat.discover(ctx, chatClaude, tool.ProjectRootPath)}
	chatJSON(w, map[string]any{"harnesses": results})
}

func (s *ControlServer) handleChatSessions(w http.ResponseWriter, r *http.Request) {
	if !chatOrigin(w, r, r.Method != http.MethodGet) {
		return
	}
	id := strings.TrimPrefix(r.URL.Path, chatSessionsPath+"/")
	if r.Method == http.MethodDelete && id != r.URL.Path {
		tool, err := s.toolContext(r.URL.Query().Get("pageURL"))
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		session := s.chatSessionInProject(id, tool.ProjectRootPath)
		if session == nil {
			http.NotFound(w, r)
			return
		}
		session.close()
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if r.URL.Path != chatSessionsPath {
		http.NotFound(w, r)
		return
	}
	switch r.Method {
	case http.MethodGet:
		tool, err := s.toolContext(r.URL.Query().Get("pageURL"))
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		s.chat.mu.Lock()
		sessions := make([]chatSessionInfo, 0, len(s.chat.sessions))
		for _, session := range s.chat.sessions {
			info := session.snapshot()
			if info.ProjectRootPath == tool.ProjectRootPath {
				sessions = append(sessions, info)
			}
		}
		s.chat.mu.Unlock()
		chatJSON(w, map[string]any{"sessions": sessions})
	case http.MethodPost:
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64*1024))
		decoder.DisallowUnknownFields()
		var request chatSessionRequest
		if err := decoder.Decode(&request); err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		var trailing any
		if err := decoder.Decode(&trailing); err != io.EOF {
			http.Error(w, "expected one JSON request", 400)
			return
		}
		if request.Harness != chatCodex && request.Harness != chatClaude {
			http.Error(w, "unknown harness", 400)
			return
		}
		tool, err := s.toolContext(request.PageURL)
		if err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		if !s.chatResumeMatchesProject(request.ResumeID, request.Harness, tool.ProjectRootPath) {
			http.Error(w, "Native session belongs to a different project.", http.StatusForbidden)
			return
		}
		ctx, cancel := chatCallContext(r.Context())
		defer cancel()
		session, err := s.chat.start(ctx, request, tool.ProjectRootPath)
		if err != nil {
			http.Error(w, err.Error(), 502)
			return
		}
		chatJSON(w, session.snapshot())
	default:
		http.Error(w, "method not allowed", 405)
	}
}

func (s *ControlServer) handleChatWebsocket(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "GET required", http.StatusMethodNotAllowed)
		return
	}
	if !chatOrigin(w, r, true) {
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
	id := r.URL.Query().Get("sessionId")
	if id == "" {
		http.Error(w, "missing sessionId", 400)
		return
	}
	tool, err := s.toolContext(r.URL.Query().Get("pageURL"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	session := s.chatSessionInProject(id, tool.ProjectRootPath)
	if session == nil {
		http.NotFound(w, r)
		return
	}
	conn, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	s.tracker.IncrementActive()
	client := &websocketClient{conn: conn, writeTimeout: s.websocketWriteTimeout, tracker: s.tracker}
	conn.SetReadLimit(chatMessageLimit)
	session.mu.Lock()
	if session.info.Status == "closed" {
		session.mu.Unlock()
		client.closeWith(websocket.CloseNormalClosure, "Chat session closed")
		return
	}
	client.writeMu.Lock()
	err = client.writeJSONMessagesLocked([]any{chatMessage{Type: "snapshot", SessionID: id, Session: session.infoCopyLocked(), Events: session.events, PendingRequestIDs: session.pendingIDsLocked()}})
	if err == nil {
		session.clients[client] = struct{}{}
	}
	client.writeMu.Unlock()
	session.mu.Unlock()
	defer func() { session.mu.Lock(); delete(session.clients, client); session.mu.Unlock(); client.close() }()
	if err != nil {
		return
	}
	for {
		kind, payload, readErr := conn.ReadMessage()
		if readErr != nil {
			return
		}
		if kind != websocket.TextMessage {
			continue
		}
		var command chatCommand
		decoder := json.NewDecoder(strings.NewReader(string(payload)))
		decoder.DisallowUnknownFields()
		commandErr := decoder.Decode(&command)
		if commandErr == nil {
			var extra any
			if decoder.Decode(&extra) != io.EOF {
				commandErr = fmt.Errorf("expected one JSON command")
			}
		}
		if commandErr == nil {
			if command.Type == "send" && command.CommandID == "" {
				commandErr = fmt.Errorf("send command requires commandId")
			}
		}
		if commandErr == nil {
			commandErr = s.chatCommandProjectError(session, r.URL.Query().Get("pageURL"))
		}
		if commandErr == nil {
			ctx, cancel := chatCallContext(s.ctx)
			commandErr = session.execute(ctx, command)
			cancel()
		}
		response := chatMessage{Type: "error", SessionID: id}
		if command.Type == "send" && command.CommandID != "" {
			response.Type = "command_result"
			response.CommandID = command.CommandID
		}
		if commandErr != nil {
			response.Error = commandErr.Error()
		}
		if response.Type == "command_result" || commandErr != nil {
			client.writeMu.Lock()
			writeErr := client.writeJSONMessagesLocked([]any{response})
			client.writeMu.Unlock()
			if writeErr != nil {
				return
			}
		}
	}
}
