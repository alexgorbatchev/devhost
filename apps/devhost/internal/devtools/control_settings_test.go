package devtools

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/hostusage"
	"github.com/gorilla/websocket"
)

// A reload replaces the settings and keeps the chat sessions: turning chat off hides its routes, and a running
// session keeps answering on its open socket.
func TestUpdateSettingsAppliesWithoutEndingChatSessions(t *testing.T) {
	server, session, conn := startChatAckTest(t)

	settings := server.currentSettings()
	settings.StackName = "renamed"
	settings.FeatureToggles.MinimapEnabled = true
	settings.Position = "top-right"
	settings.RoutedServices = []RoutedServiceIdentity{{Host: "app.localhost", Path: "/", ServiceName: "web"}}
	settings.PrimaryService = "web"
	if err := server.UpdateSettings(settings); err != nil {
		t.Fatalf("UpdateSettings(...) error = %v", err)
	}
	var config map[string]any
	if err := json.Unmarshal([]byte(getControlServerText(t, server, injectedConfigPath)), &config); err != nil {
		t.Fatal(err)
	}
	if config["stackName"] != "renamed" || config["minimapEnabled"] != true || config["position"] != "top-right" || config["primaryService"] != "web" {
		t.Fatalf("injected config after the edit = %#v", config)
	}

	settings.FeatureToggles.ChatEnabled = false
	if err := server.UpdateSettings(settings); err != nil {
		t.Fatal(err)
	}
	if err := conn.WriteJSON(map[string]any{"type": "send", "commandId": "after-the-edit", "text": "Still here"}); err != nil {
		t.Fatal(err)
	}
	if message := readChatAckTest(t, conn); message.Type != "command_result" || message.SessionID != session.snapshot().ID || message.Error != "" {
		t.Fatalf("a running session after chat turned off answered %+v", message)
	}
}

// The chat routes answer 404 while chat is off and come back when a reload turns it on, without a restart.
func TestChatRoutesFollowTheToggle(t *testing.T) {
	t.Parallel()
	server, err := StartControlServer(StartControlServerOptions{
		GetHealthResponse: func() (HealthResponse, error) { return HealthResponse{Services: []ServiceHealth{}}, nil },
		ProjectRootPath:   t.TempDir(),
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = server.Stop() })
	readSessionsStatus := func() int {
		response, err := http.Get(serverURL(server.Port(), chatSessionsPath))
		if err != nil {
			t.Fatal(err)
		}
		_ = response.Body.Close() // Only the status matters.
		return response.StatusCode
	}
	if status := readSessionsStatus(); status != http.StatusNotFound {
		t.Fatalf("sessions with chat off = %d, want %d", status, http.StatusNotFound)
	}
	settings := server.currentSettings()
	settings.FeatureToggles.ChatEnabled = true
	if err := server.UpdateSettings(settings); err != nil {
		t.Fatal(err)
	}
	if status := readSessionsStatus(); status != http.StatusOK {
		t.Fatalf("sessions after a reload turned chat on = %d, want %d", status, http.StatusOK)
	}
}

func TestUpdateSettingsSendsTheConfigurationToOpenPages(t *testing.T) {
	t.Parallel()

	server, err := StartControlServer(StartControlServerOptions{
		GetHealthResponse: func() (HealthResponse, error) { return HealthResponse{Services: []ServiceHealth{}}, nil },
		// Only the edit itself can send the new configuration before the test ends.
		HealthPollInterval: time.Hour,
		Position:           "bottom-right",
		ProjectRootPath:    t.TempDir(),
		StackName:          "hello-stack",
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = server.Stop() })
	health := mustDialWebsocket(t, websocketURL(server.Port(), healthWebsocketPath))
	defer health.Close()
	_ = health.SetReadDeadline(time.Now().Add(5 * time.Second))
	readWebsocketText(t, health)

	settings := server.currentSettings()
	settings.StackName = "renamed"
	settings.Position = "top-right"
	if err := server.UpdateSettings(settings); err != nil {
		t.Fatal(err)
	}
	if message := readWebsocketText(t, health); !strings.Contains(message, `"stackName":"renamed"`) || !strings.Contains(message, `"position":"top-right"`) {
		t.Fatalf("health after the edit = %s, want the new configuration", message)
	}
}

func TestUpdateSettingsStartsAndStopsTheResourceReadouts(t *testing.T) {
	t.Parallel()

	server := startResourceUsageControlServer(t, ResourceUsageOptions{
		Readers: hostusage.Readers{Memory: func(context.Context) (hostusage.SpaceUsage, error) {
			return hostusage.SpaceUsage{Percent: 30, UsedBytes: 3, TotalBytes: 10}, nil
		}},
	})
	assertResourceStreamStatus(t, server, http.StatusNotFound)

	settings := server.currentSettings()
	settings.ResourceIntervals = hostusage.Intervals{Memory: time.Hour}
	if err := server.UpdateSettings(settings); err != nil {
		t.Fatal(err)
	}
	if !readInjectedResourcesEnabled(t, server) {
		t.Fatal("injected config reports resources as off after they were turned on")
	}
	socket := mustDialWebsocket(t, websocketURL(server.Port(), resourcesWebsocketPath))
	defer socket.Close()
	_ = socket.SetReadDeadline(time.Now().Add(5 * time.Second))
	if message := readWebsocketText(t, socket); message != `{"memory":{"percent":30,"usedBytes":3,"totalBytes":10}}` {
		t.Fatalf("resource usage after turning readouts on = %s", message)
	}

	settings.ResourceIntervals = hostusage.Intervals{}
	if err := server.UpdateSettings(settings); err != nil {
		t.Fatal(err)
	}
	// What the stream served is over, so the page closes it rather than reconnecting.
	if _, _, err := socket.ReadMessage(); !websocket.IsCloseError(err, websocket.CloseNormalClosure) {
		t.Fatalf("resource stream after turning readouts off = %v, want a normal closure", err)
	}
	assertResourceStreamStatus(t, server, http.StatusNotFound)
}

func assertResourceStreamStatus(t *testing.T, server *ControlServer, want int) {
	t.Helper()
	_, response, err := websocket.DefaultDialer.Dial(websocketURL(server.Port(), resourcesWebsocketPath), nil)
	if err == nil || response == nil || response.StatusCode != want {
		t.Fatalf("resource usage stream = %v, %v, want status %d", response, err, want)
	}
}
