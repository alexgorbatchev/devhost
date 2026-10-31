package devtools

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	watcher "github.com/alexgorbatchev/agent-watcher"
	"github.com/alexgorbatchev/agent-watcher/scanner"
)

func agentSession(id, cwd string, state scanner.SessionState) watcher.Session {
	return watcher.Session{Harness: watcher.HarnessClaudeCode, SessionID: id, PID: 7, CWD: cwd, State: state, Name: id, LastActivity: 100}
}

func TestReadAgentsInCheckoutFiltersToTheCheckout(t *testing.T) {
	root := t.TempDir()
	sibling := root + "-sibling"
	subagent := agentSession("subagent", root, scanner.SessionStateWorking)
	subagent.Subagent = true
	sessions := []watcher.Session{
		agentSession("root", root, scanner.SessionStateWorking),
		agentSession("nested", filepath.Join(root, "packages", "ui"), scanner.SessionStateIdle),
		agentSession("sibling", sibling, scanner.SessionStateWorking),
		agentSession("parent", filepath.Dir(root), scanner.SessionStateWorking),
		agentSession("unknown-directory", "", scanner.SessionStateWorking),
		subagent,
	}

	agents := readAgentsInCheckout(sessions, root, map[string]bool{"root": true})

	if len(agents) != 2 {
		t.Fatalf("agents = %+v, want root and nested", agents)
	}
	if agents[0].Name != "root" || agents[0].Subdirectory != "." || !agents[0].IsOwned {
		t.Fatalf("root agent = %+v", agents[0])
	}
	if agents[1].Name != "nested" || agents[1].Subdirectory != filepath.Join("packages", "ui") || agents[1].IsOwned {
		t.Fatalf("nested agent = %+v", agents[1])
	}
}

func TestReadAgentsInCheckoutFollowsASymlinkedRoot(t *testing.T) {
	physical, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(t.TempDir(), "link")
	if err := os.Symlink(physical, link); err != nil {
		t.Fatal(err)
	}
	agents := readAgentsInCheckout([]watcher.Session{agentSession("a", physical, scanner.SessionStateIdle)}, link, nil)
	if len(agents) != 1 {
		t.Fatalf("agents = %+v", agents)
	}
}

func TestReadAgentsInCheckoutListsTheAgentThatNeedsSomeoneFirst(t *testing.T) {
	root := t.TempDir()
	sessions := []watcher.Session{
		agentSession("idle", root, scanner.SessionStateIdle),
		agentSession("unknown", root, scanner.SessionStateUnknown),
		agentSession("working", root, scanner.SessionStateWorking),
		agentSession("waiting", root, scanner.SessionStateWaiting),
	}
	var names []string
	for _, agent := range readAgentsInCheckout(sessions, root, nil) {
		names = append(names, agent.Name)
	}
	if strings.Join(names, " ") != "waiting working unknown idle" {
		t.Fatalf("order = %v", names)
	}
}

func TestAgentScannerSharesAScanBetweenPages(t *testing.T) {
	calls := 0
	agents := &agentScanner{snapshot: func(context.Context) ([]watcher.Session, error) {
		calls++
		return nil, nil
	}}
	start := time.Now()
	for _, offset := range []time.Duration{0, agentScanLifetime - time.Millisecond} {
		if _, err := agents.read(context.Background(), start.Add(offset)); err != nil {
			t.Fatal(err)
		}
	}
	if calls != 1 {
		t.Fatalf("scans = %d, want 1 within the lifetime", calls)
	}
	if _, err := agents.read(context.Background(), start.Add(agentScanLifetime)); err != nil {
		t.Fatal(err)
	}
	if calls != 2 {
		t.Fatalf("scans = %d, want a new scan after the lifetime", calls)
	}
}

func requestAgents(t *testing.T, s *ControlServer, target string) (int, map[string]json.RawMessage) {
	t.Helper()
	url := fmt.Sprintf("http://127.0.0.1:%d%s%s", s.Port(), agentsPath, chatTargetQuery("", target))
	response, err := http.Get(url)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = response.Body.Close() }()
	var body map[string]json.RawMessage
	if response.StatusCode == http.StatusOK {
		if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
	}
	return response.StatusCode, body
}

func TestHandleAgentsReportsOnlyDisplayFields(t *testing.T) {
	s := startChatTargetServer(t, "", refuseChatHarness(t))
	session := agentSession("native-id", s.projectRootPath, scanner.SessionStateWaiting)
	session.TranscriptPath = "/secret/transcript.jsonl"
	s.agents.snapshot = func(context.Context) ([]watcher.Session, error) { return []watcher.Session{session}, nil }

	status, body := requestAgents(t, s, chatTargetProject)

	if status != http.StatusOK {
		t.Fatalf("status = %d", status)
	}
	text := string(body["agents"])
	if strings.Contains(text, "secret") || strings.Contains(text, `"sessionId"`) {
		t.Fatalf("response exposes more than display fields: %s", text)
	}
	if !strings.Contains(text, `"state":"waiting"`) || !strings.Contains(text, `"harness":"claude-code"`) {
		t.Fatalf("agents = %s", text)
	}
}

func TestHandleAgentsKeepsWhatAFailedScanFound(t *testing.T) {
	s := startChatTargetServer(t, "", refuseChatHarness(t))
	found := agentSession("found", s.projectRootPath, scanner.SessionStateWorking)
	s.agents.snapshot = func(context.Context) ([]watcher.Session, error) {
		return []watcher.Session{found}, errors.New("scanning codex: denied")
	}

	status, body := requestAgents(t, s, chatTargetProject)

	if status != http.StatusOK || !strings.Contains(string(body["agents"]), `"found"`) {
		t.Fatalf("status = %d, body = %s", status, body["agents"])
	}
	if strings.Contains(string(body["error"]), "denied") || len(body["error"]) == 0 {
		t.Fatalf("error = %s, want a summary without internals", body["error"])
	}
}

func TestHandleAgentsRejectsAnUnknownTarget(t *testing.T) {
	s := startChatTargetServer(t, "", refuseChatHarness(t))
	if status, _ := requestAgents(t, s, "elsewhere"); status != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", status, http.StatusBadRequest)
	}
}

func TestChatStoreOwnsOpenSessionsOnly(t *testing.T) {
	store := chatTestStore(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	session, err := store.start(ctx, chatSessionRequest{Harness: chatCodex}, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	native := session.snapshot().NativeSessionID
	if !store.ownedNativeSessionIDs()[native] {
		t.Fatal("running session is not owned")
	}
	session.close()
	if store.ownedNativeSessionIDs()[native] {
		t.Fatal("closed session is still owned")
	}
}
