package devtools

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/manifest"
)

const (
	agentTransportMode              = "files"
	agentSessionDirectoryPrefix     = "devhost-agent-session-"
	annotationActionDirectoryPrefix = "devhost-annotation-action-"
	annotationActionFileName        = "annotation.json"
	annotationActionPromptFileName  = "prompt.txt"
	claudeSettingsFileName          = "claude-settings.json"
	opencodeConfigFileName          = "opencode-config.jsonc"
	opencodePluginFileName          = "opencode-plugin.ts"
	piStatusExtensionFileName       = "register-agent-status.js"
	agentAnnotationFileName         = "annotation.json"
	agentPromptFileName             = "prompt.txt"
	annotationQueueResumePromptText = "Please read the annotation details from %s and address the requested change.\r"
)

type terminalSessionCommand struct {
	cleanup func()
	command []string
	cwd     string
	env     map[string]string
}

func createTerminalSessionCommand(actions []manifest.ValidatedAnnotationAction, componentEditor string, projectRootPath string, request terminalSessionRequest, stackName string, editorIntegration editorTerminalIntegration) (*terminalSessionCommand, error) {
	if request.Kind == terminalSessionRequestKindAgent || request.Kind == terminalSessionRequestKindCommand {
		if request.Annotation == nil {
			return nil, fmt.Errorf("annotation terminal payload is required")
		}
		action, ok := findAnnotationAction(actions, request.ActionID)
		if !ok {
			return nil, fmt.Errorf("Unsupported annotation action: %s", request.ActionID)
		}
		if action.Kind != request.Kind {
			return nil, fmt.Errorf("Annotation action %s cannot start %s terminal sessions.", action.ID, request.Kind)
		}
		if request.Kind == terminalSessionRequestKindAgent {
			return createAgentTerminalCommand(action, projectRootPath, *request.Annotation, stackName)
		}
		return createCommandAnnotationTerminalCommand(action, projectRootPath, *request.Annotation, stackName)
	}

	return createEditorTerminalCommand(componentEditor, request, projectRootPath, stackName, editorIntegration)
}

func findAnnotationAction(actions []manifest.ValidatedAnnotationAction, actionID string) (manifest.ValidatedAnnotationAction, bool) {
	if actionID == "" {
		actionID = defaultAnnotationActionID
	}
	for _, action := range actions {
		if action.ID == actionID {
			return action, true
		}
	}
	return manifest.ValidatedAnnotationAction{}, false
}

func createAgentTerminalCommand(action manifest.ValidatedAnnotationAction, projectRootPath string, annotation annotationSubmitDetail, stackName string) (*terminalSessionCommand, error) {
	agent := action.Agent
	prompt := createAnnotationAgentPrompt(annotation)
	sessionFiles, err := createAgentSessionFiles(annotation, action.ID, action.DisplayName, agent.DisplayName, projectRootPath, prompt, stackName)
	if err != nil {
		return nil, err
	}

	command := []string{}
	env := copyStringMap(sessionFiles.env)
	cwd := projectRootPath

	switch agent.Kind {
	case "pi":
		command = []string{"pi", "-e", sessionFiles.piExtensionFilePath, "@" + sessionFiles.env["DEVHOST_AGENT_PROMPT_FILE"]}
	case "claude-code":
		command = []string{
			"claude",
			"--settings",
			sessionFiles.env["DEVHOST_AGENT_CLAUDE_SETTINGS_FILE"],
			fmt.Sprintf("Please read the annotation details from %s and address the requested change.", sessionFiles.env["DEVHOST_AGENT_PROMPT_FILE"]),
		}
	case "opencode":
		env["OPENCODE_CONFIG"] = sessionFiles.env["DEVHOST_AGENT_OPENCODE_CONFIG_FILE"]
		command = []string{
			"opencode",
			"run",
			fmt.Sprintf("Please read the annotation details from %s and address the requested change.", sessionFiles.env["DEVHOST_AGENT_PROMPT_FILE"]),
		}
	case "configured":
		command = append([]string{}, agent.Command...)
		cwd = agent.Cwd
		for key, value := range agent.Env {
			env[key] = value
		}
	default:
		sessionFiles.cleanup()
		return nil, fmt.Errorf("Unsupported agent adapter: %s", agent.Kind)
	}

	return &terminalSessionCommand{
		cleanup: sessionFiles.cleanup,
		command: command,
		cwd:     cwd,
		env:     env,
	}, nil
}

func createCommandAnnotationTerminalCommand(action manifest.ValidatedAnnotationAction, projectRootPath string, annotation annotationSubmitDetail, stackName string) (*terminalSessionCommand, error) {
	prompt := createAnnotationAgentPrompt(annotation)
	sessionFiles, err := createAnnotationActionSessionFiles(annotation, action.ID, action.Kind, action.DisplayName, projectRootPath, prompt, stackName)
	if err != nil {
		return nil, err
	}
	env := copyStringMap(sessionFiles.env)
	for key, value := range action.Env {
		env[key] = value
	}
	return &terminalSessionCommand{
		cleanup: sessionFiles.cleanup,
		command: append([]string{}, action.Command...),
		cwd:     action.Cwd,
		env:     env,
	}, nil
}

type annotationActionSessionFiles struct {
	cleanup func()
	env     map[string]string
}

func createAnnotationActionSessionFiles(annotation annotationSubmitDetail, actionID string, actionKind string, actionLabel string, projectRootPath string, prompt string, stackName string) (*annotationActionSessionFiles, error) {
	sessionDirectoryPath, err := os.MkdirTemp("", annotationActionDirectoryPrefix)
	if err != nil {
		return nil, fmt.Errorf("create annotation action session directory: %w", err)
	}
	cleanup := func() {
		_ = os.RemoveAll(sessionDirectoryPath)
	}

	annotationFilePath := filepath.Join(sessionDirectoryPath, annotationActionFileName)
	promptFilePath := filepath.Join(sessionDirectoryPath, annotationActionPromptFileName)
	annotationJSON, err := json.MarshalIndent(annotation, "", "  ")
	if err != nil {
		cleanup()
		return nil, fmt.Errorf("marshal annotation action file: %w", err)
	}
	if err := os.WriteFile(annotationFilePath, annotationJSON, 0o600); err != nil {
		cleanup()
		return nil, fmt.Errorf("write annotation action file: %w", err)
	}
	if err := os.WriteFile(promptFilePath, []byte(prompt), 0o600); err != nil {
		cleanup()
		return nil, fmt.Errorf("write annotation action prompt file: %w", err)
	}

	return &annotationActionSessionFiles{
		cleanup: cleanup,
		env: map[string]string{
			"DEVHOST_ANNOTATION_ACTION_ID":    actionID,
			"DEVHOST_ANNOTATION_ACTION_KIND":  actionKind,
			"DEVHOST_ANNOTATION_ACTION_LABEL": actionLabel,
			"DEVHOST_ANNOTATION_DISPLAY_NAME": actionLabel,
			"DEVHOST_ANNOTATION_FILE":         annotationFilePath,
			"DEVHOST_ANNOTATION_PROMPT_FILE":  promptFilePath,
			"DEVHOST_ANNOTATION_TRANSPORT":    agentTransportMode,
			"DEVHOST_PROJECT_ROOT":            projectRootPath,
			"DEVHOST_STACK_NAME":              stackName,
		},
	}, nil
}

type agentSessionFiles struct {
	cleanup             func()
	env                 map[string]string
	piExtensionFilePath string
}

func createAgentSessionFiles(annotation annotationSubmitDetail, actionID string, actionLabel string, agentDisplayName string, projectRootPath string, prompt string, stackName string) (*agentSessionFiles, error) {
	sessionDirectoryPath, err := os.MkdirTemp("", agentSessionDirectoryPrefix)
	if err != nil {
		return nil, fmt.Errorf("create agent session directory: %w", err)
	}
	cleanup := func() {
		_ = os.RemoveAll(sessionDirectoryPath)
	}

	annotationFilePath := filepath.Join(sessionDirectoryPath, agentAnnotationFileName)
	promptFilePath := filepath.Join(sessionDirectoryPath, agentPromptFileName)
	claudeSettingsFilePath := filepath.Join(sessionDirectoryPath, claudeSettingsFileName)
	opencodePluginFilePath := filepath.Join(sessionDirectoryPath, opencodePluginFileName)
	opencodeConfigFilePath := filepath.Join(sessionDirectoryPath, opencodeConfigFileName)
	piExtensionFilePath := filepath.Join(sessionDirectoryPath, piStatusExtensionFileName)

	annotationJSON, err := json.MarshalIndent(annotation, "", "  ")
	if err != nil {
		cleanup()
		return nil, fmt.Errorf("marshal annotation session file: %w", err)
	}
	if err := os.WriteFile(annotationFilePath, annotationJSON, 0o600); err != nil {
		cleanup()
		return nil, fmt.Errorf("write annotation session file: %w", err)
	}
	if err := os.WriteFile(promptFilePath, []byte(prompt), 0o600); err != nil {
		cleanup()
		return nil, fmt.Errorf("write agent prompt file: %w", err)
	}

	claudeSettings := map[string]any{
		"hooks": map[string]any{
			"SessionStart":     []map[string]any{{"matcher": "", "hooks": []map[string]string{{"type": "command", "command": "printf '\\x1b]1337;SetAgentStatus=working\\x07'"}}}},
			"UserPromptSubmit": []map[string]any{{"matcher": "", "hooks": []map[string]string{{"type": "command", "command": "printf '\\x1b]1337;SetAgentStatus=working\\x07'"}}}},
			"Stop":             []map[string]any{{"matcher": "", "hooks": []map[string]string{{"type": "command", "command": "printf '\\x1b]1337;SetAgentStatus=finished\\x07'"}}}},
			"SessionEnd":       []map[string]any{{"matcher": "", "hooks": []map[string]string{{"type": "command", "command": "printf '\\x1b]1337;SetAgentStatus=finished\\x07'"}}}},
		},
	}
	claudeJSON, err := json.MarshalIndent(claudeSettings, "", "  ")
	if err != nil {
		cleanup()
		return nil, fmt.Errorf("marshal Claude settings file: %w", err)
	}
	if err := os.WriteFile(claudeSettingsFilePath, claudeJSON, 0o600); err != nil {
		cleanup()
		return nil, fmt.Errorf("write Claude settings file: %w", err)
	}

	opencodePlugin := "export default async function() {\n" +
		"  return {\n" +
		"    event: async ({ event }) => {\n" +
		"      if (event.type === 'session.status' && event.properties?.status?.type === 'running') {\n" +
		"        process.stdout.write('\\x1b]1337;SetAgentStatus=working\\x07');\n" +
		"      }\n" +
		"      if (event.type === 'session.idle' || (event.type === 'session.status' && event.properties?.status?.type === 'idle')) {\n" +
		"        process.stdout.write('\\x1b]1337;SetAgentStatus=finished\\x07');\n" +
		"      }\n" +
		"    }\n" +
		"  };\n" +
		"}"
	if err := os.WriteFile(opencodePluginFilePath, []byte(opencodePlugin), 0o600); err != nil {
		cleanup()
		return nil, fmt.Errorf("write OpenCode plugin file: %w", err)
	}

	opencodeConfigJSON, err := json.MarshalIndent(map[string][]string{"plugin": []string{opencodePluginFilePath}}, "", "  ")
	if err != nil {
		cleanup()
		return nil, fmt.Errorf("marshal OpenCode config file: %w", err)
	}
	if err := os.WriteFile(opencodeConfigFilePath, opencodeConfigJSON, 0o600); err != nil {
		cleanup()
		return nil, fmt.Errorf("write OpenCode config file: %w", err)
	}

	piExtension := "module.exports = function registerAgentStatusExtension(pi) {\n" +
		"  pi.on('agent_start', () => {\n" +
		"    process.stdout.write('\\x1b]1337;SetAgentStatus=working\\x07');\n" +
		"  });\n" +
		"  pi.on('agent_end', () => {\n" +
		"    process.stdout.write('\\x1b]1337;SetAgentStatus=finished\\x07');\n" +
		"  });\n" +
		"};\n"
	if err := os.WriteFile(piExtensionFilePath, []byte(piExtension), 0o600); err != nil {
		cleanup()
		return nil, fmt.Errorf("write Pi extension file: %w", err)
	}

	return &agentSessionFiles{
		cleanup: cleanup,
		env: map[string]string{
			"DEVHOST_ANNOTATION_ACTION_ID":       actionID,
			"DEVHOST_ANNOTATION_ACTION_KIND":     terminalSessionRequestKindAgent,
			"DEVHOST_ANNOTATION_ACTION_LABEL":    actionLabel,
			"DEVHOST_ANNOTATION_DISPLAY_NAME":    actionLabel,
			"DEVHOST_ANNOTATION_FILE":            annotationFilePath,
			"DEVHOST_ANNOTATION_PROMPT_FILE":     promptFilePath,
			"DEVHOST_ANNOTATION_TRANSPORT":       agentTransportMode,
			"DEVHOST_AGENT_ANNOTATION_FILE":      annotationFilePath,
			"DEVHOST_AGENT_CLAUDE_SETTINGS_FILE": claudeSettingsFilePath,
			"DEVHOST_AGENT_DISPLAY_NAME":         agentDisplayName,
			"DEVHOST_AGENT_OPENCODE_CONFIG_FILE": opencodeConfigFilePath,
			"DEVHOST_AGENT_PROMPT_FILE":          promptFilePath,
			"DEVHOST_AGENT_TRANSPORT":            agentTransportMode,
			"DEVHOST_PROJECT_ROOT":               projectRootPath,
			"DEVHOST_STACK_NAME":                 stackName,
		},
		piExtensionFilePath: piExtensionFilePath,
	}, nil
}

func createAnnotationAgentPrompt(annotation annotationSubmitDetail) string {
	builder := &strings.Builder{}
	builder.WriteString("You are responding to a browser annotation captured by devhost.\n")
	builder.WriteString("Use the annotation context below to inspect the local codebase and drive the requested change.\n\n")
	builder.WriteString("## Requested change\n")
	builder.WriteString(annotation.Comment)
	builder.WriteString("\n\n## Page context\n")
	_, _ = fmt.Fprintf(builder, "- Stack: %s\n", annotation.StackName)
	_, _ = fmt.Fprintf(builder, "- URL: %s\n", annotation.URL)
	_, _ = fmt.Fprintf(builder, "- Title: %s\n", annotation.Title)
	_, _ = fmt.Fprintf(builder, "- Submitted at: %s\n\n", time.UnixMilli(annotation.SubmittedAt).UTC().Format(time.RFC3339))
	builder.WriteString("## Annotated markers\n")
	if len(annotation.Markers) == 0 {
		builder.WriteString("(none)\n")
	} else {
		for index, marker := range annotation.Markers {
			if index > 0 {
				builder.WriteString("\n")
			}
			writeAnnotationMarkerSection(builder, marker)
		}
	}
	builder.WriteString("\n## Required behavior\n")
	builder.WriteString("- Inspect the local codebase before proposing changes.\n")
	builder.WriteString("- Use the marker references (#1, #2, ...) when reasoning about the requested UI or behavior.\n")
	builder.WriteString("- If the request is ambiguous, ask clarifying questions before making irreversible changes.\n")
	builder.WriteString("- Prefer correct, durable fixes over quick workarounds.\n")
	return builder.String()
}

func writeAnnotationMarkerSection(builder *strings.Builder, marker annotationMarkerPayload) {
	selectedText := "(none)"
	if marker.SelectedText != nil && *marker.SelectedText != "" {
		selectedText = *marker.SelectedText
	}
	_, _ = fmt.Fprintf(builder, "### Marker #%d\n", marker.MarkerNumber)
	_, _ = fmt.Fprintf(builder, "- Full path: %s\n", orPlaceholder(marker.FullPath))
	_, _ = fmt.Fprintf(builder, "- Accessibility: %s\n", orPlaceholder(marker.Accessibility))
	_, _ = fmt.Fprintf(builder, "- Nearby text: %s\n", orPlaceholder(marker.NearbyText))
	_, _ = fmt.Fprintf(builder, "- Nearby elements: %s\n", orPlaceholder(marker.NearbyElements))
	_, _ = fmt.Fprintf(builder, "- Selected text: %s\n", selectedText)
	_, _ = fmt.Fprintf(builder, "- Source location: %s\n", formatAnnotationSourceLocation(marker.SourceLocation))
	_, _ = fmt.Fprintf(builder, "- Fixed positioned: %s\n", map[bool]string{true: "yes", false: "no"}[marker.IsFixed])
	_, _ = fmt.Fprintf(builder, "- Bounding box: x=%g, y=%g, width=%g, height=%g\n", marker.BoundingBox.X, marker.BoundingBox.Y, marker.BoundingBox.Width, marker.BoundingBox.Height)
	builder.WriteString("- Computed styles:\n")
	builder.WriteString(orPlaceholder(marker.ComputedStyles))
	builder.WriteString("\n")
}

func formatAnnotationSourceLocation(source *sourceLocation) string {
	if source == nil {
		return "(not available)"
	}
	columnSuffix := ""
	if source.ColumnNumber != nil {
		columnSuffix = fmt.Sprintf(":%d", *source.ColumnNumber)
	}
	componentPrefix := ""
	if source.ComponentName != nil && *source.ComponentName != "" {
		componentPrefix = *source.ComponentName + " @ "
	}
	return fmt.Sprintf("%s%s:%d%s", componentPrefix, source.FileName, source.LineNumber, columnSuffix)
}

func orPlaceholder(value string) string {
	if value == "" {
		return "(none)"
	}
	return value
}

func copyStringMap(source map[string]string) map[string]string {
	result := map[string]string{}
	for key, value := range source {
		result[key] = value
	}
	return result
}

func stableEnvironmentSlice(environment map[string]string) []string {
	keys := make([]string, 0, len(environment))
	for key := range environment {
		keys = append(keys, key)
	}
	sort.Strings(keys)

	entries := make([]string, 0, len(keys))
	for _, key := range keys {
		entries = append(entries, key+"="+environment[key])
	}
	return entries
}
