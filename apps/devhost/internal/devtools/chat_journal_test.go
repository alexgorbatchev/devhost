package devtools

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestChatJournalStreamsCompleteReplayAndReclaimsStorage(t *testing.T) {
	s := startChatControlServer(t, chatHelperCommand(t))
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	session, err := s.chat.start(ctx, chatSessionRequest{Harness: chatCodex}, s.projectRootPath)
	if err != nil {
		t.Fatal(err)
	}
	initial := session.events.sequence
	const count = 1024
	text := strings.Repeat("native text ", 1024)
	for i := range count {
		raw, err := json.Marshal(map[string]any{"type": "fixture_history", "index": i, "text": text})
		if err != nil {
			t.Fatal(err)
		}
		session.receive(raw)
	}
	file := session.events.file
	stat, err := file.Stat()
	if err != nil {
		t.Fatal(err)
	}
	if stat.Size() < int64(len(text)*count) || stat.Mode().Perm() != 0o600 {
		t.Fatalf("replay storage: size=%d permissions=%o", stat.Size(), stat.Mode().Perm())
	}
	if _, err := os.Stat(file.Name()); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("temporary transcript still has a directory entry: %v", err)
	}
	base := fmt.Sprintf("http://127.0.0.1:%d", s.Port())
	url := "ws" + strings.TrimPrefix(base, "http") + chatWebsocketPath + chatTargetQuery("", chatTargetProject) + "&sessionId=" + session.snapshot().ID
	conn, _, err := websocket.DefaultDialer.Dial(url, http.Header{"Origin": []string{base}})
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if err := conn.SetReadDeadline(time.Now().Add(10 * time.Second)); err != nil {
		t.Fatal(err)
	}
	var replay chatMessage
	if err := conn.ReadJSON(&replay); err != nil {
		t.Fatal(err)
	}
	if replay.Type != "snapshot" || len(replay.Events) != int(initial)+count {
		t.Fatalf("replay events=%d, initial=%d", len(replay.Events), initial)
	}
	for i, event := range replay.Events[int(initial):] {
		var frame struct {
			Index int    `json:"index"`
			Text  string `json:"text"`
		}
		if err := json.Unmarshal(event.Payload, &frame); err != nil {
			t.Fatal(err)
		}
		if event.Sequence != initial+uint64(i)+1 || frame.Index != i || frame.Text != text {
			t.Fatalf("history changed at event %d", i)
		}
	}
	// Live publication follows the streamed snapshot on the same socket.
	session.receive(json.RawMessage(`{"type":"fixture_after_snapshot"}`))
	var live chatMessage
	if err := conn.ReadJSON(&live); err != nil {
		t.Fatal(err)
	}
	if live.Type != "event" || live.Sequence != initial+count+1 {
		t.Fatalf("live ordering: %+v", live)
	}
	session.close()
	if _, err := file.Stat(); err != nil {
		t.Fatalf("closing a conversation discarded replay: %v", err)
	}
	if _, err := s.chat.start(ctx, chatSessionRequest{Harness: chatCodex, ResumeID: session.snapshot().NativeSessionID}, s.projectRootPath); err != nil {
		t.Fatal(err)
	}
	if _, err := file.Stat(); !errors.Is(err, os.ErrClosed) {
		t.Fatalf("resuming kept superseded replay storage open: %v", err)
	}
	if err := s.Stop(); err != nil {
		t.Fatal(err)
	}
	for _, remaining := range s.chat.sessions {
		if remaining.events.file != nil {
			t.Fatal("shutdown retained an open replay descriptor")
		}
	}
}

func TestChatJournalFailureStopsTheNativeSession(t *testing.T) {
	store := chatTestStore(t)
	logs := &chatLogRecorder{}
	store.log = logs.log
	session, err := store.start(context.Background(), chatSessionRequest{Harness: chatCodex}, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	session.mu.Lock()
	err = session.events.file.Close()
	session.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	session.receive(json.RawMessage(`{"type":"fixture_disk_failure"}`))
	select {
	case <-session.process.done:
	case <-time.After(5 * time.Second):
		t.Fatal("replay failure left native process running")
	}
	store.wg.Wait()
	if info := session.snapshot(); info.Status != "error" || !strings.Contains(info.Error, "retain chat replay") {
		t.Fatalf("replay failure state=%+v", info)
	}
	if !strings.Contains(logs.text(), "replay failed") {
		t.Fatal(logs.text())
	}
}
