package devtools

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path"
	"regexp"
	"strings"
	"sync"
	"syscall"
	"time"
	"unicode/utf8"

	"github.com/creack/pty"
)

const (
	defaultTerminalColumns               = 120
	defaultTerminalRows                  = 80
	maximumRetainedTerminalOutputLength  = 128000
	terminalSessionEnvironmentColorTerm  = "truecolor"
	terminalSessionEnvironmentProgram    = "devhost"
	terminalSessionEnvironmentTerm       = "xterm-256color"
	terminalSessionRequestKindAgent      = "agent"
	terminalSessionRequestKindCommand    = "command"
	terminalSessionLauncherNeovim        = "neovim"
	terminalSessionRequestKindEditor     = "editor"
	terminalSessionWebsocketQuerySession = "sessionId"
	terminalSessionWebsocketQueryToken   = "token"
)

const defaultAnnotationActionID = "agent"

var parenthesizedSourcePathPrefix = regexp.MustCompile(`^\([^)]+\)/\./`)

type sourceLocation struct {
	ColumnNumber  *int    `json:"columnNumber,omitempty"`
	ComponentName *string `json:"componentName,omitempty"`
	FileName      string  `json:"fileName"`
	LineNumber    int     `json:"lineNumber"`
}

type rectSnapshot struct {
	Height float64 `json:"height"`
	Width  float64 `json:"width"`
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
}

type annotationMarkerPayload struct {
	Accessibility    string            `json:"accessibility"`
	BoundingBox      rectSnapshot      `json:"boundingBox"`
	ComputedStyles   string            `json:"computedStyles"`
	ComputedStylesOb map[string]string `json:"computedStylesObj"`
	CSSClasses       string            `json:"cssClasses"`
	Element          string            `json:"element"`
	ElementPath      string            `json:"elementPath"`
	FullPath         string            `json:"fullPath"`
	IsFixed          bool              `json:"isFixed"`
	MarkerNumber     int               `json:"markerNumber"`
	NearbyElements   string            `json:"nearbyElements"`
	NearbyText       string            `json:"nearbyText"`
	SelectedText     *string           `json:"selectedText,omitempty"`
	SourceLocation   *sourceLocation   `json:"sourceLocation,omitempty"`
}

type annotationSubmitDetail struct {
	Comment     string                    `json:"comment"`
	Markers     []annotationMarkerPayload `json:"markers"`
	StackName   string                    `json:"stackName"`
	SubmittedAt int64                     `json:"submittedAt"`
	Title       string                    `json:"title"`
	URL         string                    `json:"url"`
}

type terminalSessionRequest struct {
	ActionID      string                  `json:"actionId,omitempty"`
	Annotation    *annotationSubmitDetail `json:"annotation,omitempty"`
	ComponentName string                  `json:"componentName,omitempty"`
	Kind          string                  `json:"kind"`
	Launcher      string                  `json:"launcher,omitempty"`
	Source        *sourceLocation         `json:"source,omitempty"`
	SourceLabel   string                  `json:"sourceLabel,omitempty"`
}

type startTerminalSessionResponse struct {
	SessionID string `json:"sessionId"`
}

type activeTerminalSessionSnapshot struct {
	Request   terminalSessionRequest `json:"request"`
	SessionID string                 `json:"sessionId"`
}

type listTerminalSessionsResponse struct {
	Sessions []activeTerminalSessionSnapshot `json:"sessions"`
}

type terminalSessionClientMessage struct {
	Cols *int
	Data *string
	Rows *int
	Type string
}

type terminalSessionExitStatus struct {
	ExitCode   *int    `json:"exitCode"`
	SignalCode *string `json:"signalCode"`
	Type       string  `json:"type"`
}

type terminalSessionErrorMessage struct {
	Message string `json:"message"`
	Type    string `json:"type"`
}

type terminalSessionOutputMessage struct {
	Data string `json:"data"`
	Type string `json:"type"`
}

type terminalSessionSnapshotMessage struct {
	Data string `json:"data"`
	Type string `json:"type"`
}

type terminalSessionState struct {
	close         func()
	clients       map[*websocketClient]struct{}
	exited        *terminalSessionExitStatus
	idleTimer     *time.Timer
	output        string
	pendingOutput []byte
	request       terminalSessionRequest
	resize        func(cols int, rows int)
	write         func(data string)
	cleanup       func()
	cleanupOnce   sync.Once
	closed        bool
	closeOnce     sync.Once
	wait          func() terminalSessionExitStatus
	agentStatus   *agentSessionStatus
	agentCarry    string
}

type terminalSessionStarter func(request terminalSessionRequest, onData func([]byte)) (*launchedTerminalSession, error)

type launchedTerminalSession struct {
	cleanup func()
	close   func()
	resize  func(cols int, rows int)
	wait    func() terminalSessionExitStatus
	write   func(data string)
}

type terminalSessionRequestPayload struct {
	ActionID      *string                 `json:"actionId"`
	Annotation    *annotationSubmitDetail `json:"annotation"`
	ComponentName *string                 `json:"componentName"`
	Kind          *string                 `json:"kind"`
	Launcher      *string                 `json:"launcher"`
	Source        *sourceLocationPayload  `json:"source"`
	SourceLabel   *string                 `json:"sourceLabel"`
	TargetSession *string                 `json:"targetSessionId"`
}

type sourceLocationPayload struct {
	ColumnNumber  *int    `json:"columnNumber"`
	ComponentName *string `json:"componentName"`
	FileName      *string `json:"fileName"`
	LineNumber    *int    `json:"lineNumber"`
}

func parseTerminalSessionRequest(payload terminalSessionRequestPayload) (terminalSessionRequest, *string, bool) {
	if payload.Kind == nil {
		return terminalSessionRequest{}, nil, false
	}

	switch *payload.Kind {
	case terminalSessionRequestKindAgent:
		if payload.Annotation == nil {
			return terminalSessionRequest{}, nil, false
		}
		actionID := defaultAnnotationActionID
		if payload.ActionID != nil {
			actionID = *payload.ActionID
		}
		return terminalSessionRequest{
			ActionID:   actionID,
			Annotation: payload.Annotation,
			Kind:       terminalSessionRequestKindAgent,
		}, payload.TargetSession, isAnnotationSubmitDetail(*payload.Annotation)
	case terminalSessionRequestKindCommand:
		if payload.Annotation == nil || payload.ActionID == nil || *payload.ActionID == "" || payload.TargetSession != nil {
			return terminalSessionRequest{}, nil, false
		}
		return terminalSessionRequest{
			ActionID:   *payload.ActionID,
			Annotation: payload.Annotation,
			Kind:       terminalSessionRequestKindCommand,
		}, nil, isAnnotationSubmitDetail(*payload.Annotation)
	case terminalSessionRequestKindEditor:
		if payload.Launcher == nil || *payload.Launcher != terminalSessionLauncherNeovim {
			return terminalSessionRequest{}, nil, false
		}
		if payload.ComponentName == nil || payload.Source == nil || payload.SourceLabel == nil {
			return terminalSessionRequest{}, nil, false
		}

		location, ok := parseSourceLocation(*payload.Source)
		if !ok {
			return terminalSessionRequest{}, nil, false
		}

		return terminalSessionRequest{
			ComponentName: *payload.ComponentName,
			Kind:          terminalSessionRequestKindEditor,
			Launcher:      *payload.Launcher,
			Source:        &location,
			SourceLabel:   *payload.SourceLabel,
		}, nil, true
	default:
		return terminalSessionRequest{}, nil, false
	}
}

func parseSourceLocation(payload sourceLocationPayload) (sourceLocation, bool) {
	if payload.FileName == nil || payload.LineNumber == nil || *payload.LineNumber <= 0 {
		return sourceLocation{}, false
	}
	if payload.ColumnNumber != nil && *payload.ColumnNumber <= 0 {
		return sourceLocation{}, false
	}

	return sourceLocation{
		ColumnNumber:  payload.ColumnNumber,
		ComponentName: payload.ComponentName,
		FileName:      *payload.FileName,
		LineNumber:    *payload.LineNumber,
	}, true
}

func parseTerminalSessionClientMessage(message []byte) (*terminalSessionClientMessage, bool) {
	var payload struct {
		Cols *int    `json:"cols"`
		Data *string `json:"data"`
		Rows *int    `json:"rows"`
		Type string  `json:"type"`
	}
	if err := json.Unmarshal(message, &payload); err != nil {
		return nil, false
	}

	switch payload.Type {
	case "input":
		if payload.Data == nil {
			return nil, false
		}
		return &terminalSessionClientMessage{Data: payload.Data, Type: payload.Type}, true
	case "resize":
		if payload.Cols == nil || payload.Rows == nil || *payload.Cols <= 0 || *payload.Rows <= 0 {
			return nil, false
		}
		return &terminalSessionClientMessage{Cols: payload.Cols, Rows: payload.Rows, Type: payload.Type}, true
	case "close":
		return &terminalSessionClientMessage{Type: payload.Type}, true
	default:
		return nil, false
	}
}

func createTerminalSessionErrorMessage(message string) terminalSessionErrorMessage {
	return terminalSessionErrorMessage{Message: message, Type: "error"}
}

func createTerminalSessionOutputMessage(data string) terminalSessionOutputMessage {
	return terminalSessionOutputMessage{Data: data, Type: "output"}
}

func createTerminalSessionSnapshotMessage(data string) terminalSessionSnapshotMessage {
	return terminalSessionSnapshotMessage{Data: data, Type: "snapshot"}
}

func retainTerminalBufferTail(output string) string {
	if terminalOutputLength(output) <= maximumRetainedTerminalOutputLength {
		return output
	}

	units := 0
	for index := len(output); index > 0; {
		r, size := utf8.DecodeLastRuneInString(output[:index])
		index -= size
		units += terminalRuneLength(r)
		if units >= maximumRetainedTerminalOutputLength {
			if units > maximumRetainedTerminalOutputLength {
				return output[index+size:]
			}
			return output[index:]
		}
	}

	return output
}

func decodeTerminalOutputChunk(pending []byte, data []byte) (string, []byte) {
	combined := append(append([]byte{}, pending...), data...)
	for index := len(combined); index >= 0; index-- {
		if utf8.Valid(combined[:index]) {
			return string(combined[:index]), append([]byte(nil), combined[index:]...)
		}
	}

	return "", combined
}

func terminalOutputLength(output string) int {
	length := 0
	for _, r := range output {
		length += terminalRuneLength(r)
	}
	return length
}

func terminalRuneLength(r rune) int {
	if r > 0xFFFF {
		return 2
	}
	return 1
}

func createEditorTerminalCommand(componentEditor string, request terminalSessionRequest, projectRootPath string) ([]string, error) {
	if request.Launcher != terminalSessionLauncherNeovim {
		return nil, fmt.Errorf("unsupported editor terminal launcher: %s", request.Launcher)
	}
	if componentEditor != terminalSessionLauncherNeovim {
		return nil, fmt.Errorf("Editor terminal sessions require devtoolsComponentEditor = \"neovim\".")
	}
	if request.Source == nil {
		return nil, fmt.Errorf("editor terminal source is required")
	}

	return createNeovimSessionCommand(*request.Source, projectRootPath), nil
}

func createNeovimSessionCommand(source sourceLocation, projectRootPath string) []string {
	columnNumber := 1
	if source.ColumnNumber != nil {
		columnNumber = *source.ColumnNumber
	}

	return []string{
		"nvim",
		"-c",
		fmt.Sprintf("call cursor(%d, %d)", source.LineNumber, columnNumber),
		"--",
		resolveSourceFilePath(source.FileName, projectRootPath),
	}
}

func resolveSourceFilePath(rawFileName string, projectRootPath string) string {
	normalizedSourcePath := normalizeFilePath(cleanSourcePath(rawFileName))
	if isAbsoluteFilePath(normalizedSourcePath) {
		return normalizedSourcePath
	}
	if projectRootPath == "" {
		return normalizedSourcePath
	}

	return normalizeFilePath(path.Join(normalizeFilePath(projectRootPath), normalizedSourcePath))
}

func cleanSourcePath(rawPath string) string {
	cleanedPath := rawPath
	if index := strings.IndexAny(cleanedPath, "?#"); index >= 0 {
		cleanedPath = cleanedPath[:index]
	}

	replacements := []struct {
		old string
		new string
	}{
		{"turbopack:///[project]/", ""},
		{"webpack-internal:///./", ""},
		{"webpack-internal:///", ""},
		{"webpack:///./", ""},
		{"webpack:///", ""},
		{"turbopack:///", ""},
		{"file:///", "/"},
		{"./", ""},
	}
	for _, replacement := range replacements {
		cleanedPath = strings.TrimPrefix(cleanedPath, replacement.old)
		if replacement.old == "./" {
			break
		}
	}

	if strings.HasPrefix(cleanedPath, "http://") || strings.HasPrefix(cleanedPath, "https://") {
		if slash := strings.Index(cleanedPath[strings.Index(cleanedPath, "://")+3:], "/"); slash >= 0 {
			prefixLength := strings.Index(cleanedPath, "://") + 3 + slash + 1
			cleanedPath = cleanedPath[prefixLength:]
		}
	}

	cleanedPath = parenthesizedSourcePathPrefix.ReplaceAllString(cleanedPath, "")
	return strings.TrimPrefix(cleanedPath, "./")
}

func normalizeFilePath(filePath string) string {
	return strings.ReplaceAll(filePath, "\\", "/")
}

func isAbsoluteFilePath(filePath string) bool {
	return strings.HasPrefix(filePath, "/") || strings.HasPrefix(filePath, "//") || isWindowsDrivePath(filePath)
}

func isWindowsDrivePath(filePath string) bool {
	if len(filePath) < 3 {
		return false
	}
	return ((filePath[0] >= 'a' && filePath[0] <= 'z') || (filePath[0] >= 'A' && filePath[0] <= 'Z')) &&
		filePath[1] == ':' && filePath[2] == '/'
}

func createTerminalSessionEnvironment(baseEnvironment map[string]string) map[string]string {
	environment := map[string]string{}
	for key, value := range baseEnvironment {
		environment[key] = value
	}
	environment["COLORTERM"] = terminalSessionEnvironmentColorTerm
	environment["TERM"] = terminalSessionEnvironmentTerm
	environment["TERM_PROGRAM"] = terminalSessionEnvironmentProgram
	return environment
}

func readCurrentEnvironmentMap() map[string]string {
	environment := map[string]string{}
	for _, entry := range os.Environ() {
		parts := strings.SplitN(entry, "=", 2)
		if len(parts) != 2 {
			continue
		}
		environment[parts[0]] = parts[1]
	}
	return environment
}

func launchEditorTerminalSession(componentEditor string, projectRootPath string, request terminalSessionRequest, onData func([]byte)) (*launchedTerminalSession, error) {
	command, err := createEditorTerminalCommand(componentEditor, request, projectRootPath)
	if err != nil {
		return nil, err
	}

	return launchTerminalCommand(command, projectRootPath, map[string]string{}, onData, func() {})
}

func launchTerminalCommand(command []string, cwd string, extraEnvironment map[string]string, onData func([]byte), cleanup func()) (*launchedTerminalSession, error) {
	if len(command) == 0 {
		return nil, fmt.Errorf("terminal command is required")
	}

	mergedEnvironment := readCurrentEnvironmentMap()
	for key, value := range extraEnvironment {
		mergedEnvironment[key] = value
	}

	cmd := exec.Command(command[0], command[1:]...)
	cmd.Dir = cwd
	cmd.Env = stableEnvironmentSlice(createTerminalSessionEnvironment(mergedEnvironment))

	ptyFile, err := pty.StartWithSize(cmd, &pty.Winsize{Cols: defaultTerminalColumns, Rows: defaultTerminalRows})
	if err != nil {
		return nil, fmt.Errorf("start terminal session: %w", err)
	}

	var closeOnce sync.Once
	var readWG sync.WaitGroup
	readWG.Add(1)
	go func() {
		defer readWG.Done()
		buffer := make([]byte, 4096)
		for {
			count, readErr := ptyFile.Read(buffer)
			if count > 0 {
				chunk := append([]byte(nil), buffer[:count]...)
				onData(chunk)
			}
			if readErr != nil {
				return
			}
		}
	}()

	closeSession := func() {
		closeOnce.Do(func() {
			_ = ptyFile.Close()
			if cmd.Process != nil {
				_ = cmd.Process.Signal(syscall.SIGTERM)
			}
		})
	}

	return &launchedTerminalSession{
		cleanup: cleanup,
		close:   closeSession,
		resize: func(cols int, rows int) {
			_ = pty.Setsize(ptyFile, &pty.Winsize{Cols: uint16(cols), Rows: uint16(rows)})
		},
		wait: func() terminalSessionExitStatus {
			_ = cmd.Wait()
			readWG.Wait()

			exitCode, signalCode := readProcessExit(cmd.ProcessState)
			return terminalSessionExitStatus{ExitCode: exitCode, SignalCode: signalCode, Type: "exit"}
		},
		write: func(data string) {
			_, _ = ptyFile.Write([]byte(data))
		},
	}, nil
}

func readProcessExit(processState *os.ProcessState) (*int, *string) {
	if processState == nil {
		return nil, nil
	}
	if status, ok := processState.Sys().(syscall.WaitStatus); ok && status.Signaled() {
		signalCode := status.Signal().String()
		return nil, &signalCode
	}

	exitCode := processState.ExitCode()
	return &exitCode, nil
}
