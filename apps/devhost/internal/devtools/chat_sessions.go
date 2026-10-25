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
	log      func(string)
	sessions map[string]*chatSession
	stopped  bool
	wg       sync.WaitGroup
}

type chatSession struct {
	mu              sync.Mutex
	operation       sync.Mutex
	info            chatSessionInfo
	process         *chatProcess
	events          *chatJournal
	activity        chatActivity
	cancel          context.CancelFunc
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
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, session := range s.sessions {
		session.mu.Lock()
		if err := session.events.remove(); err != nil {
			session.logLocked("replay cleanup failed error=%q", chatLogError(err))
		}
		session.mu.Unlock()
	}
}

func (s *chatStore) start(ctx context.Context, request chatSessionRequest, cwd string) (session *chatSession, err error) {
	if !s.begin() {
		return nil, fmt.Errorf("chat server is stopping")
	}
	defer s.wg.Done()
	id := make([]byte, 16)
	if _, err := rand.Read(id); err != nil {
		return nil, fmt.Errorf("create chat session ID: %w", err)
	}
	// A resumed session continues the native conversation it names, so it carries that ID before the client reports it.
	session = &chatSession{info: chatSessionInfo{ID: hex.EncodeToString(id), Harness: request.Harness, ProjectRootPath: cwd, NativeSessionID: request.ResumeID, Status: "starting"}, pending: map[string]json.RawMessage{}, clients: map[*websocketClient]struct{}{}}
	session.activity.log = s.log
	session.logLocked("session starting project=%q model=%q resume=%q", cwd, request.Model, request.ResumeID)
	session.events, err = newChatJournal()
	if err != nil {
		session.logLocked("session startup failed error=%q", chatLogError(err))
		return nil, err
	}
	processCtx, cancel := context.WithCancel(s.ctx)
	session.cancel = cancel
	owned := session
	retained := false
	defer func() {
		if !retained {
			cancel()
			owned.logLocked("session startup failed error=%q", chatLogError(err))
			if cleanupErr := owned.events.remove(); cleanupErr != nil {
				owned.logLocked("replay cleanup failed error=%q", chatLogError(cleanupErr))
			}
		}
	}()
	session.model = request.Model
	args := []string{"app-server"}
	if request.Harness == chatClaude {
		args = []string{"-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--replay-user-messages", "--permission-prompt-tool=stdio"}
		if request.ResumeID != "" {
			args = append(args, "--resume", request.ResumeID)
		}
	}
	process, err := startChatProcess(processCtx, request.Harness, cwd, args, s.command, session.receive)
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
		session.mu.Lock()
		session.configuredModel = configured
		session.mu.Unlock()
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
	if session.events.err != nil {
		err = session.events.err
		session.mu.Unlock()
		process.close()
		return nil, err
	}
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
	retained = true
	session.mu.Lock()
	action := "started"
	if request.ResumeID != "" {
		action = "resumed"
	}
	session.logLocked("session %s native_session=%q project=%q model=%q", action, session.info.NativeSessionID, cwd, request.Model)
	session.mu.Unlock()
	s.wg.Add(1)
	go func() {
		defer s.wg.Done()
		defer cancel()
		session.monitor()
	}()
	return session, nil
}

func (s *chatSession) monitor() {
	ticker := time.NewTicker(chatHeartbeatInterval)
	defer ticker.Stop()
	for {
		select {
		case now := <-ticker.C:
			s.heartbeat(now)
		case <-s.process.done:
			s.mu.Lock()
			if s.info.Status != "closed" {
				if !s.activity.started.IsZero() || !s.activity.dispatched.IsZero() {
					s.finishTurnLocked(time.Now(), "failed")
				}
				s.info.Status = "error"
				if s.info.Error == "" {
					s.info.Error = s.process.exitError().Error()
				}
				s.logLocked("process failed error=%q", chatLogError(s.process.exitError()))
			}
			s.broadcastLocked(chatMessage{Type: "state", Session: s.infoCopyLocked()})
			s.mu.Unlock()
			return
		}
	}
}

// dropClosedLocked removes the closed records of a native conversation that a new session has resumed: the new
// session continues it, so a page lists the conversation once. Sessions still running are kept.
func (s *chatStore) dropClosedLocked(harness, root, nativeID string) {
	for id, session := range s.sessions {
		info := session.snapshot()
		if info.Status == "closed" && info.Harness == harness && info.ProjectRootPath == root && info.NativeSessionID == nativeID {
			// Closing marks the session before the CLI has finished flushing frames.
			// Join it before retiring its journal, including concurrent close/resume.
			<-session.process.done
			session.mu.Lock()
			if err := session.events.remove(); err != nil {
				session.logLocked("replay cleanup failed error=%q", chatLogError(err))
			}
			session.mu.Unlock()
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
	if s.events.err != nil {
		return
	}
	if err := s.events.append(raw); err != nil {
		if s.info.Status != "closed" {
			s.info.Status, s.info.Error = "error", err.Error()
			s.logLocked("replay failed error=%q", chatLogError(err))
			s.broadcastLocked(chatMessage{Type: "state", Session: s.infoCopyLocked()})
		}
		s.cancel()
		return
	}
	now := time.Now()
	s.activity.lastEvent = now
	if frame.SessionID != "" && frame.SessionID != s.info.NativeSessionID {
		s.info.NativeSessionID = frame.SessionID
		if s.info.Status != "closed" {
			s.logLocked("native session identified native_session=%q", frame.SessionID)
		}
	}
	// A terminating CLI can flush final frames after closure. Retain them without reopening the session.
	if s.info.Status == "closed" {
		return
	}
	if frame.ID != nil && frame.Method != "" {
		key, err := chatRequestKey(frame.ID)
		if err == nil {
			s.pending[key] = frame.ID
			s.logRequestLocked(now, key, frame.Method)
		}
	}
	if frame.Type == "control_request" && frame.RequestID != "" {
		id, err := json.Marshal(frame.RequestID)
		if err == nil {
			s.pending[string(id)] = id
			s.logRequestLocked(now, string(id), chatClaudeRequestKind(frame))
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
						s.logRequestLocked(now, string(id), chatClaudeRequestKind(request))
					}
				}
			}
		}
	}
	var params struct {
		Turn chatCodexTurn `json:"turn"`
	}
	if frame.Method == "turn/started" || frame.Method == "turn/completed" {
		if json.Unmarshal(frame.Params, &params) == nil {
			s.turnID = params.Turn.ID
		}
	}
	switch {
	case frame.Method == "turn/started":
		s.info.Status = "running"
		s.info.Error = ""
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
	if len(s.pending) > 0 && s.info.Status != "error" {
		s.info.Status = "requires_action"
	}
	if frame.Method == "turn/completed" && params.Turn.Status == "failed" {
		s.info.Status = "error"
		s.info.Error = "Native Codex turn failed"
		if params.Turn.Error != nil && params.Turn.Error.Message != "" {
			s.info.Error = params.Turn.Error.Message
		}
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
	if s.info.Harness == chatCodex {
		s.logCodexFrameLocked(now, frame)
	} else {
		s.logClaudeFrameLocked(now, frame, raw)
	}
	requestOutcome := "resolved"
	if frame.Type == "control_cancel_request" {
		requestOutcome = "canceled"
	}
	s.logRequestsLocked(now, requestOutcome)
	s.broadcastLocked(chatMessage{Type: "event", Sequence: s.events.sequence, Payload: raw})
	s.broadcastLocked(chatMessage{Type: "state", Session: s.infoCopyLocked()})
}

func (s *chatSession) close() {
	s.closeWith(1000, "Chat session closed")
}
func (s *chatSession) closeWith(code int, reason string) {
	s.mu.Lock()
	if s.info.Status != "closed" {
		if !s.activity.started.IsZero() || !s.activity.dispatched.IsZero() {
			s.finishTurnLocked(time.Now(), "interrupted")
		}
		clear(s.pending)
		s.logRequestsLocked(time.Now(), "closed")
		s.logLocked("session closed reason=%q", reason)
	}
	s.info.Status = "closed"
	clients := snapshotClients(s.clients)
	s.clients = map[*websocketClient]struct{}{}
	s.mu.Unlock()
	s.cancel()
	for _, client := range clients {
		client.closeWith(code, reason)
	}
	s.process.close()
}

func (s *chatSession) execute(ctx context.Context, command chatCommand) (err error) {
	if command.Type == "respond" || command.Type == "interrupt" {
		started := time.Now()
		defer func() {
			s.mu.Lock()
			s.logLocked("%s %s wait=%s error=%q", command.Type, chatCommandOutcome(err), chatDuration(time.Since(started)), chatLogError(err))
			s.mu.Unlock()
		}()
	}
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
			s.logRequestsLocked(time.Now(), "response received")
			if len(s.pending) == 0 && s.info.Status != "error" {
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
			err = s.process.write(map[string]any{"id": nativeID, "result": command.Result})
		} else {
			err = s.process.write(map[string]any{"type": "control_response", "response": map[string]any{"subtype": "success", "request_id": id, "response": command.Result}})
		}
		s.mu.Lock()
		s.logLocked("response %s request=%s error=%q", chatCommandOutcome(err), key, chatLogError(err))
		s.mu.Unlock()
		return err
	}
	if command.Type == "interrupt" {
		s.mu.Lock()
		s.activity.interrupted = s.active
		s.logLocked("interrupt requested turn=%q", s.activity.turn)
		s.mu.Unlock()
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
