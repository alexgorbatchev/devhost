package devtools

import (
	"encoding/json"
	"fmt"
	"github.com/gorilla/websocket"
	"io"
	"net/http"
	"strings"
	"time"
)

// requireChatPage refuses a chat request that changes a session or opens a session socket unless a browser page
// sent it. Chat runs a coding agent in the project, so only the routed page may start or steer one; the control
// guard has already refused an Origin from another site, so this only adds that an Origin must be present.
func requireChatPage(w http.ResponseWriter, r *http.Request) bool {
	if r.Method == http.MethodGet && !websocket.IsWebSocketUpgrade(r) {
		return true
	}
	if len(r.Header.Values("Origin")) == 0 {
		http.Error(w, "Chat requests must come from the routed page.", http.StatusForbidden)
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

func (s *ControlServer) chatQueryRoot(r *http.Request) (string, error) {
	query := r.URL.Query()
	return s.chatRoot(query.Get("pageURL"), query.Get("chatTarget"))
}

func (s *ControlServer) handleChatHarnesses(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", 405)
		return
	}
	root, err := s.chatQueryRoot(r)
	if err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	ctx, cancel := chatCallContext(r.Context())
	defer cancel()
	results := []chatHarness{s.chat.discover(ctx, chatCodex, root), s.chat.discover(ctx, chatClaude, root)}
	chatJSON(w, map[string]any{"harnesses": results})
}

func (s *ControlServer) handleChatSessions(w http.ResponseWriter, r *http.Request) {
	if !requireChatPage(w, r) {
		return
	}
	// Closing stops the native process and keeps the conversation listed, so a page can still resume it.
	if id, isClose := strings.CutSuffix(strings.TrimPrefix(r.URL.Path, chatSessionsPath+"/"), chatSessionCloseSuffix); isClose && id != "" && !strings.Contains(id, "/") {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		root, err := s.chatQueryRoot(r)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		session := s.chatSessionInProject(id, root)
		if session == nil {
			http.NotFound(w, r)
			return
		}
		session.close()
		chatJSON(w, session.snapshot())
		return
	}
	if r.URL.Path != chatSessionsPath {
		http.NotFound(w, r)
		return
	}
	switch r.Method {
	case http.MethodGet:
		root, err := s.chatQueryRoot(r)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		s.chat.mu.Lock()
		sessions := make([]chatSessionInfo, 0, len(s.chat.sessions))
		for _, session := range s.chat.sessions {
			info := session.snapshot()
			if info.ProjectRootPath == root {
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
		root, err := s.chatRoot(request.PageURL, request.Target)
		if err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		if !s.chatResumeMatchesProject(request.ResumeID, request.Harness, root) {
			http.Error(w, "Native session belongs to a different project.", http.StatusForbidden)
			return
		}
		ctx, cancel := chatCallContext(r.Context())
		defer cancel()
		session, err := s.chat.start(ctx, request, root)
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
	if !requireChatPage(w, r) {
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
	root, err := s.chatQueryRoot(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	session := s.chatSessionInProject(id, root)
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
	err = client.writeChatSnapshotLocked(session)
	if err == nil {
		session.clients[client] = struct{}{}
	}
	client.writeMu.Unlock()
	session.mu.Unlock()
	defer func() { session.mu.Lock(); delete(session.clients, client); session.mu.Unlock(); client.close() }()
	if err != nil {
		return
	}
	// Sends stay ordered while approvals and interrupts can pass a pending native acknowledgement.
	type queuedCommand struct {
		command  chatCommand
		queuedAt time.Time
	}
	sends := make(chan queuedCommand, 16)
	done := make(chan struct{})
	go func() {
		defer close(done)
		for queued := range sends {
			command := queued.command
			session.logCommand(command, "dequeued", time.Since(queued.queuedAt), nil)
			ctx, cancel := chatCallContext(s.ctx)
			delivery, err := session.send(ctx, command)
			cancel()
			writeChatCommandResult(client, id, command, delivery, err)
		}
	}()
	defer func() { close(sends); <-done }()
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
			commandErr = s.chatCommandProjectError(session, r.URL.Query().Get("pageURL"), r.URL.Query().Get("chatTarget"))
		}
		if commandErr == nil && command.Type == "send" {
			if command.Text == "" && len(command.Images) == 0 {
				commandErr = fmt.Errorf("message is empty")
			} else if prompt := s.currentSettings().ChatPrompt; prompt != "" {
				command.Text += "\n\nDevhost workflow instructions:\n" + prompt
			}
		}
		if commandErr == nil && command.Type == "send" {
			encoded, encodeErr := json.Marshal(command)
			if encodeErr != nil {
				commandErr = fmt.Errorf("encode chat input: %w", encodeErr)
			} else if len(encoded) > chatMessageLimit {
				commandErr = fmt.Errorf("message including workflow instructions exceeds 8 MiB")
			}
		}
		if commandErr == nil && command.Type == "send" {
			session.mu.Lock()
			select {
			case sends <- queuedCommand{command: command, queuedAt: time.Now()}:
				session.logCommandLocked(command, "queued", 0, nil)
				session.mu.Unlock()
				continue
			default:
				commandErr = fmt.Errorf("chat send queue is full; retry after a message is accepted")
			}
			session.mu.Unlock()
		}
		if commandErr == nil {
			ctx, cancel := chatCallContext(s.ctx)
			commandErr = session.execute(ctx, command)
			cancel()
		}
		if command.Type == "send" {
			session.logCommand(command, "rejected", 0, commandErr)
		}
		writeChatCommandResult(client, id, command, "", commandErr)
	}
}

func writeChatCommandResult(client *websocketClient, id string, command chatCommand, delivery chatDelivery, commandErr error) {
	response := chatMessage{Type: "error", SessionID: id, Delivery: delivery}
	if command.Type == "send" && command.CommandID != "" {
		response.Type = "command_result"
		response.CommandID = command.CommandID
	}
	if commandErr != nil {
		response.Error = commandErr.Error()
	}
	if response.Type == "command_result" || commandErr != nil {
		client.writeMu.Lock()
		err := client.writeJSONMessagesLocked([]any{response})
		client.writeMu.Unlock()
		if err != nil {
			client.close()
		}
	}
}
