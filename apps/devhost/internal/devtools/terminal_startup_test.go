package devtools

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/manifest"
)

const terminalStartupOutput = "\x1b]1337;SetAgentStatus=working\x07startup output\n"
const terminalStartupHelperEnvironment = "GO_WANT_TERMINAL_STARTUP_HELPER"

func TestTerminalSessionRetainsOutputBeforeLauncherReturns(t *testing.T) {
	t.Parallel()
	for _, kind := range []string{terminalSessionRequestKindAgent, terminalSessionRequestKindCommand} {
		for _, tc := range []struct {
			name       string
			output     string
			isExited   bool
			isFinished bool
		}{
			{"running", terminalStartupOutput, false, false},
			{"exited", terminalStartupOutput, true, false},
			{"finished", terminalStartupOutput + "\x1b]1337;SetAgentStatus=finished\x07", true, true},
		} {
			t.Run(kind+"/"+tc.name, func(t *testing.T) {
				t.Parallel()
				root := t.TempDir()
				readyPath := filepath.Join(root, "output-written")
				server, err := StartControlServer(StartControlServerOptions{
					ProjectRootPath: root,
					ManifestPath:    filepath.Join(root, "devhost.toml"), StateDirectoryPath: root, StackName: "hello-stack",
					AnnotationActions: []manifest.ValidatedAnnotationAction{{ID: kind, Kind: kind, DisplayName: "Startup test"}},
					FeatureToggles:    FeatureToggles{TerminalEnabled: true, AnnotationQueueEnabled: kind == terminalSessionRequestKindAgent},
					GetHealthResponse: func() (HealthResponse, error) { return HealthResponse{Services: []ServiceHealth{}}, nil },
					StartTerminalSession: func(request terminalSessionRequest) (*launchedTerminalSession, error) {
						command := []string{os.Args[0], "-test.run=^TestTerminalStartupHelperProcess$"}
						env := map[string]string{
							terminalStartupHelperEnvironment: "1", "DEVHOST_STARTUP_READY_PATH": readyPath,
							"DEVHOST_STARTUP_OUTPUT": tc.output, "DEVHOST_STARTUP_EXIT": fmt.Sprint(tc.isExited),
						}
						launched, err := launchTerminalCommand(command, root, env, func() {})
						if err != nil {
							return nil, err
						}
						// Force the child to write before the launcher returns and the server registers it.
						if err := waitForTerminalStartupOutput(readyPath); err != nil {
							launched.close()
							launched.wait()
							return nil, err
						}
						return launched, nil
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
				annotation := testAnnotationDetail("Startup output", 1, "https://app.localhost/dashboard")
				var id string
				if kind == terminalSessionRequestKindAgent {
					result, queueErr := server.annotationQueueStore.enqueue(kind, annotation, "", nil)
					id, err = result.SessionID, queueErr
				} else {
					id, err = server.createTerminalSession(terminalSessionRequest{Kind: kind, Annotation: &annotation})
				}
				if err != nil {
					t.Fatal(err)
				}
				expectedOutput := strings.ReplaceAll(tc.output, "\n", "\r\n")
				waitForCondition(t, 5*time.Second, func() bool {
					server.mu.Lock()
					defer server.mu.Unlock()
					return server.terminalSessions[id].output == expectedOutput
				})
				socket := mustDialWebsocket(t, terminalWebsocketURL(server.Port(), id))
				defer socket.Close()
				var snapshot terminalSessionSnapshotMessage
				if err := json.Unmarshal([]byte(readWebsocketText(t, socket)), &snapshot); err != nil {
					t.Fatal(err)
				}
				if snapshot.Data != expectedOutput {
					t.Fatalf("startup snapshot = %q, want initial output and working status", snapshot.Data)
				}
				if tc.isExited {
					waitForCondition(t, 5*time.Second, func() bool {
						server.mu.Lock()
						defer server.mu.Unlock()
						exit := server.terminalSessions[id].exited
						return exit != nil && exit.ExitCode != nil && *exit.ExitCode == 0
					})
				}
				if kind == terminalSessionRequestKindAgent {
					waitForCondition(t, 5*time.Second, func() bool {
						queues := server.annotationQueueStore.getSnapshot()
						if tc.isFinished {
							return len(queues) == 0
						}
						status := annotationQueueStatusWorking
						if tc.isExited {
							status = annotationQueueStatusPaused
						}
						return len(queues) == 1 && queues[0].Status == status
					})
				}
			})
		}
	}
}

func waitForTerminalStartupOutput(path string) error {
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		_, err := os.Stat(path)
		if err == nil {
			return nil
		}
		if !os.IsNotExist(err) {
			return err
		}
		time.Sleep(10 * time.Millisecond)
	}
	return fmt.Errorf("child did not write its startup output before the launch deadline")
}

func TestTerminalStartupHelperProcess(t *testing.T) {
	if os.Getenv(terminalStartupHelperEnvironment) != "1" {
		return
	}
	if _, err := fmt.Fprint(os.Stdout, os.Getenv("DEVHOST_STARTUP_OUTPUT")); err != nil {
		t.Fatal(err)
	}
	if path := os.Getenv("DEVHOST_STARTUP_READY_PATH"); path != "" {
		if err := os.WriteFile(path, nil, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if os.Getenv("DEVHOST_STARTUP_EXIT") == "true" {
		os.Exit(0)
	}
	input := bufio.NewScanner(os.Stdin)
	input.Scan()
	if err := input.Err(); err != nil {
		t.Fatal(err)
	}
}
