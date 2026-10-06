package devtools

import (
	"encoding/json"
	"fmt"
	"net/http"
	"reflect"
	"strings"
	"testing"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/manifest"
)

func TestUpdateRoutingPreservesLiveTerminalAndInjectedSettings(t *testing.T) {
	t.Parallel()
	server := startAnnotationLifecycleServer(t, terminalSessionRequestKindAgent)
	annotation := testAnnotationDetail("Running annotation", 1, "https://app.localhost/dashboard")
	sessionID := startAnnotationLifecycleSession(t, server, terminalSessionRequestKindAgent, annotation)
	socket := mustDialWebsocket(t, terminalWebsocketURL(server.Port(), sessionID))
	defer socket.Close()
	readWebsocketText(t, socket)
	before := readRoutingInjectedConfig(t, server)
	routes := []RoutedServiceIdentity{{Host: "app.localhost", Path: "/", ServiceName: "replacement"}}
	if err := server.UpdateRouting(routes, "replacement"); err != nil {
		t.Fatal(err)
	}
	after := readRoutingInjectedConfig(t, server)
	if !reflect.DeepEqual(after.RoutedServices, routes) || after.PrimaryService != "replacement" {
		t.Fatalf("script retained old routes: %#v", after)
	}
	after.RoutedServices, after.PrimaryService = before.RoutedServices, before.PrimaryService
	if !reflect.DeepEqual(before, after) {
		t.Fatal("routing update changed token, settings, or project identity")
	}
	assertAnnotationLifecycleSession(t, server, sessionID)
	if err := socket.WriteJSON(map[string]string{"type": "input", "data": "finish\n"}); err != nil {
		t.Fatal(err)
	}
	for {
		if strings.Contains(readWebsocketText(t, socket), "SetAgentStatus=finished") {
			break
		}
	}
	server.annotationQueueStore.mu.Lock()
	key := resolveRoutedServiceKeyForAnnotation(server.annotationQueueStore.routedServices, annotation)
	server.annotationQueueStore.mu.Unlock()
	if key == nil || *key != "replacement" {
		t.Fatalf("queue retained old service identity: %v", key)
	}
}

func TestUpdateRoutingChangesToolLaunchSelection(t *testing.T) {
	t.Parallel()
	var selected string
	server, err := StartControlServer(StartControlServerOptions{
		ManifestPath: t.TempDir() + "/devhost.toml", StackName: "routing", PrimaryService: "old",
		GetHealthResponse: func() (HealthResponse, error) { return HealthResponse{Services: []ServiceHealth{}}, nil },
		GetToolContext: func(name string) (ToolContext, error) {
			selected = name
			return ToolContext{AnnotationActions: []manifest.ValidatedAnnotationAction{}}, nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := server.Stop(); err != nil {
			t.Error(err)
		}
	})
	if err := server.UpdateRouting([]RoutedServiceIdentity{{Host: "api.localhost", Path: "/", ServiceName: "api"}}, "web"); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct{ url, want string }{{"https://api.localhost/items", "api"}, {"https://other.localhost/", "web"}} {
		if _, err := server.toolContext(terminalSessionRequest{PageURL: tc.url}); err != nil {
			t.Fatal(err)
		}
		if selected != tc.want {
			t.Fatalf("tool launch selected %s; want %s", selected, tc.want)
		}
	}
}

func readRoutingInjectedConfig(t *testing.T, server *ControlServer) injectedConfig {
	t.Helper()
	response, err := http.Get(serverURL(server.Port(), injectedConfigPath))
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK || response.Header.Get("Cache-Control") != cacheControlNoStore {
		t.Fatalf("configuration response: status %d, cache %s", response.StatusCode, response.Header.Get("Cache-Control"))
	}
	var config injectedConfig
	if err := json.NewDecoder(response.Body).Decode(&config); err != nil {
		t.Fatal(err)
	}
	return config
}

func TestUpdateRoutingPublishesConsistentConfigWhileServing(t *testing.T) {
	t.Parallel()
	server := startAssetTestServer(t)
	if err := server.UpdateRouting([]RoutedServiceIdentity{{Host: "app.localhost", Path: "/", ServiceName: "initial"}}, "initial"); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() {
		for i := range 1000 {
			name := fmt.Sprintf("service-%d", i)
			if err := server.UpdateRouting([]RoutedServiceIdentity{{Host: "app.localhost", Path: "/", ServiceName: name}}, name); err != nil {
				done <- err
				return
			}
		}
		done <- nil
	}()
	t.Cleanup(func() {
		if err := <-done; err != nil {
			t.Error(err)
		}
	})
	for range 100 {
		config := readRoutingInjectedConfig(t, server)
		if len(config.RoutedServices) != 1 || config.RoutedServices[0].ServiceName != config.PrimaryService {
			t.Fatalf("configuration mixed routing generations: %#v", config)
		}
	}
}
