package devtools

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
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
	reactHighlightCursorPath         = controlPathPrefix + "/react-highlight/cursor"
	reactHighlightWebsocketPath      = controlPathPrefix + "/ws/react-highlight"
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
	Managed    bool    `json:"managed"`
	Name       string  `json:"name"`
	Status     bool    `json:"status"`
	URL        *string `json:"url,omitempty"`
	Dirty      bool    `json:"dirty,omitempty"`
	Restarting bool    `json:"restarting,omitempty"`
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
	AnnotationDefaultActionID  string
	AnnotationActions          []manifest.ValidatedAnnotationAction
	ComponentEditor            string
	DevAssetsDir               string
	FeatureToggles             FeatureToggles
	GetHealthResponse          func() (HealthResponse, error)
	IdleTerminalSessionTimeout time.Duration
	ManifestPath               string
	Position                   string
	ProjectRootPath            string
	PrimaryService             string
	RestartService             func([]string) error
	RestartServicesShortcut    string
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
	restartService             func([]string) error
	getHealth                  func() (HealthResponse, error)
	annotationActions          []manifest.ValidatedAnnotationAction
	projectRootPath            string
	stackName                  string
	startTerminalSession       terminalSessionStarter
	annotationQueueStore       *annotationQueueStore
	neovimShellIntegration     *neovimPluginShellIntegrationFiles
	tracker                    *ActivityTracker

	devAssetsDir   string
	configJSON     []byte
	ctx            context.Context
	cancel         context.CancelFunc
	buildMu        sync.Mutex
	disableRebuild bool

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
	reactHighlightClients  map[*websocketClient]struct{}

	serverWG sync.WaitGroup
	upgrader websocket.Upgrader
}

type websocketClient struct {
	conn      *websocket.Conn
	writeMu   sync.Mutex
	closeOnce sync.Once
	tracker   *ActivityTracker
}

type injectedConfig struct {
	AnnotationDefaultActionID string                     `json:"annotationDefaultActionId"`
	AnnotationActions         []injectedAnnotationAction `json:"annotationActions"`
	ComponentEditor           string                     `json:"componentEditor"`
	ControlToken              string                     `json:"controlToken"`
	Position                  string                     `json:"position"`
	ProjectRootPath           string                     `json:"projectRootPath"`
	StackName                 string                     `json:"stackName"`
	EditorEnabled             bool                       `json:"editorEnabled"`
	ExternalToolbarsEnabled   bool                       `json:"externalToolbarsEnabled"`
	MinimapEnabled            bool                       `json:"minimapEnabled"`
	StatusEnabled             bool                       `json:"statusEnabled"`
	AnnotationEnabled         bool                       `json:"annotationEnabled"`
	AnnotationQueueEnabled    bool                       `json:"annotationQueueEnabled"`
	TerminalEnabled           bool                       `json:"terminalEnabled"`
	RoutedServices            []RoutedServiceIdentity    `json:"routedServices"`
	RestartServicesShortcut   string                     `json:"restartServicesShortcut"`
	PrimaryService            string                     `json:"primaryService"`
}

type injectedAnnotationAction struct {
	ID           string `json:"id"`
	DisplayName  string `json:"displayName"`
	Kind         string `json:"kind"`
	QueueEnabled bool   `json:"queueEnabled"`
}

type restartServiceRequest struct {
	ServiceName  string   `json:"serviceName,omitempty"`
	ServiceNames []string `json:"serviceNames,omitempty"`
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

type reactHighlightCursorRequest struct {
	Locator *string `json:"locator"`
}

type reactHighlightCursorMessage struct {
	Kind        string  `json:"kind"`
	Locator     *string `json:"locator"`
	ProjectRoot string  `json:"projectRoot"`
	StackName   string  `json:"stackName"`
	Timestamp   int64   `json:"timestamp"`
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

	annotationActions := append([]manifest.ValidatedAnnotationAction{}, options.AnnotationActions...)
	annotationDefaultActionID := normalizeAnnotationDefaultActionID(options.AnnotationDefaultActionID, annotationActions)
	config := injectedConfig{
		AnnotationDefaultActionID: annotationDefaultActionID,
		AnnotationActions:         createInjectedAnnotationActions(annotationActions),
		AnnotationEnabled:         options.FeatureToggles.AnnotationEnabled,
		AnnotationQueueEnabled:    options.FeatureToggles.AnnotationQueueEnabled,
		ComponentEditor:           options.ComponentEditor,
		ControlToken:              controlToken,
		EditorEnabled:             options.FeatureToggles.EditorEnabled,
		ExternalToolbarsEnabled:   options.FeatureToggles.ExternalToolbarsEnabled,
		MinimapEnabled:            options.FeatureToggles.MinimapEnabled,
		Position:                  options.Position,
		ProjectRootPath:           options.ProjectRootPath,
		RoutedServices:            append([]RoutedServiceIdentity{}, options.RoutedServices...),
		StackName:                 options.StackName,
		StatusEnabled:             options.FeatureToggles.StatusEnabled,
		TerminalEnabled:           options.FeatureToggles.TerminalEnabled,
		RestartServicesShortcut:   options.RestartServicesShortcut,
		PrimaryService:            options.PrimaryService,
	}
	configJSON, err := json.Marshal(config)
	if err != nil {
		_ = listener.Close()
		return nil, fmt.Errorf("marshal devtools config: %w", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	controlServer := &ControlServer{
		ctx:                        ctx,
		cancel:                     cancel,
		devAssetsDir:               options.DevAssetsDir,
		configJSON:                 configJSON,
		annotationActions:          annotationActions,
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
		reactHighlightClients:      map[*websocketClient]struct{}{},
		restartService:             options.RestartService,
		stackName:                  options.StackName,
		startTerminalSession:       options.StartTerminalSession,
		terminalSessions:           map[string]*terminalSessionState{},
		xtermStylesheet:            xtermStylesheet,
		tracker:                    NewActivityTracker(),
		upgrader: websocket.Upgrader{
			CheckOrigin: func(*http.Request) bool {
				return true
			},
		},
	}
	if controlServer.idleTerminalSessionTimeout <= 0 {
		controlServer.idleTerminalSessionTimeout = defaultIdleTerminalSessionPeriod
	}
	if options.FeatureToggles.EditorEnabled {
		neovimShellIntegration, err := createNeovimPluginShellIntegrationFiles(
			options.ProjectRootPath,
			options.StackName,
			fmt.Sprintf("http://127.0.0.1:%d%s", controlServer.Port(), reactHighlightCursorPath),
			controlToken,
		)
		if err != nil {
			_ = listener.Close()
			return nil, err
		}
		controlServer.neovimShellIntegration = neovimShellIntegration
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
					actionID:    session.request.ActionID,
					agentStatus: session.agentStatus,
					annotation:  *session.request.Annotation,
					sessionID:   sessionID,
				}
			},
			routedServices:     options.RoutedServices,
			stackName:          options.StackName,
			stateDirectoryPath: options.StateDirectoryPath,
			startAgentSession: func(actionID string, annotation annotationSubmitDetail) (string, error) {
				return controlServer.createTerminalSession(terminalSessionRequest{ActionID: actionID, Annotation: &annotation, Kind: terminalSessionRequestKindAgent})
			},
			writeAnnotationToSession: func(actionID string, sessionID string, annotation annotationSubmitDetail) error {
				action, ok := findAnnotationAction(annotationActions, actionID)
				if !ok || action.Kind != terminalSessionRequestKindAgent {
					return fmt.Errorf("Annotation action %s is not available.", actionID)
				}
				controlServer.mu.Lock()
				session := controlServer.terminalSessions[sessionID]
				if session == nil || session.closed || session.exited != nil || session.request.Kind != terminalSessionRequestKindAgent || session.request.ActionID != actionID {
					controlServer.mu.Unlock()
					return fmt.Errorf("Agent terminal session %s is not available.", sessionID)
				}
				session.request.Annotation = &annotation
				write := session.write
				controlServer.mu.Unlock()

				sessionFiles, err := createAgentSessionFiles(annotation, action.ID, action.DisplayName, action.Agent.DisplayName, options.ProjectRootPath, createAnnotationAgentPrompt(annotation), options.StackName)
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
	mux.HandleFunc(reactHighlightCursorPath, controlServer.handleReactHighlightCursor)
	mux.HandleFunc(terminalWebsocketPath, controlServer.handleTerminalWebsocket)
	mux.HandleFunc(annotationQueuesWebsocketPath, controlServer.handleAnnotationQueueWebsocket)
	mux.HandleFunc(reactHighlightWebsocketPath, controlServer.handleReactHighlightWebsocket)
	mux.HandleFunc(xtermStylesheetPath, controlServer.handleXtermStylesheet)
	mux.HandleFunc(restartServicePath, controlServer.handleRestartService)
	mux.HandleFunc(healthWebsocketPath, controlServer.handleHealthWebsocket)
	mux.HandleFunc(logsWebsocketPath, controlServer.handleLogsWebsocket)
	controlServer.server = &http.Server{Handler: controlServer.trackerMiddleware(mux)}

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
func normalizeAnnotationDefaultActionID(actionID string, actions []manifest.ValidatedAnnotationAction) string {
	for _, action := range actions {
		if action.ID == actionID {
			return actionID
		}
	}
	if len(actions) > 0 {
		return actions[0].ID
	}
	return ""
}

func createInjectedAnnotationActions(actions []manifest.ValidatedAnnotationAction) []injectedAnnotationAction {
	result := make([]injectedAnnotationAction, 0, len(actions))
	for _, action := range actions {
		result = append(result, injectedAnnotationAction{
			ID:           action.ID,
			DisplayName:  action.DisplayName,
			Kind:         action.Kind,
			QueueEnabled: action.Kind == terminalSessionRequestKindAgent,
		})
	}
	return result
}

func (s *ControlServer) Port() int {
	return s.listener.Addr().(*net.TCPAddr).Port
}

func (s *ControlServer) Tracker() *ActivityTracker {
	return s.tracker
}

func (s *ControlServer) trackerMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s.tracker.RecordActivity()
		next.ServeHTTP(w, r)
	})
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
	if s.cancel != nil {
		s.cancel()
	}
	healthClients := snapshotClients(s.healthClients)
	logsClients := snapshotClients(s.logsClients)
	annotationQueueClients := snapshotClients(s.annotationQueueClients)
	reactHighlightClients := snapshotClients(s.reactHighlightClients)
	terminalSessionIDs := append([]string{}, s.terminalSessionOrder...)
	neovimShellIntegration := s.neovimShellIntegration
	s.healthClients = map[*websocketClient]struct{}{}
	s.logsClients = map[*websocketClient]struct{}{}
	s.annotationQueueClients = map[*websocketClient]struct{}{}
	s.reactHighlightClients = map[*websocketClient]struct{}{}
	s.neovimShellIntegration = nil
	s.mu.Unlock()
	if s.annotationQueueStore != nil {
		_ = s.annotationQueueStore.prepareForShutdown()
	}

	for _, sessionID := range terminalSessionIDs {
		s.closeTerminalSession(sessionID)
	}
	for _, client := range append(append(append(healthClients, logsClients...), annotationQueueClients...), reactHighlightClients...) {
		client.close()
	}

	shutdownContext, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	shutdownError := s.server.Shutdown(shutdownContext)
	s.serverWG.Wait()
	if neovimShellIntegration != nil {
		neovimShellIntegration.cleanup()
	}
	return shutdownError
}

func formatJSError(errLog string) string {
	return fmt.Sprintf(`console.error("DEVHOST COMPILATION ERROR:\n" + %q);
if (typeof document !== "undefined") {
	const banner = document.createElement("div");
	banner.style.position = "fixed";
	banner.style.bottom = "0";
	banner.style.left = "0";
	banner.style.right = "0";
	banner.style.background = "#ff3333";
	banner.style.color = "white";
	banner.style.padding = "16px";
	banner.style.zIndex = "999999";
	banner.style.fontFamily = "monospace";
	banner.style.whiteSpace = "pre-wrap";
	banner.style.fontSize = "14px";
	banner.innerText = "DEVHOST COMPILATION ERROR:\n" + %q;
	document.body.appendChild(banner);
}`, errLog, errLog)
}

func (s *ControlServer) checkAndBuildAssets() (string, bool) {
	srcDir := filepath.Join(s.projectRootPath, "packages/devhost-ui/src/devtools")
	compiledPath := filepath.Join(s.devAssetsDir, "devtools.js")

	s.buildMu.Lock()
	defer s.buildMu.Unlock()

	if s.disableRebuild {
		return "", false
	}

	var maxModTime time.Time
	walkErr := filepath.WalkDir(srcDir, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		name := d.Name()
		if strings.HasPrefix(name, ".") {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if d.IsDir() {
			return nil
		}
		if strings.HasSuffix(name, ".test.ts") ||
			strings.HasSuffix(name, ".test.tsx") ||
			strings.HasSuffix(name, ".spec.ts") ||
			strings.HasSuffix(name, ".spec.tsx") {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return err
		}
		if info.ModTime().After(maxModTime) {
			maxModTime = info.ModTime()
		}
		return nil
	})

	if walkErr != nil {
		_, _ = fmt.Fprintf(os.Stderr, "Warning: failed to walk source assets directory: %v\n", walkErr)
		return "", false
	}

	var needsBuild bool
	compiledInfo, err := os.Stat(compiledPath)
	if os.IsNotExist(err) {
		needsBuild = true
	} else if err != nil {
		_, _ = fmt.Fprintf(os.Stderr, "Warning: failed to stat compiled assets: %v\n", err)
		return "", false
	} else if maxModTime.After(compiledInfo.ModTime()) {
		needsBuild = true
	}

	if !needsBuild {
		content, err := os.ReadFile(compiledPath)
		if err != nil {
			_, _ = fmt.Fprintf(os.Stderr, "Warning: failed to read compiled assets from disk: %v\n", err)
			return "", false
		}
		return string(content), true
	}

	_, _ = fmt.Fprintln(os.Stderr, "[devhost] Changes detected in devtools UI source files. Rebuilding assets...")

	cmd := exec.CommandContext(s.ctx, "bun", "run", "build:devtools-bundle:devhost")
	cmd.Dir = s.projectRootPath

	var stderr strings.Builder
	cmd.Stderr = &stderr

	runErr := cmd.Run()
	if runErr != nil {
		errLog := stderr.String()
		if errLog == "" {
			errLog = runErr.Error()
		}
		_, _ = fmt.Fprintf(os.Stderr, "[devhost] Compilation failed:\n%s\n", errLog)

		jsError := formatJSError(errLog)
		return jsError, true
	}

	_, err = os.Stat(compiledPath)
	if os.IsNotExist(err) {
		_, _ = fmt.Fprintln(os.Stderr, "Error: compilation completed successfully, but devtools.js is still missing from disk.")
		s.disableRebuild = true
		return "", false
	}

	content, err := os.ReadFile(compiledPath)
	if err != nil {
		_, _ = fmt.Fprintf(os.Stderr, "Warning: failed to read newly compiled assets: %v\n", err)
		return "", false
	}

	return string(content), true
}

func (s *ControlServer) handleInjectedScript(writer http.ResponseWriter, _ *http.Request) {
	writer.Header().Set("cache-control", cacheControlNoStore)
	writer.Header().Set("content-type", applicationJavascriptContentType)

	var script string
	var ok bool

	if s.devAssetsDir != "" {
		script, ok = s.checkAndBuildAssets()
	}

	if ok {
		fullScript := fmt.Sprintf("globalThis.__DEVHOST_INJECTED_CONFIG__=%s;\n%s", string(s.configJSON), script)
		_, _ = writer.Write([]byte(fullScript))
	} else {
		_, _ = writer.Write([]byte(s.devtoolsScript))
	}
}

func (s *ControlServer) handleXtermStylesheet(writer http.ResponseWriter, _ *http.Request) {
	writer.Header().Set("cache-control", cacheControlNoStore)
	writer.Header().Set("content-type", textCSSContentType)

	if s.devAssetsDir != "" {
		compiledPath := filepath.Join(s.devAssetsDir, "xterm.css")
		content, err := os.ReadFile(compiledPath)
		if err == nil {
			_, _ = writer.Write(content)
			return
		}
		_, _ = fmt.Fprintf(os.Stderr, "Warning: failed to read xterm.css from disk: %v\n", err)
	}

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
	if error := json.NewDecoder(request.Body).Decode(&payload); error != nil {
		http.Error(writer, "Invalid restart service payload.", http.StatusBadRequest)
		return
	}

	serviceNames := payload.ServiceNames
	if len(serviceNames) == 0 && payload.ServiceName != "" {
		serviceNames = []string{payload.ServiceName}
	}

	if len(serviceNames) == 0 {
		http.Error(writer, "Invalid restart service payload: no services specified.", http.StatusBadRequest)
		return
	}

	if s.restartService == nil {
		http.Error(writer, "Restart service not supported.", http.StatusNotImplemented)
		return
	}

	if error := s.restartService(serviceNames); error != nil {
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

func (s *ControlServer) handleReactHighlightCursor(writer http.ResponseWriter, request *http.Request) {
	if request.Header.Get(controlTokenHeaderName) != s.controlToken {
		http.Error(writer, "Forbidden", http.StatusForbidden)
		return
	}

	if request.Method != http.MethodPost {
		http.Error(writer, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var payload reactHighlightCursorRequest
	if error := json.NewDecoder(request.Body).Decode(&payload); error != nil {
		http.Error(writer, "Invalid React Highlight cursor payload.", http.StatusBadRequest)
		return
	}
	if payload.Locator != nil && *payload.Locator == "" {
		http.Error(writer, "Invalid React Highlight cursor payload.", http.StatusBadRequest)
		return
	}

	message, error := json.Marshal(reactHighlightCursorMessage{
		Kind:        "cursor",
		Locator:     payload.Locator,
		ProjectRoot: s.projectRootPath,
		StackName:   s.stackName,
		Timestamp:   time.Now().UnixMilli(),
	})
	if error != nil {
		http.Error(writer, "Failed to encode React Highlight cursor payload.", http.StatusInternalServerError)
		return
	}

	s.mu.Lock()
	clients := snapshotClients(s.reactHighlightClients)
	s.mu.Unlock()
	s.broadcast(clients, string(message), func(client *websocketClient) {
		s.removeReactHighlightClient(client)
	})

	writer.Header().Set("content-type", "application/json")
	_ = json.NewEncoder(writer).Encode(successResponse{Success: true})
}

func (s *ControlServer) handleReactHighlightWebsocket(writer http.ResponseWriter, request *http.Request) {
	if request.URL.Query().Get(terminalSessionWebsocketQueryToken) != s.controlToken {
		http.Error(writer, "Forbidden", http.StatusForbidden)
		return
	}

	client, error := s.upgrade(writer, request)
	if error != nil {
		return
	}

	s.mu.Lock()
	s.reactHighlightClients[client] = struct{}{}
	s.mu.Unlock()

	go s.readUntilClosed(client, s.removeReactHighlightClient)
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

	s.tracker.IncrementActive()
	return &websocketClient{conn: connection, tracker: s.tracker}, nil
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

func (s *ControlServer) removeReactHighlightClient(client *websocketClient) {
	s.mu.Lock()
	delete(s.reactHighlightClients, client)
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
	c.closeOnce.Do(func() {
		_ = c.conn.Close()
		if c.tracker != nil {
			c.tracker.DecrementActive()
		}
	})
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
