package devtools

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestChatSessionsStayWithinResolvedProject(t *testing.T) {
	s := startChatControlServer(t)
	fixture := chatTestStore(t)
	s.chat.command = fixture.command
	firstRoot, secondRoot := s.projectRootPath, t.TempDir()
	var current atomic.Value
	current.Store(firstRoot)
	s.getToolContext = func(string) (ToolContext, error) { return ToolContext{ProjectRootPath: current.Load().(string)}, nil }
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	first, err := s.chat.start(ctx, chatSessionRequest{Harness: chatClaude}, firstRoot)
	if err != nil {
		t.Fatal(err)
	}
	second, err := s.chat.start(ctx, chatSessionRequest{Harness: chatCodex}, secondRoot)
	if err != nil {
		t.Fatal(err)
	}
	base := fmt.Sprintf("http://127.0.0.1:%d", s.Port())
	pageURL := "https://shop.localhost/page"
	query := chatTargetQuery(pageURL, chatTargetProject)
	t.Run("lists only selected project", func(t *testing.T) {
		for _, item := range []struct{ root, id string }{{firstRoot, first.snapshot().ID}, {secondRoot, second.snapshot().ID}} {
			current.Store(item.root)
			response := mustGet(t, base+chatSessionsPath+query)
			var result struct {
				Sessions []chatSessionInfo `json:"sessions"`
			}
			if err := json.Unmarshal([]byte(readResponseText(t, response)), &result); err != nil {
				t.Fatal(err)
			}
			if len(result.Sessions) != 1 || result.Sessions[0].ID != item.id {
				t.Fatalf("project sessions=%+v", result.Sessions)
			}
		}
	})
	current.Store(firstRoot)
	t.Run("rejects cross project websocket", func(t *testing.T) {
		address := "ws" + strings.TrimPrefix(base, "http") + chatWebsocketPath + query + "&sessionId=" + second.snapshot().ID
		conn, response, err := websocket.DefaultDialer.Dial(address, http.Header{"Origin": []string{base}})
		if conn != nil {
			defer conn.Close()
		}
		if response != nil {
			defer response.Body.Close()
		}
		if err == nil || response == nil || response.StatusCode != http.StatusNotFound {
			t.Fatalf("cross-project attach response=%v error=%v", response, err)
		}
	})
	t.Run("rejects cross project close", func(t *testing.T) {
		request, err := http.NewRequest(http.MethodPost, base+chatSessionsPath+"/"+second.snapshot().ID+chatSessionCloseSuffix+query, nil)
		if err != nil {
			t.Fatal(err)
		}
		request.Header.Set("Origin", base)
		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		if response.StatusCode != http.StatusNotFound || second.snapshot().Status == "closed" {
			t.Fatalf("cross-project close status=%d session=%+v", response.StatusCode, second.snapshot())
		}
	})
	t.Run("rejects known native history from another project", func(t *testing.T) {
		body, err := json.Marshal(chatSessionRequest{Harness: chatCodex, PageURL: pageURL, Target: chatTargetProject, ResumeID: second.snapshot().NativeSessionID})
		if err != nil {
			t.Fatal(err)
		}
		request, err := http.NewRequest(http.MethodPost, base+chatSessionsPath, strings.NewReader(string(body)))
		if err != nil {
			t.Fatal(err)
		}
		request.Header.Set("Origin", base)
		request.Header.Set("Content-Type", jsonMediaType)
		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		if response.StatusCode != http.StatusForbidden {
			t.Fatalf("cross-project resume=%d", response.StatusCode)
		}
	})
	t.Run("rechecks project after a checkout switch on an attached socket", func(t *testing.T) {
		current.Store(secondRoot)
		address := "ws" + strings.TrimPrefix(base, "http") + chatWebsocketPath + query + "&sessionId=" + second.snapshot().ID
		conn, _, err := websocket.DefaultDialer.Dial(address, http.Header{"Origin": []string{base}})
		if err != nil {
			t.Fatal(err)
		}
		defer conn.Close()
		if err := conn.SetReadDeadline(time.Now().Add(3 * time.Second)); err != nil {
			t.Fatal(err)
		}
		var snapshot chatMessage
		if err := conn.ReadJSON(&snapshot); err != nil {
			t.Fatal(err)
		}
		if snapshot.Type != "snapshot" {
			t.Fatalf("same-project attach=%+v", snapshot)
		}
		current.Store(firstRoot)
		if err := conn.WriteJSON(chatCommand{Type: "send", CommandID: "stale-project-send", Text: "Do not enter the other checkout"}); err != nil {
			t.Fatal(err)
		}
		result := readChatAckTest(t, conn)
		if result.Type != "command_result" || result.CommandID != "stale-project-send" || result.Error != "Chat session belongs to a different project." {
			t.Fatalf("stale-project result=%+v", result)
		}
		if second.snapshot().Status != "idle" {
			t.Fatal("A stale socket started a native turn in the old checkout")
		}
	})
}
