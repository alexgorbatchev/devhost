package devtools

import (
	"encoding/json"
	"fmt"
	"net/http"
	"slices"
	"time"

	"github.com/gorilla/websocket"
)

func (s *ControlServer) handleTerminalSessions(writer http.ResponseWriter, request *http.Request) {
	if request.Header.Get(controlTokenHeaderName) != s.controlToken {
		http.Error(writer, "Forbidden", http.StatusForbidden)
		return
	}

	switch request.Method {
	case http.MethodGet:
		writer.Header().Set("content-type", "application/json")
		_ = json.NewEncoder(writer).Encode(s.createTerminalSessionListResponse())
	case http.MethodPost:
		var payload terminalSessionRequestPayload
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			http.Error(writer, "Invalid terminal session payload.", http.StatusBadRequest)
			return
		}

		terminalRequest, targetSessionID, ok := parseTerminalSessionRequest(payload)
		if !ok {
			http.Error(writer, "Invalid terminal session payload.", http.StatusBadRequest)
			return
		}

		var sessionID string
		var err error
		if terminalRequest.Kind == terminalSessionRequestKindAgent {
			if s.annotationQueueStore == nil || terminalRequest.Annotation == nil {
				http.Error(writer, "Invalid terminal session payload.", http.StatusBadRequest)
				return
			}
			result, queueErr := s.annotationQueueStore.enqueue(terminalRequest.ActionID, *terminalRequest.Annotation, targetSessionID)
			err = queueErr
			sessionID = result.SessionID
		} else {
			sessionID, err = s.createTerminalSession(terminalRequest)
		}
		if err != nil {
			writeAnnotationQueueMutationError(writer, err)
			return
		}

		writer.Header().Set("content-type", "application/json")
		_ = json.NewEncoder(writer).Encode(startTerminalSessionResponse{SessionID: sessionID})
	default:
		http.Error(writer, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *ControlServer) handleTerminalWebsocket(writer http.ResponseWriter, request *http.Request) {
	query := request.URL.Query()
	if query.Get(terminalSessionWebsocketQueryToken) != s.controlToken {
		http.Error(writer, "Forbidden", http.StatusForbidden)
		return
	}

	sessionID := query.Get(terminalSessionWebsocketQuerySession)
	if sessionID == "" {
		http.Error(writer, "Missing sessionId query parameter.", http.StatusBadRequest)
		return
	}

	s.mu.Lock()
	hasSession := s.terminalSessions[sessionID] != nil
	s.mu.Unlock()
	if !hasSession {
		http.Error(writer, "Terminal session was not found.", http.StatusNotFound)
		return
	}

	client, err := s.upgrade(writer, request)
	if err != nil {
		return
	}

	s.mu.Lock()
	session := s.terminalSessions[sessionID]
	if session == nil {
		s.mu.Unlock()
		_ = writeJSONMessage(client, createTerminalSessionErrorMessage("Terminal session is no longer available."))
		client.close()
		return
	}

	s.cancelIdleTerminalSessionShutdownLocked(session)
	if session.clients == nil {
		session.clients = map[*websocketClient]struct{}{}
	}
	session.clients[client] = struct{}{}
	snapshot := session.output
	exitStatus := session.exited
	s.mu.Unlock()

	if err := writeJSONMessage(client, createTerminalSessionSnapshotMessage(snapshot)); err != nil {
		s.handleTerminalClientClosed(sessionID, client)
		return
	}
	if exitStatus != nil {
		if err := writeJSONMessage(client, exitStatus); err != nil {
			s.handleTerminalClientClosed(sessionID, client)
			return
		}
	}

	go s.readTerminalMessages(sessionID, client)
}

func (s *ControlServer) createTerminalSession(request terminalSessionRequest) (string, error) {
	if !s.featureToggles.TerminalEnabled {
		return "", fmt.Errorf("Terminal session launching is not configured.")
	}
	if request.Kind == terminalSessionRequestKindEditor && !s.featureToggles.EditorEnabled {
		return "", fmt.Errorf("Terminal session launching is not configured.")
	}

	starter := s.startTerminalSession
	if starter == nil {
		starter = func(request terminalSessionRequest, onData func([]byte)) (*launchedTerminalSession, error) {
			command, err := createTerminalSessionCommand(s.annotationActions, s.componentEditor, s.projectRootPath, request, s.stackName, editorTerminalIntegration{
				controlToken: s.controlToken,
				endpoint:     fmt.Sprintf("http://127.0.0.1:%d%s", s.Port(), reactHighlightCursorPath),
			})
			if err != nil {
				return nil, err
			}
			return launchTerminalCommand(command.command, command.cwd, command.env, onData, command.cleanup)
		}
	}

	sessionID, err := createControlToken()
	if err != nil {
		return "", err
	}

	launchedSession, err := starter(request, func(data []byte) {
		s.appendTerminalSessionOutput(sessionID, data)
	})
	if err != nil {
		return "", err
	}

	session := &terminalSessionState{
		agentCarry: "",
		close:      launchedSession.close,
		clients:    map[*websocketClient]struct{}{},
		cleanup:    launchedSession.cleanup,
		request:    request,
		resize:     launchedSession.resize,
		write:      launchedSession.write,
		wait:       launchedSession.wait,
	}

	s.mu.Lock()
	s.terminalSessions[sessionID] = session
	s.terminalSessionOrder = append(s.terminalSessionOrder, sessionID)
	s.scheduleIdleTerminalSessionShutdownLocked(sessionID, session)
	s.mu.Unlock()

	go func() {
		exitStatus := session.wait()
		s.finishTerminalSession(sessionID, exitStatus)
		s.runTerminalSessionCleanup(session)
	}()

	return sessionID, nil
}

func (s *ControlServer) appendTerminalSessionOutput(sessionID string, data []byte) {
	if len(data) == 0 {
		return
	}

	var statuses []agentSessionStatus
	s.mu.Lock()
	session := s.terminalSessions[sessionID]
	if session == nil || session.closed {
		s.mu.Unlock()
		return
	}

	outputChunk, pendingOutput := decodeTerminalOutputChunk(session.pendingOutput, data)
	session.pendingOutput = pendingOutput
	if outputChunk == "" {
		s.mu.Unlock()
		return
	}
	if session.request.Kind == terminalSessionRequestKindAgent {
		parsed := parseAgentStatusOSC(session.agentCarry, outputChunk)
		session.agentCarry = parsed.carryover
		statuses = parsed.statuses
		if len(statuses) > 0 {
			lastStatus := statuses[len(statuses)-1]
			session.agentStatus = &lastStatus
		}
	}

	session.output = retainTerminalBufferTail(session.output + outputChunk)
	clients := make([]*websocketClient, 0, len(session.clients))
	for client := range session.clients {
		clients = append(clients, client)
	}
	s.mu.Unlock()

	for _, status := range statuses {
		if s.annotationQueueStore != nil {
			_ = s.annotationQueueStore.handleAgentStatus(sessionID, status)
		}
	}
	s.broadcastTerminalMessage(clients, createTerminalSessionOutputMessage(outputChunk), sessionID)
}

func (s *ControlServer) finishTerminalSession(sessionID string, exitStatus terminalSessionExitStatus) {
	var statuses []agentSessionStatus
	s.mu.Lock()
	session := s.terminalSessions[sessionID]
	if session == nil || session.closed {
		s.mu.Unlock()
		return
	}

	if len(session.pendingOutput) > 0 {
		trailingOutput := string(session.pendingOutput)
		session.pendingOutput = nil
		if session.request.Kind == terminalSessionRequestKindAgent {
			parsed := parseAgentStatusOSC(session.agentCarry, trailingOutput)
			session.agentCarry = parsed.carryover
			statuses = parsed.statuses
			if len(statuses) > 0 {
				lastStatus := statuses[len(statuses)-1]
				session.agentStatus = &lastStatus
			}
		}
		session.output = retainTerminalBufferTail(session.output + trailingOutput)
		clients := make([]*websocketClient, 0, len(session.clients))
		for client := range session.clients {
			clients = append(clients, client)
		}
		s.mu.Unlock()
		s.broadcastTerminalMessage(clients, createTerminalSessionOutputMessage(trailingOutput), sessionID)
		s.mu.Lock()
		session = s.terminalSessions[sessionID]
		if session == nil || session.closed {
			s.mu.Unlock()
			return
		}
	}

	session.exited = &exitStatus
	clients := make([]*websocketClient, 0, len(session.clients))
	for client := range session.clients {
		clients = append(clients, client)
	}
	if len(session.clients) == 0 {
		s.scheduleIdleTerminalSessionShutdownLocked(sessionID, session)
	}
	s.mu.Unlock()

	for _, status := range statuses {
		if s.annotationQueueStore != nil {
			_ = s.annotationQueueStore.handleAgentStatus(sessionID, status)
		}
	}
	s.broadcastTerminalMessage(clients, exitStatus, sessionID)
	if s.annotationQueueStore != nil && session.request.Kind == terminalSessionRequestKindAgent {
		_ = s.annotationQueueStore.handleSessionExited(sessionID)
	}
}

func (s *ControlServer) readTerminalMessages(sessionID string, client *websocketClient) {
	defer s.handleTerminalClientClosed(sessionID, client)

	for {
		messageType, payload, err := client.conn.ReadMessage()
		if err != nil {
			return
		}

		if messageType != websocket.TextMessage {
			_ = writeJSONMessage(client, createTerminalSessionErrorMessage("Terminal messages must be text frames."))
			continue
		}

		message, ok := parseTerminalSessionClientMessage(payload)
		if !ok {
			_ = writeJSONMessage(client, createTerminalSessionErrorMessage("Invalid terminal message."))
			continue
		}

		s.mu.Lock()
		session := s.terminalSessions[sessionID]
		if session == nil || session.closed {
			s.mu.Unlock()
			_ = writeJSONMessage(client, createTerminalSessionErrorMessage("Terminal session is no longer available."))
			client.close()
			return
		}

		if message.Type == "input" {
			write := session.write
			exited := session.exited != nil
			s.mu.Unlock()
			if !exited && message.Data != nil {
				write(*message.Data)
			}
			continue
		}

		if message.Type == "resize" {
			resize := session.resize
			exited := session.exited != nil
			s.mu.Unlock()
			if !exited && message.Cols != nil && message.Rows != nil {
				resize(*message.Cols, *message.Rows)
			}
			continue
		}
		s.mu.Unlock()

		if s.annotationQueueStore != nil {
			_ = s.annotationQueueStore.handleUserClosedSession(sessionID)
		}
		s.closeTerminalSession(sessionID)
		return
	}
}

func (s *ControlServer) handleTerminalClientClosed(sessionID string, client *websocketClient) {
	s.mu.Lock()
	defer s.mu.Unlock()

	session := s.terminalSessions[sessionID]
	if session == nil {
		return
	}
	delete(session.clients, client)
	if len(session.clients) == 0 && !session.closed {
		s.scheduleIdleTerminalSessionShutdownLocked(sessionID, session)
	}
	client.close()
}

func (s *ControlServer) closeTerminalSession(sessionID string) {
	var clients []*websocketClient
	var session *terminalSessionState

	s.mu.Lock()
	session = s.terminalSessions[sessionID]
	if session == nil || session.closed {
		s.mu.Unlock()
		return
	}

	session.closed = true
	s.cancelIdleTerminalSessionShutdownLocked(session)
	for client := range session.clients {
		clients = append(clients, client)
	}
	delete(s.terminalSessions, sessionID)
	s.terminalSessionOrder = removeTerminalSessionID(s.terminalSessionOrder, sessionID)
	s.mu.Unlock()

	for _, client := range clients {
		client.close()
	}
	session.closeOnce.Do(session.close)
	s.runTerminalSessionCleanup(session)
}

func (s *ControlServer) runTerminalSessionCleanup(session *terminalSessionState) {
	if session == nil || session.cleanup == nil {
		return
	}
	session.cleanupOnce.Do(session.cleanup)
}

func (s *ControlServer) createTerminalSessionListResponse() listTerminalSessionsResponse {
	s.mu.Lock()
	defer s.mu.Unlock()

	sessions := make([]activeTerminalSessionSnapshot, 0, len(s.terminalSessionOrder))
	for _, sessionID := range s.terminalSessionOrder {
		session := s.terminalSessions[sessionID]
		if session == nil || session.closed {
			continue
		}
		sessions = append(sessions, activeTerminalSessionSnapshot{Request: session.request, SessionID: sessionID})
	}

	return listTerminalSessionsResponse{Sessions: sessions}
}

func (s *ControlServer) scheduleIdleTerminalSessionShutdownLocked(sessionID string, session *terminalSessionState) {
	s.cancelIdleTerminalSessionShutdownLocked(session)
	session.idleTimer = time.AfterFunc(s.idleTerminalSessionTimeout, func() {
		if s.annotationQueueStore != nil {
			_ = s.annotationQueueStore.handleSessionExited(sessionID)
		}
		s.closeTerminalSession(sessionID)
	})
}

func (s *ControlServer) cancelIdleTerminalSessionShutdownLocked(session *terminalSessionState) {
	if session.idleTimer == nil {
		return
	}
	session.idleTimer.Stop()
	session.idleTimer = nil
}

func (s *ControlServer) broadcastTerminalMessage(clients []*websocketClient, message any, sessionID string) {
	for _, client := range clients {
		if err := writeJSONMessage(client, message); err != nil {
			s.handleTerminalClientClosed(sessionID, client)
		}
	}
}

func removeTerminalSessionID(sessionIDs []string, sessionID string) []string {
	index := slices.Index(sessionIDs, sessionID)
	if index == -1 {
		return sessionIDs
	}

	return append(sessionIDs[:index], sessionIDs[index+1:]...)
}

func writeJSONMessage(client *websocketClient, value any) error {
	payload, err := json.Marshal(value)
	if err != nil {
		return err
	}

	return client.write(websocket.TextMessage, payload)
}
