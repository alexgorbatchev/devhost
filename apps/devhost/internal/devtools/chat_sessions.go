package devtools

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os/exec"
	"sync"
	"time"
)

type chatStore struct {
	mu       sync.Mutex
	ctx      context.Context
	command  chatCommandFactory
	sessions map[string]*chatSession
	stopped  bool
	wg       sync.WaitGroup
}

type chatSession struct {
	mu              sync.Mutex
	operation       sync.Mutex
	info            chatSessionInfo
	process         *chatProcess
	events          []chatEvent
	pending         map[string]json.RawMessage
	turnID          string
	active          bool
	model           string
	configuredModel string
	clients         map[*websocketClient]struct{}
}

// newChatStore starts native harnesses through command, or through the installed CLIs when command is nil.
func newChatStore(ctx context.Context, command chatCommandFactory) *chatStore {
	if command == nil {
		command = exec.CommandContext
	}
	return &chatStore{ctx: ctx, command: command, sessions: map[string]*chatSession{}}
}

// HasActiveChatSessions keeps an in-flight native turn alive after its page disconnects.
func (s *ControlServer) HasActiveChatSessions() bool {
	if s.chat == nil {
		return false
	}
	s.chat.mu.Lock()
	defer s.chat.mu.Unlock()
	for _, session := range s.chat.sessions {
		status := session.snapshot().Status
		if status == "running" || status == "requires_action" || status == "starting" {
			return true
		}
	}
	return false
}

func (s *chatStore) begin() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.stopped {
		return false
	}
	s.wg.Add(1)
	return true
}

func (s *chatStore) close() {
	s.mu.Lock()
	s.stopped = true
	sessions := make([]*chatSession, 0, len(s.sessions))
	for _, session := range s.sessions {
		sessions = append(sessions, session)
	}
	s.mu.Unlock()
	for _, session := range sessions {
		session.closeWith(1001, "Devhost stopping")
	}
	s.wg.Wait()
}

func (s *chatStore) start(ctx context.Context, request chatSessionRequest, cwd string) (*chatSession, error) {
	if !s.begin() {
		return nil, fmt.Errorf("chat server is stopping")
	}
	defer s.wg.Done()
	id := make([]byte, 16)
	if _, err := rand.Read(id); err != nil {
		return nil, fmt.Errorf("create chat session ID: %w", err)
	}
	// A resumed session continues the native conversation it names, so it carries that ID before the client reports it.
	session := &chatSession{info: chatSessionInfo{ID: hex.EncodeToString(id), Harness: request.Harness, ProjectRootPath: cwd, NativeSessionID: request.ResumeID, Status: "starting"}, pending: map[string]json.RawMessage{}, clients: map[*websocketClient]struct{}{}}
	session.model = request.Model
	args := []string{"app-server"}
	if request.Harness == chatClaude {
		args = []string{"-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--replay-user-messages", "--permission-prompt-tool=stdio"}
		if request.ResumeID != "" {
			args = append(args, "--resume", request.ResumeID)
		}
	}
	process, err := startChatProcess(s.ctx, request.Harness, cwd, args, s.command, session.receive)
	if err != nil {
		return nil, err
	}
	session.process = process
	if _, err = initializeChat(ctx, process); err != nil {
		process.close()
		return nil, err
	}
	if request.Harness == chatCodex {
		configured, modelErr := configuredChatModel(ctx, process, cwd)
		if modelErr != nil {
			process.close()
			return nil, modelErr
		}
		session.configuredModel = configured
		method := "thread/start"
		params := map[string]any{"cwd": cwd}
		if request.Model != "" {
			params["model"] = request.Model
		}
		if request.ResumeID != "" {
			method = "thread/resume"
			params["threadId"] = request.ResumeID
		}
		result, callErr := process.call(ctx, method, params)
		if callErr != nil {
			process.close()
			return nil, callErr
		}
		var response struct {
			Thread struct {
				ID string `json:"id"`
			} `json:"thread"`
		}
		if err = json.Unmarshal(result, &response); err != nil || response.Thread.ID == "" {
			process.close()
			return nil, fmt.Errorf("Codex returned no thread ID")
		}
		session.mu.Lock()
		session.info.NativeSessionID = response.Thread.ID
		session.mu.Unlock()
	}
	session.mu.Lock()
	if session.info.Status == "starting" {
		session.info.Status = "idle"
	}
	session.mu.Unlock()
	s.mu.Lock()
	if s.stopped {
		s.mu.Unlock()
		process.close()
		return nil, fmt.Errorf("chat server is stopping")
	}
	info := session.snapshot()
	if request.ResumeID != "" {
		s.dropClosedLocked(info.Harness, info.ProjectRootPath, request.ResumeID)
	}
	s.sessions[info.ID] = session
	s.mu.Unlock()
	s.wg.Add(1)
	go func() {
		defer s.wg.Done()
		<-process.done
		session.mu.Lock()
		if session.info.Status != "closed" {
			session.info.Status = "error"
			session.info.Error = process.exitError().Error()
		}
		session.broadcastLocked(chatMessage{Type: "state", Session: session.infoCopyLocked()})
		session.mu.Unlock()
	}()
	return session, nil
}

// dropClosedLocked removes the closed records of a native conversation that a new session has resumed: the new
// session continues it, so a page lists the conversation once. Sessions still running are kept.
func (s *chatStore) dropClosedLocked(harness, root, nativeID string) {
	for id, session := range s.sessions {
		info := session.snapshot()
		if info.Status == "closed" && info.Harness == harness && info.ProjectRootPath == root && info.NativeSessionID == nativeID {
			delete(s.sessions, id)
		}
	}
}

func initializeChat(ctx context.Context, p *chatProcess) (json.RawMessage, error) {
	params := map[string]any{}
	if p.harness == chatCodex {
		params["clientInfo"] = map[string]string{"name": "devhost", "version": "development"}
	}
	result, err := p.call(ctx, "initialize", params)
	if err != nil {
		return nil, err
	}
	if p.harness == chatCodex {
		if err = p.write(map[string]string{"method": "initialized"}); err != nil {
			return nil, err
		}
	}
	return result, nil
}

func (s *chatSession) infoCopyLocked() *chatSessionInfo { info := s.info; return &info }
func (s *chatSession) snapshot() chatSessionInfo        { s.mu.Lock(); defer s.mu.Unlock(); return s.info }

// A session serializes publication and attachment. Client deadlines bound slow readers.
func (s *chatSession) broadcastLocked(message chatMessage) {
	if message.Type == "state" {
		message.PendingRequestIDs = s.pendingIDsLocked()
	}
	message.SessionID = s.info.ID
	for client := range s.clients {
		client.writeMu.Lock()
		err := client.writeJSONMessagesLocked([]any{message})
		client.writeMu.Unlock()
		if err != nil {
			delete(s.clients, client)
			go client.close()
		}
	}
}

func (s *chatSession) pendingIDsLocked() *[]json.RawMessage {
	ids := make([]json.RawMessage, 0, len(s.pending))
	for _, id := range s.pending {
		ids = append(ids, id)
	}
	return &ids
}

func (s *chatSession) receive(raw json.RawMessage) {
	var frame chatNativeFrame
	if json.Unmarshal(raw, &frame) != nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.events = append(s.events, chatEvent{Sequence: uint64(len(s.events) + 1), Payload: raw})
	if frame.SessionID != "" {
		s.info.NativeSessionID = frame.SessionID
	}
	// A terminating CLI can flush final frames after closure. Retain them without reopening the session.
	if s.info.Status == "closed" {
		return
	}
	if frame.ID != nil && frame.Method != "" {
		key, err := chatRequestKey(frame.ID)
		if err == nil {
			s.pending[key] = frame.ID
		}
	}
	if frame.Type == "control_request" && frame.RequestID != "" {
		id, err := json.Marshal(frame.RequestID)
		if err == nil {
			s.pending[string(id)] = id
		}
	}
	if frame.Type == "control_cancel_request" {
		id, err := json.Marshal(frame.RequestID)
		if err == nil {
			delete(s.pending, string(id))
		}
	}
	if frame.Method == "serverRequest/resolved" {
		var params struct {
			RequestID json.RawMessage `json:"requestId"`
		}
		if json.Unmarshal(frame.Params, &params) == nil {
			if key, err := chatRequestKey(params.RequestID); err == nil {
				delete(s.pending, key)
			}
		}
	}
	if frame.Type == "control_response" {
		var response struct {
			Permissions []chatNativeFrame `json:"pending_permission_requests"`
			Dialogs     []chatNativeFrame `json:"pending_user_dialog_requests"`
		}
		if json.Unmarshal(frame.Response, &response) == nil {
			for _, request := range append(response.Permissions, response.Dialogs...) {
				if request.RequestID != "" {
					id, err := json.Marshal(request.RequestID)
					if err == nil {
						s.pending[string(id)] = id
					}
				}
			}
		}
	}
	var params struct {
		Turn struct {
			ID string `json:"id"`
		} `json:"turn"`
	}
	if frame.Method == "turn/started" || frame.Method == "turn/completed" {
		if json.Unmarshal(frame.Params, &params) == nil {
			s.turnID = params.Turn.ID
		}
	}
	switch {
	case frame.Method == "turn/started":
		s.info.Status = "running"
		s.active = true
	case frame.Method == "turn/completed", frame.Type == "result":
		s.info.Status = "idle"
		s.turnID = ""
		s.active = false
	}
	if frame.Type == "system" && frame.Subtype == "session_state_changed" {
		switch frame.State {
		case "idle", "running", "requires_action":
			s.info.Status = frame.State
			s.active = frame.State != "idle"
		}
	}
	if len(s.pending) > 0 {
		s.info.Status = "requires_action"
	}
	if frame.Type == "result" && frame.IsError {
		s.info.Status = "error"
		var text string
		if json.Unmarshal(frame.Result, &text) == nil {
			s.info.Error = text
		} else {
			s.info.Error = "Native Claude turn failed"
		}
	}
	s.broadcastLocked(chatMessage{Type: "event", Sequence: uint64(len(s.events)), Payload: raw})
	s.broadcastLocked(chatMessage{Type: "state", Session: s.infoCopyLocked()})
}

func (s *chatSession) close() {
	s.closeWith(1000, "Chat session closed")
}
func (s *chatSession) closeWith(code int, reason string) {
	s.mu.Lock()
	s.info.Status = "closed"
	clients := snapshotClients(s.clients)
	s.clients = map[*websocketClient]struct{}{}
	s.mu.Unlock()
	for _, client := range clients {
		client.closeWith(code, reason)
	}
	s.process.close()
}

func (s *chatSession) execute(ctx context.Context, command chatCommand) error {
	if command.Type == "respond" {
		key, err := chatRequestKey(command.RequestID)
		if err != nil {
			return err
		}
		var id string
		if s.snapshot().Harness == chatClaude {
			if err = json.Unmarshal(command.RequestID, &id); err != nil {
				return fmt.Errorf("Claude request ID must be a string")
			}
		}
		if !json.Valid(command.Result) {
			return fmt.Errorf("native response must be JSON")
		}
		s.mu.Lock()
		nativeID, ok := s.pending[key]
		if ok {
			delete(s.pending, key)
			if len(s.pending) == 0 {
				if s.active {
					s.info.Status = "running"
				} else {
					s.info.Status = "idle"
				}
			}
			s.broadcastLocked(chatMessage{Type: "state", Session: s.infoCopyLocked()})
		}
		s.mu.Unlock()
		if !ok {
			return fmt.Errorf("native request is not pending")
		}
		if s.snapshot().Harness == chatCodex {
			return s.process.write(map[string]any{"id": nativeID, "result": command.Result})
		}
		return s.process.write(map[string]any{"type": "control_response", "response": map[string]any{"subtype": "success", "request_id": id, "response": command.Result}})
	}
	if command.Type == "interrupt" {
		info := s.snapshot()
		if info.Harness == chatClaude {
			_, err := s.process.call(ctx, "interrupt", nil)
			return err
		}
		s.mu.Lock()
		turn := s.turnID
		s.mu.Unlock()
		if turn == "" {
			return fmt.Errorf("no native turn is running")
		}
		_, err := s.process.call(ctx, "turn/interrupt", map[string]any{"threadId": info.NativeSessionID, "turnId": turn})
		return err
	}
	if command.Type != "send" {
		return fmt.Errorf("unknown chat command")
	}
	return s.send(ctx, command)
}

func chatCallContext(ctx context.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(ctx, 30*time.Second)
}
