package devtools

import (
	"cmp"
	"context"
	"fmt"
	"net/http"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"

	watcher "github.com/alexgorbatchev/agent-watcher"
	"github.com/alexgorbatchev/agent-watcher/scanner"
)

const (
	agentsPath = controlPathPrefix + "/agents"
	// agentScanLifetime lets pages share a scan. One covers every agent on the
	// machine, and several pages and devhost instances can be open at once.
	agentScanLifetime = 5 * time.Second
	agentScanTimeout  = 10 * time.Second
)

// runningAgent is what a page may know about an agent. The control server answers
// on the page's own origin, so page scripts can read this: it leaves out transcript
// paths and the native session ID that would let a request resume the session.
type runningAgent struct {
	Key          string `json:"key"`
	Harness      string `json:"harness"`
	State        string `json:"state"`
	Name         string `json:"name,omitempty"`
	Subdirectory string `json:"subdirectory"`
	LastActivity int64  `json:"lastActivity"`
	IsOwned      bool   `json:"isOwned"`
}

type agentSnapshotFunc func(context.Context) ([]watcher.Session, error)

// agentScanner scans on demand, so nothing runs while no page asks.
type agentScanner struct {
	snapshot agentSnapshotFunc
	mu       sync.Mutex
	scanned  time.Time
	sessions []watcher.Session
	err      error
}

func newAgentScanner() *agentScanner {
	agents := &agentScanner{}
	var once sync.Once
	var snapshotter *watcher.Snapshotter
	var createErr error
	agents.snapshot = func(ctx context.Context) ([]watcher.Session, error) {
		// Reused so its file caches keep later scans cheap.
		once.Do(func() { snapshotter, createErr = watcher.NewSnapshotter(watcher.Config{}) })
		if createErr != nil {
			return nil, createErr
		}
		return snapshotter.Snapshot(ctx)
	}
	return agents
}

func (a *agentScanner) read(ctx context.Context, now time.Time) ([]watcher.Session, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if !a.scanned.IsZero() && now.Sub(a.scanned) < agentScanLifetime {
		return a.sessions, a.err
	}
	ctx, cancel := context.WithTimeout(ctx, agentScanTimeout)
	defer cancel()
	a.sessions, a.err = a.snapshot(ctx)
	a.scanned = now
	return a.sessions, a.err
}

// readAgentsInCheckout keeps the top-level sessions working in root, including its
// subdirectories. Subagents belong to the session that started them.
func readAgentsInCheckout(sessions []watcher.Session, root string, ownedSessionIDs map[string]bool) []runningAgent {
	resolvedRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		resolvedRoot = root
	}
	agents := []runningAgent{}
	for _, session := range sessions {
		if session.Subagent || session.CWD == "" {
			continue
		}
		relative, err := filepath.Rel(resolvedRoot, session.CWD)
		if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
			continue
		}
		agents = append(agents, runningAgent{
			Key:     fmt.Sprintf("%s:%d", session.Harness, session.PID),
			Harness: string(session.Harness), State: string(session.State), Name: session.Name,
			Subdirectory: relative, LastActivity: session.LastActivity, IsOwned: ownedSessionIDs[session.SessionID],
		})
	}
	slices.SortFunc(agents, func(a, b runningAgent) int {
		return cmp.Or(cmp.Compare(agentStateRank(a.State), agentStateRank(b.State)), cmp.Compare(b.LastActivity, a.LastActivity), cmp.Compare(a.Key, b.Key))
	})
	return agents
}

// agentStateRank lists an agent that needs someone first, and a quiet one last.
func agentStateRank(state string) int {
	switch scanner.SessionState(state) {
	case scanner.SessionStateWaiting:
		return 0
	case scanner.SessionStateWorking:
		return 1
	case scanner.SessionStateIdle:
		return 3
	default:
		return 2
	}
}

func (s *chatStore) ownedNativeSessionIDs() map[string]bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	owned := make(map[string]bool, len(s.sessions))
	for _, session := range s.sessions {
		info := session.snapshot()
		if info.Status != "closed" && info.NativeSessionID != "" {
			owned[info.NativeSessionID] = true
		}
	}
	return owned
}

func (s *ControlServer) handleAgents(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	root, err := s.chatQueryRoot(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	// A harness that fails to scan does not hide the agents the others found.
	sessions, err := s.agents.read(r.Context(), time.Now())
	response := map[string]any{"agents": readAgentsInCheckout(sessions, root, s.chat.ownedNativeSessionIDs())}
	if err != nil {
		response["error"] = "Some agents could not be listed."
		s.chat.logAgentScanFailure(err)
	}
	chatJSON(w, response)
}

func (s *chatStore) logAgentScanFailure(err error) {
	if s.log != nil {
		s.log(fmt.Sprintf("running agents scan failed error=%q", chatLogError(err)))
	}
}
