package devtools

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestControlServerServesAssetsAndRestartService(t *testing.T) {
	t.Parallel()

	restartedServices := []string{}
	controlServer, err := StartControlServer(StartControlServerOptions{
		ComponentEditor: "vscode",
		FeatureToggles: FeatureToggles{
			AnnotationEnabled:       false,
			EditorEnabled:           false,
			ExternalToolbarsEnabled: true,
			MinimapEnabled:          true,
			StatusEnabled:           true,
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
	if got := injectedScriptResponse.Header.Get("cache-control"); got != cacheControlImmutable {
		t.Fatalf("inject.js cache-control = %q, want %q", got, cacheControlImmutable)
	}
	staticScriptText := readResponseText(t, injectedScriptResponse)
	injectedScriptText := getControlServerText(t, controlServer, injectedConfigPath)
	if strings.Contains(staticScriptText, injectedScriptText) {
		t.Fatal("static script contains instance configuration")
	}
	var config map[string]any
	configText := injectedScriptText
	if err := json.Unmarshal([]byte(configText), &config); err != nil {
		t.Fatalf("decode injected config: %v", err)
	}
	home, err := os.UserHomeDir()
	if err != nil {
		t.Fatal(err)
	}
	if got := config["homeDirectoryPath"]; got != home {
		t.Fatalf("injected home directory = %v, want %q", got, home)
	}
	if _, exists := config["controlToken"]; exists {
		t.Fatal("configuration includes a removed control token")
	}
	if !strings.Contains(injectedScriptText, `"annotationEnabled":false`) {
		t.Fatalf("inject.js missing annotation capability gate: %q", injectedScriptText)
	}
	restartResponse, err := http.Post(serverURL(controlServer.Port(), restartServicePath), "application/json", strings.NewReader(`{"serviceName":"web"}`))
	if err != nil {
		t.Fatal(err)
	}
	defer restartResponse.Body.Close()
	if restartResponse.StatusCode != http.StatusOK {
		t.Fatalf("restart without credentials status = %d", restartResponse.StatusCode)
	}
	request, err := http.NewRequest(http.MethodPost, serverURL(controlServer.Port(), restartServicePath), strings.NewReader(`{"bad":true}`))
	if err != nil {
		t.Fatalf("NewRequest(...) error = %v", err)
	}
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
	request.Header.Set("content-type", "application/json")
	successResponse, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("Do(valid restart request) error = %v", err)
	}
	defer successResponse.Body.Close()
	if successResponse.StatusCode != http.StatusOK {
		t.Fatalf("restart success status = %d, want 200", successResponse.StatusCode)
	}
	if len(restartedServices) != 2 || restartedServices[0] != "web" || restartedServices[1] != "api" {
		t.Fatalf("restarted services = %#v, want [web api]", restartedServices)
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
	request, err = http.NewRequest(http.MethodPost, serverURL(unsupportedServer.Port(), restartServicePath), strings.NewReader(`{"serviceName":"api"}`))
	if err != nil {
		t.Fatalf("NewRequest(...) error = %v", err)
	}
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
		ComponentEditor: "vscode",
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
		ComponentEditor: "vscode",
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
	firstSocket := mustDialWebsocket(t, reactHighlightWebsocketURL(firstServer.Port()))
	defer firstSocket.Close()
	secondSocket := mustDialWebsocket(t, reactHighlightWebsocketURL(secondServer.Port()))
	defer secondSocket.Close()

	firstRequest, err := http.NewRequest(http.MethodPost, serverURL(firstServer.Port(), reactHighlightCursorPath), strings.NewReader(`{"locator":"src/App.tsx:10:5"}`))
	if err != nil {
		t.Fatalf("NewRequest(first cursor) error = %v", err)
	}
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

func serverURL(port int, path string) string {
	return fmt.Sprintf("http://127.0.0.1:%d%s", port, path)
}

func websocketURL(port int, path string) string {
	return fmt.Sprintf("ws://127.0.0.1:%d%s", port, path)
}

func reactHighlightWebsocketURL(port int) string {
	return fmt.Sprintf("ws://127.0.0.1:%d%s", port, reactHighlightWebsocketPath)
}

func mustGet(t *testing.T, url string) *http.Response {
	t.Helper()

	response, err := http.Get(url)
	if err != nil {
		t.Fatalf("Get(%s) error = %v", url, err)
	}

	return response
}

func readResponseText(t *testing.T, response *http.Response) string {
	t.Helper()

	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatalf("ReadAll(...) error = %v", err)
	}

	return string(body)
}

func mustDialWebsocket(t *testing.T, url string) *websocket.Conn {
	t.Helper()

	connection, _, err := websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		t.Fatalf("Dial(%s) error = %v", url, err)
	}

	return connection
}

func readWebsocketText(t *testing.T, connection *websocket.Conn) string {
	t.Helper()

	_, message, err := connection.ReadMessage()
	if err != nil {
		t.Fatalf("ReadMessage(...) error = %v", err)
	}

	return string(message)
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
