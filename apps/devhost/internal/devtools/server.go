package devtools

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"sync"
	"time"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/manifest"
	"github.com/gorilla/websocket"
)

const (
	controlPathPrefix                = "/__devhost__"
	injectedScriptPath               = controlPathPrefix + "/inject.js"
	terminalSessionsPath             = controlPathPrefix + "/terminal-sessions"
	terminalWebsocketPath            = controlPathPrefix + "/ws/terminal"
	xtermStylesheetPath              = controlPathPrefix + "/xterm.css"
	restartServicePath               = controlPathPrefix + "/restart-service"
	healthWebsocketPath              = controlPathPrefix + "/ws/health"
	logsWebsocketPath                = controlPathPrefix + "/ws/logs"
	controlTokenHeaderName           = "x-devhost-control-token"
	maximumRetainedLogEntries        = 512
	healthPollInterval               = time.Second
	defaultIdleTerminalSessionPeriod = 10 * time.Second
	applicationJavascriptContentType = "application/javascript; charset=utf-8"
	textCSSContentType               = "text/css; charset=utf-8"
	cacheControlNoStore              = "no-store"
)

type FeatureToggles struct {
	AnnotationEnabled       bool
	AnnotationQueueEnabled  bool
	EditorEnabled           bool
	ExternalToolbarsEnabled bool
	MinimapEnabled          bool
	StatusEnabled           bool
	TerminalEnabled         bool
}

type RoutedServiceIdentity struct {
	Host        string `json:"host"`
	Path        string `json:"path"`
	ServiceName string `json:"serviceName"`
}

type ServiceHealth struct {
	Managed bool    `json:"managed"`
	Name   string  `json:"name"`
	Status bool    `json:"status"`
	URL    *string `json:"url,omitempty"`
}

type HealthResponse struct {
	Services []ServiceHealth `json:"services"`
}

type ServiceLogStream string

const (
	ServiceLogStreamStdout ServiceLogStream = "stdout"
	ServiceLogStreamStderr ServiceLogStream = "stderr"
)

type ServiceLogEntry struct {
	ID          int              `json:"id"`
	Line        string           `json:"line"`
	ServiceName string           `json:"serviceName"`
	Stream      ServiceLogStream `json:"stream"`
}

type StartControlServerOptions struct {
	AgentDisplayName           string
	ComponentEditor            string
	Agent                      manifest.ValidatedAgent
	FeatureToggles             FeatureToggles
	GetHealthResponse          func() (HealthResponse, error)
	IdleTerminalSessionTimeout time.Duration
	ManifestPath               string
	Position                   string
	ProjectRootPath            string
	RestartService             func(string) error
	RoutedServices             []RoutedServiceIdentity
	StateDirectoryPath         string
	StartTerminalSession       terminalSessionStarter
	StackName                  string
}

type ControlServer struct {
	listener net.Listener
	server   *http.Server

	controlToken               string
	componentEditor            string
	devtoolsScript             string
	featureToggles             FeatureToggles
	idleTerminalSessionTimeout time.Duration
	xtermStylesheet            string
	restartService             func(string) error
	getHealth                  func() (HealthResponse, error)
	agent                      manifest.ValidatedAgent
	projectRootPath            string
	stackName                  string
	startTerminalSession       terminalSessionStarter
	annotationQueueStore       *annotationQueueStore

	mu                     sync.Mutex
	isStopped              bool
	lastPublishedHealth    string
	nextLogEntryID         int
	retainedLogEntries     []ServiceLogEntry
	terminalSessionOrder   []string
	terminalSessions       map[string]*terminalSessionState
	annotationQueueClients map[*websocketClient]struct{}
	healthClients          map[*websocketClient]struct{}
	logsClients            map[*websocketClient]struct{}

	serverWG sync.WaitGroup
	upgrader websocket.Upgrader
}

type websocketClient struct {
	conn    *websocket.Conn
	writeMu sync.Mutex
}

type injectedConfig struct {
	AgentDisplayName        string                  `json:"agentDisplayName"`
	ComponentEditor         string                  `json:"componentEditor"`
	ControlToken            string                  `json:"controlToken"`
	Position                string                  `json:"position"`
	ProjectRootPath         string                  `json:"projectRootPath"`
	StackName               string                  `json:"stackName"`
	EditorEnabled           bool                    `json:"editorEnabled"`
	ExternalToolbarsEnabled bool                    `json:"externalToolbarsEnabled"`
	MinimapEnabled          bool                    `json:"minimapEnabled"`
	StatusEnabled           bool                    `json:"statusEnabled"`
	AnnotationEnabled       bool                    `json:"annotationEnabled"`
	AnnotationQueueEnabled  bool                    `json:"annotationQueueEnabled"`
	TerminalEnabled         bool                    `json:"terminalEnabled"`
	RoutedServices          []RoutedServiceIdentity `json:"routedServices"`
}

type restartServiceRequest struct {
	ServiceName string `json:"serviceName"`
}

type successResponse struct {
	Success bool `json:"success"`
}

type serviceLogSnapshotMessage struct {
	Entries []ServiceLogEntry `json:"entries"`
	Type    string            `json:"type"`
}

type serviceLogUpdateMessage struct {
	Entry ServiceLogEntry `json:"entry"`
	Type  string          `json:"type"`
}

func StartControlServer(options StartControlServerOptions) (*ControlServer, error) {
	if options.GetHealthResponse == nil {
		return nil, fmt.Errorf("health response callback is required")
	}

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, fmt.Errorf("start devtools control listener: %w", err)
	}

	controlToken, err := createControlToken()
	if err != nil {
		_ = listener.Close()
		return nil, fmt.Errorf("create devtools control token: %w", err)
	}

	devtoolsScript, err := readBundledDevtoolsScript()
	if err != nil {
		_ = listener.Close()
		return nil, err
	}
	xtermStylesheet, err := readXtermStylesheet()
	if err != nil {
		_ = listener.Close()
		return nil, err
	}

	config := injectedConfig{
		AgentDisplayName:        options.AgentDisplayName,
		AnnotationEnabled:       options.FeatureToggles.AnnotationEnabled,
		AnnotationQueueEnabled:  options.FeatureToggles.AnnotationQueueEnabled,
		ComponentEditor:         options.ComponentEditor,
		ControlToken:            controlToken,
		EditorEnabled:           options.FeatureToggles.EditorEnabled,
		ExternalToolbarsEnabled: options.FeatureToggles.ExternalToolbarsEnabled,
		MinimapEnabled:          options.FeatureToggles.MinimapEnabled,
		Position:                options.Position,
		ProjectRootPath:         options.ProjectRootPath,
		RoutedServices:          append([]RoutedServiceIdentity{}, options.RoutedServices...),
		StackName:               options.StackName,
		StatusEnabled:           options.FeatureToggles.StatusEnabled,
		TerminalEnabled:         options.FeatureToggles.TerminalEnabled,
	}
	configJSON, err := json.Marshal(config)
	if err != nil {
		_ = listener.Close()
		return nil, fmt.Errorf("marshal devtools config: %w", err)
	}

	controlServer := &ControlServer{
		agent:                      options.Agent,
		componentEditor:            options.ComponentEditor,
		controlToken:               controlToken,
		devtoolsScript:             fmt.Sprintf("globalThis.__DEVHOST_INJECTED_CONFIG__=%s;\n%s", string(configJSON), devtoolsScript),
		featureToggles:             options.FeatureToggles,
		annotationQueueClients:     map[*websocketClient]struct{}{},
		getHealth:                  options.GetHealthResponse,
		healthClients:              map[*websocketClient]struct{}{},
		idleTerminalSessionTimeout: options.IdleTerminalSessionTimeout,
		listener:                   listener,
		logsClients:                map[*websocketClient]struct{}{},
		nextLogEntryID:             1,
		projectRootPath:            options.ProjectRootPath,
		restartService:             options.RestartService,
		stackName:                  options.StackName,
		startTerminalSession:       options.StartTerminalSession,
		terminalSessions:           map[string]*terminalSessionState{},
		xtermStylesheet:            xtermStylesheet,
		upgrader: websocket.Upgrader{
			CheckOrigin: func(*http.Request) bool {
				return true
			},
		},
	}
	if controlServer.idleTerminalSessionTimeout <= 0 {
		controlServer.idleTerminalSessionTimeout = defaultIdleTerminalSessionPeriod
	}
	if options.FeatureToggles.AnnotationQueueEnabled {
		controlServer.annotationQueueStore = newAnnotationQueueStore(annotationQueueStoreOptions{
			manifestPath: options.ManifestPath,
			onQueuesChanged: func(queues []annotationQueueSnapshot) {
				controlServer.publishAnnotationQueues(queues)
			},
			readLiveAgentSession: func(sessionID string) *liveAgentSessionSnapshot {
				controlServer.mu.Lock()
				defer controlServer.mu.Unlock()

				session := controlServer.terminalSessions[sessionID]
				if session == nil || session.closed || session.exited != nil || session.request.Kind != terminalSessionRequestKindAgent || session.request.Annotation == nil {
					return nil
				}

				return &liveAgentSessionSnapshot{
					agentStatus: session.agentStatus,
					annotation:  *session.request.Annotation,
					sessionID:   sessionID,
				}
			},
			routedServices:     options.RoutedServices,
			stackName:          options.StackName,
			stateDirectoryPath: options.StateDirectoryPath,
			startAgentSession: func(annotation annotationSubmitDetail) (string, error) {
				return controlServer.createTerminalSession(terminalSessionRequest{Annotation: &annotation, Kind: terminalSessionRequestKindAgent})
			},
			writeAnnotationToSession: func(sessionID string, annotation annotationSubmitDetail) error {
				controlServer.mu.Lock()
				session := controlServer.terminalSessions[sessionID]
				if session == nil || session.closed || session.exited != nil || session.request.Kind != terminalSessionRequestKindAgent {
					controlServer.mu.Unlock()
					return fmt.Errorf("Agent terminal session %s is not available.", sessionID)
				}
				session.request.Annotation = &annotation
				write := session.write
				controlServer.mu.Unlock()

				sessionFiles, err := createAgentSessionFiles(annotation, options.AgentDisplayName, options.ProjectRootPath, createAnnotationAgentPrompt(annotation), options.StackName)
				if err != nil {
					return err
				}
				controlServer.mu.Lock()
				activeSession := controlServer.terminalSessions[sessionID]
				if activeSession == nil || activeSession.closed {
					controlServer.mu.Unlock()
					sessionFiles.cleanup()
					return fmt.Errorf("Agent terminal session %s is not available.", sessionID)
				}
				activeSession.cleanup = chainCleanup(activeSession.cleanup, sessionFiles.cleanup)
				controlServer.mu.Unlock()
				write(fmt.Sprintf(annotationQueueResumePromptText, sessionFiles.env["DEVHOST_AGENT_PROMPT_FILE"]))
				return nil
			},
		})
		if err := controlServer.annotationQueueStore.resumePersistedQueues(); err != nil {
			_ = listener.Close()
			return nil, err
		}
	}

	mux := http.NewServeMux()
	mux.HandleFunc(injectedScriptPath, controlServer.handleInjectedScript)
	mux.HandleFunc(terminalSessionsPath, controlServer.handleTerminalSessions)
	mux.HandleFunc(annotationQueuesPath, controlServer.handleAnnotationQueues)
	mux.HandleFunc(annotationQueuesPath+"/", controlServer.handleAnnotationQueues)
	mux.HandleFunc(terminalWebsocketPath, controlServer.handleTerminalWebsocket)
	mux.HandleFunc(annotationQueuesWebsocketPath, controlServer.handleAnnotationQueueWebsocket)
	mux.HandleFunc(xtermStylesheetPath, controlServer.handleXtermStylesheet)
	mux.HandleFunc(restartServicePath, controlServer.handleRestartService)
	mux.HandleFunc(healthWebsocketPath, controlServer.handleHealthWebsocket)
	mux.HandleFunc(logsWebsocketPath, controlServer.handleLogsWebsocket)
	controlServer.server = &http.Server{Handler: mux}

	controlServer.serverWG.Add(2)
	go func() {
		defer controlServer.serverWG.Done()
		if serveError := controlServer.server.Serve(listener); serveError != nil && serveError != http.ErrServerClosed {
			return
		}
	}()
	go func() {
		defer controlServer.serverWG.Done()
		ticker := time.NewTicker(healthPollInterval)
		defer ticker.Stop()

		for range ticker.C {
			if controlServer.isClosed() {
				return
			}
			if !controlServer.hasHealthSubscribers() {
				continue
			}
			_ = controlServer.PublishHealthResponse()
		}
	}()

	return controlServer, nil
}

func (s *ControlServer) Port() int {
	return s.listener.Addr().(*net.TCPAddr).Port
}

func (s *ControlServer) PublishHealthResponse() error {
	if s.isClosed() {
		return nil
	}

	healthMessage, error := s.resolveHealthMessage()
	if error != nil || healthMessage == "" {
		return error
	}

	s.mu.Lock()
	if healthMessage == s.lastPublishedHealth {
		s.mu.Unlock()
		return nil
	}
	s.lastPublishedHealth = healthMessage
	clients := snapshotClients(s.healthClients)
	s.mu.Unlock()

	s.broadcast(clients, healthMessage, func(client *websocketClient) {
		s.removeHealthClient(client)
	})
	return nil
}

func (s *ControlServer) PublishLogEntry(serviceName string, stream ServiceLogStream, line string) {
	if s.isClosed() {
		return
	}

	s.mu.Lock()
	logEntry := ServiceLogEntry{
		ID:          s.nextLogEntryID,
		Line:        line,
		ServiceName: serviceName,
		Stream:      stream,
	}
	s.nextLogEntryID += 1
	s.retainedLogEntries = append(s.retainedLogEntries, logEntry)
	if len(s.retainedLogEntries) > maximumRetainedLogEntries {
		s.retainedLogEntries = s.retainedLogEntries[len(s.retainedLogEntries)-maximumRetainedLogEntries:]
	}
	clients := snapshotClients(s.logsClients)
	s.mu.Unlock()

	message, _ := json.Marshal(serviceLogUpdateMessage{Entry: logEntry, Type: "entry"})
	s.broadcast(clients, string(message), func(client *websocketClient) {
		s.removeLogsClient(client)
	})
}

func (s *ControlServer) Stop() error {
	s.mu.Lock()
	if s.isStopped {
		s.mu.Unlock()
		return nil
	}
	s.isStopped = true
	healthClients := snapshotClients(s.healthClients)
	logsClients := snapshotClients(s.logsClients)
	annotationQueueClients := snapshotClients(s.annotationQueueClients)
	terminalSessionIDs := append([]string{}, s.terminalSessionOrder...)
	s.healthClients = map[*websocketClient]struct{}{}
	s.logsClients = map[*websocketClient]struct{}{}
	s.annotationQueueClients = map[*websocketClient]struct{}{}
	s.mu.Unlock()
	if s.annotationQueueStore != nil {
		_ = s.annotationQueueStore.prepareForShutdown()
	}

	for _, sessionID := range terminalSessionIDs {
		s.closeTerminalSession(sessionID)
	}
	for _, client := range append(append(healthClients, logsClients...), annotationQueueClients...) {
		client.close()
	}

	shutdownContext, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	shutdownError := s.server.Shutdown(shutdownContext)
	s.serverWG.Wait()
	return shutdownError
}

func (s *ControlServer) handleInjectedScript(writer http.ResponseWriter, _ *http.Request) {
	writer.Header().Set("cache-control", cacheControlNoStore)
	writer.Header().Set("content-type", applicationJavascriptContentType)
	_, _ = writer.Write([]byte(s.devtoolsScript))
}

func (s *ControlServer) handleXtermStylesheet(writer http.ResponseWriter, _ *http.Request) {
	writer.Header().Set("cache-control", cacheControlNoStore)
	writer.Header().Set("content-type", textCSSContentType)
	_, _ = writer.Write([]byte(s.xtermStylesheet))
}

func (s *ControlServer) handleRestartService(writer http.ResponseWriter, request *http.Request) {
	if request.Header.Get(controlTokenHeaderName) != s.controlToken {
		http.Error(writer, "Forbidden", http.StatusForbidden)
		return
	}

	if request.Method != http.MethodPost {
		http.Error(writer, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var payload restartServiceRequest
	if error := json.NewDecoder(request.Body).Decode(&payload); error != nil || payload.ServiceName == "" {
		http.Error(writer, "Invalid restart service payload.", http.StatusBadRequest)
		return
	}

	if s.restartService == nil {
		http.Error(writer, "Restart service not supported.", http.StatusNotImplemented)
		return
	}

	if error := s.restartService(payload.ServiceName); error != nil {
		http.Error(writer, error.Error(), http.StatusInternalServerError)
		return
	}

	writer.Header().Set("content-type", "application/json")
	_ = json.NewEncoder(writer).Encode(successResponse{Success: true})
}

func (s *ControlServer) handleHealthWebsocket(writer http.ResponseWriter, request *http.Request) {
	client, error := s.upgrade(writer, request)
	if error != nil {
		return
	}

	healthMessage, error := s.resolveHealthMessage()
	if error != nil {
		client.close()
		return
	}
	if healthMessage != "" {
		s.mu.Lock()
		s.lastPublishedHealth = healthMessage
		s.healthClients[client] = struct{}{}
		s.mu.Unlock()
		if error := client.write(websocket.TextMessage, []byte(healthMessage)); error != nil {
			s.removeHealthClient(client)
			return
		}
	} else {
		s.mu.Lock()
		s.healthClients[client] = struct{}{}
		s.mu.Unlock()
	}

	go s.readUntilClosed(client, s.removeHealthClient)
}

func (s *ControlServer) handleLogsWebsocket(writer http.ResponseWriter, request *http.Request) {
	client, error := s.upgrade(writer, request)
	if error != nil {
		return
	}

	s.mu.Lock()
	s.logsClients[client] = struct{}{}
	snapshot := append([]ServiceLogEntry{}, s.retainedLogEntries...)
	s.mu.Unlock()

	message, _ := json.Marshal(serviceLogSnapshotMessage{Entries: snapshot, Type: "snapshot"})
	if error := client.write(websocket.TextMessage, message); error != nil {
		s.removeLogsClient(client)
		return
	}

	go s.readUntilClosed(client, s.removeLogsClient)
}

func (s *ControlServer) resolveHealthMessage() (string, error) {
	healthResponse, error := s.getHealth()
	if error != nil {
		return "", error
	}

	message, error := json.Marshal(healthResponse)
	if error != nil {
		return "", error
	}

	return string(message), nil
}

func (s *ControlServer) upgrade(writer http.ResponseWriter, request *http.Request) (*websocketClient, error) {
	connection, error := s.upgrader.Upgrade(writer, request, nil)
	if error != nil {
		return nil, error
	}

	return &websocketClient{conn: connection}, nil
}

func (s *ControlServer) readUntilClosed(client *websocketClient, remove func(*websocketClient)) {
	for {
		if _, _, error := client.conn.ReadMessage(); error != nil {
			remove(client)
			return
		}
	}
}

func (s *ControlServer) broadcast(clients []*websocketClient, message string, remove func(*websocketClient)) {
	for _, client := range clients {
		if error := client.write(websocket.TextMessage, []byte(message)); error != nil {
			remove(client)
		}
	}
}

func (s *ControlServer) removeHealthClient(client *websocketClient) {
	s.mu.Lock()
	delete(s.healthClients, client)
	s.mu.Unlock()
	client.close()
}

func (s *ControlServer) removeLogsClient(client *websocketClient) {
	s.mu.Lock()
	delete(s.logsClients, client)
	s.mu.Unlock()
	client.close()
}

func (s *ControlServer) hasHealthSubscribers() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.healthClients) > 0
}

func (s *ControlServer) isClosed() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.isStopped
}

func (c *websocketClient) write(messageType int, payload []byte) error {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	return c.conn.WriteMessage(messageType, payload)
}

func (c *websocketClient) close() {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	_ = c.conn.Close()
}

func createControlToken() (string, error) {
	bytes := make([]byte, 16)
	if _, error := rand.Read(bytes); error != nil {
		return "", error
	}

	return hex.EncodeToString(bytes), nil
}

func snapshotClients(clients map[*websocketClient]struct{}) []*websocketClient {
	result := make([]*websocketClient, 0, len(clients))
	for client := range clients {
		result = append(result, client)
	}

	return result
}

func chainCleanup(current func(), next func()) func() {
	if current == nil {
		return next
	}
	if next == nil {
		return current
	}
	return func() {
		current()
		next()
	}
}
