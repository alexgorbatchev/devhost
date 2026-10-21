package devtools

import (
	"encoding/json"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// A client that attaches reads the stack's health afresh. Clients attached earlier must receive that health too:
// the next publish compares equal to what the newcomer was sent, so it would never reach them.
func TestControlServerSendsHealthReadForNewClientToEarlierClients(t *testing.T) {
	t.Parallel()

	var isHealthy atomic.Bool
	isHealthy.Store(true)
	controlServer, err := StartControlServer(StartControlServerOptions{
		ComponentEditor: "vscode",
		FeatureToggles:  FeatureToggles{StatusEnabled: true},
		GetHealthResponse: func() (HealthResponse, error) {
			return HealthResponse{Services: []ServiceHealth{{Managed: true, Name: "web", Status: isHealthy.Load()}}}, nil
		},
		Position:        "bottom-right",
		ProjectRootPath: t.TempDir(),
		StackName:       "hello-stack",
	})
	if err != nil {
		t.Fatalf("StartControlServer(...) error = %v", err)
	}
	t.Cleanup(func() {
		_ = controlServer.Stop()
	})

	const healthy = `{"services":[{"managed":true,"name":"web","status":true}]}`
	const unhealthy = `{"services":[{"managed":true,"name":"web","status":false}]}`

	earlierSocket := mustDialWebsocket(t, websocketURL(controlServer.Port(), healthWebsocketPath))
	defer earlierSocket.Close()
	if message := readWebsocketText(t, earlierSocket); message != healthy {
		t.Fatalf("earlier client's first health = %q, want %q", message, healthy)
	}

	isHealthy.Store(false)
	laterSocket := mustDialWebsocket(t, websocketURL(controlServer.Port(), healthWebsocketPath))
	defer laterSocket.Close()
	if message := readWebsocketText(t, laterSocket); message != unhealthy {
		t.Fatalf("later client's first health = %q, want %q", message, unhealthy)
	}

	_ = earlierSocket.SetReadDeadline(time.Now().Add(5 * time.Second))
	if message := readWebsocketText(t, earlierSocket); message != unhealthy {
		t.Fatalf("earlier client's next health = %q, want %q", message, unhealthy)
	}
}

// A page that stops reading, such as one paused in a debugger, must not hold up whoever publishes to it. Once the
// connection can take no more data, the write that would block is given up after the write timeout and the client
// is dropped.
func TestControlServerDropsClientThatStopsReading(t *testing.T) {
	t.Parallel()

	controlServer, err := StartControlServer(StartControlServerOptions{
		ComponentEditor: "vscode",
		FeatureToggles:  FeatureToggles{MinimapEnabled: true, StatusEnabled: true},
		GetHealthResponse: func() (HealthResponse, error) {
			return HealthResponse{Services: []ServiceHealth{}}, nil
		},
		Position:              "bottom-right",
		ProjectRootPath:       t.TempDir(),
		StackName:             "hello-stack",
		WebsocketWriteTimeout: 200 * time.Millisecond,
	})
	if err != nil {
		t.Fatalf("StartControlServer(...) error = %v", err)
	}
	t.Cleanup(func() {
		_ = controlServer.Stop()
	})

	stalledSocket := mustDialWebsocket(t, websocketURL(controlServer.Port(), logsWebsocketPath))
	defer stalledSocket.Close()
	// The snapshot is the last thing this client reads.
	readWebsocketText(t, stalledSocket)

	// Far more than the connection can hold unread, so one of these writes has to block.
	line := strings.Repeat("a", 64<<10)
	published := make(chan struct{})
	go func() {
		defer close(published)
		for range 2000 {
			controlServer.PublishLogEntry("api", ServiceLogStreamStdout, line)
		}
	}()
	select {
	case <-published:
	case <-time.After(10 * time.Second):
		t.Fatal("publishing is still blocked on a client that stopped reading")
	}

	controlServer.mu.Lock()
	remainingClients := len(controlServer.logsClients)
	controlServer.mu.Unlock()
	if remainingClients != 0 {
		t.Fatalf("log clients after the stalled one timed out = %d, want none", remainingClients)
	}
}

// The browser replaces its log list with the snapshot, so an entry delivered first would be lost.
func TestControlServerLogsClientReceivesSnapshotBeforeLiveEntries(t *testing.T) {
	t.Parallel()

	controlServer, err := StartControlServer(StartControlServerOptions{
		ComponentEditor: "vscode",
		FeatureToggles:  FeatureToggles{MinimapEnabled: true, StatusEnabled: true},
		GetHealthResponse: func() (HealthResponse, error) {
			return HealthResponse{Services: []ServiceHealth{}}, nil
		},
		Position:        "bottom-right",
		ProjectRootPath: t.TempDir(),
		StackName:       "hello-stack",
	})
	if err != nil {
		t.Fatalf("StartControlServer(...) error = %v", err)
	}
	t.Cleanup(func() {
		_ = controlServer.Stop()
	})

	// A full log of long lines makes the snapshot slow to encode, which is when a live entry used to overtake it.
	line := strings.Repeat("a", 4096)
	for range maximumRetainedLogEntries {
		controlServer.PublishLogEntry("api", ServiceLogStreamStdout, line)
	}

	stopEntries := make(chan struct{})
	entriesStopped := make(chan struct{})
	go func() {
		defer close(entriesStopped)
		for {
			select {
			case <-stopEntries:
				return
			default:
				controlServer.PublishLogEntry("api", ServiceLogStreamStdout, line)
			}
		}
	}()
	defer func() {
		close(stopEntries)
		<-entriesStopped
	}()

	for attempt := range 100 {
		logsSocket := mustDialWebsocket(t, websocketURL(controlServer.Port(), logsWebsocketPath))
		var first serviceLogSnapshotMessage
		if err := json.Unmarshal([]byte(readWebsocketText(t, logsSocket)), &first); err != nil {
			t.Fatalf("Unmarshal(first message) error = %v", err)
		}
		logsSocket.Close()
		if first.Type != "snapshot" {
			t.Fatalf("attach %d: first message type = %q, want snapshot", attempt, first.Type)
		}
	}
}

// The browser replaces its queues with every snapshot it receives, so the snapshot a client is sent on attach must
// not arrive after a newer one.
