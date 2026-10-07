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
	annotationFileName              = "annotation.json"
	annotationPromptFileName        = "prompt.txt"
	claudeSettingsFileName          = "claude-settings.json"
	opencodeConfigFileName          = "opencode-config.jsonc"
	opencodePluginFileName          = "opencode-plugin.ts"
	piStatusExtensionFileName       = "register-agent-status.js"
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
		action, err := resolveAnnotationSessionAction(actions, request)
		if err != nil {
			return nil, err
		}
		if request.Kind == terminalSessionRequestKindAgent {
			return createAgentTerminalCommand(action, projectRootPath, *request.Annotation, request.ColorScheme, stackName)
		}
		return createCommandAnnotationTerminalCommand(action, projectRootPath, *request.Annotation, stackName)
	}

	return createEditorTerminalCommand(componentEditor, request, projectRootPath, stackName, editorIntegration)
}

// resolveAnnotationSessionAction returns the configured action an annotation session request names.
func resolveAnnotationSessionAction(actions []manifest.ValidatedAnnotationAction, request terminalSessionRequest) (manifest.ValidatedAnnotationAction, error) {
	action, ok := findAnnotationAction(actions, request.ActionID)
	if !ok {
		return manifest.ValidatedAnnotationAction{}, fmt.Errorf("Unsupported annotation action: %s", request.ActionID)
	}
	if action.Kind != request.Kind {
		return manifest.ValidatedAnnotationAction{}, fmt.Errorf("Annotation action %s cannot start %s terminal sessions.", action.ID, request.Kind)
	}
	return action, nil
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

func createAgentTerminalCommand(action manifest.ValidatedAnnotationAction, projectRootPath string, annotation annotationSubmitDetail, colorScheme agentColorScheme, stackName string) (*terminalSessionCommand, error) {
	agent := action.Agent
	sessionFiles, err := createAnnotationSessionFiles(agentSessionDirectoryPrefix, annotationSessionFilesOptions{
		action:          action,
		annotation:      annotation,
		projectRootPath: projectRootPath,
		stackName:       stackName,
	})
	if err != nil {
		return nil, err
	}
	fail := func(err error) (*terminalSessionCommand, error) {
		sessionFiles.cleanup()
		return nil, err
	}

	command := []string{}
	env := copyStringMap(sessionFiles.env)
	cwd := projectRootPath
	instruction := createAnnotationPromptInstruction(sessionFiles.promptFilePath)

	// Each built-in adapter writes only the support file it loads to report agent status.
	switch agent.Kind {
	case "pi":
		extensionFilePath, err := writePiStatusExtension(sessionFiles.directoryPath)
		if err != nil {
			return fail(err)
		}
		command = []string{"pi", "-e", extensionFilePath}
		if colorScheme != "" {
			// pi's built-in light and dark themes match the devtools terminal palette; without the flag pi
			// guesses from terminal queries and falls back to dark.
			command = append(command, "--use-theme", string(colorScheme))
		}
		command = append(command, agent.Args...)
		command = append(command, "@"+sessionFiles.promptFilePath)
	case "claude-code":
		settingsFilePath, err := writeClaudeSettings(sessionFiles.directoryPath, colorScheme)
		if err != nil {
			return fail(err)
		}
		command = []string{
			"claude",
			"--settings",
			settingsFilePath,
		}
		command = append(command, agent.Args...)
		command = append(command, instruction)
	case "opencode":
		configFilePath, err := writeOpencodeConfig(sessionFiles.directoryPath)
		if err != nil {
			return fail(err)
		}
		env["OPENCODE_CONFIG"] = configFilePath
		command = []string{
			"opencode",
			"run",
		}
		command = append(command, agent.Args...)
		command = append(command, instruction)
	case "codex":
		env[codexStatusTTYEnvironmentName] = ""
		command = codexTerminalCommand()
		command = append(command, agent.Args...)
		command = append(command, instruction)
	case "configured":
		command = append([]string{}, agent.Command...)
		cwd = agent.Cwd
		for key, value := range agent.Env {
			env[key] = value
		}
	default:
		return fail(fmt.Errorf("Unsupported agent adapter: %s", agent.Kind))
	}

	return &terminalSessionCommand{
		cleanup: sessionFiles.cleanup,
		command: command,
		cwd:     cwd,
		env:     env,
	}, nil
}

func createCommandAnnotationTerminalCommand(action manifest.ValidatedAnnotationAction, projectRootPath string, annotation annotationSubmitDetail, stackName string) (*terminalSessionCommand, error) {
	sessionFiles, err := createAnnotationSessionFiles(annotationActionDirectoryPrefix, annotationSessionFilesOptions{
		action:          action,
		annotation:      annotation,
		projectRootPath: projectRootPath,
		stackName:       stackName,
	})
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

// annotationSessionFiles are the files every annotation action receives and the environment that points at them.
type annotationSessionFiles struct {
	cleanup        func()
	directoryPath  string
	env            map[string]string
	promptFilePath string
}

type annotationSessionFilesOptions struct {
	action          manifest.ValidatedAnnotationAction
	annotation      annotationSubmitDetail
	projectRootPath string
	stackName       string
}

func createAnnotationSessionDirectory(tempDir *string, prefix string) (string, error) {
	base := ""
	if tempDir != nil {
		base = *tempDir
		if err := os.MkdirAll(base, 0o700); err != nil {
			return "", fmt.Errorf("create annotation temp directory %q: %w", base, err)
		}
	}
	return os.MkdirTemp(base, prefix)
}

func createAnnotationSessionFiles(directoryPrefix string, options annotationSessionFilesOptions) (*annotationSessionFiles, error) {
	directoryPath, err := createAnnotationSessionDirectory(options.action.TempDir, directoryPrefix)
	if err != nil {
		return nil, fmt.Errorf("create annotation session directory: %w", err)
	}
	cleanup := func() {
		_ = os.RemoveAll(directoryPath)
	}

	annotationFilePath := filepath.Join(directoryPath, annotationFileName)
	promptFilePath := filepath.Join(directoryPath, annotationPromptFileName)
	annotationJSON, err := json.MarshalIndent(options.annotation, "", "  ")
	if err != nil {
		cleanup()
		return nil, fmt.Errorf("marshal annotation file: %w", err)
	}
	if err := os.WriteFile(annotationFilePath, annotationJSON, 0o600); err != nil {
		cleanup()
		return nil, fmt.Errorf("write annotation file: %w", err)
	}
	if err := os.WriteFile(promptFilePath, []byte(createAnnotationAgentPrompt(options.annotation)), 0o600); err != nil {
		cleanup()
		return nil, fmt.Errorf("write annotation prompt file: %w", err)
	}

	return &annotationSessionFiles{
		cleanup:       cleanup,
		directoryPath: directoryPath,
		env: map[string]string{
			"DEVHOST_ANNOTATION_ACTION_ID":    options.action.ID,
			"DEVHOST_ANNOTATION_ACTION_KIND":  options.action.Kind,
			"DEVHOST_ANNOTATION_ACTION_LABEL": options.action.Label,
			"DEVHOST_ANNOTATION_FILE":         annotationFilePath,
			"DEVHOST_ANNOTATION_PROMPT_FILE":  promptFilePath,
			"DEVHOST_ANNOTATION_TRANSPORT":    agentTransportMode,
			"DEVHOST_PROJECT_ROOT":            options.projectRootPath,
			"DEVHOST_STACK_NAME":              options.stackName,
		},
		promptFilePath: promptFilePath,
	}, nil
}

// createAnnotationPromptInstruction is the message that points an agent at its rendered annotation prompt.
func createAnnotationPromptInstruction(promptFilePath string) string {
	return fmt.Sprintf("Please read the annotation details from %s and address the requested change.", promptFilePath)
}

// writeClaudeSettings writes the Claude Code settings whose hooks report agent status. colorScheme becomes the theme
// when set; empty leaves the user's own theme in effect.
func writeClaudeSettings(directoryPath string, colorScheme agentColorScheme) (string, error) {
	settings := map[string]any{
		"hooks": map[string]any{
			"SessionStart":     []map[string]any{{"matcher": "", "hooks": []map[string]string{{"type": "command", "command": "printf '\\x1b]1337;SetAgentStatus=working\\x07'"}}}},
			"UserPromptSubmit": []map[string]any{{"matcher": "", "hooks": []map[string]string{{"type": "command", "command": "printf '\\x1b]1337;SetAgentStatus=working\\x07'"}}}},
			"Stop":             []map[string]any{{"matcher": "", "hooks": []map[string]string{{"type": "command", "command": "printf '\\x1b]1337;SetAgentStatus=finished\\x07'"}}}},
			"SessionEnd":       []map[string]any{{"matcher": "", "hooks": []map[string]string{{"type": "command", "command": "printf '\\x1b]1337;SetAgentStatus=finished\\x07'"}}}},
		},
	}
	if colorScheme != "" {
		settings["theme"] = string(colorScheme)
	}
	settingsJSON, err := json.MarshalIndent(settings, "", "  ")
	if err != nil {
		return "", fmt.Errorf("marshal Claude settings file: %w", err)
	}
	settingsFilePath := filepath.Join(directoryPath, claudeSettingsFileName)
	if err := os.WriteFile(settingsFilePath, settingsJSON, 0o600); err != nil {
		return "", fmt.Errorf("write Claude settings file: %w", err)
	}
	return settingsFilePath, nil
}

// writeOpencodeConfig writes the OpenCode plugin that reports agent status and the config that loads it, and returns
// the config path.
func writeOpencodeConfig(directoryPath string) (string, error) {
	plugin := "export default async function() {\n" +
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
	pluginFilePath := filepath.Join(directoryPath, opencodePluginFileName)
	if err := os.WriteFile(pluginFilePath, []byte(plugin), 0o600); err != nil {
		return "", fmt.Errorf("write OpenCode plugin file: %w", err)
	}

	configJSON, err := json.MarshalIndent(map[string][]string{"plugin": {pluginFilePath}}, "", "  ")
	if err != nil {
		return "", fmt.Errorf("marshal OpenCode config file: %w", err)
	}
	configFilePath := filepath.Join(directoryPath, opencodeConfigFileName)
	if err := os.WriteFile(configFilePath, configJSON, 0o600); err != nil {
		return "", fmt.Errorf("write OpenCode config file: %w", err)
	}
	return configFilePath, nil
}

// writePiStatusExtension writes the Pi extension that reports agent status.
func writePiStatusExtension(directoryPath string) (string, error) {
	extension := "module.exports = function registerAgentStatusExtension(pi) {\n" +
		"  pi.on('agent_start', () => {\n" +
		"    process.stdout.write('\\x1b]1337;SetAgentStatus=working\\x07');\n" +
		"  });\n" +
		"  pi.on('agent_end', () => {\n" +
		"    process.stdout.write('\\x1b]1337;SetAgentStatus=finished\\x07');\n" +
		"  });\n" +
		"};\n"
	extensionFilePath := filepath.Join(directoryPath, piStatusExtensionFileName)
	if err := os.WriteFile(extensionFilePath, []byte(extension), 0o600); err != nil {
		return "", fmt.Errorf("write Pi extension file: %w", err)
	}
	return extensionFilePath, nil
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
