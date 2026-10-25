package devtools

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"io"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"slices"
	"strings"
	"syscall"
	"testing"
	"time"
)

// This is an actual child process exercising both installed-client wire formats.
func TestChatHarnessHelperProcess(t *testing.T) {
	if os.Getenv("DEVHOST_CHAT_HELPER") != "1" {
		return
	}
	if os.Getenv("DEVHOST_CHAT_FINAL_FRAME_ON_STOP") == "1" {
		stopping := make(chan os.Signal, 1)
		signal.Notify(stopping, syscall.SIGTERM)
		go func() {
			<-stopping
			var final any = map[string]any{"method": "turn/completed", "params": map[string]any{"turn": map[string]string{"id": "late-turn", "status": "interrupted"}}}
			if os.Getenv("DEVHOST_CHAT_FINAL_HARNESS") == chatClaude {
				final = map[string]any{"type": "result", "session_id": "closed-native-session", "subtype": "success", "is_error": false}
			}
			if err := json.NewEncoder(os.Stdout).Encode(final); err != nil {
				os.Exit(11)
			}
			os.Exit(0)
		}()
	}
	if os.Getenv("DEVHOST_CHAT_IGNORE_TERM") == "1" {
		signal.Ignore(syscall.SIGTERM)
		if _, err := os.Stdout.WriteString("{\"type\":\"fixture_ready\"}\n"); err != nil {
			os.Exit(10)
		}
		for {
			time.Sleep(time.Hour)
		}
	}
	decoder := json.NewDecoder(os.Stdin)
	var delayedUser *chatNativeFrame
	encoder := json.NewEncoder(os.Stdout)
	write := func(value any) {
		if err := encoder.Encode(value); err != nil {
			os.Exit(2)
		}
	}
	for {
		var frame chatNativeFrame
		if err := decoder.Decode(&frame); err != nil {
			if err == io.EOF {
				if os.Getenv("DEVHOST_CHAT_FINAL_FRAME_ON_STOP") == "1" {
					select {}
				}
				return
			}
			os.Exit(3)
		}
		if frame.Method != "" {
			var params map[string]json.RawMessage
			if len(frame.Params) > 0 && json.Unmarshal(frame.Params, &params) != nil {
				os.Exit(4)
			}
			var result any = map[string]any{}
			switch frame.Method {
			case "initialize":
				result = map[string]any{"serverInfo": "fixture"}
			case "config/read":
				result = map[string]any{"config": map[string]any{"model": "configured-codex"}}
				if os.Getenv("DEVHOST_CHAT_UNSET_MODEL") == "1" {
					result = map[string]any{"config": map[string]any{"model": nil}}
				}
			case "model/list":
				cursor := params["cursor"]
				next := any("page2")
				id := "native-first"
				if len(cursor) > 0 {
					next = nil
					id = "native-second"
				}
				result = map[string]any{"data": []any{map[string]any{"id": "catalog-row", "model": id, "isDefault": len(cursor) == 0, "displayName": "Native model", "description": "native description", "inputModalities": []string{"text", "image"}}}, "nextCursor": next}
			case "thread/start", "thread/resume":
				cwd, err := os.Getwd()
				if err != nil {
					os.Exit(5)
				}
				result = map[string]any{"thread": map[string]any{"id": "codex-session", "cwd": cwd}, "params": params}
			case "turn/start":
				if os.Getenv("DEVHOST_CHAT_BAD_PROTOCOL") == "1" {
					if _, err := os.Stderr.WriteString(strings.Repeat("fixture diagnostic ", chatDiagnosticLimit)); err != nil {
						os.Exit(12)
					}
					if _, err := os.Stdout.WriteString("{invalid native JSON}\n"); err != nil {
						os.Exit(13)
					}
					os.Exit(14)
				}
				if os.Getenv("DEVHOST_CHAT_REJECT_TURN") == "1" {
					write(map[string]any{"id": frame.ID, "error": map[string]any{"code": -32602, "message": "Native turn rejected"}})
					continue
				}
				write(map[string]any{"type": "fixture_model", "model": params["model"]})
				write(map[string]any{"method": "turn/started", "params": map[string]any{"threadId": "codex-session", "turn": map[string]string{"id": "turn-one"}}})
				write(map[string]any{"id": "approval-one", "method": "item/commandExecution/requestApproval", "params": map[string]string{"threadId": "codex-session", "turnId": "turn-one"}})
				result = map[string]any{"turn": map[string]string{"id": "turn-one"}, "input": params["input"]}
			case "turn/steer":
				if outcome := os.Getenv("DEVHOST_CHAT_STEER_FINISH"); outcome != "" {
					status := "completed"
					if outcome == "failed" {
						status = "failed"
					}
					write(map[string]any{"method": "serverRequest/resolved", "params": map[string]string{"requestId": "approval-one"}})
					write(map[string]any{"method": "turn/completed", "params": map[string]any{"turn": map[string]string{"id": "turn-one", "status": status}}})
					write(map[string]any{"id": frame.ID, "error": map[string]any{"code": -32600, "message": "No active turn"}})
					continue
				}
				if string(params["expectedTurnId"]) != `"turn-one"` || params["model"] != nil {
					os.Exit(11)
				}
				write(map[string]any{"type": "fixture_steer", "input": params["input"]})
				result = map[string]any{"turnId": "turn-one"}
			case "turn/interrupt":
				write(map[string]any{"method": "turn/completed", "params": map[string]any{"turn": map[string]string{"id": "turn-one", "status": "interrupted"}}})
			case "initialized":
				continue
			default:
				os.Exit(6)
			}
			write(map[string]any{"id": frame.ID, "result": result})
			continue
		}
		if frame.Type == "control_request" {
			var request struct {
				Subtype string `json:"subtype"`
			}
			if json.Unmarshal(frame.Request, &request) != nil {
				os.Exit(7)
			}
			result := map[string]any{}
			response := map[string]any{"subtype": "success", "request_id": frame.RequestID, "response": result}
			switch request.Subtype {
			case "initialize":
				result["models"] = []any{map[string]any{"value": "native-claude", "displayName": "Native Claude", "description": "native description", "supportsEffort": true}}
				response["pending_permission_requests"] = []any{map[string]any{"type": "control_request", "request_id": "inherited", "request": map[string]any{"subtype": "can_use_tool", "tool_name": "Read", "input": map[string]string{"file_path": "example.txt"}}}}
			case "interrupt":
				write(map[string]any{"type": "result", "session_id": "claude-session", "subtype": "success", "result": "interrupted"})
			case "set_model":
				write(map[string]any{"type": "fixture_model", "request": json.RawMessage(frame.Request)})
			default:
				os.Exit(8)
			}
			write(map[string]any{"type": "control_response", "response": response})
			continue
		}
		if frame.Type == "user" {
			write(map[string]any{"type": "system", "subtype": "init", "session_id": "claude-session"})
			if os.Getenv("DEVHOST_CHAT_DELAY_REPLAY") == "1" {
				delayedUser = &frame
				write(map[string]any{"type": "control_request", "request_id": "delivery-approval", "request": map[string]any{"subtype": "can_use_tool", "tool_name": "Read", "input": map[string]string{"file_path": "example.txt"}}})
				continue
			}
			if os.Getenv("DEVHOST_CHAT_USER_REJECT") == "1" {
				write(map[string]any{"type": "user", "uuid": "11111111-1111-4111-8111-111111111111", "isReplay": true, "session_id": "claude-session", "parent_tool_use_id": nil, "message": frame.Message})
				write(map[string]any{"type": "result", "is_error": true, "result": "Native input rejected", "user_message_uuid": frame.UUID})
				continue
			}
			if os.Getenv("DEVHOST_CHAT_REPLAY_USER") == "1" && os.Getenv("DEVHOST_CHAT_SKIP_REPLAY") != "1" {
				write(map[string]any{"type": "user", "uuid": frame.UUID, "isReplay": true, "session_id": "claude-session", "parent_tool_use_id": nil, "message": frame.Message})
			}
			write(map[string]any{"type": "stream_event", "session_id": "claude-session", "event": map[string]string{"type": "message_start"}})
			continue
		}
		if len(frame.ID) > 0 || frame.Type == "control_response" {
			if delayedUser != nil {
				write(map[string]any{"type": "user", "uuid": delayedUser.UUID, "isReplay": true, "session_id": "claude-session", "message": delayedUser.Message})
				delayedUser = nil
			}
			write(map[string]any{"type": "fixture_received_response", "response": json.RawMessage(frame.Result), "native": frame})
			continue
		}
		os.Exit(9)
	}
}

// chatHelperCommand starts TestChatHarnessHelperProcess in place of every native harness.
func chatHelperCommand(t *testing.T) chatCommandFactory {
	t.Helper()
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	return func(ctx context.Context, name string, args ...string) *exec.Cmd {
		t.Logf("starting native %s %v", name, args)
		cmd := exec.CommandContext(ctx, executable, "-test.run=^TestChatHarnessHelperProcess$")
		cmd.Env = append(os.Environ(), "DEVHOST_CHAT_HELPER=1")
		if slices.Contains(args, "--replay-user-messages") {
			cmd.Env = append(cmd.Env, "DEVHOST_CHAT_REPLAY_USER=1")
		}
		return cmd
	}
}

func chatTestStore(t *testing.T) *chatStore {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	store := newChatStore(ctx, chatHelperCommand(t))
	t.Cleanup(func() { cancel(); store.close() })
	return store
}

func TestChatNativeModelDiscovery(t *testing.T) {
	t.Parallel()
	store := chatTestStore(t)
	for _, harness := range []string{chatCodex, chatClaude} {
		t.Run(harness, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			result := store.discover(ctx, harness, t.TempDir())
			if !result.Available {
				t.Fatalf("discovery: %s", result.Error)
			}
			count := 1
			if harness == chatCodex {
				count = 2
			}
			if len(result.Models) != count {
				t.Fatalf("models=%+v", result.Models)
			}
			if model := result.Models[0]; !strings.HasPrefix(model.Label, "Native") || model.Description != "native description" {
				t.Fatalf("model=%+v, want the native catalog's label and description", model)
			}
		})
	}
}

func TestChatInstalledDiscovery(t *testing.T) {
	if os.Getenv("DEVHOST_TEST_INSTALLED_HARNESSES") != "1" {
		t.Skip("explicit installed-client integration")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	store := newChatStore(ctx, exec.CommandContext)
	defer store.close()
	cwd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	for _, harness := range []string{chatCodex, chatClaude} {
		t.Run(harness, func(t *testing.T) {
			result := store.discover(ctx, harness, cwd)
			if !result.Available || len(result.Models) == 0 {
				t.Fatalf("native discovery failed: %+v", result)
			}
			t.Logf("%s advertised %d native models", result.Label, len(result.Models))
		})
	}
}

func waitChatState(t *testing.T, session *chatSession, status string) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if session.snapshot().Status == status {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatalf("state=%+v, expected %s", session.snapshot(), status)
}

func TestChatNativeSessionsApproveInterruptAndKeepReplay(t *testing.T) {
	t.Parallel()
	for _, harness := range []string{chatCodex, chatClaude} {
		t.Run(harness, func(t *testing.T) {
			store := chatTestStore(t)
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			session, err := store.start(ctx, chatSessionRequest{Harness: harness}, t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			if harness == chatClaude {
				if err = session.execute(ctx, chatCommand{Type: "respond", RequestID: json.RawMessage(`"inherited"`), Result: json.RawMessage(`{"behavior":"deny","message":"Declined"}`)}); err != nil {
					t.Fatalf("inherited native request: %v", err)
				}
			}
			if err = session.execute(ctx, chatCommand{Type: "respond", RequestID: json.RawMessage(`"invented"`), Result: json.RawMessage(`{}`)}); err == nil {
				t.Fatal("answered an invented permission")
			}
			if err = session.execute(ctx, chatCommand{Type: "send", Text: "actual text"}); err != nil {
				t.Fatal(err)
			}
			if harness == chatCodex {
				waitChatState(t, session, "requires_action")
				if err = session.execute(ctx, chatCommand{Type: "respond", RequestID: json.RawMessage(`"approval-one"`), Result: json.RawMessage(`{"decision":"decline"}`)}); err != nil {
					t.Fatal(err)
				}
				if err = session.execute(ctx, chatCommand{Type: "respond", RequestID: json.RawMessage(`"approval-one"`), Result: json.RawMessage(`{}`)}); err == nil {
					t.Fatal("answered permission twice")
				}
			}
			if err = session.execute(ctx, chatCommand{Type: "interrupt"}); err != nil {
				t.Fatal(err)
			}
			waitChatState(t, session, "idle")
			info := session.snapshot()
			if info.NativeSessionID == "" {
				t.Fatal("native identity missing")
			}
			session.mu.Lock()
			events := chatTestEvents(t, session)
			session.mu.Unlock()
			if len(events) < 4 {
				t.Fatalf("lost native history: %+v", events)
			}
			for index, event := range events {
				if event.Sequence != uint64(index+1) || !json.Valid(event.Payload) {
					t.Fatalf("invalid replay event: %+v", event)
				}
			}
			if err = session.execute(ctx, chatCommand{Type: "send", Text: "next turn"}); err != nil {
				t.Fatalf("interrupt destroyed session: %v", err)
			}
		})
	}
}

func TestChatInstalledSessionStartup(t *testing.T) {
	if os.Getenv("DEVHOST_TEST_INSTALLED_HARNESSES") != "1" {
		t.Skip("explicit installed-client integration")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	store := newChatStore(ctx, exec.CommandContext)
	defer store.close()
	cwd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	for _, harness := range []string{chatCodex, chatClaude} {
		t.Run(harness, func(t *testing.T) {
			session, err := store.start(ctx, chatSessionRequest{Harness: harness}, cwd)
			if err != nil {
				t.Fatal(err)
			}
			info := session.snapshot()
			if info.Status != "idle" {
				t.Fatalf("native startup=%+v", info)
			}
			if harness == chatCodex && info.NativeSessionID == "" {
				t.Fatal("native thread missing")
			}
			session.close()
			t.Logf("%s native initialization and clean shutdown succeeded", harness)
		})
	}
}

func TestChatInstalledConversation(t *testing.T) {
	if os.Getenv("DEVHOST_TEST_CHAT_INFERENCE") != "1" {
		t.Skip("explicit native inference integration")
	}
	cwd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	for _, harness := range []string{chatCodex, chatClaude} {
		t.Run(harness, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
			defer cancel()
			store := newChatStore(ctx, exec.CommandContext)
			defer store.close()
			session, err := store.start(ctx, chatSessionRequest{Harness: harness}, cwd)
			if err != nil {
				t.Fatal(err)
			}
			defer func() {
				if directory := os.Getenv("DEVHOST_CHAT_EVIDENCE_DIR"); directory != "" {
					session.mu.Lock()
					encoded, err := json.MarshalIndent(chatTestEvents(t, session), "", "  ")
					session.mu.Unlock()
					if err != nil {
						t.Error(err)
						return
					}
					if err = os.WriteFile(filepath.Join(directory, harness+"-conversation.json"), encoded, 0600); err != nil {
						t.Error(err)
					}
				}
			}()
			if err = session.execute(ctx, chatCommand{Type: "send", Text: "Reply with exactly DEVHOST_CHAT_OK. Do not use any tools or modify any files."}); err != nil {
				t.Fatal(err)
			}
			for session.snapshot().Status != "idle" {
				info := session.snapshot()
				if info.Status == "error" || info.Status == "requires_action" {
					t.Fatalf("native conversation paused: %+v", info)
				}
				select {
				case <-ctx.Done():
					t.Fatal(ctx.Err())
				case <-time.After(20 * time.Millisecond):
				}
			}
			session.mu.Lock()
			defer session.mu.Unlock()
			found := false
			for _, event := range chatTestEvents(t, session) {
				var frame struct {
					Method string `json:"method"`
					Params struct {
						Delta string `json:"delta"`
						Item  struct {
							Type string `json:"type"`
							Text string `json:"text"`
						} `json:"item"`
					} `json:"params"`
					Type    string `json:"type"`
					Message struct {
						Content []struct {
							Type string `json:"type"`
							Text string `json:"text"`
						} `json:"content"`
					} `json:"message"`
				}
				if json.Unmarshal(event.Payload, &frame) != nil {
					continue
				}
				if frame.Method == "item/agentMessage/delta" && strings.Contains(frame.Params.Delta, "DEVHOST_CHAT_OK") {
					found = true
				}
				if frame.Method == "item/completed" && frame.Params.Item.Type == "agentMessage" && strings.Contains(frame.Params.Item.Text, "DEVHOST_CHAT_OK") {
					found = true
				}
				if frame.Type == "assistant" {
					for _, part := range frame.Message.Content {
						if part.Type == "text" && strings.Contains(part.Text, "DEVHOST_CHAT_OK") {
							found = true
						}
					}
				}
			}
			if !found {
				t.Fatal("native assistant response missing expected text")
			}
			t.Logf("%s actual native assistant turn completed with %d frames", harness, int(session.events.sequence))
		})
	}
}

func TestChatProcessRetiresUncooperativeChild(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	ready := make(chan struct{}, 1)
	factory := func(ctx context.Context, name string, args ...string) *exec.Cmd {
		cmd := exec.CommandContext(ctx, executable, "-test.run=^TestChatHarnessHelperProcess$")
		cmd.Env = append(os.Environ(), "DEVHOST_CHAT_HELPER=1", "DEVHOST_CHAT_IGNORE_TERM=1")
		return cmd
	}
	process, err := startChatProcess(ctx, chatCodex, t.TempDir(), nil, factory, func(json.RawMessage) { ready <- struct{}{} })
	if err != nil {
		t.Fatal(err)
	}
	select {
	case <-ready:
	case <-time.After(3 * time.Second):
		process.close()
		t.Fatal("child never became ready")
	}
	done := make(chan struct{})
	go func() { process.close(); close(done) }()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("owned child ignored shutdown")
	}
	if process.cmd.ProcessState == nil {
		t.Fatal("owned child was not reaped")
	}
}

func TestChatNativeCancelRemovesOnlyCurrentPendingRequests(t *testing.T) {
	for _, harness := range []string{chatCodex, chatClaude} {
		t.Run(harness, func(t *testing.T) {
			store := chatTestStore(t)
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			session, err := store.start(ctx, chatSessionRequest{Harness: harness}, t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			id := json.RawMessage(`9223372036854775807`)
			if harness == chatCodex {
				session.receive(json.RawMessage(`{"id":9223372036854775807,"method":"item/commandExecution/requestApproval","params":{}}`))
				session.receive(json.RawMessage(`{"method":"serverRequest/resolved","params":{"requestId":9223372036854775807,"threadId":"codex-session"}}`))
			} else {
				id = json.RawMessage(`"inherited"`)
				session.receive(json.RawMessage(`{"type":"control_cancel_request","request_id":"inherited"}`))
			}
			if err = session.execute(ctx, chatCommand{Type: "respond", RequestID: id, Result: json.RawMessage(`{}`)}); err == nil {
				t.Fatal("answered a native-canceled request")
			}
		})
	}
}

func TestChatNativeResultErrorIsNotASuccessfulTurn(t *testing.T) {
	store := chatTestStore(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	session, err := store.start(ctx, chatSessionRequest{Harness: chatClaude}, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	session.receive(json.RawMessage(`{"type":"control_cancel_request","request_id":"inherited"}`))
	session.receive(json.RawMessage(`{"type":"result","subtype":"success","is_error":true,"terminal_reason":"api_error","session_id":"native-claude","result":"Not logged in · Please run /login"}`))
	info := session.snapshot()
	if info.Status != "error" || !strings.Contains(info.Error, "Not logged in") {
		t.Fatalf("native failure became success: %+v", info)
	}
}

func TestChatImagesValidateNativePayload(t *testing.T) {
	imageValue := image.NewRGBA(image.Rect(0, 0, 2, 2))
	imageValue.Set(0, 0, color.White)
	var buffer bytes.Buffer
	if err := png.Encode(&buffer, imageValue); err != nil {
		t.Fatal(err)
	}
	data := "data:image/png;base64," + base64.StdEncoding.EncodeToString(buffer.Bytes())
	images, err := validateChatImages([]chatImage{{DataURL: data}})
	if err != nil || len(images) != 1 || images[0].dataURL != data {
		t.Fatalf("images=%+v err=%v", images, err)
	}
	for _, invalid := range []string{"https://example.com/image.png", "data:image/gif;base64,AAAA", "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(buffer.Bytes()), "data:image/png;base64,AAAA", "data:image/png;base64," + strings.Repeat("A", chatMessageLimit)} {
		if _, err := validateChatImages([]chatImage{{DataURL: invalid}}); err == nil {
			t.Fatal("accepted invalid attachment")
		}
	}
}
