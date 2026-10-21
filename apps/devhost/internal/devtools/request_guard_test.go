package devtools

import (
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

const guardTestRoutedHost = "project.localhost"

func startRequestGuardServer(t *testing.T) *ControlServer {
	t.Helper()
	controlServer, err := StartControlServer(StartControlServerOptions{
		GetHealthResponse: func() (HealthResponse, error) { return HealthResponse{Services: []ServiceHealth{}}, nil },
		OwnsDocumentURL: func(port int, href string) (bool, error) {
			return href == "https://"+guardTestRoutedHost+"/", nil
		},
		RestartService:     func([]string) error { return nil },
		RestartStack:       func() error { return nil },
		StartService:       func([]string) error { return nil },
		ProjectRootPath:    t.TempDir(),
		StateDirectoryPath: t.TempDir(),
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := controlServer.Stop(); err != nil {
			t.Errorf("stop request guard server: %v", err)
		}
	})
	return controlServer
}

func sendGuardTestRequest(t *testing.T, port int, method, path, host string, header http.Header, body string) int {
	t.Helper()
	request, err := http.NewRequest(method, serverURL(port, path), strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	if host != "" {
		request.Host = host
	}
	for name, values := range header {
		request.Header[name] = values
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	if err := response.Body.Close(); err != nil {
		t.Fatal(err)
	}
	return response.StatusCode
}

func TestControlServerRejectsStateChangesFromOtherSites(t *testing.T) {
	controlServer := startRequestGuardServer(t)
	loopback := fmt.Sprintf("127.0.0.1:%d", controlServer.Port())
	rebound := fmt.Sprintf("rebound.example:%d", controlServer.Port())
	for _, tc := range []struct {
		name   string
		host   string
		header http.Header
		want   int
	}{
		{"a tool without browser headers", "", nil, http.StatusNoContent},
		{"a page on the same origin", "", http.Header{"Origin": {"http://" + loopback}, "Sec-Fetch-Site": {"same-origin"}}, http.StatusNoContent},
		{"a page on another site", "", http.Header{"Origin": {"https://other.example"}}, http.StatusForbidden},
		{"a cross-site fetch", "", http.Header{"Sec-Fetch-Site": {"cross-site"}}, http.StatusForbidden},
		{"a same-site fetch from another origin", "", http.Header{"Sec-Fetch-Site": {"same-site"}}, http.StatusForbidden},
		{"a name rebound to the control port", rebound, http.Header{"Origin": {"http://" + rebound}, "Sec-Fetch-Site": {"same-origin"}}, http.StatusForbidden},
		{"a route of this stack", guardTestRoutedHost, http.Header{"Origin": {"https://" + guardTestRoutedHost}, "Sec-Fetch-Site": {"same-origin"}, "X-Forwarded-Proto": {"https"}}, http.StatusNoContent},
		{"a route of another stack", "other.localhost", http.Header{"Origin": {"https://other.localhost"}, "Sec-Fetch-Site": {"same-origin"}, "X-Forwarded-Proto": {"https"}}, http.StatusForbidden},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := sendGuardTestRequest(t, controlServer.Port(), http.MethodPost, restartStackPath, tc.host, tc.header, ""); got != tc.want {
				t.Fatalf("POST %s status = %d, want %d", restartStackPath, got, tc.want)
			}
		})
	}
}

func TestEveryStateChangingControlRouteRejectsOtherSites(t *testing.T) {
	controlServer := startRequestGuardServer(t)
	crossSite := http.Header{"Origin": {"https://other.example"}, "Content-Type": {"application/json"}}
	for _, tc := range []struct{ method, path, body string }{
		{http.MethodPost, restartServicePath, `{"serviceNames":["api"]}`},
		{http.MethodPost, restartStackPath, ""},
		{http.MethodPost, startServicePath, `{"serviceNames":["api"]}`},
		{http.MethodPost, worktreesPath, `{"repositoryId":"root","path":"/tmp"}`},
		{http.MethodPost, terminalSessionsPath, `{"kind":"editor"}`},
		{http.MethodPost, annotationQueuesPath, `{}`},
		{http.MethodDelete, annotationQueuesPath + "/queue/entry", ""},
		{http.MethodPost, reactHighlightCursorPath, `{"locator":null}`},
	} {
		t.Run(tc.method+" "+tc.path, func(t *testing.T) {
			if got := sendGuardTestRequest(t, controlServer.Port(), tc.method, tc.path, "", crossSite, tc.body); got != http.StatusForbidden {
				t.Fatalf("status = %d, want %d", got, http.StatusForbidden)
			}
		})
	}
}

func TestControlRequestBodiesMustBeJSON(t *testing.T) {
	controlServer := startRequestGuardServer(t)
	for _, tc := range []struct {
		contentType string
		want        int
	}{
		{"application/json", http.StatusNoContent},
		{"application/json; charset=utf-8", http.StatusNoContent},
		{"text/plain", http.StatusUnsupportedMediaType},
		{"", http.StatusUnsupportedMediaType},
	} {
		t.Run(tc.contentType, func(t *testing.T) {
			header := http.Header{"Content-Type": {tc.contentType}}
			if got := sendGuardTestRequest(t, controlServer.Port(), http.MethodPost, startServicePath, "", header, `{"serviceNames":["api"]}`); got != tc.want {
				t.Fatalf("status = %d, want %d", got, tc.want)
			}
		})
	}
}

func TestControlWebsocketsRejectOtherSites(t *testing.T) {
	controlServer := startRequestGuardServer(t)
	loopback := fmt.Sprintf("127.0.0.1:%d", controlServer.Port())
	rebound := fmt.Sprintf("rebound.example:%d", controlServer.Port())
	for _, tc := range []struct {
		name   string
		header http.Header
		want   int
	}{
		{"a page on the same origin", http.Header{"Origin": {"http://" + loopback}}, http.StatusSwitchingProtocols},
		{"a page on another site", http.Header{"Origin": {"https://other.example"}}, http.StatusForbidden},
		{"a name rebound to the control port", http.Header{"Origin": {"http://" + rebound}, "Host": {rebound}}, http.StatusForbidden},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dialer := websocket.Dialer{HandshakeTimeout: time.Second}
			conn, response, err := dialer.Dial(websocketURL(controlServer.Port(), healthWebsocketPath), tc.header)
			if conn != nil {
				if err := conn.Close(); err != nil {
					t.Fatal(err)
				}
			}
			if response == nil {
				t.Fatalf("handshake returned no response: %v", err)
			}
			if err := response.Body.Close(); err != nil {
				t.Fatal(err)
			}
			if response.StatusCode != tc.want {
				t.Fatalf("handshake status = %d, want %d", response.StatusCode, tc.want)
			}
		})
	}
}
