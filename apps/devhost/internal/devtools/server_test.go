package devtools

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/manifest"
	"github.com/gorilla/websocket"
)

func TestControlServerServesAssetsAndRestartService(t *testing.T) {
	t.Parallel()

	restartedServices := []string{}
	controlServer, err := StartControlServer(StartControlServerOptions{
		AnnotationActions: []manifest.ValidatedAnnotationAction{
			{Agent: manifest.ValidatedAgent{DisplayName: "Pi", Kind: "pi"}, DisplayName: "Pi", ID: defaultAnnotationActionID, Kind: "agent"},
			{Command: []string{"bun", "run", "lint"}, Cwd: "/tmp/project", DisplayName: "Run lint", ID: "lint", Kind: "command"},
		},
		ComponentEditor: "vscode",
		FeatureToggles: FeatureToggles{
			AnnotationEnabled:       false,
			AnnotationQueueEnabled:  false,
			EditorEnabled:           false,
			ExternalToolbarsEnabled: true,
			MinimapEnabled:          true,
			StatusEnabled:           true,
			TerminalEnabled:         false,
		},
		GetHealthResponse: func() (HealthResponse, error) {
			return HealthResponse{Services: []ServiceHealth{{Managed: true, Name: "web", Status: true}}}, nil
		},
		Position:        "bottom-right",
		ProjectRootPath: "/tmp/project",
		PrimaryService:  "web",
		RestartService: func(serviceNames []string) error {
			restartedServices = append(restartedServices, serviceNames...)
			return nil
		},
		StackName: "hello-stack",
	})
	if err != nil {
		t.Fatalf("StartControlServer(...) error = %v", err)
	}
	t.Cleanup(func() {
		_ = controlServer.Stop()
	})

	injectedScriptResponse, err := http.Get(serverURL(controlServer.Port(), injectedScriptPath))
	if err != nil {
		t.Fatalf("Get(inject.js) error = %v", err)
	}
	defer injectedScriptResponse.Body.Close()
	if got := injectedScriptResponse.Header.Get("cache-control"); got != cacheControlNoStore {
		t.Fatalf("inject.js cache-control = %q, want %q", got, cacheControlNoStore)
	}
	injectedScriptText := readResponseText(t, injectedScriptResponse)
	if !strings.Contains(injectedScriptText, `"controlToken":"`) {
		t.Fatalf("inject.js missing control token: %q", injectedScriptText)
	}
	if !strings.Contains(injectedScriptText, `"annotationEnabled":false`) {
		t.Fatalf("inject.js missing annotation capability gate: %q", injectedScriptText)
	}
	if !strings.Contains(injectedScriptText, `"terminalEnabled":false`) {
		t.Fatalf("inject.js missing terminal capability gate: %q", injectedScriptText)
	}
	if !strings.Contains(injectedScriptText, `"annotationDefaultActionId":"agent"`) || !strings.Contains(injectedScriptText, `"annotationActions":[{"id":"agent","displayName":"Pi","kind":"agent","queueEnabled":true},{"id":"lint","displayName":"Run lint","kind":"command","queueEnabled":false}]`) {
		t.Fatalf("inject.js missing UI-safe annotation actions: %q", injectedScriptText)
	}

	xtermResponse, err := http.Get(serverURL(controlServer.Port(), xtermStylesheetPath))
	if err != nil {
		t.Fatalf("Get(xterm.css) error = %v", err)
	}
	defer xtermResponse.Body.Close()
	if got := xtermResponse.Header.Get("cache-control"); got != cacheControlNoStore {
		t.Fatalf("xterm.css cache-control = %q, want %q", got, cacheControlNoStore)
	}
	if body := readResponseText(t, xtermResponse); !strings.Contains(body, ".xterm") {
		t.Fatalf("xterm.css missing xterm styles")
	}

	controlToken := extractControlToken(t, injectedScriptText)
	restartResponse, err := http.Post(serverURL(controlServer.Port(), restartServicePath), "application/json", strings.NewReader(`{"serviceName":"web"}`))
	if err != nil {
		t.Fatalf("Post(restart-service unauthenticated) error = %v", err)
	}
	defer restartResponse.Body.Close()
	if restartResponse.StatusCode != http.StatusForbidden {
		t.Fatalf("restart status = %d, want 403", restartResponse.StatusCode)
	}

	request, err := http.NewRequest(http.MethodPost, serverURL(controlServer.Port(), restartServicePath), strings.NewReader(`{"bad":true}`))
	if err != nil {
		t.Fatalf("NewRequest(...) error = %v", err)
	}
	request.Header.Set(controlTokenHeaderName, controlToken)
	request.Header.Set("content-type", "application/json")
	invalidResponse, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("Do(invalid restart request) error = %v", err)
	}
	defer invalidResponse.Body.Close()
	if invalidResponse.StatusCode != http.StatusBadRequest {
		t.Fatalf("invalid restart status = %d, want 400", invalidResponse.StatusCode)
	}

	request, err = http.NewRequest(http.MethodPost, serverURL(controlServer.Port(), restartServicePath), strings.NewReader(`{"serviceName":"api"}`))
	if err != nil {
		t.Fatalf("NewRequest(...) error = %v", err)
	}
	request.Header.Set(controlTokenHeaderName, controlToken)
	request.Header.Set("content-type", "application/json")
	successResponse, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("Do(valid restart request) error = %v", err)
	}
	defer successResponse.Body.Close()
	if successResponse.StatusCode != http.StatusOK {
		t.Fatalf("restart success status = %d, want 200", successResponse.StatusCode)
	}
	if len(restartedServices) != 1 || restartedServices[0] != "api" {
		t.Fatalf("restarted services = %#v, want [api]", restartedServices)
	}

	unsupportedServer, unsupportedError := StartControlServer(StartControlServerOptions{
		ComponentEditor: "vscode",
		FeatureToggles:  FeatureToggles{StatusEnabled: true},
		GetHealthResponse: func() (HealthResponse, error) {
			return HealthResponse{Services: []ServiceHealth{}}, nil
		},
		Position:        "bottom-right",
		ProjectRootPath: "/tmp/project",
		StackName:       "hello-stack",
	})
	if unsupportedError != nil {
		t.Fatalf("StartControlServer(unsupported restart) error = %v", unsupportedError)
	}
	t.Cleanup(func() {
		_ = unsupportedServer.Stop()
	})

	unsupportedToken := extractControlToken(t, readResponseText(t, mustGet(t, serverURL(unsupportedServer.Port(), injectedScriptPath))))
	request, err = http.NewRequest(http.MethodPost, serverURL(unsupportedServer.Port(), restartServicePath), strings.NewReader(`{"serviceName":"api"}`))
	if err != nil {
		t.Fatalf("NewRequest(...) error = %v", err)
	}
	request.Header.Set(controlTokenHeaderName, unsupportedToken)
	request.Header.Set("content-type", "application/json")
	unsupportedResponse, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("Do(unsupported restart request) error = %v", err)
	}
	defer unsupportedResponse.Body.Close()
	if unsupportedResponse.StatusCode != http.StatusNotImplemented {
		t.Fatalf("unsupported restart status = %d, want 501", unsupportedResponse.StatusCode)
	}
}

func TestControlServerHealthAndLogsWebsockets(t *testing.T) {
	t.Parallel()

	healthResponse := HealthResponse{Services: []ServiceHealth{{Managed: true, Name: "web", Status: true}}}
	controlServer, err := StartControlServer(StartControlServerOptions{
		ComponentEditor: "vscode",
		FeatureToggles:  FeatureToggles{MinimapEnabled: true, StatusEnabled: true},
		GetHealthResponse: func() (HealthResponse, error) {
			return healthResponse, nil
		},
		Position:        "bottom-right",
		ProjectRootPath: "/tmp/project",
		StackName:       "hello-stack",
	})
	if err != nil {
		t.Fatalf("StartControlServer(...) error = %v", err)
	}
	t.Cleanup(func() {
		_ = controlServer.Stop()
	})

	healthSocket := mustDialWebsocket(t, websocketURL(controlServer.Port(), healthWebsocketPath))
	defer healthSocket.Close()
	if message := readWebsocketText(t, healthSocket); message != `{"services":[{"managed":true,"name":"web","status":true}]}` {
		t.Fatalf("health snapshot = %q", message)
	}
	healthResponse = HealthResponse{Services: []ServiceHealth{{Managed: false, Name: "web", Status: false}}}
	if err := controlServer.PublishHealthResponse(); err != nil {
		t.Fatalf("PublishHealthResponse(next) error = %v", err)
	}
	if message := readWebsocketText(t, healthSocket); message != `{"services":[{"managed":false,"name":"web","status":false}]}` {
		t.Fatalf("updated health snapshot = %q", message)
	}
	if err := controlServer.PublishHealthResponse(); err != nil {
		t.Fatalf("PublishHealthResponse(duplicate) error = %v", err)
	}
	_ = healthSocket.SetReadDeadline(time.Now().Add(100 * time.Millisecond))
	if _, _, err := healthSocket.ReadMessage(); err == nil {
		t.Fatal("ReadMessage(duplicate health) error = nil, want deadline timeout")
	}
	_ = healthSocket.SetReadDeadline(time.Time{})

	controlServer.PublishLogEntry("api", ServiceLogStreamStdout, "[api] ready")
	logsSocket := mustDialWebsocket(t, websocketURL(controlServer.Port(), logsWebsocketPath))
	defer logsSocket.Close()
	if message := readWebsocketText(t, logsSocket); message != `{"entries":[{"id":1,"line":"[api] ready","serviceName":"api","stream":"stdout"}],"type":"snapshot"}` {
		t.Fatalf("logs snapshot = %q", message)
	}
	controlServer.PublishLogEntry("api", ServiceLogStreamStderr, "[api] failed")
	if message := readWebsocketText(t, logsSocket); message != `{"entry":{"id":2,"line":"[api] failed","serviceName":"api","stream":"stderr"},"type":"entry"}` {
		t.Fatalf("logs update = %q", message)
	}
}

func TestControlServerReactHighlightCursorBroadcastIsInstanceScoped(t *testing.T) {
	t.Parallel()

	firstProjectRootPath := t.TempDir()
	secondProjectRootPath := t.TempDir()
	firstServer, err := StartControlServer(StartControlServerOptions{
		ComponentEditor: "neovim",
		FeatureToggles:  FeatureToggles{EditorEnabled: true, StatusEnabled: true, TerminalEnabled: true},
		GetHealthResponse: func() (HealthResponse, error) {
			return HealthResponse{Services: []ServiceHealth{}}, nil
		},
		Position:        "bottom-right",
		ProjectRootPath: firstProjectRootPath,
		StackName:       "first-stack",
	})
	if err != nil {
		t.Fatalf("StartControlServer(first) error = %v", err)
	}
	t.Cleanup(func() {
		_ = firstServer.Stop()
	})

	secondServer, err := StartControlServer(StartControlServerOptions{
		ComponentEditor: "neovim",
		FeatureToggles:  FeatureToggles{EditorEnabled: true, StatusEnabled: true, TerminalEnabled: true},
		GetHealthResponse: func() (HealthResponse, error) {
			return HealthResponse{Services: []ServiceHealth{}}, nil
		},
		Position:        "bottom-right",
		ProjectRootPath: secondProjectRootPath,
		StackName:       "second-stack",
	})
	if err != nil {
		t.Fatalf("StartControlServer(second) error = %v", err)
	}
	t.Cleanup(func() {
		_ = secondServer.Stop()
	})

	firstToken := extractControlToken(t, readResponseText(t, mustGet(t, serverURL(firstServer.Port(), injectedScriptPath))))
	secondToken := extractControlToken(t, readResponseText(t, mustGet(t, serverURL(secondServer.Port(), injectedScriptPath))))
	firstSocket := mustDialWebsocket(t, reactHighlightWebsocketURL(firstServer.Port(), firstToken))
	defer firstSocket.Close()
	secondSocket := mustDialWebsocket(t, reactHighlightWebsocketURL(secondServer.Port(), secondToken))
	defer secondSocket.Close()

	crossTokenRequest, err := http.NewRequest(http.MethodPost, serverURL(secondServer.Port(), reactHighlightCursorPath), strings.NewReader(`{"locator":"src/App.tsx:1:1"}`))
	if err != nil {
		t.Fatalf("NewRequest(cross token) error = %v", err)
	}
	crossTokenRequest.Header.Set(controlTokenHeaderName, firstToken)
	crossTokenResponse, err := http.DefaultClient.Do(crossTokenRequest)
	if err != nil {
		t.Fatalf("Do(cross token) error = %v", err)
	}
	defer crossTokenResponse.Body.Close()
	if crossTokenResponse.StatusCode != http.StatusForbidden {
		t.Fatalf("cross-token React Highlight status = %d, want 403", crossTokenResponse.StatusCode)
	}

	firstRequest, err := http.NewRequest(http.MethodPost, serverURL(firstServer.Port(), reactHighlightCursorPath), strings.NewReader(`{"locator":"src/App.tsx:10:5"}`))
	if err != nil {
		t.Fatalf("NewRequest(first cursor) error = %v", err)
	}
	firstRequest.Header.Set(controlTokenHeaderName, firstToken)
	firstRequest.Header.Set("content-type", "application/json")
	firstResponse, err := http.DefaultClient.Do(firstRequest)
	if err != nil {
		t.Fatalf("Do(first cursor) error = %v", err)
	}
	defer firstResponse.Body.Close()
	if firstResponse.StatusCode != http.StatusOK {
		t.Fatalf("first cursor status = %d, want 200", firstResponse.StatusCode)
	}

	var message reactHighlightCursorMessage
	if err := firstSocket.ReadJSON(&message); err != nil {
		t.Fatalf("ReadJSON(first cursor) error = %v", err)
	}
	if message.Kind != "cursor" || message.Locator == nil || *message.Locator != "src/App.tsx:10:5" || message.ProjectRoot != firstProjectRootPath || message.StackName != "first-stack" || message.Timestamp <= 0 {
		t.Fatalf("first cursor message = %#v", message)
	}

	_ = secondSocket.SetReadDeadline(time.Now().Add(100 * time.Millisecond))
	if _, _, err := secondSocket.ReadMessage(); err == nil {
		t.Fatal("ReadMessage(second socket after first cursor) error = nil, want deadline timeout")
	}
	_ = secondSocket.SetReadDeadline(time.Time{})
}

func TestControlServerWritesNeovimShellLauncher(t *testing.T) {
	t.Parallel()

	projectRootPath := t.TempDir()
	controlServer, err := StartControlServer(StartControlServerOptions{
		ComponentEditor: "vscode",
		FeatureToggles:  FeatureToggles{EditorEnabled: true, StatusEnabled: true, TerminalEnabled: true},
		GetHealthResponse: func() (HealthResponse, error) {
			return HealthResponse{Services: []ServiceHealth{}}, nil
		},
		Position:        "bottom-right",
		ProjectRootPath: projectRootPath,
		StackName:       "hello-stack",
	})
	if err != nil {
		t.Fatalf("StartControlServer(...) error = %v", err)
	}

	launcherPath := filepath.Join(projectRootPath, ".tmp", "devhost", "hello-stack", "nvim-shell", "bin", "devhost-nvim")
	launcherPayload, err := os.ReadFile(launcherPath)
	if err != nil {
		t.Fatalf("ReadFile(launcher) error = %v", err)
	}
	launcherScript := string(launcherPayload)
	if !strings.Contains(launcherScript, fmt.Sprintf("export DEVHOST_REACT_HIGHLIGHT_URL='http://127.0.0.1:%d/__devhost__/react-highlight/cursor'", controlServer.Port())) || !strings.Contains(launcherScript, fmt.Sprintf("export DEVHOST_CONTROL_TOKEN='%s'", controlServer.controlToken)) {
		t.Fatalf("launcher script missing instance endpoint/token:\n%s", launcherScript)
	}

	if err := controlServer.Stop(); err != nil {
		t.Fatalf("Stop() error = %v", err)
	}
	if _, err := os.Stat(launcherPath); !os.IsNotExist(err) {
		t.Fatalf("Stat(cleaned launcher) error = %v, want not exist", err)
	}
}

func TestControlServerTerminalSessionsEditorOnlyLifecycle(t *testing.T) {
	t.Parallel()

	starter := newTestTerminalStarter()
	projectRootPath := t.TempDir()
	controlServer, err := StartControlServer(StartControlServerOptions{
		AnnotationActions: []manifest.ValidatedAnnotationAction{
			{Agent: manifest.ValidatedAgent{DisplayName: "Pi", Kind: "pi"}, DisplayName: "Pi", ID: defaultAnnotationActionID, Kind: "agent"},
			{Command: []string{"bun", "run", "lint"}, Cwd: "/tmp/project", DisplayName: "Run lint", ID: "lint", Kind: "command"},
		},
		ComponentEditor: "neovim",
		FeatureToggles: FeatureToggles{
			EditorEnabled:   true,
			StatusEnabled:   true,
			TerminalEnabled: true,
		},
		GetHealthResponse: func() (HealthResponse, error) {
			return HealthResponse{Services: []ServiceHealth{}}, nil
		},
		Position:             "bottom-right",
		ProjectRootPath:      projectRootPath,
		StackName:            "hello-stack",
		StartTerminalSession: starter.start,
	})
	if err != nil {
		t.Fatalf("StartControlServer(...) error = %v", err)
	}
	t.Cleanup(func() {
		_ = controlServer.Stop()
	})

	controlToken := extractControlToken(t, readResponseText(t, mustGet(t, serverURL(controlServer.Port(), injectedScriptPath))))
	unauthorizedListResponse, err := http.Get(serverURL(controlServer.Port(), terminalSessionsPath))
	if err != nil {
		t.Fatalf("Get(terminal-sessions unauthenticated) error = %v", err)
	}
	defer unauthorizedListResponse.Body.Close()
	if unauthorizedListResponse.StatusCode != http.StatusForbidden {
		t.Fatalf("unauthenticated terminal list status = %d, want 403", unauthorizedListResponse.StatusCode)
	}

	invalidRequest, err := http.NewRequest(http.MethodPost, serverURL(controlServer.Port(), terminalSessionsPath), strings.NewReader(`{"kind":"agent"}`))
	if err != nil {
		t.Fatalf("NewRequest(agent terminal) error = %v", err)
	}
	invalidRequest.Header.Set(controlTokenHeaderName, controlToken)
	invalidRequest.Header.Set("content-type", "application/json")
	invalidResponse, err := http.DefaultClient.Do(invalidRequest)
	if err != nil {
		t.Fatalf("Do(agent terminal) error = %v", err)
	}
	defer invalidResponse.Body.Close()
	if invalidResponse.StatusCode != http.StatusBadRequest {
		t.Fatalf("agent terminal status = %d, want 400", invalidResponse.StatusCode)
	}

	commandRequest, err := http.NewRequest(http.MethodPost, serverURL(controlServer.Port(), terminalSessionsPath), strings.NewReader(`{"annotation":{"comment":"Lint this","markers":[],"stackName":"hello-stack","submittedAt":1,"title":"Example","url":"https://app.localhost/dashboard"},"actionId":"lint","kind":"command"}`))
	if err != nil {
		t.Fatalf("NewRequest(command terminal) error = %v", err)
	}
	commandRequest.Header.Set(controlTokenHeaderName, controlToken)
	commandRequest.Header.Set("content-type", "application/json")
	commandResponse, err := http.DefaultClient.Do(commandRequest)
	if err != nil {
		t.Fatalf("Do(command terminal) error = %v", err)
	}
	defer commandResponse.Body.Close()
	if commandResponse.StatusCode != http.StatusOK {
		t.Fatalf("command terminal status = %d, want 200", commandResponse.StatusCode)
	}
	var commandCreated startTerminalSessionResponse
	if err := json.NewDecoder(commandResponse.Body).Decode(&commandCreated); err != nil {
		t.Fatalf("Decode(command terminal response) error = %v", err)
	}
	if len(starter.startedRequests) != 1 || starter.startedRequests[0].Kind != terminalSessionRequestKindCommand || starter.startedRequests[0].ActionID != "lint" {
		t.Fatalf("started requests after command = %#v", starter.startedRequests)
	}
	controlServer.closeTerminalSession(commandCreated.SessionID)

	createRequestBody := `{"componentName":"SaveButton","kind":"editor","launcher":"neovim","source":{"columnNumber":8,"fileName":"src/components/SaveButton.tsx","lineNumber":42},"sourceLabel":"src/components/SaveButton.tsx:42:8"}`
	createRequest, err := http.NewRequest(http.MethodPost, serverURL(controlServer.Port(), terminalSessionsPath), strings.NewReader(createRequestBody))
	if err != nil {
		t.Fatalf("NewRequest(editor terminal) error = %v", err)
	}
	createRequest.Header.Set(controlTokenHeaderName, controlToken)
	createRequest.Header.Set("content-type", "application/json")
	createResponse, err := http.DefaultClient.Do(createRequest)
	if err != nil {
		t.Fatalf("Do(editor terminal) error = %v", err)
	}
	defer createResponse.Body.Close()
	if createResponse.StatusCode != http.StatusOK {
		t.Fatalf("editor terminal status = %d, want 200", createResponse.StatusCode)
	}

	var created startTerminalSessionResponse
	if err := json.NewDecoder(createResponse.Body).Decode(&created); err != nil {
		t.Fatalf("Decode(start terminal response) error = %v", err)
	}
	if created.SessionID == "" {
		t.Fatal("start terminal response missing sessionId")
	}
	if len(starter.sessions) != 2 {
		t.Fatalf("started sessions = %d, want 2", len(starter.sessions))
	}
	if _, response, err := websocket.DefaultDialer.Dial(websocketURL(controlServer.Port(), terminalWebsocketPath)+"?sessionId="+created.SessionID, nil); err == nil || response == nil || response.StatusCode != http.StatusForbidden {
		if response != nil {
			response.Body.Close()
		}
		t.Fatalf("unauthorized terminal websocket = (%v, %#v), want 403", err, response)
	} else {
		response.Body.Close()
	}

	listRequest, err := http.NewRequest(http.MethodGet, serverURL(controlServer.Port(), terminalSessionsPath), nil)
	if err != nil {
		t.Fatalf("NewRequest(list terminal sessions) error = %v", err)
	}
	listRequest.Header.Set(controlTokenHeaderName, controlToken)
	listResponse, err := http.DefaultClient.Do(listRequest)
	if err != nil {
		t.Fatalf("Do(list terminal sessions) error = %v", err)
	}
	defer listResponse.Body.Close()
	if listResponse.StatusCode != http.StatusOK {
		t.Fatalf("list terminal sessions status = %d, want 200", listResponse.StatusCode)
	}

	var listed listTerminalSessionsResponse
	if err := json.NewDecoder(listResponse.Body).Decode(&listed); err != nil {
		t.Fatalf("Decode(list terminal sessions) error = %v", err)
	}
	if len(listed.Sessions) != 1 || listed.Sessions[0].SessionID != created.SessionID {
		t.Fatalf("listed sessions = %#v", listed.Sessions)
	}
	if listed.Sessions[0].Request.Launcher != terminalSessionLauncherNeovim || listed.Sessions[0].Request.Kind != terminalSessionRequestKindEditor {
		t.Fatalf("listed request = %#v", listed.Sessions[0].Request)
	}

	terminalSocket := mustDialWebsocket(t, terminalWebsocketURL(controlServer.Port(), created.SessionID, controlToken))
	defer terminalSocket.Close()
	if message := readWebsocketText(t, terminalSocket); message != `{"data":"","type":"snapshot"}` {
		t.Fatalf("terminal snapshot = %q", message)
	}

	starter.sessions[1].emit("hello from nvim\n")
	if message := readWebsocketText(t, terminalSocket); message != `{"data":"hello from nvim\n","type":"output"}` {
		t.Fatalf("terminal output = %q", message)
	}

	if err := terminalSocket.WriteMessage(websocket.BinaryMessage, []byte("binary")); err != nil {
		t.Fatalf("WriteMessage(binary) error = %v", err)
	}
	if message := readWebsocketText(t, terminalSocket); message != `{"message":"Terminal messages must be text frames.","type":"error"}` {
		t.Fatalf("binary frame error = %q", message)
	}

	if err := terminalSocket.WriteMessage(websocket.TextMessage, []byte("{bad json")); err != nil {
		t.Fatalf("WriteMessage(invalid text) error = %v", err)
	}
	if message := readWebsocketText(t, terminalSocket); message != `{"message":"Invalid terminal message.","type":"error"}` {
		t.Fatalf("invalid text error = %q", message)
	}

	if err := terminalSocket.WriteJSON(map[string]any{"data": "fix it\n", "type": "input"}); err != nil {
		t.Fatalf("WriteJSON(input) error = %v", err)
	}
	if err := terminalSocket.WriteJSON(map[string]any{"cols": 100, "rows": 30, "type": "resize"}); err != nil {
		t.Fatalf("WriteJSON(resize) error = %v", err)
	}
	waitForCondition(t, time.Second, func() bool {
		got := starter.sessions[1].writesSnapshot()
		return len(got) == 1 && got[0] == "fix it\n"
	})
	if got := starter.sessions[1].writesSnapshot(); len(got) != 1 || got[0] != "fix it\n" {
		t.Fatalf("writes = %#v, want [fix it\\n]", got)
	}
	waitForCondition(t, time.Second, func() bool {
		got := starter.sessions[1].resizesSnapshot()
		return len(got) == 1 && got[0] == (testTerminalResize{cols: 100, rows: 30})
	})
	if got := starter.sessions[1].resizesSnapshot(); len(got) != 1 || got[0] != (testTerminalResize{cols: 100, rows: 30}) {
		t.Fatalf("resizes = %#v, want [{100 30}]", got)
	}

	exitCode := 0
	starter.sessions[1].exit(&exitCode, nil)
	if message := readWebsocketText(t, terminalSocket); message != `{"exitCode":0,"signalCode":null,"type":"exit"}` {
		t.Fatalf("exit message = %q", message)
	}

	lateSocket := mustDialWebsocket(t, terminalWebsocketURL(controlServer.Port(), created.SessionID, controlToken))
	defer lateSocket.Close()
	if message := readWebsocketText(t, lateSocket); message != `{"data":"hello from nvim\n","type":"snapshot"}` {
		t.Fatalf("late snapshot = %q", message)
	}
	if message := readWebsocketText(t, lateSocket); message != `{"exitCode":0,"signalCode":null,"type":"exit"}` {
		t.Fatalf("late exit = %q", message)
	}

	if err := lateSocket.WriteJSON(map[string]any{"type": "close"}); err != nil {
		t.Fatalf("WriteJSON(close) error = %v", err)
	}
	_ = lateSocket.SetReadDeadline(time.Now().Add(time.Second))
	if _, _, err := lateSocket.ReadMessage(); err == nil {
		t.Fatal("ReadMessage(close) error = nil, want closed websocket")
	}

	listRequest, err = http.NewRequest(http.MethodGet, serverURL(controlServer.Port(), terminalSessionsPath), nil)
	if err != nil {
		t.Fatalf("NewRequest(list terminal sessions after close) error = %v", err)
	}
	listRequest.Header.Set(controlTokenHeaderName, controlToken)
	listResponse, err = http.DefaultClient.Do(listRequest)
	if err != nil {
		t.Fatalf("Do(list terminal sessions after close) error = %v", err)
	}
	defer listResponse.Body.Close()
	if err := json.NewDecoder(listResponse.Body).Decode(&listed); err != nil {
		t.Fatalf("Decode(list terminal sessions after close) error = %v", err)
	}
	if len(listed.Sessions) != 0 {
		t.Fatalf("listed sessions after close = %#v, want []", listed.Sessions)
	}
	waitForCondition(t, time.Second, func() bool {
		return starter.sessions[1].closeCountValue() == 1
	})
	if closeCount := starter.sessions[1].closeCountValue(); closeCount != 1 {
		t.Fatalf("close count = %d, want 1", closeCount)
	}
}

func TestControlServerAgentAnnotationQueuesLifecycle(t *testing.T) {
	t.Parallel()

	starter := newTestTerminalStarter()
	stateDirectoryPath := t.TempDir()
	controlServer, err := StartControlServer(StartControlServerOptions{
		AnnotationActions: []manifest.ValidatedAnnotationAction{{
			Agent:       manifest.ValidatedAgent{DisplayName: "Pi", Kind: "pi"},
			DisplayName: "Pi",
			ID:          defaultAnnotationActionID,
			Kind:        "agent",
		}},
		AnnotationDefaultActionID: defaultAnnotationActionID,
		ComponentEditor:           "vscode",
		FeatureToggles: FeatureToggles{
			AnnotationEnabled:      true,
			AnnotationQueueEnabled: true,
			StatusEnabled:          true,
			TerminalEnabled:        true,
		},
		GetHealthResponse: func() (HealthResponse, error) {
			return HealthResponse{Services: []ServiceHealth{}}, nil
		},
		ManifestPath:         "/tmp/project/devhost.toml",
		Position:             "bottom-right",
		ProjectRootPath:      "/tmp/project",
		StackName:            "hello-stack",
		StartTerminalSession: starter.start,
		StateDirectoryPath:   stateDirectoryPath,
	})
	if err != nil {
		t.Fatalf("StartControlServer(...) error = %v", err)
	}
	t.Cleanup(func() {
		_ = controlServer.Stop()
	})

	controlToken := extractControlToken(t, readResponseText(t, mustGet(t, serverURL(controlServer.Port(), injectedScriptPath))))
	createRequest, err := http.NewRequest(http.MethodPost, serverURL(controlServer.Port(), terminalSessionsPath), strings.NewReader(`{"annotation":{"comment":"First annotation","markers":[],"stackName":"hello-stack","submittedAt":1,"title":"Example","url":"https://app.localhost/dashboard"},"kind":"agent"}`))
	if err != nil {
		t.Fatalf("NewRequest(first agent) error = %v", err)
	}
	createRequest.Header.Set(controlTokenHeaderName, controlToken)
	createRequest.Header.Set("content-type", "application/json")
	createResponse, err := http.DefaultClient.Do(createRequest)
	if err != nil {
		t.Fatalf("Do(first agent) error = %v", err)
	}
	defer createResponse.Body.Close()

	var firstCreated startTerminalSessionResponse
	if err := json.NewDecoder(createResponse.Body).Decode(&firstCreated); err != nil {
		t.Fatalf("Decode(first agent) error = %v", err)
	}

	queueSocket := mustDialWebsocket(t, annotationQueueWebsocketURL(controlServer.Port(), controlToken))
	defer queueSocket.Close()
	if message := readWebsocketText(t, queueSocket); !strings.Contains(message, `"status":"launching"`) || !strings.Contains(message, firstCreated.SessionID) {
		t.Fatalf("initial queue snapshot = %q", message)
	}
	if _, response, err := websocket.DefaultDialer.Dial(websocketURL(controlServer.Port(), annotationQueuesWebsocketPath), nil); err == nil || response == nil || response.StatusCode != http.StatusForbidden {
		if response != nil {
			response.Body.Close()
		}
		t.Fatalf("unauthorized annotation queue websocket = (%v, %#v), want 403", err, response)
	} else {
		response.Body.Close()
	}

	starter.sessions[0].emit("\x1b]1337;SetAgentStatus=working\x07")
	if message := readWebsocketText(t, queueSocket); !strings.Contains(message, `"status":"working"`) {
		t.Fatalf("working queue snapshot = %q", message)
	}

	queueRequestBody := `{"annotation":{"comment":"Second annotation","markers":[],"stackName":"hello-stack","submittedAt":2,"title":"Example","url":"https://app.localhost/settings/profile"},"kind":"agent","targetSessionId":"` + firstCreated.SessionID + `"}`
	queueRequest, err := http.NewRequest(http.MethodPost, serverURL(controlServer.Port(), terminalSessionsPath), strings.NewReader(queueRequestBody))
	if err != nil {
		t.Fatalf("NewRequest(second agent) error = %v", err)
	}
	queueRequest.Header.Set(controlTokenHeaderName, controlToken)
	queueRequest.Header.Set("content-type", "application/json")
	queueResponse, err := http.DefaultClient.Do(queueRequest)
	if err != nil {
		t.Fatalf("Do(second agent) error = %v", err)
	}
	defer queueResponse.Body.Close()
	if message := readWebsocketText(t, queueSocket); !strings.Contains(message, `"state":"queued"`) {
		t.Fatalf("queued snapshot = %q", message)
	}

	listRequest, err := http.NewRequest(http.MethodGet, serverURL(controlServer.Port(), annotationQueuesPath), nil)
	if err != nil {
		t.Fatalf("NewRequest(list queues) error = %v", err)
	}
	listRequest.Header.Set(controlTokenHeaderName, controlToken)
	listResponse, err := http.DefaultClient.Do(listRequest)
	if err != nil {
		t.Fatalf("Do(list queues) error = %v", err)
	}
	defer listResponse.Body.Close()
	var listedQueues listAnnotationQueuesResponse
	if err := json.NewDecoder(listResponse.Body).Decode(&listedQueues); err != nil {
		t.Fatalf("Decode(list queues) error = %v", err)
	}
	queuedEntryID := listedQueues.Queues[0].Entries[1].EntryID

	patchRequest, err := http.NewRequest(http.MethodPatch, serverURL(controlServer.Port(), annotationQueuesPath+"/"+queuedEntryID), strings.NewReader(`{"comment":"Updated queued annotation"}`))
	if err != nil {
		t.Fatalf("NewRequest(patch queue) error = %v", err)
	}
	patchRequest.Header.Set(controlTokenHeaderName, controlToken)
	patchRequest.Header.Set("content-type", "application/json")
	patchResponse, err := http.DefaultClient.Do(patchRequest)
	if err != nil {
		t.Fatalf("Do(patch queue) error = %v", err)
	}
	defer patchResponse.Body.Close()
	if patchResponse.StatusCode != http.StatusOK {
		t.Fatalf("patch queue status = %d, want 200", patchResponse.StatusCode)
	}
	if message := readWebsocketText(t, queueSocket); !strings.Contains(message, "Updated queued annotation") {
		t.Fatalf("patched snapshot = %q", message)
	}

	deleteRequest, err := http.NewRequest(http.MethodDelete, serverURL(controlServer.Port(), annotationQueuesPath+"/"+queuedEntryID), nil)
	if err != nil {
		t.Fatalf("NewRequest(delete queue) error = %v", err)
	}
	deleteRequest.Header.Set(controlTokenHeaderName, controlToken)
	deleteResponse, err := http.DefaultClient.Do(deleteRequest)
	if err != nil {
		t.Fatalf("Do(delete queue) error = %v", err)
	}
	defer deleteResponse.Body.Close()
	if deleteResponse.StatusCode != http.StatusOK {
		t.Fatalf("delete queue status = %d, want 200", deleteResponse.StatusCode)
	}
	if message := readWebsocketText(t, queueSocket); strings.Contains(message, `"state":"queued"`) {
		t.Fatalf("deleted snapshot still queued = %q", message)
	}

	terminalSocket := mustDialWebsocket(t, terminalWebsocketURL(controlServer.Port(), firstCreated.SessionID, controlToken))
	if message := readWebsocketText(t, terminalSocket); !strings.Contains(message, `"type":"snapshot"`) {
		t.Fatalf("agent terminal snapshot = %q", message)
	}
	if err := terminalSocket.WriteJSON(map[string]any{"type": "close"}); err != nil {
		t.Fatalf("WriteJSON(close) error = %v", err)
	}
	_ = terminalSocket.SetReadDeadline(time.Now().Add(time.Second))
	if _, _, err := terminalSocket.ReadMessage(); err == nil {
		t.Fatal("ReadMessage(close) error = nil, want closed websocket")
	}
	terminalSocket.Close()
	if message := readWebsocketText(t, queueSocket); !strings.Contains(message, `"status":"paused"`) || !strings.Contains(message, `"pauseReason":"user-terminated"`) {
		t.Fatalf("paused snapshot = %q", message)
	}

	resumeRequest, err := http.NewRequest(http.MethodPost, serverURL(controlServer.Port(), annotationQueuesPath+"/"+listedQueues.Queues[0].QueueID+"/resume"), nil)
	if err != nil {
		t.Fatalf("NewRequest(resume queue) error = %v", err)
	}
	resumeRequest.Header.Set(controlTokenHeaderName, controlToken)
	resumeResponse, err := http.DefaultClient.Do(resumeRequest)
	if err != nil {
		t.Fatalf("Do(resume queue) error = %v", err)
	}
	defer resumeResponse.Body.Close()
	if resumeResponse.StatusCode != http.StatusOK {
		t.Fatalf("resume queue status = %d, want 200", resumeResponse.StatusCode)
	}
	if len(starter.sessions) != 2 {
		t.Fatalf("resumed started sessions = %d, want 2", len(starter.sessions))
	}
}

func TestControlServerAgentAnnotationQueuesPersistAcrossRestart(t *testing.T) {
	t.Parallel()

	stateDirectoryPath := t.TempDir()
	firstStarter := newTestTerminalStarter()
	firstServer, err := StartControlServer(StartControlServerOptions{
		AnnotationActions: []manifest.ValidatedAnnotationAction{{
			Agent:       manifest.ValidatedAgent{DisplayName: "Pi", Kind: "pi"},
			DisplayName: "Pi",
			ID:          defaultAnnotationActionID,
			Kind:        "agent",
		}},
		AnnotationDefaultActionID: defaultAnnotationActionID,
		ComponentEditor:           "vscode",
		FeatureToggles: FeatureToggles{
			AnnotationEnabled:      true,
			AnnotationQueueEnabled: true,
			StatusEnabled:          true,
			TerminalEnabled:        true,
		},
		GetHealthResponse: func() (HealthResponse, error) {
			return HealthResponse{Services: []ServiceHealth{}}, nil
		},
		ManifestPath:         "/tmp/project/devhost.toml",
		Position:             "bottom-right",
		ProjectRootPath:      "/tmp/project",
		StackName:            "hello-stack",
		StartTerminalSession: firstStarter.start,
		StateDirectoryPath:   stateDirectoryPath,
	})
	if err != nil {
		t.Fatalf("StartControlServer(first) error = %v", err)
	}

	controlToken := extractControlToken(t, readResponseText(t, mustGet(t, serverURL(firstServer.Port(), injectedScriptPath))))
	firstRequest, err := http.NewRequest(http.MethodPost, serverURL(firstServer.Port(), terminalSessionsPath), strings.NewReader(`{"annotation":{"comment":"First annotation","markers":[],"stackName":"hello-stack","submittedAt":1,"title":"Example","url":"https://app.localhost/dashboard"},"kind":"agent"}`))
	if err != nil {
		t.Fatalf("NewRequest(first agent) error = %v", err)
	}
	firstRequest.Header.Set(controlTokenHeaderName, controlToken)
	firstRequest.Header.Set("content-type", "application/json")
	firstResponse, err := http.DefaultClient.Do(firstRequest)
	if err != nil {
		t.Fatalf("Do(first agent) error = %v", err)
	}
	defer firstResponse.Body.Close()
	var firstCreated startTerminalSessionResponse
	if err := json.NewDecoder(firstResponse.Body).Decode(&firstCreated); err != nil {
		t.Fatalf("Decode(first agent) error = %v", err)
	}
	firstStarter.sessions[0].emit("\x1b]1337;SetAgentStatus=working\x07")

	secondRequest, err := http.NewRequest(http.MethodPost, serverURL(firstServer.Port(), terminalSessionsPath), strings.NewReader(`{"annotation":{"comment":"Second annotation","markers":[],"stackName":"hello-stack","submittedAt":2,"title":"Example","url":"https://app.localhost/settings/profile"},"kind":"agent","targetSessionId":"`+firstCreated.SessionID+`"}`))
	if err != nil {
		t.Fatalf("NewRequest(second agent) error = %v", err)
	}
	secondRequest.Header.Set(controlTokenHeaderName, controlToken)
	secondRequest.Header.Set("content-type", "application/json")
	secondResponse, err := http.DefaultClient.Do(secondRequest)
	if err != nil {
		t.Fatalf("Do(second agent) error = %v", err)
	}
	secondResponse.Body.Close()
	if err := firstServer.Stop(); err != nil {
		t.Fatalf("Stop(first server) error = %v", err)
	}

	secondStarter := newTestTerminalStarter()
	secondServer, err := StartControlServer(StartControlServerOptions{
		AnnotationActions: []manifest.ValidatedAnnotationAction{{
			Agent:       manifest.ValidatedAgent{DisplayName: "Pi", Kind: "pi"},
			DisplayName: "Pi",
			ID:          defaultAnnotationActionID,
			Kind:        "agent",
		}},
		AnnotationDefaultActionID: defaultAnnotationActionID,
		ComponentEditor:           "vscode",
		FeatureToggles: FeatureToggles{
			AnnotationEnabled:      true,
			AnnotationQueueEnabled: true,
			StatusEnabled:          true,
			TerminalEnabled:        true,
		},
		GetHealthResponse: func() (HealthResponse, error) {
			return HealthResponse{Services: []ServiceHealth{}}, nil
		},
		ManifestPath:         "/tmp/project/devhost.toml",
		Position:             "bottom-right",
		ProjectRootPath:      "/tmp/project",
		StackName:            "hello-stack",
		StartTerminalSession: secondStarter.start,
		StateDirectoryPath:   stateDirectoryPath,
	})
	if err != nil {
		t.Fatalf("StartControlServer(second) error = %v", err)
	}
	t.Cleanup(func() {
		_ = secondServer.Stop()
	})
	if len(secondStarter.startedRequests) != 1 || secondStarter.startedRequests[0].Annotation == nil || secondStarter.startedRequests[0].Annotation.Comment != "First annotation" {
		t.Fatalf("resumed requests = %#v", secondStarter.startedRequests)
	}

	secondToken := extractControlToken(t, readResponseText(t, mustGet(t, serverURL(secondServer.Port(), injectedScriptPath))))
	listRequest, err := http.NewRequest(http.MethodGet, serverURL(secondServer.Port(), annotationQueuesPath), nil)
	if err != nil {
		t.Fatalf("NewRequest(list queues) error = %v", err)
	}
	listRequest.Header.Set(controlTokenHeaderName, secondToken)
	listResponse, err := http.DefaultClient.Do(listRequest)
	if err != nil {
		t.Fatalf("Do(list queues) error = %v", err)
	}
	defer listResponse.Body.Close()
	var listedQueues listAnnotationQueuesResponse
	if err := json.NewDecoder(listResponse.Body).Decode(&listedQueues); err != nil {
		t.Fatalf("Decode(list queues) error = %v", err)
	}
	if len(listedQueues.Queues) != 1 || len(listedQueues.Queues[0].Entries) != 2 || listedQueues.Queues[0].Entries[0].Annotation.Comment != "First annotation" || listedQueues.Queues[0].Entries[1].Annotation.Comment != "Second annotation" {
		t.Fatalf("persisted queues = %#v", listedQueues)
	}

	secondStarter.sessions[0].emit("\x1b]1337;SetAgentStatus=finished\x07")
	waitForCondition(t, time.Second, func() bool {
		writes := secondStarter.sessions[0].writesSnapshot()
		return len(writes) == 1 && strings.Contains(writes[0], "prompt.txt")
	})
}

func TestControlServerTerminalSessionsRetainTailAndIdleCleanup(t *testing.T) {
	t.Parallel()

	starter := newTestTerminalStarter()
	projectRootPath := t.TempDir()
	controlServer, err := StartControlServer(StartControlServerOptions{
		ComponentEditor: "neovim",
		FeatureToggles: FeatureToggles{
			EditorEnabled:   true,
			StatusEnabled:   true,
			TerminalEnabled: true,
		},
		GetHealthResponse: func() (HealthResponse, error) {
			return HealthResponse{Services: []ServiceHealth{}}, nil
		},
		IdleTerminalSessionTimeout: 25 * time.Millisecond,
		Position:                   "bottom-right",
		ProjectRootPath:            projectRootPath,
		StackName:                  "hello-stack",
		StartTerminalSession:       starter.start,
	})
	if err != nil {
		t.Fatalf("StartControlServer(...) error = %v", err)
	}
	t.Cleanup(func() {
		_ = controlServer.Stop()
	})

	controlToken := extractControlToken(t, readResponseText(t, mustGet(t, serverURL(controlServer.Port(), injectedScriptPath))))
	createRequest, err := http.NewRequest(http.MethodPost, serverURL(controlServer.Port(), terminalSessionsPath), strings.NewReader(`{"componentName":"SaveButton","kind":"editor","launcher":"neovim","source":{"fileName":"src/components/SaveButton.tsx","lineNumber":42},"sourceLabel":"src/components/SaveButton.tsx:42:1"}`))
	if err != nil {
		t.Fatalf("NewRequest(editor terminal) error = %v", err)
	}
	createRequest.Header.Set(controlTokenHeaderName, controlToken)
	createRequest.Header.Set("content-type", "application/json")
	createResponse, err := http.DefaultClient.Do(createRequest)
	if err != nil {
		t.Fatalf("Do(editor terminal) error = %v", err)
	}
	defer createResponse.Body.Close()

	var created startTerminalSessionResponse
	if err := json.NewDecoder(createResponse.Body).Decode(&created); err != nil {
		t.Fatalf("Decode(start terminal response) error = %v", err)
	}

	outputPrefix := strings.Repeat("a", maximumRetainedTerminalOutputLength+32)
	starter.sessions[0].emit(outputPrefix)
	exitCode := 0
	starter.sessions[0].exit(&exitCode, nil)

	terminalSocket := mustDialWebsocket(t, terminalWebsocketURL(controlServer.Port(), created.SessionID, controlToken))
	snapshotMessage := readWebsocketText(t, terminalSocket)
	var snapshot terminalSessionSnapshotMessage
	if err := json.Unmarshal([]byte(snapshotMessage), &snapshot); err != nil {
		t.Fatalf("Unmarshal(snapshot) error = %v", err)
	}
	if snapshot.Type != "snapshot" {
		t.Fatalf("snapshot type = %q, want snapshot", snapshot.Type)
	}
	if len(snapshot.Data) != maximumRetainedTerminalOutputLength {
		t.Fatalf("snapshot length = %d, want %d", len(snapshot.Data), maximumRetainedTerminalOutputLength)
	}
	wantTail := outputPrefix[len(outputPrefix)-maximumRetainedTerminalOutputLength:]
	if snapshot.Data != wantTail {
		t.Fatalf("snapshot tail mismatch")
	}
	if message := readWebsocketText(t, terminalSocket); message != `{"exitCode":0,"signalCode":null,"type":"exit"}` {
		t.Fatalf("idle cleanup exit = %q", message)
	}
	terminalSocket.Close()

	time.Sleep(80 * time.Millisecond)

	listRequest, err := http.NewRequest(http.MethodGet, serverURL(controlServer.Port(), terminalSessionsPath), nil)
	if err != nil {
		t.Fatalf("NewRequest(list terminal sessions) error = %v", err)
	}
	listRequest.Header.Set(controlTokenHeaderName, controlToken)
	listResponse, err := http.DefaultClient.Do(listRequest)
	if err != nil {
		t.Fatalf("Do(list terminal sessions) error = %v", err)
	}
	defer listResponse.Body.Close()

	var listed listTerminalSessionsResponse
	if err := json.NewDecoder(listResponse.Body).Decode(&listed); err != nil {
		t.Fatalf("Decode(list terminal sessions) error = %v", err)
	}
	if len(listed.Sessions) != 0 {
		t.Fatalf("listed sessions after idle cleanup = %#v, want []", listed.Sessions)
	}
	waitForCondition(t, time.Second, func() bool {
		return starter.sessions[0].closeCountValue() == 1
	})
	if closeCount := starter.sessions[0].closeCountValue(); closeCount != 1 {
		t.Fatalf("close count after idle cleanup = %d, want 1", closeCount)
	}
}

func serverURL(port int, path string) string {
	return fmt.Sprintf("http://127.0.0.1:%d%s", port, path)
}

func websocketURL(port int, path string) string {
	return fmt.Sprintf("ws://127.0.0.1:%d%s", port, path)
}

func terminalWebsocketURL(port int, sessionID string, controlToken string) string {
	return fmt.Sprintf("ws://127.0.0.1:%d%s?sessionId=%s&token=%s", port, terminalWebsocketPath, sessionID, controlToken)
}

func annotationQueueWebsocketURL(port int, controlToken string) string {
	return fmt.Sprintf("ws://127.0.0.1:%d%s?token=%s", port, annotationQueuesWebsocketPath, controlToken)
}

func reactHighlightWebsocketURL(port int, controlToken string) string {
	return fmt.Sprintf("ws://127.0.0.1:%d%s?token=%s", port, reactHighlightWebsocketPath, controlToken)
}

func extractControlToken(t *testing.T, injectedScript string) string {
	t.Helper()

	start := strings.Index(injectedScript, `"controlToken":"`)
	if start == -1 {
		t.Fatalf("inject.js missing control token: %q", injectedScript)
	}
	start += len(`"controlToken":"`)
	end := strings.Index(injectedScript[start:], `"`)
	if end == -1 {
		t.Fatalf("inject.js missing closing control token quote: %q", injectedScript)
	}

	return injectedScript[start : start+end]
}

func mustGet(t *testing.T, url string) *http.Response {
	t.Helper()

	response, error := http.Get(url)
	if error != nil {
		t.Fatalf("Get(%s) error = %v", url, error)
	}

	return response
}

func readResponseText(t *testing.T, response *http.Response) string {
	t.Helper()

	body, error := io.ReadAll(response.Body)
	if error != nil {
		t.Fatalf("ReadAll(...) error = %v", error)
	}

	return string(body)
}

func mustDialWebsocket(t *testing.T, url string) *websocket.Conn {
	t.Helper()

	connection, _, error := websocket.DefaultDialer.Dial(url, nil)
	if error != nil {
		t.Fatalf("Dial(%s) error = %v", url, error)
	}

	return connection
}

func readWebsocketText(t *testing.T, connection *websocket.Conn) string {
	t.Helper()

	_, message, error := connection.ReadMessage()
	if error != nil {
		t.Fatalf("ReadMessage(...) error = %v", error)
	}

	return string(message)
}

type testTerminalStarter struct {
	mu              sync.Mutex
	startedRequests []terminalSessionRequest
	sessions        []*testTerminalSession
}

type testTerminalSession struct {
	mu         sync.Mutex
	closeCount int
	exitOnce   sync.Once
	onData     func([]byte)
	resizes    []testTerminalResize
	waits      chan terminalSessionExitStatus
	writes     []string
}

type testTerminalResize struct {
	cols int
	rows int
}

func newTestTerminalStarter() *testTerminalStarter {
	return &testTerminalStarter{}
}

func (s *testTerminalStarter) start(request terminalSessionRequest, onData func([]byte)) (*launchedTerminalSession, error) {
	session := &testTerminalSession{
		onData: onData,
		waits:  make(chan terminalSessionExitStatus, 1),
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	s.startedRequests = append(s.startedRequests, request)
	s.sessions = append(s.sessions, session)

	return &launchedTerminalSession{
		cleanup: func() {},
		close:   session.close,
		resize:  session.resize,
		wait: func() terminalSessionExitStatus {
			status := <-session.waits
			return status
		},
		write: session.write,
	}, nil
}

func (s *testTerminalSession) close() {
	s.mu.Lock()
	s.closeCount += 1
	s.mu.Unlock()
	s.exitOnce.Do(func() {
		s.waits <- terminalSessionExitStatus{Type: "exit"}
	})
}

func (s *testTerminalSession) emit(text string) {
	s.onData([]byte(text))
}

func (s *testTerminalSession) exit(exitCode *int, signalCode *string) {
	s.exitOnce.Do(func() {
		s.waits <- terminalSessionExitStatus{ExitCode: exitCode, SignalCode: signalCode, Type: "exit"}
	})
}

func (s *testTerminalSession) resize(cols int, rows int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.resizes = append(s.resizes, testTerminalResize{cols: cols, rows: rows})
}

func (s *testTerminalSession) write(data string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.writes = append(s.writes, data)
}

func (s *testTerminalSession) closeCountValue() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.closeCount
}

func (s *testTerminalSession) resizesSnapshot() []testTerminalResize {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]testTerminalResize{}, s.resizes...)
}

func (s *testTerminalSession) writesSnapshot() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]string{}, s.writes...)
}

func waitForCondition(t *testing.T, timeout time.Duration, condition func() bool) {
	t.Helper()

	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if condition() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}

	t.Fatal("condition did not become true before timeout")
}

func TestControlServerDevAssetsDir(t *testing.T) {
	t.Parallel()

	projectRoot := t.TempDir()
	devAssetsDir := t.TempDir()

	srcDir := filepath.Join(projectRoot, "packages", "devhost-ui", "src", "devtools")
	if err := os.MkdirAll(srcDir, 0755); err != nil {
		t.Fatalf("failed to create src dir: %v", err)
	}

	controlServer, err := StartControlServer(StartControlServerOptions{
		ComponentEditor: "vscode",
		DevAssetsDir:   devAssetsDir,
		FeatureToggles: FeatureToggles{
			StatusEnabled: true,
		},
		GetHealthResponse: func() (HealthResponse, error) {
			return HealthResponse{Services: []ServiceHealth{}}, nil
		},
		Position:        "bottom-right",
		ProjectRootPath: projectRoot,
		StackName:       "test-assets-stack",
	})
	if err != nil {
		t.Fatalf("failed to start control server: %v", err)
	}
	t.Cleanup(func() {
		_ = controlServer.Stop()
	})

	injectResp, err := http.Get(serverURL(controlServer.Port(), injectedScriptPath))
	if err != nil {
		t.Fatalf("failed to get inject.js: %v", err)
	}
	defer injectResp.Body.Close()
	injectBody := readResponseText(t, injectResp)
	if !strings.Contains(injectBody, "globalThis.__DEVHOST_INJECTED_CONFIG__") {
		t.Fatalf("expected embedded injectBody, got: %s", injectBody)
	}

	xtermResp, err := http.Get(serverURL(controlServer.Port(), xtermStylesheetPath))
	if err != nil {
		t.Fatalf("failed to get xterm.css: %v", err)
	}
	defer xtermResp.Body.Close()
	xtermBody := readResponseText(t, xtermResp)
	if !strings.Contains(xtermBody, ".xterm") {
		t.Fatalf("expected embedded xtermBody, got: %s", xtermBody)
	}

	dummyJS := "console.log('from disk');"
	if err := os.WriteFile(filepath.Join(devAssetsDir, "devtools.js"), []byte(dummyJS), 0644); err != nil {
		t.Fatalf("failed to write devtools.js: %v", err)
	}
	dummyCSS := "/* css from disk */"
	if err := os.WriteFile(filepath.Join(devAssetsDir, "xterm.css"), []byte(dummyCSS), 0644); err != nil {
		t.Fatalf("failed to write xterm.css: %v", err)
	}

	dummySrcPath := filepath.Join(srcDir, "main.ts")
	if err := os.WriteFile(dummySrcPath, []byte("export {}"), 0644); err != nil {
		t.Fatalf("failed to write source file: %v", err)
	}

	now := time.Now()
	if err := os.Chtimes(dummySrcPath, now.Add(-time.Hour), now.Add(-time.Hour)); err != nil {
		t.Fatalf("failed to set source modtime: %v", err)
	}
	if err := os.Chtimes(filepath.Join(devAssetsDir, "devtools.js"), now, now); err != nil {
		t.Fatalf("failed to set devtools.js modtime: %v", err)
	}

	injectResp2, err := http.Get(serverURL(controlServer.Port(), injectedScriptPath))
	if err != nil {
		t.Fatalf("failed to get inject.js: %v", err)
	}
	defer injectResp2.Body.Close()
	injectBody2 := readResponseText(t, injectResp2)
	if !strings.Contains(injectBody2, "from disk") {
		t.Fatalf("expected disk script, got: %s", injectBody2)
	}

	xtermResp2, err := http.Get(serverURL(controlServer.Port(), xtermStylesheetPath))
	if err != nil {
		t.Fatalf("failed to get xterm.css: %v", err)
	}
	defer xtermResp2.Body.Close()
	xtermBody2 := readResponseText(t, xtermResp2)
	if !strings.Contains(xtermBody2, "css from disk") {
		t.Fatalf("expected disk css, got: %s", xtermBody2)
	}
}
