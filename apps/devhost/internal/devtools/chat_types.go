package devtools

import "encoding/json"

const (
	chatHarnessesPath = controlPathPrefix + "/chat/harnesses"
	chatSessionsPath  = controlPathPrefix + "/chat/sessions"
	// chatSessionCloseSuffix follows a session ID: POST /chat/sessions/{id}/close.
	chatSessionCloseSuffix = "/close"
	chatWebsocketPath      = controlPathPrefix + "/ws/chat"
	chatMessageLimit       = 8 * 1024 * 1024
	chatCodex              = "codex"
	chatClaude             = "claude-code"
	chatTargetProject      = "project"
	chatTargetDevhost      = "devhost"
)

type chatModel struct {
	ID          string `json:"id"`
	Label       string `json:"label"`
	Description string `json:"description"`
}

type chatHarness struct {
	ID        string      `json:"id"`
	Label     string      `json:"label"`
	Available bool        `json:"available"`
	Models    []chatModel `json:"models"`
	Error     string      `json:"error,omitempty"`
}

type chatSessionInfo struct {
	ID              string `json:"id"`
	Harness         string `json:"harness"`
	ProjectRootPath string `json:"projectRootPath"`
	NativeSessionID string `json:"nativeSessionId,omitempty"`
	Status          string `json:"status"`
	Error           string `json:"error,omitempty"`
}

type chatSessionRequest struct {
	Harness  string `json:"harness"`
	PageURL  string `json:"pageURL"`
	Target   string `json:"target"`
	Model    string `json:"model,omitempty"`
	ResumeID string `json:"resumeId,omitempty"`
}

type chatImage struct {
	DataURL string `json:"dataURL"`
}

type chatCommand struct {
	Type      string          `json:"type"`
	CommandID string          `json:"commandId,omitempty"`
	Text      string          `json:"text,omitempty"`
	Model     *string         `json:"model,omitempty"`
	Images    []chatImage     `json:"images,omitempty"`
	RequestID json.RawMessage `json:"requestId,omitempty"`
	Result    json.RawMessage `json:"result,omitempty"`
}

type chatEvent struct {
	Sequence uint64          `json:"sequence"`
	Payload  json.RawMessage `json:"payload"`
}

type chatMessage struct {
	PendingRequestIDs *[]json.RawMessage `json:"pendingRequestIds,omitempty"`
	Type              string             `json:"type"`
	CommandID         string             `json:"commandId,omitempty"`
	SessionID         string             `json:"sessionId,omitempty"`
	Session           *chatSessionInfo   `json:"session,omitempty"`
	Events            []chatEvent        `json:"events,omitempty"`
	Sequence          uint64             `json:"sequence,omitempty"`
	Payload           json.RawMessage    `json:"payload,omitempty"`
	Error             string             `json:"error,omitempty"`
}

type chatNativeFrame struct {
	UUID            string          `json:"uuid"`
	IsReplay        bool            `json:"isReplay"`
	UserMessageUUID string          `json:"user_message_uuid"`
	Message         json.RawMessage `json:"message"`
	IsError         bool            `json:"is_error"`
	ID              json.RawMessage `json:"id"`
	Method          string          `json:"method"`
	Params          json.RawMessage `json:"params"`
	Result          json.RawMessage `json:"result"`
	Error           json.RawMessage `json:"error"`
	Type            string          `json:"type"`
	Subtype         string          `json:"subtype"`
	State           string          `json:"state"`
	SessionID       string          `json:"session_id"`
	RequestID       string          `json:"request_id"`
	Request         json.RawMessage `json:"request"`
	Response        json.RawMessage `json:"response"`
}
