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
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/hostusage"
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
	restartStackPath                 = controlPathPrefix + "/restart-stack"
	startServicePath                 = controlPathPrefix + "/start-service"
	healthWebsocketPath              = controlPathPrefix + "/ws/health"
	resourcesWebsocketPath           = controlPathPrefix + "/ws/resources"
	logsWebsocketPath                = controlPathPrefix + "/ws/logs"
	maximumRetainedLogEntries        = 512
	healthPollInterval               = time.Second
	websocketCloseFrameTimeout       = time.Second
	websocketCloseReasonStopping     = "devhost is stopping"
	websocketCloseReasonSessionEnded = "terminal session ended"
	// A page that reads nothing for this long while its connection is full, such as one paused in a debugger, is
	// dropped.
	defaultWebsocketWriteTimeout     = 10 * time.Second
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
	Managed         bool    `json:"managed"`
	Name            string  `json:"name"`
	Status          bool    `json:"status"`
	URL             *string `json:"url,omitempty"`
	Dirty           bool    `json:"dirty,omitempty"`
	Restarting      bool    `json:"restarting,omitempty"`
	ExitCode        *int    `json:"exitCode,omitempty"`
	ProjectRootPath string  `json:"projectRootPath,omitempty"`
}

// StoppedService is a manifest service this run has not started.
type StoppedService struct {
	Name string `json:"name"`
}

type HealthResponse struct {
	Routing  *RoutingConfig  `json:"routing,omitempty"`
	Services []ServiceHealth `json:"services"`
	// StoppedServices lists the services left out by a run that named the ones to start.
	StoppedServices []StoppedService     `json:"stoppedServices,omitempty"`
	Repositories    []WorktreeRepository `json:"repositories,omitempty"`
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
	NativeBrowser              manifest.DevtoolsBrowserConfig
	AllowsNativeBrowserURL     func(int, string) (bool, error)
	AnnotationDefaultActionID  string
	AnnotationActions          []manifest.ValidatedAnnotationAction
	ComponentEditor            string
	DevSource                  *DevSourceCheckout
	FeatureToggles             FeatureToggles
	GetHealthResponse          func() (HealthResponse, error)
	IdleTerminalSessionTimeout time.Duration
	// WebsocketWriteTimeout bounds one write to a browser connection. Zero selects the default.
	WebsocketWriteTimeout   time.Duration
	ManifestPath            string
	Position                string
	ProjectRootPath         string
	PrimaryService          string
	ResourceUsage           ResourceUsageOptions
	RestartService          func([]string) error
	RestartStack            func() error
	StartService            func([]string) error
	SwitchWorktree          func(string, string) error
	RefreshWorktrees        func() error
	GetToolContext          func(string) (ToolContext, error)
	RestartServicesShortcut string
	RoutedServices          []RoutedServiceIdentity
	StateDirectoryPath      string
	StartTerminalSession    terminalSessionStarter
	StackName               string
}

type ControlServer struct {
	nativeBrowser              manifest.DevtoolsBrowserConfig
	nativeBrowserInstanceID    string
	allowsNativeBrowserURL     func(int, string) (bool, error)
	listener                   net.Listener
	server                     *http.Server
	componentEditor            string
	featureToggles             FeatureToggles
	idleTerminalSessionTimeout time.Duration
	websocketWriteTimeout      time.Duration
	restartService             func([]string) error
	restartStack               func() error
	startService               func([]string) error
	switchWorktree             func(string, string) error
	refreshWorktrees           func() error
	getToolContext             func(string) (ToolContext, error)
	routedServices             []RoutedServiceIdentity
	primaryService             string
	getHealth                  func() (HealthResponse, error)
	annotationActions          []manifest.ValidatedAnnotationAction
	projectRootPath            string
	stackName                  string
	startTerminalSession       terminalSessionStarter
	annotationQueueStore       *annotationQueueStore
	neovimShellIntegration     *neovimPluginShellIntegrationFiles
	tracker                    *ActivityTracker

	devSource  *DevSourceCheckout
	configJSON []byte
	ctx        context.Context
	cancel     context.CancelFunc
	buildMu    sync.Mutex
	// healthMu makes recording the health sent last and sending it one step, so the health every client holds is the
	// recorded one.
	healthMu sync.Mutex
	// resourcesMu does for resource usage what healthMu does for health.
	resourcesMu sync.Mutex

	mu                     sync.Mutex
	isStopped              bool
	lastPublishedHealth    string
	lastPublishedResources string
	resourceSampler        *hostusage.Sampler
	resourceClients        map[*websocketClient]struct{}
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
	conn         *websocket.Conn
	writeMu      sync.Mutex
	closeOnce    sync.Once
	tracker      *ActivityTracker
	writeTimeout time.Duration
}

type injectedConfig struct {
	NativeBrowserConfigured   bool                       `json:"nativeBrowserConfigured"`
	NativeBrowserInstanceID   string                     `json:"nativeBrowserInstanceId"`
	AnnotationDefaultActionID string                     `json:"annotationDefaultActionId"`
	AnnotationActions         []injectedAnnotationAction `json:"annotationActions"`
	ComponentEditor           string                     `json:"componentEditor"`
	HomeDirectoryPath         string                     `json:"homeDirectoryPath"`
	Position                  string                     `json:"position"`
	ProjectRootPath           string                     `json:"projectRootPath"`
	StackName                 string                     `json:"stackName"`
	EditorEnabled             bool                       `json:"editorEnabled"`
	ExternalToolbarsEnabled   bool                       `json:"externalToolbarsEnabled"`
	MinimapEnabled            bool                       `json:"minimapEnabled"`
	StatusEnabled             bool                       `json:"statusEnabled"`
	ResourcesEnabled          bool                       `json:"resourcesEnabled"`
	AnnotationEnabled         bool                       `json:"annotationEnabled"`
	AnnotationQueueEnabled    bool                       `json:"annotationQueueEnabled"`
	TerminalEnabled           bool                       `json:"terminalEnabled"`
	RoutedServices            []RoutedServiceIdentity    `json:"routedServices"`
	RestartServicesShortcut   string                     `json:"restartServicesShortcut"`
	PrimaryService            string                     `json:"primaryService"`
}

type injectedAnnotationAction struct {
	ID           string `json:"id"`
	Label        string `json:"label"`
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

	annotationActions := append([]manifest.ValidatedAnnotationAction{}, options.AnnotationActions...)
	annotationDefaultActionID := normalizeAnnotationDefaultActionID(options.AnnotationDefaultActionID, annotationActions)
	home, err := os.UserHomeDir()
	if err != nil {
		// Path abbreviation is optional; keep absolute paths when no home is available.
		home = ""
	}
	instanceID, err := createRandomID()
	if err != nil {
		_ = listener.Close() // The identity error is authoritative; no listener is retained.
		return nil, fmt.Errorf("create native browser instance identity: %w", err)
	}
	config := injectedConfig{
		NativeBrowserConfigured:   options.NativeBrowser.Endpoint != "",
		NativeBrowserInstanceID:   instanceID,
		AnnotationDefaultActionID: annotationDefaultActionID,
		AnnotationActions:         createInjectedAnnotationActions(annotationActions),
		AnnotationEnabled:         options.FeatureToggles.AnnotationEnabled,
		AnnotationQueueEnabled:    options.FeatureToggles.AnnotationQueueEnabled,
		ComponentEditor:           options.ComponentEditor,
		HomeDirectoryPath:         home,
		EditorEnabled:             options.FeatureToggles.EditorEnabled,
		ExternalToolbarsEnabled:   options.FeatureToggles.ExternalToolbarsEnabled,
		MinimapEnabled:            options.FeatureToggles.MinimapEnabled,
		Position:                  options.Position,
		ProjectRootPath:           options.ProjectRootPath,
		RoutedServices:            append([]RoutedServiceIdentity{}, options.RoutedServices...),
		StackName:                 options.StackName,
		StatusEnabled:             options.FeatureToggles.StatusEnabled,
		ResourcesEnabled:          options.ResourceUsage.isEnabled(),
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
		nativeBrowser:              options.NativeBrowser,
		nativeBrowserInstanceID:    instanceID,
		allowsNativeBrowserURL:     options.AllowsNativeBrowserURL,
		ctx:                        ctx,
		cancel:                     cancel,
		devSource:                  options.DevSource,
		configJSON:                 configJSON,
		annotationActions:          annotationActions,
		componentEditor:            options.ComponentEditor,
		featureToggles:             options.FeatureToggles,
		annotationQueueClients:     map[*websocketClient]struct{}{},
		getHealth:                  options.GetHealthResponse,
		healthClients:              map[*websocketClient]struct{}{},
		idleTerminalSessionTimeout: options.IdleTerminalSessionTimeout,
		websocketWriteTimeout:      options.WebsocketWriteTimeout,
		listener:                   listener,
		logsClients:                map[*websocketClient]struct{}{},
		nextLogEntryID:             1,
		projectRootPath:            options.ProjectRootPath,
		reactHighlightClients:      map[*websocketClient]struct{}{},
		resourceClients:            map[*websocketClient]struct{}{},
		restartService:             options.RestartService,
		restartStack:               options.RestartStack,
		startService:               options.StartService,
		switchWorktree:             options.SwitchWorktree,
		refreshWorktrees:           options.RefreshWorktrees,
		getToolContext:             options.GetToolContext,
		routedServices:             append([]RoutedServiceIdentity{}, options.RoutedServices...),
		primaryService:             options.PrimaryService,
		stackName:                  options.StackName,
		startTerminalSession:       options.StartTerminalSession,
		terminalSessions:           map[string]*terminalSessionState{},
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
	if controlServer.websocketWriteTimeout <= 0 {
		controlServer.websocketWriteTimeout = defaultWebsocketWriteTimeout
	}
	if options.FeatureToggles.EditorEnabled {
		neovimShellIntegration, err := createNeovimPluginShellIntegrationFiles(
			options.ProjectRootPath,
			options.StackName,
			fmt.Sprintf("http://127.0.0.1:%d%s", controlServer.Port(), reactHighlightCursorPath),
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
					colorScheme: session.request.ColorScheme,
					sessionID:   sessionID,
				}
			},
			routedServices:     options.RoutedServices,
			stackName:          options.StackName,
			stateDirectoryPath: options.StateDirectoryPath,
			startAgentSession: func(actionID string, annotation annotationSubmitDetail, colorScheme agentColorScheme) (string, error) {
				return controlServer.createTerminalSession(terminalSessionRequest{ActionID: actionID, Annotation: &annotation, ColorScheme: colorScheme, Kind: terminalSessionRequestKindAgent})
			},
			writeAnnotationToSession: func(actionID string, sessionID string, annotation annotationSubmitDetail) error {
				action, ok := findAnnotationAction(annotationActions, actionID)
				if !ok || action.Kind != terminalSessionRequestKindAgent {
					return fmt.Errorf("Annotation action %s is not available.", actionID)
				}
				toolContext, err := controlServer.toolContext(terminalSessionRequest{Annotation: &annotation})
				if err != nil {
					return err
				}
				controlServer.mu.Lock()
				session := controlServer.terminalSessions[sessionID]
				if session == nil || session.closed || session.exited != nil || session.request.Kind != terminalSessionRequestKindAgent || session.request.ActionID != actionID {
					controlServer.mu.Unlock()
					return fmt.Errorf("Agent terminal session %s is not available.", sessionID)
				}
				if session.projectRootPath != toolContext.ProjectRootPath {
					controlServer.mu.Unlock()
					return fmt.Errorf("Agent session belongs to the previous checkout; resume the queue to start a session in the selected worktree.")
				}
				session.request.Annotation = &annotation
				write := session.write
				controlServer.mu.Unlock()

				// The agent is already running with its adapter support files, so the handoff needs only the annotation.
				sessionFiles, err := createAnnotationSessionFiles(agentSessionDirectoryPrefix, annotationSessionFilesOptions{
					action:          action,
					annotation:      annotation,
					projectRootPath: toolContext.ProjectRootPath,
					stackName:       options.StackName,
				})
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
				// The carriage return submits the instruction to the running agent.
				write(createAnnotationPromptInstruction(sessionFiles.promptFilePath) + "\r")
				return nil
			},
		})
		if err := controlServer.annotationQueueStore.resumePersistedQueues(); err != nil {
			_ = listener.Close()
			return nil, err
		}
	}

	mux := http.NewServeMux()
	mux.HandleFunc(nativeBrowserWebsocketPath, controlServer.handleNativeBrowserWebsocket)
	mux.HandleFunc(injectedScriptPath, controlServer.handleInjectedScript)
	mux.HandleFunc(injectedConfigPath, controlServer.handleInjectedConfig)
	mux.HandleFunc(devtoolsAssetsPath, controlServer.handleDevtoolsAsset)
	mux.HandleFunc(terminalSessionsPath, controlServer.handleTerminalSessions)
	mux.HandleFunc(annotationQueuesPath, controlServer.handleAnnotationQueues)
	mux.HandleFunc(annotationQueuesPath+"/", controlServer.handleAnnotationQueues)
	mux.HandleFunc(reactHighlightCursorPath, controlServer.handleReactHighlightCursor)
	mux.HandleFunc(terminalWebsocketPath, controlServer.handleTerminalWebsocket)
	mux.HandleFunc(annotationQueuesWebsocketPath, controlServer.handleAnnotationQueueWebsocket)
	mux.HandleFunc(reactHighlightWebsocketPath, controlServer.handleReactHighlightWebsocket)
	mux.HandleFunc(xtermStylesheetPath, controlServer.handleXtermStylesheet)
	mux.HandleFunc("GET "+reduxMonitorPath, controlServer.handleReduxMonitor)
	mux.HandleFunc("GET "+reduxRegistrationScriptPath, controlServer.handleReduxRegistrationScript)
	mux.HandleFunc("GET "+reduxMonitorScriptPath, controlServer.handleReduxMonitorScript)
	mux.HandleFunc("GET "+reduxMonitorStylesheetPath, controlServer.handleReduxMonitorStylesheet)
	mux.HandleFunc(restartServicePath, controlServer.handleRestartService)
	mux.HandleFunc(restartStackPath, controlServer.handleRestartStack)
	mux.HandleFunc(startServicePath, controlServer.handleStartService)
	mux.HandleFunc(worktreesPath, controlServer.handleWorktrees)
	mux.HandleFunc(healthWebsocketPath, controlServer.handleHealthWebsocket)
	if options.ResourceUsage.isEnabled() {
		mux.HandleFunc(resourcesWebsocketPath, controlServer.handleResourcesWebsocket)
		controlServer.startResourceSampler(options.ResourceUsage)
	}
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
			Label:        action.Label,
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

	return s.publishHealth(nil)
}

// publishHealth reads the stack health and sends it to every client it is news to: all of them when it differs
// from the health sent last, and otherwise only newClient, which has received none yet. newClient is the client an
// attach is adding, or nil.
func (s *ControlServer) publishHealth(newClient *websocketClient) error {
	healthMessage, err := s.resolveHealthMessage()
	if err != nil {
		return err
	}

	// With two sends interleaved, a client could end up holding health other than the recorded one, and the next
	// publish of the recorded health would be skipped as nothing new.
	s.healthMu.Lock()
	defer s.healthMu.Unlock()

	s.mu.Lock()
	if newClient != nil {
		s.healthClients[newClient] = struct{}{}
	}
	var recipients []*websocketClient
	switch {
	case healthMessage != s.lastPublishedHealth:
		s.lastPublishedHealth = healthMessage
		recipients = snapshotClients(s.healthClients)
	case newClient != nil:
		recipients = []*websocketClient{newClient}
	}
	s.mu.Unlock()

	s.broadcast(recipients, healthMessage, s.removeHealthClient)
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
	resourceClients := snapshotClients(s.resourceClients)
	resourceSampler := s.resourceSampler
	terminalSessionIDs := append([]string{}, s.terminalSessionOrder...)
	neovimShellIntegration := s.neovimShellIntegration
	s.healthClients = map[*websocketClient]struct{}{}
	s.logsClients = map[*websocketClient]struct{}{}
	s.annotationQueueClients = map[*websocketClient]struct{}{}
	s.reactHighlightClients = map[*websocketClient]struct{}{}
	s.resourceClients = map[*websocketClient]struct{}{}
	s.neovimShellIntegration = nil
	s.mu.Unlock()
	if s.annotationQueueStore != nil {
		_ = s.annotationQueueStore.prepareForShutdown()
	}

	for _, sessionID := range terminalSessionIDs {
		s.closeTerminalSession(sessionID)
	}
	for _, client := range slices.Concat(healthClients, logsClients, annotationQueueClients, reactHighlightClients, resourceClients) {
		client.closeWith(websocket.CloseGoingAway, websocketCloseReasonStopping)
	}
	if resourceSampler != nil {
		// The context is canceled and the clients are closed, so no reading is taken or sent after Stop returns.
		resourceSampler.Wait()
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

func (s *ControlServer) checkAndBuildAssets(filename string) ([]byte, []byte, error) {
	srcDir := s.devSource.sourceDirectoryPath
	compiledPath := s.devSource.assetPath(filename)

	s.buildMu.Lock()
	defer s.buildMu.Unlock()

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
		return nil, nil, fmt.Errorf("walk source assets: %w", walkErr)
	}

	var needsBuild bool
	compiledInfo, err := os.Stat(compiledPath)
	if os.IsNotExist(err) {
		needsBuild = true
	} else if err != nil {
		return nil, nil, fmt.Errorf("stat compiled assets: %w", err)
	} else if maxModTime.After(compiledInfo.ModTime()) {
		needsBuild = true
	}

	if !needsBuild {
		return s.readAsset(filename)
	}

	_, _ = fmt.Fprintln(os.Stderr, "[devhost] Changes detected in devtools UI source files. Rebuilding assets...")

	cmd := s.devSource.buildCommand(s.ctx)

	var stderr strings.Builder
	cmd.Stderr = &stderr

	runErr := cmd.Run()
	if runErr != nil {
		errLog := stderr.String()
		if errLog == "" {
			errLog = runErr.Error()
		}
		_, _ = fmt.Fprintf(os.Stderr, "[devhost] Compilation failed:\n%s\n", errLog)

		return nil, nil, fmt.Errorf("build devtools assets: %s", errLog)
	}

	// A build that exits cleanly without writing the bundle is reported like a
	// failed one and retried on the next request. Builds are serialized by
	// buildMu, so retrying per page load cannot pile up concurrent builds.
	_, err = os.Stat(compiledPath)
	if os.IsNotExist(err) {
		missingBundleMessage := fmt.Sprintf("The %s recipe finished without writing %s.", devtoolsBundleRecipe, compiledPath)
		_, _ = fmt.Fprintf(os.Stderr, "[devhost] %s\n", missingBundleMessage)
		return nil, nil, fmt.Errorf("%s", missingBundleMessage)
	}

	return s.readAsset(filename)
}

func (s *ControlServer) handleRestartService(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodPost {
		http.Error(writer, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var payload restartServiceRequest
	if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
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

	if err := s.restartService(serviceNames); err != nil {
		http.Error(writer, err.Error(), http.StatusInternalServerError)
		return
	}

	writer.Header().Set("content-type", "application/json")
	_ = json.NewEncoder(writer).Encode(successResponse{Success: true})
}

func (s *ControlServer) handleHealthWebsocket(writer http.ResponseWriter, request *http.Request) {
	client, err := s.upgrade(writer, request)
	if err != nil {
		return
	}

	// Attaching publishes: the health read for this client goes to the earlier clients too when it is new to them.
	if err := s.publishHealth(client); err != nil {
		client.close()
		return
	}

	go s.readUntilClosed(client, s.removeHealthClient)
}

func (s *ControlServer) handleLogsWebsocket(writer http.ResponseWriter, request *http.Request) {
	client, err := s.upgrade(writer, request)
	if err != nil {
		return
	}

	s.mu.Lock()
	s.logsClients[client] = struct{}{}
	snapshot := append([]ServiceLogEntry{}, s.retainedLogEntries...)
	// The client is now reachable by new entries. Taking its write lock before releasing the server lock makes them
	// wait, so the snapshot they extend always arrives first.
	client.writeMu.Lock()
	s.mu.Unlock()
	err = client.writeJSONMessagesLocked([]any{serviceLogSnapshotMessage{Entries: snapshot, Type: "snapshot"}})
	client.writeMu.Unlock()
	if err != nil {
		s.removeLogsClient(client)
		return
	}

	go s.readUntilClosed(client, s.removeLogsClient)
}

func (s *ControlServer) handleReactHighlightCursor(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodPost {
		http.Error(writer, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var payload reactHighlightCursorRequest
	if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
		http.Error(writer, "Invalid React Highlight cursor payload.", http.StatusBadRequest)
		return
	}
	if payload.Locator != nil && *payload.Locator == "" {
		http.Error(writer, "Invalid React Highlight cursor payload.", http.StatusBadRequest)
		return
	}

	message, err := json.Marshal(reactHighlightCursorMessage{
		Kind:        "cursor",
		Locator:     payload.Locator,
		ProjectRoot: s.projectRootPath,
		StackName:   s.stackName,
		Timestamp:   time.Now().UnixMilli(),
	})
	if err != nil {
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
	client, err := s.upgrade(writer, request)
	if err != nil {
		return
	}

	s.mu.Lock()
	s.reactHighlightClients[client] = struct{}{}
	s.mu.Unlock()

	go s.readUntilClosed(client, s.removeReactHighlightClient)
}

func (s *ControlServer) resolveHealthMessage() (string, error) {
	healthResponse, err := s.getHealth()
	if err != nil {
		return "", err
	}

	message, err := json.Marshal(healthResponse)
	if err != nil {
		return "", err
	}

	return string(message), nil
}

func (s *ControlServer) upgrade(writer http.ResponseWriter, request *http.Request) (*websocketClient, error) {
	connection, err := s.upgrader.Upgrade(writer, request, nil)
	if err != nil {
		return nil, err
	}

	s.tracker.IncrementActive()
	return &websocketClient{conn: connection, tracker: s.tracker, writeTimeout: s.websocketWriteTimeout}, nil
}

func (s *ControlServer) readUntilClosed(client *websocketClient, remove func(*websocketClient)) {
	for {
		if _, _, err := client.conn.ReadMessage(); err != nil {
			remove(client)
			return
		}
	}
}

func (s *ControlServer) broadcast(clients []*websocketClient, message string, remove func(*websocketClient)) {
	for _, client := range clients {
		if err := client.write(websocket.TextMessage, []byte(message)); err != nil {
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
	return c.writeMessageLocked(messageType, payload)
}

// writeMessageLocked writes one frame. The caller holds writeMu. Without a deadline, a client that stops reading
// blocks the write for as long as its connection lingers, and with it whoever is publishing. A write that misses
// the deadline leaves the connection unusable, so every caller drops the client when a write fails.
func (c *websocketClient) writeMessageLocked(messageType int, payload []byte) error {
	if err := c.conn.SetWriteDeadline(time.Now().Add(c.writeTimeout)); err != nil {
		return err
	}
	return c.conn.WriteMessage(messageType, payload)
}

// writeJSONMessagesLocked writes values as consecutive text frames. The caller holds writeMu.
func (c *websocketClient) writeJSONMessagesLocked(values []any) error {
	for _, value := range values {
		payload, err := json.Marshal(value)
		if err != nil {
			return err
		}
		if err := c.writeMessageLocked(websocket.TextMessage, payload); err != nil {
			return err
		}
	}
	return nil
}

// close ends a connection that is already broken or that the browser is closing: nobody is left to tell why.
func (c *websocketClient) close() {
	c.end(nil)
}

// closeWith tells the browser why the connection ends, then closes it. The code decides what the page does next: it
// reopens a connection that ended because the stack is going away, and leaves one that ended normally closed.
// Without a close frame a browser reports every end as a failure and cannot tell the two apart.
func (c *websocketClient) closeWith(code int, reason string) {
	c.end(websocket.FormatCloseMessage(code, reason))
}

func (c *websocketClient) end(closeFrame []byte) {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	c.closeOnce.Do(func() {
		if closeFrame != nil {
			// Best effort: a browser that is gone cannot be told, and the connection closes either way.
			_ = c.conn.WriteControl(websocket.CloseMessage, closeFrame, time.Now().Add(websocketCloseFrameTimeout))
		}
		_ = c.conn.Close()
		if c.tracker != nil {
			c.tracker.DecrementActive()
		}
	})
}

func createRandomID() (string, error) {
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
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
