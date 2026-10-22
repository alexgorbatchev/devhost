package devtools

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os/exec"
	"strings"
	"testing"
	"time"
)

const chatClosedTestPageURL = "https://shop.localhost/page"

// postChatTestSession sends a page's chat request to path and returns the session record it answers with.
func postChatTestSession(t *testing.T, base, path string, body io.Reader) chatSessionInfo {
	t.Helper()
	request, err := http.NewRequest(http.MethodPost, base+path, body)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Origin", base)
	if body != nil {
		request.Header.Set("Content-Type", jsonMediaType)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	text := readResponseText(t, response)
	if response.StatusCode != http.StatusOK {
		t.Fatalf("POST %s status=%d body=%s", path, response.StatusCode, text)
	}
	var session chatSessionInfo
	if err := json.Unmarshal([]byte(text), &session); err != nil {
		t.Fatal(err)
	}
	return session
}

// startChatTestSession starts a project conversation through the page route, resuming resumeID when it is set.
func startChatTestSession(t *testing.T, base, harness, resumeID string) chatSessionInfo {
	t.Helper()
	body, err := json.Marshal(chatSessionRequest{Harness: harness, PageURL: chatClosedTestPageURL, Target: chatTargetProject, ResumeID: resumeID})
	if err != nil {
		t.Fatal(err)
	}
	return postChatTestSession(t, base, chatSessionsPath, strings.NewReader(string(body)))
}

func listChatTestSessions(t *testing.T, base string) []chatSessionInfo {
	t.Helper()
	var listed struct {
		Sessions []chatSessionInfo `json:"sessions"`
	}
	query := chatTargetQuery(chatClosedTestPageURL, chatTargetProject)
	if err := json.Unmarshal([]byte(readResponseText(t, mustGet(t, base+chatSessionsPath+query))), &listed); err != nil {
		t.Fatal(err)
	}
	return listed.Sessions
}

// Closing a conversation stops its native process but keeps the conversation, so a page can still list and
// resume it.
func TestChatCloseKeepsTheConversation(t *testing.T) {
	s := startChatControlServer(t)
	s.chat.command = chatTestStore(t).command
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	session, err := s.chat.start(ctx, chatSessionRequest{Harness: chatCodex}, s.projectRootPath)
	if err != nil {
		t.Fatal(err)
	}
	base := fmt.Sprintf("http://127.0.0.1:%d", s.Port())
	query := chatTargetQuery(chatClosedTestPageURL, chatTargetProject)
	closed := postChatTestSession(t, base, chatSessionsPath+"/"+session.snapshot().ID+chatSessionCloseSuffix+query, nil)
	if closed.ID != session.snapshot().ID || closed.Status != "closed" {
		t.Fatalf("closed session=%+v", closed)
	}
	select {
	case <-session.process.done:
	case <-ctx.Done():
		t.Fatal("native process still running after close")
	}
	if listed := listChatTestSessions(t, base); len(listed) != 1 || listed[0].ID != closed.ID || listed[0].Status != "closed" {
		t.Fatalf("listed sessions after close=%+v", listed)
	}
}

// Resuming a closed conversation continues it in a new session, which replaces the closed record: the list keeps one
// record for the conversation, and it carries the native session ID from the start.
func TestChatResumeReplacesTheClosedConversation(t *testing.T) {
	s := startChatControlServer(t)
	s.chat.command = chatTestStore(t).command
	base := fmt.Sprintf("http://127.0.0.1:%d", s.Port())
	query := chatTargetQuery(chatClosedTestPageURL, chatTargetProject)
	started := startChatTestSession(t, base, chatCodex, "")
	closed := postChatTestSession(t, base, chatSessionsPath+"/"+started.ID+chatSessionCloseSuffix+query, nil)
	if closed.NativeSessionID == "" {
		t.Fatalf("closed session has no native ID: %+v", closed)
	}
	other := startChatTestSession(t, base, chatCodex, "")
	resumed := startChatTestSession(t, base, chatCodex, closed.NativeSessionID)
	listed := listChatTestSessions(t, base)
	ids := make([]string, 0, len(listed))
	for _, session := range listed {
		ids = append(ids, session.ID)
		if session.ID == resumed.ID && (session.Status == "closed" || session.NativeSessionID != closed.NativeSessionID) {
			t.Fatalf("resumed session=%+v", session)
		}
	}
	if len(listed) != 2 || !strings.Contains(strings.Join(ids, " "), resumed.ID) || !strings.Contains(strings.Join(ids, " "), other.ID) {
		t.Fatalf("listed sessions after resume=%v, want %s and %s", ids, other.ID, resumed.ID)
	}

	// Claude Code reports its native ID with its first frames; a resumed session already knows it.
	claude := startChatTestSession(t, base, chatClaude, "claude-history")
	if claude.NativeSessionID != "claude-history" {
		t.Fatalf("resumed Claude session native ID=%q", claude.NativeSessionID)
	}
}

func TestChatClosedStateSurvivesFinalNativeProcessFrames(t *testing.T) {
	for _, harness := range []string{chatCodex, chatClaude} {
		t.Run(harness, func(t *testing.T) {
			store := chatTestStore(t)
			factory := store.command
			store.command = func(ctx context.Context, name string, args ...string) *exec.Cmd {
				command := factory(ctx, name, args...)
				command.Env = append(command.Env, "DEVHOST_CHAT_FINAL_FRAME_ON_STOP=1", "DEVHOST_CHAT_FINAL_HARNESS="+harness)
				return command
			}
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			session, err := store.start(ctx, chatSessionRequest{Harness: harness}, t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			session.close()
			if actual := session.snapshot().Status; actual != "closed" {
				t.Fatalf("Final native process frame changed closed state to %s", actual)
			}
			session.mu.Lock()
			defer session.mu.Unlock()
			if len(session.events) == 0 {
				t.Fatal("The final native frame was lost")
			}
			var final chatNativeFrame
			if err := json.Unmarshal(session.events[len(session.events)-1].Payload, &final); err != nil {
				t.Fatal(err)
			}
			if harness == chatCodex && final.Method != "turn/completed" {
				t.Fatalf("Final Codex frame=%s", session.events[len(session.events)-1].Payload)
			}
			if harness == chatClaude && (final.Type != "result" || session.info.NativeSessionID != "closed-native-session") {
				t.Fatalf("Final Claude identity/result lost: %+v", session.info)
			}
		})
	}
}
