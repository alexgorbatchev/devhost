package devtools

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"strconv"
	"sync"
	"syscall"
	"time"
)

const chatProcessGrace = 2 * time.Second
const chatDiagnosticLimit = 16 * 1024

type chatCommandFactory func(context.Context, string, ...string) *exec.Cmd
type chatRPCResult struct {
	value json.RawMessage
	err   error
}

type chatNativeError struct {
	harness string
	payload json.RawMessage
}

func (e *chatNativeError) Error() string {
	return fmt.Sprintf("%s request failed: %s", e.harness, e.payload)
}

type chatProcess struct {
	harness     string
	cmd         *exec.Cmd
	stdin       io.WriteCloser
	cancel      context.CancelFunc
	done        chan struct{}
	watcherDone chan struct{}
	writeMu     sync.Mutex
	mu          sync.Mutex
	nextID      uint64
	pending     map[string]chan chatRPCResult
	err         error
	diagnostics []byte
}

func startChatProcess(ctx context.Context, harness, cwd string, args []string, command chatCommandFactory, receive func(json.RawMessage)) (*chatProcess, error) {
	ctx, cancel := context.WithCancel(ctx)
	executable := "codex"
	if harness == chatClaude {
		executable = "claude"
	}
	cmd := command(ctx, executable, args...)
	cmd.Dir = cwd
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Cancel = func() error { return syscall.Kill(-cmd.Process.Pid, syscall.SIGTERM) }
	cmd.WaitDelay = chatProcessGrace
	stdin, err := cmd.StdinPipe()
	if err != nil {
		cancel()
		return nil, fmt.Errorf("open %s input: %w", executable, err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		cancel()
		_ = stdin.Close()
		return nil, fmt.Errorf("open %s output: %w", executable, err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		cancel()
		_ = stdin.Close()
		_ = stdout.Close()
		return nil, fmt.Errorf("open %s diagnostics: %w", executable, err)
	}
	if err := cmd.Start(); err != nil {
		cancel()
		_ = stdin.Close()
		_ = stdout.Close()
		_ = stderr.Close() // No child owns these pipes after a failed spawn.
		return nil, fmt.Errorf("start %s: %w", executable, err)
	}
	p := &chatProcess{harness: harness, cmd: cmd, stdin: stdin, cancel: cancel, done: make(chan struct{}), watcherDone: make(chan struct{}), pending: map[string]chan chatRPCResult{}}
	var groupMu sync.Mutex
	retired := false
	go func() {
		defer close(p.watcherDone)
		select {
		case <-ctx.Done():
		case <-p.done:
			return
		}
		timer := time.NewTimer(chatProcessGrace)
		defer timer.Stop()
		select {
		case <-p.done:
		case <-timer.C:
			// The unreaped leader still owns this process-group ID. Kill inherited
			// pipe holders as well, so a descendant cannot prevent shutdown.
			groupMu.Lock()
			if !retired {
				_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
			}
			groupMu.Unlock()
		}
	}()
	stderrDone := make(chan struct{})
	go func() {
		defer close(stderrDone)
		buffer := make([]byte, chatDiagnosticLimit)
		for {
			n, err := stderr.Read(buffer)
			if n > 0 {
				p.mu.Lock()
				p.diagnostics = append(p.diagnostics, buffer[:n]...)
				if len(p.diagnostics) > chatDiagnosticLimit {
					p.diagnostics = p.diagnostics[len(p.diagnostics)-chatDiagnosticLimit:]
				}
				p.mu.Unlock()
			}
			if err != nil {
				return
			}
		}
	}()
	go func() {
		decoder := json.NewDecoder(stdout)
		var readErr error
		for {
			var raw json.RawMessage
			if err := decoder.Decode(&raw); err != nil {
				if err != io.EOF {
					readErr = fmt.Errorf("read %s protocol: %w", executable, err)
					cancel()
				}
				break
			}
			if receive != nil {
				receive(raw)
			}
			p.resolve(raw)
		}
		// Keep the leader unreaped until its owned process group is retired, so a
		// reused PID can never make cleanup address an unrelated process group.
		groupMu.Lock()
		killErr := syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
		retired = true
		groupMu.Unlock()
		<-stderrDone
		if killErr != nil && !errors.Is(killErr, syscall.ESRCH) && readErr == nil {
			readErr = fmt.Errorf("retire %s process group: %w", executable, killErr)
		}
		waitErr := cmd.Wait()
		_ = stdin.Close() // Retire the owned descriptor even when the CLI exits by itself.
		p.mu.Lock()
		p.err = readErr
		if p.err == nil {
			p.err = waitErr
		}
		p.mu.Unlock()
		cancel()
		close(p.done)
	}()
	return p, nil
}

func (p *chatProcess) write(value any) error {
	p.writeMu.Lock()
	defer p.writeMu.Unlock()
	if err := json.NewEncoder(p.stdin).Encode(value); err != nil {
		return fmt.Errorf("write %s protocol: %w", p.harness, err)
	}
	return nil
}

func (p *chatProcess) call(ctx context.Context, method string, params map[string]any) (json.RawMessage, error) {
	p.mu.Lock()
	p.nextID++
	id := strconv.FormatUint(p.nextID, 10)
	key := id
	if p.harness == chatClaude {
		key = `"` + id + `"`
	}
	p.mu.Unlock()
	var request any
	if p.harness == chatCodex {
		request = map[string]any{"id": json.RawMessage(id), "method": method, "params": params}
	} else {
		inner := map[string]any{"subtype": method}
		for name, value := range params {
			inner[name] = value
		}
		request = map[string]any{"type": "control_request", "request_id": id, "request": inner}
	}
	return p.exchange(ctx, key, request)
}

func (p *chatProcess) exchange(ctx context.Context, key string, request any) (json.RawMessage, error) {
	response := make(chan chatRPCResult, 1)
	p.mu.Lock()
	p.pending[key] = response
	p.mu.Unlock()
	defer func() { p.mu.Lock(); delete(p.pending, key); p.mu.Unlock() }()
	if err := p.write(request); err != nil {
		return nil, err
	}
	select {
	case result := <-response:
		return result.value, result.err
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-p.done:
		return nil, p.exitError()
	}
}

func (p *chatProcess) resolve(raw json.RawMessage) {
	var frame chatNativeFrame
	if json.Unmarshal(raw, &frame) != nil {
		return
	}
	key, value, errorValue := string(frame.ID), frame.Result, frame.Error
	if p.harness == chatCodex && frame.Method != "" {
		return
	}
	if p.harness == chatClaude {
		if frame.Type == "user" && frame.IsReplay && frame.UUID != "" {
			p.deliver("user:"+frame.UUID, chatRPCResult{value: raw})
			return
		}
		if frame.Type == "result" && frame.IsError && frame.UserMessageUUID != "" {
			p.deliver("user:"+frame.UserMessageUUID, chatRPCResult{err: fmt.Errorf("Claude rejected the user message: %s", frame.Result)})
			return
		}
		if frame.Type != "control_response" {
			return
		}
		var response struct {
			Subtype   string          `json:"subtype"`
			RequestID string          `json:"request_id"`
			Response  json.RawMessage `json:"response"`
			Error     string          `json:"error"`
		}
		if json.Unmarshal(frame.Response, &response) != nil {
			return
		}
		encoded, err := json.Marshal(response.RequestID)
		if err != nil {
			return
		}
		key, value = string(encoded), response.Response
		if response.Subtype == "error" {
			encodedError, err := json.Marshal(response.Error)
			if err != nil {
				return
			}
			errorValue = encodedError
		}
	}
	result := chatRPCResult{value: value}
	if len(errorValue) > 0 && string(errorValue) != "null" {
		result.err = &chatNativeError{harness: p.harness, payload: errorValue}
	}
	p.deliver(key, result)
}

func (p *chatProcess) deliver(key string, result chatRPCResult) {
	p.mu.Lock()
	response := p.pending[key]
	p.mu.Unlock()
	if response == nil {
		return
	}
	select {
	case response <- result:
	default:
	}
}

func (p *chatProcess) exitError() error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.err != nil {
		return fmt.Errorf("%s exited: %w (%s)", p.harness, p.err, p.diagnostics)
	}
	return fmt.Errorf("%s protocol closed", p.harness)
}

func (p *chatProcess) close() {
	p.cancel()
	_ = p.stdin.Close() // Closing the owned pipe also releases a concurrent blocked write.
	<-p.done
	<-p.watcherDone
}
