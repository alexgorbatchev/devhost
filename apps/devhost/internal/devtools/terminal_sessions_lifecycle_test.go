package devtools

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/manifest"
)

const annotationHelperEnvironment = "GO_WANT_ANNOTATION_SESSION_HELPER"

func TestAnnotationSessionsSurviveBrowserDisconnect(t *testing.T) {
	t.Parallel()
	for _, kind := range []string{terminalSessionRequestKindAgent, terminalSessionRequestKindCommand} {
		t.Run(kind, func(t *testing.T) {
			t.Parallel()
			server := startAnnotationLifecycleServer(t, kind)
			annotation := testAnnotationDetail("First annotation", 1, "https://app.localhost/dashboard")
			sessionID := startAnnotationLifecycleSession(t, server, kind, annotation)

			// Submission must survive even when the browser never attaches a terminal.
			time.Sleep(3 * server.idleTerminalSessionTimeout)
			assertAnnotationLifecycleSession(t, server, sessionID)
			socket := mustDialWebsocket(t, terminalWebsocketURL(server.Port(), sessionID))
			defer socket.Close()
			if snapshot := readWebsocketText(t, socket); !strings.Contains(snapshot, "SetAgentStatus=working") {
				t.Fatalf("initial terminal snapshot = %q, want working output", snapshot)
			}
			if err := socket.Close(); err != nil {
				t.Fatal(err)
			}
			waitForAnnotationLifecycleDisconnect(t, server, sessionID)
			time.Sleep(3 * server.idleTerminalSessionTimeout)
			assertAnnotationLifecycleSession(t, server, sessionID)
			if !server.HasActiveTerminalSessions() {
				t.Fatal("disconnected annotation must prevent stack idle shutdown")
			}

			if kind == terminalSessionRequestKindAgent {
				queues := server.annotationQueueStore.getSnapshot()
				if len(queues) != 1 || queues[0].Status != annotationQueueStatusWorking || queues[0].PauseReason != nil {
					t.Fatalf("disconnected queue = %#v, want working", queues)
				}
				second := testAnnotationDetail("Second annotation", 2, annotation.URL)
				result, err := server.annotationQueueStore.enqueue(kind, second, "", &sessionID)
				if err != nil || result.SessionID != sessionID {
					t.Fatalf("enqueue second annotation = (%#v, %v), want same session", result, err)
				}
				writeAnnotationLifecycleInput(t, server, sessionID, "finish\n")
				waitForCondition(t, time.Second, func() bool {
					queues := server.annotationQueueStore.getSnapshot()
					return len(queues) == 1 && len(queues[0].Entries) == 1 && queues[0].Entries[0].Annotation.Comment == second.Comment && queues[0].Status == annotationQueueStatusWorking
				})
				writeAnnotationLifecycleInput(t, server, sessionID, "finish\n")
				waitForCondition(t, time.Second, func() bool {
					return len(server.annotationQueueStore.getSnapshot()) == 0
				})
				time.Sleep(3 * server.idleTerminalSessionTimeout)
				assertAnnotationLifecycleSession(t, server, sessionID)
				third := testAnnotationDetail("Third annotation", 3, annotation.URL)
				result, err = server.annotationQueueStore.enqueue(kind, third, "", &sessionID)
				if err != nil || result.SessionID != sessionID {
					t.Fatalf("enqueue into idle session = (%#v, %v), want same session", result, err)
				}
				waitForCondition(t, time.Second, func() bool {
					queues := server.annotationQueueStore.getSnapshot()
					return len(queues) == 1 && queues[0].Status == annotationQueueStatusWorking
				})
			}

			reconnected := mustDialWebsocket(t, terminalWebsocketURL(server.Port(), sessionID))
			defer reconnected.Close()
			if snapshot := readWebsocketText(t, reconnected); !strings.Contains(snapshot, "SetAgentStatus=working") {
				t.Fatalf("restored snapshot = %q, want retained working output", snapshot)
			}
			if err := reconnected.Close(); err != nil {
				t.Fatal(err)
			}
			waitForAnnotationLifecycleDisconnect(t, server, sessionID)
			writeAnnotationLifecycleInput(t, server, sessionID, "exit\n")
			waitForCondition(t, 5*time.Second, func() bool {
				return len(server.createTerminalSessionListResponse().Sessions) == 0
			})
			if kind == terminalSessionRequestKindAgent {
				queues := server.annotationQueueStore.getSnapshot()
				if len(queues) != 1 || queues[0].PauseReason == nil || *queues[0].PauseReason != string(annotationQueuePauseReasonSessionExited) {
					t.Fatalf("exited queue = %#v, want session-exited pause", queues)
				}
			}
		})
	}
}

func TestAnnotationSessionsExplicitShutdown(t *testing.T) {
	t.Parallel()
	for _, kind := range []string{terminalSessionRequestKindAgent, terminalSessionRequestKindCommand} {
		for _, termination := range []string{"terminate", "stop-stack"} {
			t.Run(kind+"/"+termination, func(t *testing.T) {
				t.Parallel()
				server := startAnnotationLifecycleServer(t, kind)
				annotation := testAnnotationDetail("Explicit shutdown", 1, "https://app.localhost/dashboard")
				sessionID := startAnnotationLifecycleSession(t, server, kind, annotation)
				pauseReason := annotationQueuePauseReasonShutdown
				if termination == "terminate" {
					socket := mustDialWebsocket(t, terminalWebsocketURL(server.Port(), sessionID))
					defer socket.Close()
					readWebsocketText(t, socket)
					if err := socket.WriteJSON(map[string]string{"type": "close"}); err != nil {
						t.Fatal(err)
					}
					pauseReason = annotationQueuePauseReasonUserTerminated
				} else if err := server.Stop(); err != nil {
					t.Fatal(err)
				}
				waitForCondition(t, time.Second, func() bool {
					return len(server.createTerminalSessionListResponse().Sessions) == 0
				})
				if kind == terminalSessionRequestKindAgent {
					queues := server.annotationQueueStore.getSnapshot()
					if len(queues) != 1 || queues[0].Status != annotationQueueStatusPaused || queues[0].ActiveSessionID != nil {
						t.Fatalf("terminated queue = %#v, want paused with no active session", queues)
					}
					persisted := loadPersistedAnnotationQueueState(server.annotationQueueStore.queueFilePath)
					if len(persisted.Queues) != 1 || persisted.Queues[0].PauseReason == nil || *persisted.Queues[0].PauseReason != pauseReason {
						t.Fatalf("terminated queue = %#v, want pause reason %s", queues, pauseReason)
					}
				}
			})
		}
	}
}

func startAnnotationLifecycleServer(t *testing.T, kind string) *ControlServer {
	t.Helper()
	projectRoot := t.TempDir()
	command := []string{os.Args[0], "-test.run=^TestAnnotationSessionHelperProcess$"}
	env := map[string]string{annotationHelperEnvironment: "1"}
	action := manifest.ValidatedAnnotationAction{
		ID: kind, Kind: kind, DisplayName: "Lifecycle test", TempDir: &projectRoot,
		Command: command, Cwd: projectRoot, Env: env,
		Agent: manifest.ValidatedAgent{Kind: "configured", DisplayName: "Lifecycle test", Command: command, Cwd: projectRoot, Env: env},
	}
	server, err := StartControlServer(StartControlServerOptions{
		AnnotationActions: []manifest.ValidatedAnnotationAction{action}, AnnotationDefaultActionID: kind,
		FeatureToggles:             FeatureToggles{AnnotationEnabled: true, AnnotationQueueEnabled: true, TerminalEnabled: true},
		GetHealthResponse:          func() (HealthResponse, error) { return HealthResponse{Services: []ServiceHealth{}}, nil },
		IdleTerminalSessionTimeout: 200 * time.Millisecond,
		ManifestPath:               filepath.Join(projectRoot, "devhost.toml"), ProjectRootPath: projectRoot,
		StateDirectoryPath: projectRoot, StackName: "hello-stack", Position: "bottom-right",
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := server.Stop(); err != nil {
			t.Error(err)
		}
	})
	return server
}

func startAnnotationLifecycleSession(t *testing.T, server *ControlServer, kind string, annotation annotationSubmitDetail) string {
	t.Helper()
	payload, err := json.Marshal(terminalSessionRequest{ActionID: kind, Annotation: &annotation, Kind: kind})
	if err != nil {
		t.Fatal(err)
	}
	request, err := http.NewRequest(http.MethodPost, serverURL(server.Port(), terminalSessionsPath), bytes.NewReader(payload))
	if err != nil {
		t.Fatal(err)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("start annotation status = %d", response.StatusCode)
	}
	var result startTerminalSessionResponse
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
		t.Fatal(err)
	}
	// Start the helper through its PTY after the HTTP submission registers the session.
	writeAnnotationLifecycleInput(t, server, result.SessionID, "start\n")
	waitForCondition(t, 5*time.Second, func() bool {
		server.mu.Lock()
		defer server.mu.Unlock()
		session := server.terminalSessions[result.SessionID]
		return session != nil && strings.Contains(session.output, "SetAgentStatus=working")
	})
	return result.SessionID
}

func assertAnnotationLifecycleSession(t *testing.T, server *ControlServer, sessionID string) {
	t.Helper()
	sessions := server.createTerminalSessionListResponse().Sessions
	if len(sessions) != 1 || sessions[0].SessionID != sessionID {
		t.Fatalf("annotation sessions = %#v, want original running session", sessions)
	}
}

func waitForAnnotationLifecycleDisconnect(t *testing.T, server *ControlServer, sessionID string) {
	t.Helper()
	waitForCondition(t, time.Second, func() bool {
		server.mu.Lock()
		defer server.mu.Unlock()
		session := server.terminalSessions[sessionID]
		return session != nil && len(session.clients) == 0
	})
}

func writeAnnotationLifecycleInput(t *testing.T, server *ControlServer, sessionID, input string) {
	t.Helper()
	server.mu.Lock()
	session := server.terminalSessions[sessionID]
	server.mu.Unlock()
	if session == nil {
		t.Fatal("annotation session is missing")
	}
	session.write(input)
}

func TestAnnotationSessionHelperProcess(t *testing.T) {
	if os.Getenv(annotationHelperEnvironment) != "1" {
		return
	}
	input := bufio.NewScanner(os.Stdin)
	for input.Scan() {
		status := "working"
		switch input.Text() {
		case "exit":
			return
		case "finish":
			status = "finished"
		}
		if _, err := fmt.Fprintf(os.Stdout, "\x1b]1337;SetAgentStatus=%s\x07", status); err != nil {
			t.Fatal(err)
		}
	}
	if err := input.Err(); err != nil {
		t.Fatal(err)
	}
}
