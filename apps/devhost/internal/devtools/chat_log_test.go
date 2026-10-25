package devtools

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

type chatLogRecorder struct {
	mu    sync.Mutex
	lines []string
}

func (r *chatLogRecorder) log(line string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.lines = append(r.lines, line)
}

func (r *chatLogRecorder) text() string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return strings.Join(r.lines, "\n")
}

func waitChatLog(t *testing.T, recorder *chatLogRecorder, text string) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for !strings.Contains(recorder.text(), text) {
		if time.Now().After(deadline) {
			t.Fatalf("missing %q in logs:\n%s", text, recorder.text())
		}
		time.Sleep(time.Millisecond)
	}
}

func TestChatActivityLogging(t *testing.T) {
	for _, harness := range []string{chatCodex, chatClaude} {
		t.Run(harness, func(t *testing.T) {
			store := chatTestStore(t)
			logs := &chatLogRecorder{}
			store.log = logs.log
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			session, err := store.start(ctx, chatSessionRequest{Harness: harness, Model: "chosen-model", ResumeID: "history"}, t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			respond := func(id string) {
				t.Helper()
				if err := session.execute(ctx, chatCommand{Type: "respond", RequestID: json.RawMessage(id), Result: json.RawMessage(`{"decision":"decline","behavior":"deny","message":"PRIVATE_RESPONSE"}`)}); err != nil {
					t.Fatal(err)
				}
			}
			if harness == chatClaude {
				respond(`"inherited"`)
			}
			if err := session.execute(ctx, chatCommand{Type: "send", CommandID: "message-one", Text: "PRIVATE_PROMPT"}); err != nil {
				t.Fatal(err)
			}
			waitChatLog(t, logs, "turn started")
			var frames []string
			var want []string
			if harness == chatCodex {
				respond(`"approval-one"`)
				frames = []string{
					`{"method":"item/started","params":{"item":{"id":"tool-one","type":"commandExecution","cwd":"/project","command":"PRIVATE_COMMAND"}}}`,
					`{"method":"item/completed","params":{"item":{"id":"tool-one","type":"commandExecution","status":"completed","exitCode":7,"durationMs":12,"aggregatedOutput":"PRIVATE_OUTPUT"}}}`,
					`{"method":"thread/tokenUsage/updated","params":{"turnId":"turn-one","tokenUsage":{"last":{"inputTokens":30,"cachedInputTokens":10,"outputTokens":12,"reasoningOutputTokens":4,"totalTokens":42}}}}`,
					`{"method":"error","params":{"turnId":"turn-one","willRetry":true,"error":{"message":"PRIVATE_ERROR"}}}`,
					`{"method":"turn/completed","params":{"turn":{"id":"turn-one","status":"failed"}}}`,
				}
				want = []string{`kind="item/commandExecution/requestApproval"`, `path="/project"`, "exit=7", "duration=12ms", "input=30 cached_input=10 output=12 reasoning_output=4 total=42", "native error", "retry=true"}
			} else {
				frames = []string{
					`{"type":"stream_event","event":{"type":"content_block_start","content_block":{"type":"tool_use","id":"tool-one","name":"Read","input":{}}}}`,
					`{"type":"assistant","message":{"model":"chosen-model","content":[{"type":"tool_use","id":"tool-one","name":"Read","input":{"file_path":"/project/file.ts","extra":"PRIVATE_ARGUMENT"}}]}}`,
					`{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"tool-one","is_error":true,"content":"PRIVATE_OUTPUT"}]}}`,
					`{"type":"result","is_error":true,"result":"PRIVATE_REPLY","duration_ms":1250,"usage":{"input_tokens":30,"output_tokens":12,"cache_read_input_tokens":10,"cache_creation_input_tokens":2},"total_cost_usd":0.012345}`,
				}
				want = []string{`kind="can_use_tool"`, `path="/project/file.ts"`, `native model="chosen-model"`, "input=30 output=12 cache_read=10 cache_write=2", "estimate_usd=0.012345", `native duration turn="local-1" duration=1.25s`}
			}
			for _, frame := range frames {
				session.receive(json.RawMessage(frame))
			}
			if err := session.execute(ctx, chatCommand{Type: "send", CommandID: "message-two", Text: "PRIVATE_FOLLOWUP"}); err != nil {
				t.Fatal(err)
			}
			if harness == chatCodex {
				respond(`"approval-one"`)
			}
			if err := session.execute(ctx, chatCommand{Type: "interrupt"}); err != nil {
				t.Fatal(err)
			}
			session.close()
			want = append(want, "session resumed", "session closed", `command="message-one"`, "message accepted", "mode=new_turn", "turn failed", "turn interrupted", "tool started", "tool failed", "response received", "waited=", `model="chosen-model"`, `session="`+session.info.ID+`"`)
			text := logs.text()
			for _, expected := range want {
				if !strings.Contains(text, expected) {
					t.Errorf("missing %q in logs:\n%s", expected, text)
				}
			}
			if strings.Contains(text, "PRIVATE_") {
				t.Errorf("chat contents leaked into logs:\n%s", text)
			}
			if count := strings.Count(text, "tool started"); count != 1 {
				t.Errorf("streamed and complete tool blocks logged %d starts", count)
			}
		})
	}
}

func TestChatQuietHeartbeat(t *testing.T) {
	logs := &chatLogRecorder{}
	now := time.Now()
	session := &chatSession{info: chatSessionInfo{ID: "heartbeat", Harness: chatCodex, Status: "running"}, pending: map[string]json.RawMessage{}}
	session.activity.log = logs.log
	session.startTurnLocked(now, "turn")
	session.startToolLocked(now, "tool", "Read", "file.go")
	session.heartbeat(now.Add(chatHeartbeatInterval - time.Millisecond))
	if strings.Contains(logs.text(), "still working") {
		t.Fatal("heartbeat before quiet interval")
	}
	session.heartbeat(now.Add(chatHeartbeatInterval))
	session.heartbeat(now.Add(chatHeartbeatInterval + time.Second))
	if count := strings.Count(logs.text(), "still working"); count != 1 {
		t.Fatalf("heartbeats=%d", count)
	}
	if !strings.Contains(logs.text(), `tools="Read"`) {
		t.Fatal(logs.text())
	}
	session.activity.lastEvent = now.Add(2*chatHeartbeatInterval - time.Second)
	session.heartbeat(now.Add(2 * chatHeartbeatInterval))
	if count := strings.Count(logs.text(), "still working"); count != 1 {
		t.Fatal("native traffic did not suppress heartbeat")
	}
	session.info.Status = "requires_action"
	session.heartbeat(now.Add(3 * chatHeartbeatInterval))
	session.finishTurnLocked(now.Add(3*chatHeartbeatInterval), "completed")
	session.heartbeat(now.Add(4 * chatHeartbeatInterval))
	if count := strings.Count(logs.text(), "still working"); count != 2 {
		t.Fatalf("heartbeats=%d", count)
	}
}

func TestChatQuietDispatchAndLateTurnStart(t *testing.T) {
	logs := &chatLogRecorder{}
	now := time.Now()
	session := &chatSession{
		info: chatSessionInfo{Harness: chatClaude, Status: "running"},
		activity: chatActivity{
			log: logs.log, dispatched: now, lastEvent: now, lastHeartbeat: now,
			turn: "local-1", turnSequence: 1, interrupted: true,
		},
	}
	session.heartbeat(now.Add(chatHeartbeatInterval))
	if !strings.Contains(logs.text(), `still working turn="local-1"`) {
		t.Fatal("no heartbeat while waiting for native turn start:", logs.text())
	}
	// A native start can arrive after an interrupt acknowledgement. It must
	// preserve the pending interruption and the local turn's correlation ID.
	session.logClaudeFrameLocked(now.Add(chatHeartbeatInterval), chatNativeFrame{Type: "stream_event"}, json.RawMessage(`{"event":{"type":"message_start"}}`))
	session.logClaudeFrameLocked(now.Add(chatHeartbeatInterval+time.Second), chatNativeFrame{Type: "result"}, json.RawMessage(`{}`))
	session.heartbeat(now.Add(3 * chatHeartbeatInterval))
	if text := logs.text(); !strings.Contains(text, `turn interrupted turn="local-1"`) || strings.Count(text, "still working") != 1 {
		t.Fatal(text)
	}
	// A later autonomous native turn gets its own local identifier.
	session.startTurnLocked(now.Add(4*chatHeartbeatInterval), "")
	if session.activity.turn != "local-2" {
		t.Fatalf("reused completed turn identifier: %s", session.activity.turn)
	}
}

func TestChatLogErrorPrivacyAndBounds(t *testing.T) {
	for _, err := range []error{
		&chatNativeError{payload: json.RawMessage(`{"code":-32602,"message":"PRIVATE_PROMPT"}`)},
		&chatNativeError{payload: json.RawMessage(`"PRIVATE_REPLY"`)},
		&chatInputRejectedError{result: json.RawMessage(`"PRIVATE_REPLY"`)},
		context.DeadlineExceeded,
		context.Canceled,
	} {
		if text := chatLogError(err); text == "" || strings.Contains(text, "PRIVATE_") {
			t.Errorf("unsafe error log: %q", text)
		}
	}
	logs := &chatLogRecorder{}
	session := &chatSession{activity: chatActivity{log: logs.log}}
	session.logLocked("tool path=%q", strings.Repeat("long/path/", chatLogLineLimit))
	if len(logs.text()) > chatLogLineLimit+len("…") {
		t.Fatal("unbounded native metadata in retained logs")
	}
}

func TestChatLogsReachTerminalAndBrowser(t *testing.T) {
	s := startChatControlServer(t, chatHelperCommand(t))
	logs := &chatLogRecorder{}
	s.onLog = logs.log
	session, err := s.chat.start(context.Background(), chatSessionRequest{Harness: chatCodex}, s.projectRootPath)
	if err != nil {
		t.Fatal(err)
	}
	base := fmt.Sprintf("http://127.0.0.1:%d", s.Port())
	url := "ws" + strings.TrimPrefix(base, "http") + chatWebsocketPath + chatTargetQuery("", chatTargetProject) + "&sessionId=" + session.snapshot().ID
	conn, _, err := websocket.DefaultDialer.Dial(url, http.Header{"Origin": []string{base}})
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if err := conn.SetReadDeadline(time.Now().Add(5 * time.Second)); err != nil {
		t.Fatal(err)
	}
	var snapshot chatMessage
	if err := conn.ReadJSON(&snapshot); err != nil {
		t.Fatal(err)
	}
	for _, command := range []chatCommand{
		{Type: "send", CommandID: "delivered", Text: "PRIVATE_PROMPT"},
		{Type: "send", CommandID: "invalid"},
	} {
		if err := conn.WriteJSON(command); err != nil {
			t.Fatal(err)
		}
		for {
			var message chatMessage
			if err := conn.ReadJSON(&message); err != nil {
				t.Fatal(err)
			}
			if message.Type == "command_result" && message.CommandID == command.CommandID {
				break
			}
		}
	}
	for _, expected := range []string{"session started", "message queued", "message dequeued", "message accepted", "message rejected"} {
		if !strings.Contains(logs.text(), expected) {
			t.Errorf("missing terminal event %q: %s", expected, logs.text())
		}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.retainedLogEntries) == 0 {
		t.Fatal("chat activity missing from browser log replay")
	}
	for _, entry := range s.retainedLogEntries {
		if entry.ServiceName != "chat" || !strings.Contains(logs.text(), entry.Line) || strings.Contains(entry.Line, "PRIVATE_") {
			t.Errorf("browser log=%+v", entry)
		}
	}
}

func TestChatProcessFailuresAreLogged(t *testing.T) {
	for _, failure := range []string{"startup", "protocol"} {
		t.Run(failure, func(t *testing.T) {
			store := chatTestStore(t)
			logs := &chatLogRecorder{}
			store.log = logs.log
			factory := store.command
			store.command = func(ctx context.Context, name string, args ...string) *exec.Cmd {
				if failure == "startup" {
					return &exec.Cmd{Err: os.ErrNotExist}
				}
				cmd := factory(ctx, name, args...)
				cmd.Env = append(cmd.Env, "DEVHOST_CHAT_BAD_PROTOCOL=1")
				return cmd
			}
			session, err := store.start(context.Background(), chatSessionRequest{Harness: chatCodex}, t.TempDir())
			if failure == "startup" {
				if err == nil {
					t.Fatal("missing startup failure")
				}
				waitChatLog(t, logs, "session startup failed")
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			if err := session.execute(ctx, chatCommand{Type: "send", Text: "PRIVATE_PROMPT"}); err == nil {
				t.Fatal("malformed protocol accepted")
			}
			waitChatLog(t, logs, "process failed")
			if !strings.Contains(logs.text(), "read codex protocol") || !strings.Contains(logs.text(), "fixture diagnostic") {
				t.Fatal(logs.text())
			}
			for _, line := range strings.Split(logs.text(), "\n") {
				if len(line) > chatLogLineLimit+len("…") {
					t.Fatal("unbounded process diagnostics")
				}
			}
		})
	}
}
