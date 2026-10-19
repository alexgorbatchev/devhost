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

func TestUpdateSettingsAppliesWithoutEndingSessions(t *testing.T) {
	t.Parallel()

	server := startAnnotationLifecycleServer(t, terminalSessionRequestKindAgent)
	sessionID := startAnnotationLifecycleSession(t, server, terminalSessionRequestKindAgent, testAnnotationDetail("Before the edit", 1, "https://app.localhost/"))
	health := mustDialWebsocket(t, websocketURL(server.Port(), healthWebsocketPath))
	defer health.Close()
	_ = health.SetReadDeadline(time.Now().Add(5 * time.Second))
	readWebsocketText(t, health)

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
	// Open pages learn the configuration from the health stream.
	if message := readWebsocketText(t, health); !strings.Contains(message, `"stackName":"renamed"`) || !strings.Contains(message, `"position":"top-right"`) {
		t.Fatalf("health after the edit = %s, want the new configuration", message)
	}
	assertAnnotationLifecycleSession(t, server, sessionID)

	settings.FeatureToggles.TerminalEnabled = false
	if err := server.UpdateSettings(settings); err != nil {
		t.Fatal(err)
	}
	if _, err := server.createTerminalSession(terminalSessionRequest{Kind: terminalSessionRequestKindCommand, ActionID: terminalSessionRequestKindAgent}); err == nil || err.Error() != "Terminal session launching is not configured." {
		t.Fatalf("createTerminalSession(...) with terminals turned off = %v", err)
	}
	assertAnnotationLifecycleSession(t, server, sessionID)
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
