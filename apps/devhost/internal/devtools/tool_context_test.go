package devtools

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/manifest"
)

func TestTerminalLaunchUsesSelectedCheckoutAndRetainsExistingSessionRoot(t *testing.T) {
	configured, selected := t.TempDir(), t.TempDir()
	cwdFile, rootFile := filepath.Join(t.TempDir(), "cwd"), filepath.Join(t.TempDir(), "root")
	root := configured
	tempDir := t.TempDir()
	server, err := StartControlServer(StartControlServerOptions{
		ProjectRootPath: configured, PrimaryService: "web",
		GetHealthResponse: func() (HealthResponse, error) { return HealthResponse{Services: []ServiceHealth{}}, nil },
		FeatureToggles:    FeatureToggles{TerminalEnabled: true},
		GetToolContext: func(name string) (ToolContext, error) {
			if name != "web" {
				t.Errorf("tool service = %q", name)
			}
			return ToolContext{ProjectRootPath: root, AnnotationActions: []manifest.ValidatedAnnotationAction{{
				ID: "cwd", Kind: "command", Cwd: root, TempDir: &tempDir,
				Command: []string{"sh", "-c", `pwd > "$OUTPUT_PATH"; printf '%s' "$DEVHOST_PROJECT_ROOT" > "$ROOT_PATH"`},
				Env:     map[string]string{"OUTPUT_PATH": cwdFile, "ROOT_PATH": rootFile},
			}}}, nil
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
	request := terminalSessionRequest{Kind: terminalSessionRequestKindCommand, ActionID: "cwd", Annotation: &annotationSubmitDetail{URL: "https://web.localhost", Comment: "Check checkout", Markers: []annotationMarkerPayload{}}}
	launch := func() string {
		id, err := server.createTerminalSession(request)
		if err != nil {
			t.Fatal(err)
		}
		waitForCondition(t, 5*time.Second, func() bool {
			server.mu.Lock()
			defer server.mu.Unlock()
			return server.terminalSessions[id].exited != nil
		})
		cwd, err := os.ReadFile(cwdFile)
		if err != nil {
			t.Fatal(err)
		}
		project, err := os.ReadFile(rootFile)
		if err != nil {
			t.Fatal(err)
		}
		if string(cwd) != root+"\n" || string(project) != root {
			t.Fatalf("launched cwd/root = %q/%q, want %q", cwd, project, root)
		}
		return id
	}
	oldSession := launch()
	root = selected
	newSession := launch()
	server.mu.Lock()
	defer server.mu.Unlock()
	if server.terminalSessions[oldSession].projectRootPath != configured || server.terminalSessions[newSession].projectRootPath != selected {
		t.Fatal("checkout change mutated an existing session or launched a new one in the old checkout")
	}
}

func TestToolContextResolvesEditorAndAnnotationServiceFromPageURL(t *testing.T) {
	s := &ControlServer{primaryService: "web", routedServices: []RoutedServiceIdentity{{Host: "shop.localhost", Path: "/", ServiceName: "web"}, {Host: "shop.localhost", Path: "/api/*", ServiceName: "api"}}, getToolContext: func(name string) (ToolContext, error) { return ToolContext{ProjectRootPath: name}, nil }}
	for _, tc := range []struct {
		request terminalSessionRequest
		want    string
	}{
		{terminalSessionRequest{PageURL: "https://shop.localhost/api/items"}, "api"},
		{terminalSessionRequest{Annotation: &annotationSubmitDetail{URL: "https://shop.localhost/api/items"}}, "api"},
		{terminalSessionRequest{PageURL: "https://shop.localhost/"}, "web"},
		{terminalSessionRequest{}, "web"},
	} {
		ctx, err := s.toolContext(tc.request)
		if err != nil || ctx.ProjectRootPath != tc.want {
			t.Fatalf("context = %#v, %v, want %q", ctx, err, tc.want)
		}
	}
}

func TestWorktreeQueuePausesOldSessionAndResumesInSelectedCheckout(t *testing.T) {
	configured, selected := t.TempDir(), t.TempDir()
	root := configured
	inputFile := filepath.Join(t.TempDir(), "input")
	tempDir := t.TempDir()
	action := manifest.ValidatedAnnotationAction{ID: "fix", Kind: "agent", DisplayName: "Test agent", TempDir: &tempDir, Agent: manifest.ValidatedAgent{Kind: "configured", Cwd: configured, Command: []string{"sh", "-c", `read task; printf '%s' "$task" > "$INPUT_PATH"`}, Env: map[string]string{"INPUT_PATH": inputFile}}}
	server, err := StartControlServer(StartControlServerOptions{
		ProjectRootPath: configured, PrimaryService: "web", ManifestPath: filepath.Join(configured, "devhost.toml"), StateDirectoryPath: t.TempDir(),
		GetHealthResponse: func() (HealthResponse, error) { return HealthResponse{Services: []ServiceHealth{}}, nil },
		AnnotationActions: []manifest.ValidatedAnnotationAction{action},
		FeatureToggles:    FeatureToggles{TerminalEnabled: true, AnnotationEnabled: true, AnnotationQueueEnabled: true},
		RoutedServices:    []RoutedServiceIdentity{{Host: "web.localhost", Path: "/", ServiceName: "web"}},
		GetToolContext: func(string) (ToolContext, error) {
			current := action
			current.Agent.Cwd = root
			return ToolContext{ProjectRootPath: root, AnnotationActions: []manifest.ValidatedAnnotationAction{current}}, nil
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
	annotation := annotationSubmitDetail{URL: "https://web.localhost", Comment: "First task", Markers: []annotationMarkerPayload{}}
	first, err := server.annotationQueueStore.enqueue("fix", annotation, "", nil)
	if err != nil {
		t.Fatal(err)
	}
	root = selected
	annotation.Comment = "Task for selected checkout"
	if _, err := server.annotationQueueStore.enqueue("fix", annotation, "", &first.SessionID); err != nil {
		t.Fatal(err)
	}
	err = server.annotationQueueStore.handleAgentStatus(first.SessionID, agentSessionStatusFinished)
	if err == nil || !strings.Contains(err.Error(), "previous checkout") {
		t.Fatalf("old-session handoff = %v", err)
	}
	if _, err := os.Stat(inputFile); !os.IsNotExist(err) {
		t.Fatal("new task was written into the old checkout session")
	}
	queues := server.annotationQueueStore.getSnapshot()
	if len(queues) != 1 || queues[0].Status != annotationQueueStatusPaused {
		t.Fatalf("queue after switch = %#v", queues)
	}
	resumed, err := server.annotationQueueStore.resumeQueue(queues[0].QueueID, "")
	if err != nil {
		t.Fatal(err)
	}
	server.mu.Lock()
	defer server.mu.Unlock()
	if resumed.SessionID == first.SessionID || server.terminalSessions[resumed.SessionID].projectRootPath != selected {
		t.Fatal("resume reused the previous checkout session")
	}
}
