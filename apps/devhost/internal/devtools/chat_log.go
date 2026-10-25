package devtools

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/cliout"
)

const chatHeartbeatInterval = 30 * time.Second
const chatLogDetailLimit = 512
const chatLogLineLimit = 2048

type chatActivity struct {
	log           func(string)
	started       time.Time
	dispatched    time.Time
	lastEvent     time.Time
	lastHeartbeat time.Time
	turn          string
	turnSequence  uint64
	interrupted   bool
	tools         map[string]chatToolActivity
	requests      map[string]chatRequestActivity
	usage         string
	nativeModel   string
}

type chatRequestActivity struct {
	started time.Time
	kind    string
}

type chatToolActivity struct {
	name    string
	path    string
	started time.Time
}

func (s *ControlServer) logChat(message string) {
	message = cliout.FoldPaths(message)
	if s.onLog != nil {
		s.onLog(message)
	}
	s.PublishLogEntry("chat", ServiceLogStreamStdout, message)
}

func (s *chatSession) logLocked(format string, args ...any) {
	if s.activity.log != nil {
		message := fmt.Sprintf("chat session=%q harness=%q ", s.info.ID, s.info.Harness) + fmt.Sprintf(format, args...)
		if len(message) > chatLogLineLimit {
			message = strings.ToValidUTF8(message[:chatLogLineLimit], "") + "…"
		}
		s.activity.log(message)
	}
}

func (s *chatSession) logCommand(command chatCommand, event string, elapsed time.Duration, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.logCommandLocked(command, event, elapsed, err)
}

func (s *chatSession) logCommandLocked(command chatCommand, event string, elapsed time.Duration, err error) {
	s.logLocked("message %s command=%q attachments=%d wait=%s error=%q", event, command.CommandID, len(command.Images), chatDuration(elapsed), chatLogError(err))
}

func chatCommandOutcome(err error) string {
	if err != nil {
		return "rejected"
	}
	return "accepted"
}

func (s *chatSession) startTurnLocked(now time.Time, id string) {
	if !s.activity.started.IsZero() {
		if id != "" {
			s.activity.turn = id
		}
		return
	}
	s.activity.started = now
	s.activity.lastEvent = now
	s.activity.lastHeartbeat = now
	if id == "" {
		id = s.activity.turn
		if id == "" || s.activity.dispatched.IsZero() {
			s.activity.turnSequence++
			id = fmt.Sprintf("local-%d", s.activity.turnSequence)
		}
	}
	s.activity.turn = id
	s.activity.usage = ""
	s.activity.tools = map[string]chatToolActivity{}
	model := s.model
	if model == "" {
		model = s.configuredModel
	}
	if model == "" {
		model = "native default"
	}
	s.logLocked("turn started turn=%q model=%q", id, model)
}

func (s *chatSession) finishTurnLocked(now time.Time, outcome string) {
	if s.info.Harness == chatClaude && s.activity.interrupted && outcome == "completed" {
		outcome = "interrupted"
	}
	duration := "unknown"
	if !s.activity.started.IsZero() {
		duration = chatDuration(now.Sub(s.activity.started))
	} else if !s.activity.dispatched.IsZero() {
		duration = chatDuration(now.Sub(s.activity.dispatched))
	}
	s.logLocked("turn %s turn=%q duration=%s", outcome, s.activity.turn, duration)
	s.activity.started = time.Time{}
	s.activity.dispatched = time.Time{}
	s.activity.interrupted = false
	clear(s.activity.tools)
}

func (s *chatSession) heartbeat(now time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	started := s.activity.started
	if started.IsZero() {
		started = s.activity.dispatched
	}
	if s.info.Status == "closed" || s.info.Status == "error" || started.IsZero() || now.Sub(s.activity.lastEvent) < chatHeartbeatInterval || now.Sub(s.activity.lastHeartbeat) < chatHeartbeatInterval {
		return
	}
	tools := make([]string, 0, len(s.activity.tools))
	for _, tool := range s.activity.tools {
		tools = append(tools, tool.name)
	}
	sort.Strings(tools)
	s.logLocked("still working turn=%q state=%s elapsed=%s quiet=%s tools=%q pending=%d", s.activity.turn, s.info.Status, chatDuration(now.Sub(started)), chatDuration(now.Sub(s.activity.lastEvent)), strings.Join(tools, ","), len(s.pending))
	s.activity.lastHeartbeat = now
}

func (s *chatSession) startToolLocked(now time.Time, id, name, path string) {
	if id == "" || name == "" {
		return
	}
	if tool, exists := s.activity.tools[id]; exists {
		if path != "" {
			tool.path = path
			s.activity.tools[id] = tool
		}
		return
	}
	if s.activity.tools == nil {
		s.activity.tools = map[string]chatToolActivity{}
	}
	s.activity.tools[id] = chatToolActivity{name: name, path: path, started: now}
	s.logLocked("tool started turn=%q item=%q tool=%q path=%q", s.activity.turn, id, name, path)
}

func (s *chatSession) finishToolLocked(now time.Time, id, outcome string, exit *int) {
	tool, exists := s.activity.tools[id]
	if !exists {
		return
	}
	code := "unknown"
	if exit != nil {
		code = fmt.Sprint(*exit)
	}
	duration := "unknown"
	if !tool.started.IsZero() {
		duration = chatDuration(now.Sub(tool.started))
	}
	s.logLocked("tool %s turn=%q item=%q tool=%q path=%q duration=%s exit=%s", outcome, s.activity.turn, id, tool.name, tool.path, duration, code)
	delete(s.activity.tools, id)
}

func (s *chatSession) logRequestLocked(now time.Time, key, kind string) {
	if s.activity.requests == nil {
		s.activity.requests = map[string]chatRequestActivity{}
	}
	if _, exists := s.activity.requests[key]; exists {
		return
	}
	s.activity.requests[key] = chatRequestActivity{started: now, kind: kind}
	s.logLocked("waiting for user request=%s kind=%q", key, kind)
}

func (s *chatSession) logRequestsLocked(now time.Time, outcome string) {
	for key, request := range s.activity.requests {
		if _, pending := s.pending[key]; !pending {
			s.logLocked("request %s request=%s kind=%q waited=%s", outcome, key, request.kind, chatDuration(now.Sub(request.started)))
			delete(s.activity.requests, key)
		}
	}
}

func chatDuration(value time.Duration) string { return value.Round(time.Millisecond).String() }

func chatLogError(err error) string {
	if err == nil {
		return ""
	}
	var input *chatInputRejectedError
	if errors.As(err, &input) {
		return "native user input rejected"
	}
	var native *chatNativeError
	if errors.As(err, &native) {
		var payload struct {
			Code json.RawMessage `json:"code"`
		}
		if json.Unmarshal(native.payload, &payload) == nil && len(payload.Code) != 0 {
			return fmt.Sprintf("native request rejected code=%s", payload.Code)
		}
		return "native request rejected"
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return "native acknowledgement timed out"
	}
	if errors.Is(err, context.Canceled) {
		return "operation canceled"
	}
	message := err.Error()
	if len(message) > chatLogDetailLimit {
		message = message[:chatLogDetailLimit] + "…"
	}
	return strings.ToValidUTF8(message, "�")
}
