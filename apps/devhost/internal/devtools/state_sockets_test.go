package devtools

import (
	"encoding/json"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/manifest"
	"github.com/gorilla/websocket"
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
func TestControlServerAnnotationQueueClientReceivesSnapshotsInOrder(t *testing.T) {
	t.Parallel()

	starter := newTestTerminalStarter()
	controlServer, err := StartControlServer(StartControlServerOptions{
		AnnotationActions: []manifest.ValidatedAnnotationAction{{
			Agent: manifest.ValidatedAgent{Kind: "pi"},
			Label: "Pi",
			ID:    defaultAnnotationActionID,
			Kind:  "agent",
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
		StateDirectoryPath:   t.TempDir(),
	})
	if err != nil {
		t.Fatalf("StartControlServer(...) error = %v", err)
	}
	t.Cleanup(func() {
		_ = controlServer.Stop()
	})

	sessionID := startTerminalTestSession(t, controlServer, `{"annotation":{"comment":"First annotation","markers":[],"stackName":"hello-stack","submittedAt":1,"title":"Example","url":"https://app.localhost/dashboard"},"colorScheme":"light","kind":"agent"}`)
	starter.sessions[0].emit("\x1b]1337;SetAgentStatus=working\x07")
	waitForCondition(t, 5*time.Second, func() bool {
		queues := controlServer.annotationQueueStore.getSnapshot()
		return len(queues) == 1 && queues[0].Status == annotationQueueStatusWorking
	})
	startTerminalTestSession(t, controlServer, `{"annotation":{"comment":"Second annotation","markers":[],"stackName":"hello-stack","submittedAt":2,"title":"Example","url":"https://app.localhost/settings"},"kind":"agent","targetSessionId":"`+sessionID+`"}`)
	queues := controlServer.annotationQueueStore.getSnapshot()
	if len(queues) != 1 || len(queues[0].Entries) != 2 {
		t.Fatalf("queues = %#v, want one queue with an active and a queued entry", queues)
	}
	queuedEntryID := queues[0].Entries[1].EntryID

	// Every change carries the next revision in the queued entry's comment. Odd revisions are large, so a snapshot
	// taken of one is slow to encode, which is when the small revision that follows used to overtake it.
	padding := strings.Repeat("x", 8<<20)
	if err := controlServer.annotationQueueStore.updateEntryComment(queuedEntryID, "0"); err != nil {
		t.Fatalf("updateEntryComment(0) error = %v", err)
	}
	stopChanges := make(chan struct{})
	changesStopped := make(chan struct{})
	go func() {
		defer close(changesStopped)
		for revision := 1; ; revision++ {
			select {
			case <-stopChanges:
				return
			default:
			}
			comment := strconv.Itoa(revision)
			if revision%2 == 1 {
				comment += " " + padding
			}
			if err := controlServer.annotationQueueStore.updateEntryComment(queuedEntryID, comment); err != nil {
				t.Errorf("updateEntryComment(%d) error = %v", revision, err)
				return
			}
		}
	}()
	defer func() {
		close(stopChanges)
		<-changesStopped
	}()

	for attempt := range 30 {
		queueSocket := mustDialWebsocket(t, annotationQueueWebsocketURL(controlServer.Port()))
		first := readAnnotationQueueRevision(t, queueSocket)
		second := readAnnotationQueueRevision(t, queueSocket)
		queueSocket.Close()
		if second < first {
			t.Fatalf("attach %d: received revision %d after revision %d", attempt, second, first)
		}
	}
}

func readAnnotationQueueRevision(t *testing.T, queueSocket *websocket.Conn) int {
	t.Helper()

	var message annotationQueuesSnapshotMessage
	if err := json.Unmarshal([]byte(readWebsocketText(t, queueSocket)), &message); err != nil {
		t.Fatalf("Unmarshal(queue snapshot) error = %v", err)
	}
	if len(message.Queues) != 1 || len(message.Queues[0].Entries) != 2 {
		t.Fatalf("queue snapshot has %d queues, want one queue with two entries", len(message.Queues))
	}
	revisionText, _, _ := strings.Cut(message.Queues[0].Entries[1].Annotation.Comment, " ")
	revision, err := strconv.Atoi(revisionText)
	if err != nil {
		t.Fatalf("queued entry comment starts with %q, want a revision number", revisionText)
	}
	return revision
}
