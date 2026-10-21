package devtools

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
)

func TestUpdateRoutingChangesToolLaunchSelection(t *testing.T) {
	t.Parallel()
	var selected string
	server, err := StartControlServer(StartControlServerOptions{
		StackName: "routing", PrimaryService: "old",
		GetHealthResponse: func() (HealthResponse, error) { return HealthResponse{Services: []ServiceHealth{}}, nil },
		GetToolContext: func(name string) (ToolContext, error) {
			selected = name
			return ToolContext{}, nil
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
		if _, err := server.toolContext(tc.url); err != nil {
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
