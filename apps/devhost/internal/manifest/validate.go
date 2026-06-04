package manifest

import (
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

const (
	defaultManagedCaddyAdminAddress = "127.0.0.1:20197"
	defaultManagedCaddyBindHost     = "127.0.0.1"
	defaultManagedCaddyHTTPPort     = 80
	defaultManagedCaddyHTTPSPort    = 443
	defaultDevtoolsEditor           = "vscode"
	defaultDevtoolsStatusPosition   = "bottom-right"
	defaultAnnotationActionID       = "agent"
	defaultServiceBindHost          = "127.0.0.1"
)

var (
	serviceNamePattern = regexp.MustCompile(`^[a-z][a-z0-9-]*$`)
	hostPattern        = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$`)
)

func ValidateManifest(manifestPath string, rawManifest RawManifest) (Manifest, error) {
	manifestDirectoryPath := filepath.Dir(manifestPath)
	schemaIssues := []string{}
	validationIssues := []string{}
	manifestValue := rawManifest.value

	allowKeys(manifestValue, []string{"annotation", "caddy", "devtools", "name", "services"}, "", &schemaIssues)

	name, ok := readRequiredNonEmptyString(manifestValue, "name", &schemaIssues)
	if !ok {
		name = ""
	}

	validatedAnnotation := validateAnnotation(manifestValue["annotation"], manifestDirectoryPath, &schemaIssues, &validationIssues)
	validatedCaddy := validateCaddy(manifestValue["caddy"], &schemaIssues)
	validatedDevtools := validateDevtools(manifestValue["devtools"], &schemaIssues)
	validatedServices, primaryService := validateServices(
		manifestValue["services"],
		rawManifest.serviceOrder,
		manifestDirectoryPath,
		&schemaIssues,
		&validationIssues,
	)

	if len(schemaIssues) > 0 {
		return Manifest{}, fmt.Errorf("Manifest schema is invalid:\n%s", strings.Join(schemaIssues, "\n"))
	}

	if len(validationIssues) > 0 {
		return Manifest{}, fmt.Errorf("Manifest validation failed:\n%s", strings.Join(validationIssues, "\n"))
	}

	return Manifest{
		Annotation:            validatedAnnotation,
		Caddy:                 validatedCaddy,
		Devtools:              validatedDevtools,
		ManifestDirectoryPath: manifestDirectoryPath,
		ManifestPath:          manifestPath,
		Name:                  name,
		PrimaryService:        primaryService,
		ServiceOrder:          append([]string{}, rawManifest.serviceOrder...),
		Services:              validatedServices,
	}, nil
}

func validateAnnotation(rawValue any, manifestDirectoryPath string, schemaIssues *[]string, validationIssues *[]string) ValidatedAnnotation {
	if rawValue == nil {
		return ValidatedAnnotation{}
	}

	value, ok := readMap(rawValue, "annotation", schemaIssues)
	if !ok {
		return ValidatedAnnotation{}
	}
	allowKeys(value, []string{"actions", "defaultAction"}, "annotation", schemaIssues)
	configuredDefaultActionID, hasConfiguredDefaultActionID := readOptionalNonEmptyString(value, "defaultAction", schemaIssues)

	rawActions, ok := value["actions"]
	if !ok {
		*schemaIssues = append(*schemaIssues, "annotation.actions must contain at least one action.")
		return ValidatedAnnotation{}
	}
	actionsValue, ok := rawActions.([]map[string]any)
	if !ok {
		if anyArray, arrayOK := rawActions.([]any); arrayOK {
			actionsValue = make([]map[string]any, 0, len(anyArray))
			for _, rawAction := range anyArray {
				actionValue, actionOK := readMap(rawAction, "annotation.actions", schemaIssues)
				if actionOK {
					actionsValue = append(actionsValue, actionValue)
				}
			}
		} else {
			*schemaIssues = append(*schemaIssues, "annotation.actions must be an array of tables.")
			return ValidatedAnnotation{}
		}
	}
	if len(actionsValue) == 0 {
		*schemaIssues = append(*schemaIssues, "annotation.actions must contain at least one action.")
		return ValidatedAnnotation{}
	}

	seenIDs := map[string]struct{}{}
	actions := make([]ValidatedAnnotationAction, 0, len(actionsValue))
	for index, actionValue := range actionsValue {
		action := validateAnnotationAction(index, actionValue, manifestDirectoryPath, schemaIssues, validationIssues)
		if action.ID == "" {
			continue
		}
		if _, ok := seenIDs[action.ID]; ok {
			*schemaIssues = append(*schemaIssues, fmt.Sprintf("annotation.actions id must be unique: %s", action.ID))
			continue
		}
		seenIDs[action.ID] = struct{}{}
		actions = append(actions, action)
	}

	defaultActionID := ""
	if len(actions) > 0 {
		defaultActionID = actions[0].ID
	}
	if hasConfiguredDefaultActionID {
		defaultActionID = configuredDefaultActionID
		if _, ok := seenIDs[configuredDefaultActionID]; !ok {
			*schemaIssues = append(*schemaIssues, fmt.Sprintf("annotation.defaultAction must reference an annotation action id: %s", configuredDefaultActionID))
		}
	}

	return ValidatedAnnotation{Actions: actions, DefaultActionID: defaultActionID}
}

func validateAnnotationAction(index int, value map[string]any, manifestDirectoryPath string, schemaIssues *[]string, validationIssues *[]string) ValidatedAnnotationAction {
	allowKeys(value, []string{"agent", "command", "id", "kind", "label"}, "annotation.actions", schemaIssues)

	actionID, hasID := readOptionalNonEmptyString(value, "id", schemaIssues)
	if !hasID {
		*schemaIssues = append(*schemaIssues, fmt.Sprintf("annotation.actions[%d].id Expected a non-empty string.", index))
		return ValidatedAnnotationAction{}
	}
	if !serviceNamePattern.MatchString(actionID) {
		*schemaIssues = append(*schemaIssues, fmt.Sprintf("annotation.actions.%s.id must match ^[a-z][a-z0-9-]*$.", actionID))
		return ValidatedAnnotationAction{}
	}

	actionKind, hasKind := readOptionalNonEmptyString(value, "kind", schemaIssues)
	if !hasKind {
		*schemaIssues = append(*schemaIssues, fmt.Sprintf("annotation.actions.%s.kind Expected a non-empty string.", actionID))
		return ValidatedAnnotationAction{}
	}

	actionLabel, hasLabel := readOptionalNonEmptyString(value, "label", schemaIssues)
	if !hasLabel {
		*schemaIssues = append(*schemaIssues, fmt.Sprintf("annotation.actions.%s.label Expected a non-empty string.", actionID))
		return ValidatedAnnotationAction{ID: actionID, Kind: actionKind}
	}

	switch actionKind {
	case "agent":
		return validateAgentAnnotationAction(actionID, actionLabel, value, manifestDirectoryPath, schemaIssues, validationIssues)
	case "command":
		return validateCommandAnnotationAction(actionID, actionLabel, value, manifestDirectoryPath, schemaIssues, validationIssues)
	default:
		*schemaIssues = append(*schemaIssues, fmt.Sprintf("annotation.actions.%s.kind must be one of agent or command.", actionID))
		return ValidatedAnnotationAction{}
	}
}

func validateAgentAnnotationAction(actionID string, actionLabel string, value map[string]any, manifestDirectoryPath string, schemaIssues *[]string, validationIssues *[]string) ValidatedAnnotationAction {
	if _, hasCommand := value["command"]; hasCommand {
		*schemaIssues = append(*schemaIssues, fmt.Sprintf("annotation.actions.%s agent actions must omit command.", actionID))
		return ValidatedAnnotationAction{DisplayName: actionLabel, ID: actionID, Kind: "agent"}
	}
	agentValue, ok := readMap(value["agent"], "annotation.actions."+actionID+".agent", schemaIssues)
	if !ok {
		return ValidatedAnnotationAction{DisplayName: actionLabel, ID: actionID, Kind: "agent"}
	}
	allowKeys(agentValue, []string{"adapter", "command", "cwd", "displayName", "env"}, "annotation.actions."+actionID+".agent", schemaIssues)
	agent := validateAgentActionFields("annotation.actions."+actionID+".agent", agentValue, manifestDirectoryPath, schemaIssues, validationIssues, false)
	if agent.DisplayName == "" || agent.Kind == "" {
		return ValidatedAnnotationAction{DisplayName: actionLabel, ID: actionID, Kind: "agent"}
	}
	return createAgentAnnotationAction(actionID, actionLabel, agent)
}

func validateCommandAnnotationAction(actionID string, actionLabel string, value map[string]any, manifestDirectoryPath string, schemaIssues *[]string, validationIssues *[]string) ValidatedAnnotationAction {
	if _, hasAgent := value["agent"]; hasAgent {
		*schemaIssues = append(*schemaIssues, fmt.Sprintf("annotation.actions.%s command actions must omit agent.", actionID))
		return ValidatedAnnotationAction{DisplayName: actionLabel, ID: actionID, Kind: "command"}
	}
	commandValue, ok := readMap(value["command"], "annotation.actions."+actionID+".command", schemaIssues)
	if !ok {
		return ValidatedAnnotationAction{DisplayName: actionLabel, ID: actionID, Kind: "command"}
	}
	allowKeys(commandValue, []string{"command", "cwd", "env"}, "annotation.actions."+actionID+".command", schemaIssues)
	command, hasCommand := readOptionalCommand(commandValue, "command", schemaIssues)
	if !hasCommand {
		*schemaIssues = append(*schemaIssues, fmt.Sprintf("annotation.actions.%s.command must define command.", actionID))
		return ValidatedAnnotationAction{DisplayName: actionLabel, ID: actionID, Kind: "command"}
	}
	cwd := "."
	if valueCwd, ok := readOptionalString(commandValue, "cwd", schemaIssues); ok {
		cwd = valueCwd
	}
	env := map[string]string{}
	if envValue, ok := readOptionalStringMap(commandValue, "env", schemaIssues); ok {
		env = envValue
	}
	return ValidatedAnnotationAction{
		Command:     command,
		Cwd:         resolveConstrainedPath("annotation.actions."+actionID+".cwd", cwd, manifestDirectoryPath, validationIssues),
		DisplayName: actionLabel,
		Env:         env,
		ID:          actionID,
		Kind:        "command",
	}
}

func createAgentAnnotationAction(actionID string, actionLabel string, agent ValidatedAgent) ValidatedAnnotationAction {
	return ValidatedAnnotationAction{Agent: agent, DisplayName: actionLabel, ID: actionID, Kind: "agent"}
}

func validateAgentActionFields(path string, value map[string]any, manifestDirectoryPath string, schemaIssues *[]string, validationIssues *[]string, allowAdapterDisplayName bool) ValidatedAgent {

	adapterValue, hasAdapter := readOptionalString(value, "adapter", schemaIssues)
	commandValue, hasCommand := readOptionalStringArray(value, "command", schemaIssues)
	displayName, hasDisplayName := readOptionalNonEmptyString(value, "displayName", schemaIssues)
	cwdValue, hasCwd := readOptionalString(value, "cwd", schemaIssues)
	envValue, hasEnv := readOptionalStringMap(value, "env", schemaIssues)

	if hasAdapter {
		if hasCommand || (!allowAdapterDisplayName && hasDisplayName) || hasCwd || hasEnv {
			*schemaIssues = append(*schemaIssues, fmt.Sprintf("%s must define either adapter or custom command fields, not both.", path))
			return ValidatedAgent{}
		}

		switch adapterValue {
		case "pi":
			return ValidatedAgent{DisplayName: readAdapterDisplayName("Pi", displayName, hasDisplayName), Kind: "pi"}
		case "claude-code":
			return ValidatedAgent{DisplayName: readAdapterDisplayName("Claude Code", displayName, hasDisplayName), Kind: "claude-code"}
		case "opencode":
			return ValidatedAgent{DisplayName: readAdapterDisplayName("OpenCode", displayName, hasDisplayName), Kind: "opencode"}
		default:
			*schemaIssues = append(*schemaIssues, fmt.Sprintf("%s.adapter must be one of pi, claude-code, or opencode.", path))
			return ValidatedAgent{}
		}
	}

	if !hasCommand || !hasDisplayName {
		*schemaIssues = append(*schemaIssues, fmt.Sprintf("%s must define adapter or both command and displayName.", path))
		return ValidatedAgent{}
	}

	cwd := "."
	if hasCwd {
		cwd = cwdValue
	}

	resolvedCwd := resolveConstrainedPath(path+".cwd", cwd, manifestDirectoryPath, validationIssues)
	validatedEnv := map[string]string{}
	if hasEnv {
		validatedEnv = envValue
	}

	return ValidatedAgent{
		Command:     commandValue,
		Cwd:         resolvedCwd,
		DisplayName: displayName,
		Env:         validatedEnv,
		Kind:        "configured",
	}
}

func readAdapterDisplayName(defaultValue string, displayName string, hasDisplayName bool) string {
	if hasDisplayName {
		return displayName
	}
	return defaultValue
}

func validateCaddy(rawValue any, schemaIssues *[]string) CaddyConfig {
	result := CaddyConfig{Global: CaddyGlobalConfig{
		AdminAddress: defaultManagedCaddyAdminAddress,
		BindHost:     defaultManagedCaddyBindHost,
		HTTP:         false,
		HTTPPort:     defaultManagedCaddyHTTPPort,
		HTTPSPort:    defaultManagedCaddyHTTPSPort,
	}}

	if rawValue == nil {
		return result
	}

	value, ok := readMap(rawValue, "caddy", schemaIssues)
	if !ok {
		return result
	}

	allowKeys(value, []string{"global"}, "caddy", schemaIssues)
	if value["global"] == nil {
		return result
	}

	globalValue, ok := readMap(value["global"], "caddy.global", schemaIssues)
	if !ok {
		return result
	}

	allowKeys(globalValue, []string{"adminAddress", "bindHost", "http", "httpPort", "httpsPort"}, "caddy.global", schemaIssues)

	if adminAddress, ok := readOptionalNonEmptyString(globalValue, "adminAddress", schemaIssues); ok {
		result.Global.AdminAddress = adminAddress
	}

	if bindHost, ok := readOptionalString(globalValue, "bindHost", schemaIssues); ok {
		if isAllowedBindHost(bindHost) {
			result.Global.BindHost = bindHost
		} else {
			*schemaIssues = append(*schemaIssues, "caddy.global.bindHost must be one of 127.0.0.1, 0.0.0.0, ::1, or ::.")
		}
	}

	if httpEnabled, ok := readOptionalBool(globalValue, "http", schemaIssues); ok {
		result.Global.HTTP = httpEnabled
	}

	if httpPort, ok := readOptionalPort(globalValue, "httpPort", "caddy.global.httpPort", schemaIssues); ok {
		result.Global.HTTPPort = httpPort
	}

	if httpsPort, ok := readOptionalPort(globalValue, "httpsPort", "caddy.global.httpsPort", schemaIssues); ok {
		result.Global.HTTPSPort = httpsPort
	}

	return result
}

func validateDevtools(rawValue any, schemaIssues *[]string) DevtoolsConfig {
	result := DevtoolsConfig{
		Editor:           DevtoolsEditorConfig{Enabled: true, IDE: defaultDevtoolsEditor},
		ExternalToolbars: DevtoolsToggleConfig{Enabled: true},
		Minimap:          DevtoolsMinimapConfig{Enabled: true},
		Status:           DevtoolsStatusConfig{Enabled: true, Position: defaultDevtoolsStatusPosition},
		Shortcuts:        DevtoolsShortcutsConfig{RestartServices: "alt+shift+r"},
	}

	if rawValue == nil {
		return result
	}

	value, ok := readMap(rawValue, "devtools", schemaIssues)
	if !ok {
		return result
	}

	allowKeys(value, []string{"editor", "externalToolbars", "minimap", "status", "shortcuts"}, "devtools", schemaIssues)

	if rawEditor := value["editor"]; rawEditor != nil {
		editorValue, ok := readMap(rawEditor, "devtools.editor", schemaIssues)
		if ok {
			allowKeys(editorValue, []string{"enabled", "ide"}, "devtools.editor", schemaIssues)
			if enabled, ok := readOptionalBool(editorValue, "enabled", schemaIssues); ok {
				result.Editor.Enabled = enabled
			}
			if ide, ok := readOptionalString(editorValue, "ide", schemaIssues); ok {
				if isSupportedEditor(ide) {
					result.Editor.IDE = ide
				} else {
					*schemaIssues = append(*schemaIssues, "devtools.editor.ide must be one of cursor, neovim, vscode, vscode-insiders, or webstorm.")
				}
			}
		}
	}

	if rawExternalToolbars := value["externalToolbars"]; rawExternalToolbars != nil {
		externalToolbarsValue, ok := readMap(rawExternalToolbars, "devtools.externalToolbars", schemaIssues)
		if ok {
			allowKeys(externalToolbarsValue, []string{"enabled"}, "devtools.externalToolbars", schemaIssues)
			if enabled, ok := readOptionalBool(externalToolbarsValue, "enabled", schemaIssues); ok {
				result.ExternalToolbars.Enabled = enabled
			}
		}
	}

	if rawMinimap := value["minimap"]; rawMinimap != nil {
		minimapValue, ok := readMap(rawMinimap, "devtools.minimap", schemaIssues)
		if ok {
			allowKeys(minimapValue, []string{"enabled"}, "devtools.minimap", schemaIssues)
			if enabled, ok := readOptionalBool(minimapValue, "enabled", schemaIssues); ok {
				result.Minimap.Enabled = enabled
			}
		}
	}

	if rawStatus := value["status"]; rawStatus != nil {
		statusValue, ok := readMap(rawStatus, "devtools.status", schemaIssues)
		if ok {
			allowKeys(statusValue, []string{"enabled", "position"}, "devtools.status", schemaIssues)
			if enabled, ok := readOptionalBool(statusValue, "enabled", schemaIssues); ok {
				result.Status.Enabled = enabled
			}
			if position, ok := readOptionalString(statusValue, "position", schemaIssues); ok {
				if position == "top-right" || position == "bottom-right" {
					result.Status.Position = position
				} else {
					*schemaIssues = append(*schemaIssues, "devtools.status.position must be top-right or bottom-right.")
				}
			}
		}
	}

	if rawShortcuts := value["shortcuts"]; rawShortcuts != nil {
		shortcutsValue, ok := readMap(rawShortcuts, "devtools.shortcuts", schemaIssues)
		if ok {
			allowKeys(shortcutsValue, []string{"restart-services"}, "devtools.shortcuts", schemaIssues)
			if restartServices, ok := readOptionalString(shortcutsValue, "restart-services", schemaIssues); ok {
				if isValidShortcut(restartServices) {
					result.Shortcuts.RestartServices = restartServices
				} else {
					result.Shortcuts.RestartServices = "alt+shift+r"
				}
			}
		}
	}

	return result
}

func validateServices(
	rawValue any,
	serviceOrder []string,
	manifestDirectoryPath string,
	schemaIssues *[]string,
	validationIssues *[]string,
) (map[string]ValidatedService, string) {
	validatedServices := map[string]ValidatedService{}
	if rawValue == nil {
		*schemaIssues = append(*schemaIssues, "services must be an object.")
		return validatedServices, ""
	}

	servicesValue, ok := readMap(rawValue, "services", schemaIssues)
	if !ok {
		return validatedServices, ""
	}

	serviceNames := make([]string, 0, len(servicesValue))
	for serviceName := range servicesValue {
		serviceNames = append(serviceNames, serviceName)
	}
	sort.Strings(serviceNames)

	if len(servicesValue) == 0 {
		*validationIssues = append(*validationIssues, "services must contain at least one service.")
		return validatedServices, ""
	}

	primaryServices := []string{}
	routedPathsByHost := map[string][]string{}
	fixedBindPorts := map[string]struct{}{}

	for _, serviceName := range serviceNames {
		rawService, ok := readMap(servicesValue[serviceName], fmt.Sprintf("services.%s", serviceName), schemaIssues)
		if !ok {
			continue
		}

		if !serviceNamePattern.MatchString(serviceName) {
			*validationIssues = append(*validationIssues, fmt.Sprintf("services.%s has an invalid name.", serviceName))
			continue
		}

		validatedService, isPrimary := validateService(
			serviceName,
			rawService,
			serviceNames,
			manifestDirectoryPath,
			routedPathsByHost,
			fixedBindPorts,
			schemaIssues,
			validationIssues,
		)
		validatedServices[serviceName] = validatedService
		if isPrimary {
			primaryServices = append(primaryServices, serviceName)
		}
	}

	primaryService := ""
	if len(primaryServices) > 1 {
		*validationIssues = append(*validationIssues, fmt.Sprintf("Multiple primary services defined: %s", strings.Join(primaryServices, ", ")))
	} else if len(primaryServices) == 1 {
		primaryService = primaryServices[0]
	} else {
		primaryService = readPrimaryFallbackService(serviceOrder, serviceNames)
	}

	return validatedServices, primaryService
}

func validateService(
	serviceName string,
	value map[string]any,
	serviceNames []string,
	manifestDirectoryPath string,
	routedPathsByHost map[string][]string,
	fixedBindPorts map[string]struct{},
	schemaIssues *[]string,
	validationIssues *[]string,
) (ValidatedService, bool) {
	allowKeys(value, []string{"bindHost", "command", "cwd", "dependsOn", "env", "health", "host", "injectPort", "lifecycle", "managed", "path", "port", "primary", "watch"}, fmt.Sprintf("services.%s", serviceName), schemaIssues)

	watch := []string{}
	if watchValues, ok := readOptionalStringArray(value, "watch", schemaIssues); ok {
		for _, p := range watchValues {
			resolvedPath := filepath.Clean(filepath.Join(manifestDirectoryPath, p))
			relativePath, err := filepath.Rel(manifestDirectoryPath, resolvedPath)
			if err != nil || relativePath == ".." || strings.HasPrefix(relativePath, ".."+string(filepath.Separator)) {
				fmt.Fprintf(os.Stderr, "WARNING: services.%s.watch path %q resolves outside the manifest directory %q\n", serviceName, p, manifestDirectoryPath)
			}
			watch = append(watch, p)
		}
	}

	managed, hasManaged := readOptionalBool(value, "managed", schemaIssues)
	if !hasManaged {
		managed = true
	}

	lifecycle, _ := readOptionalServiceLifecycle(value, fmt.Sprintf("services.%s.lifecycle", serviceName), schemaIssues)

	command := []string{}
	hasCommand := false
	if lifecycle.Mode == "daemon" {
		command, hasCommand = readOptionalCommand(value, "command", schemaIssues)
		if !hasCommand {
			command = []string{}
		}
	} else if managed {
		var ok bool
		command, ok = readRequiredCommand(value, "command", schemaIssues)
		hasCommand = ok
		if !ok {
			command = []string{}
		}
	} else {
		command, hasCommand = readOptionalCommand(value, "command", schemaIssues)
		if !hasCommand {
			command = []string{}
		}
	}

	if !managed && hasCommand {
		*validationIssues = append(*validationIssues, fmt.Sprintf("services.%s must omit command when managed = false.", serviceName))
	}
	if lifecycle.Mode == "daemon" && !managed {
		*validationIssues = append(*validationIssues, fmt.Sprintf("services.%s.lifecycle.mode=\"daemon\" requires managed = true.", serviceName))
	}
	if lifecycle.Mode == "daemon" && hasCommand {
		*validationIssues = append(*validationIssues, fmt.Sprintf("services.%s must omit command when lifecycle.mode = \"daemon\".", serviceName))
	}
	if lifecycle.Mode == "daemon" && len(lifecycle.Start) == 0 {
		*validationIssues = append(*validationIssues, fmt.Sprintf("services.%s.lifecycle.start is required when lifecycle.mode = \"daemon\".", serviceName))
	}
	if lifecycle.Mode == "daemon" && len(lifecycle.Stop) == 0 {
		*validationIssues = append(*validationIssues, fmt.Sprintf("services.%s.lifecycle.stop is required when lifecycle.mode = \"daemon\".", serviceName))
	}
	if lifecycle.Mode != "daemon" && len(lifecycle.Start) != 0 {
		*validationIssues = append(*validationIssues, fmt.Sprintf("services.%s.lifecycle.start is only supported when lifecycle.mode = \"daemon\".", serviceName))
	}
	if lifecycle.Mode != "daemon" && len(lifecycle.Status) != 0 {
		*validationIssues = append(*validationIssues, fmt.Sprintf("services.%s.lifecycle.status is only supported when lifecycle.mode = \"daemon\".", serviceName))
	}
	if lifecycle.Mode != "daemon" && len(lifecycle.Stop) != 0 {
		*validationIssues = append(*validationIssues, fmt.Sprintf("services.%s.lifecycle.stop is only supported when lifecycle.mode = \"daemon\".", serviceName))
	}

	primary, _ := readOptionalBool(value, "primary", schemaIssues)
	bindHost, bindHostSet := readOptionalString(value, "bindHost", schemaIssues)
	if !bindHostSet {
		bindHost = defaultServiceBindHost
	} else if !isAllowedBindHost(bindHost) {
		*schemaIssues = append(*schemaIssues, fmt.Sprintf("services.%s.bindHost must be one of 127.0.0.1, 0.0.0.0, ::1, or ::.", serviceName))
	}

	cwd := "."
	if valueCwd, ok := readOptionalString(value, "cwd", schemaIssues); ok {
		cwd = valueCwd
	}
	resolvedCwd := resolveConstrainedPath(fmt.Sprintf("services.%s.cwd", serviceName), cwd, manifestDirectoryPath, validationIssues)

	dependsOn := []string{}
	if values, ok := readOptionalStringArray(value, "dependsOn", schemaIssues); ok {
		dependsOn = values
	}
	for _, dependencyName := range dependsOn {
		if !contains(serviceNames, dependencyName) {
			*validationIssues = append(*validationIssues, fmt.Sprintf("services.%s.dependsOn references an unknown service: %s", serviceName, dependencyName))
		}
	}

	env := map[string]string{}
	if values, ok := readOptionalStringMap(value, "env", schemaIssues); ok {
		env = values
	}

	port, hasPort := readOptionalServicePort(value, "port", schemaIssues)
	injectPort, hasInjectPort := readOptionalBool(value, "injectPort", schemaIssues)
	if !hasInjectPort {
		if !managed {
			injectPort = false
		} else {
		injectPort = true
		}
	}
	if !managed && hasInjectPort {
		*validationIssues = append(*validationIssues, fmt.Sprintf("services.%s must omit injectPort when managed = false.", serviceName))
	}

	host, hasHost := readOptionalString(value, "host", schemaIssues)
	var normalizedHost *string
	if hasHost {
		normalizedHost = &host
		if !isValidHost(host) {
			*validationIssues = append(*validationIssues, fmt.Sprintf("services.%s.host must be a valid hostname, received: %s", serviceName, host))
		}
	}

	var normalizedPath *string
	if hasHost {
		rawPath := "/"
		if pathValue, ok := readOptionalNonEmptyString(value, "path", schemaIssues); ok {
			rawPath = pathValue
		}
		validatedPath := validateRoutePath(serviceName, rawPath, validationIssues)
		if validatedPath != nil {
			existingPaths := routedPathsByHost[host]
			if conflictingPath := readConflictingRoutePath(existingPaths, *validatedPath); conflictingPath != "" {
				*validationIssues = append(*validationIssues, fmt.Sprintf("services.%s.path overlaps another routed service on host %s: %s", serviceName, host, conflictingPath))
			}
			routedPathsByHost[host] = append(existingPaths, *validatedPath)
			normalizedPath = validatedPath
		}
		if !hasPort {
			*validationIssues = append(*validationIssues, fmt.Sprintf("services.%s.host requires services.%s.port.", serviceName, serviceName))
		}
	}

	health, hasHealth := readOptionalHealth(value, "health", schemaIssues)
	if hasHealth && health.Process && hasHost {
		*validationIssues = append(*validationIssues, fmt.Sprintf("services.%s must not use health.process on a routed service.", serviceName))
	}
	if hasHealth && health.Process && !managed {
		*validationIssues = append(*validationIssues, fmt.Sprintf("services.%s must not use health.process when managed = false.", serviceName))
	}
	if hasHealth && health.Process && lifecycle.Mode == "daemon" {
		*validationIssues = append(*validationIssues, fmt.Sprintf("services.%s must not use health.process when lifecycle.mode = \"daemon\".", serviceName))
	}

	if hasPort && port != nil && port.Auto && hasHealth {
		*validationIssues = append(*validationIssues, fmt.Sprintf("services.%s must omit health when port = \"auto\" in v1.", serviceName))
	}
	if hasPort && port != nil && port.Auto && !managed {
		*validationIssues = append(*validationIssues, fmt.Sprintf("services.%s must not use port = \"auto\" when managed = false.", serviceName))
	}
	if hasPort && port != nil && port.Auto && lifecycle.Mode == "daemon" {
		*validationIssues = append(*validationIssues, fmt.Sprintf("services.%s must not use port = \"auto\" when lifecycle.mode = \"daemon\".", serviceName))
	}

	if !hasPort && !hasHealth {
		*validationIssues = append(*validationIssues, fmt.Sprintf("services.%s must define either port or health.", serviceName))
	}

	if hasHealth && health != nil && health.HTTP != nil {
		validateHealthHTTP(serviceName, *health.HTTP, validationIssues)
	}

	if hasPort && port != nil && !port.Auto {
		fixedPortClaimKeys := readFixedPortClaimKeys(bindHost, port.Number)
		if hasFixedPortConflict(fixedBindPorts, fixedPortClaimKeys) {
			*validationIssues = append(*validationIssues, fmt.Sprintf("services.%s duplicates fixed bind port %s:%d.", serviceName, bindHost, port.Number))
		}
		for _, fixedPortClaimKey := range fixedPortClaimKeys {
			fixedBindPorts[fixedPortClaimKey] = struct{}{}
		}
	}

	return ValidatedService{
		BindHost:   bindHost,
		Command:    command,
		Cwd:        resolvedCwd,
		DependsOn:  dependsOn,
		Env:        env,
		Health:     health,
		Host:       normalizedHost,
		InjectPort: injectPort,
		Lifecycle:  lifecycle,
		Managed:    managed,
		Name:       serviceName,
		Path:       normalizedPath,
		Port:       port,
		Watch:      watch,
	}, primary
}

func readPrimaryFallbackService(serviceOrder []string, serviceNames []string) string {
	if len(serviceOrder) == 0 {
		if len(serviceNames) == 0 {
			return ""
		}
		return serviceNames[0]
	}

	serviceNameSet := map[string]struct{}{}
	for _, serviceName := range serviceNames {
		serviceNameSet[serviceName] = struct{}{}
	}

	for _, serviceName := range serviceOrder {
		if _, ok := serviceNameSet[serviceName]; ok {
			return serviceName
		}
	}

	return serviceNames[0]
}

func resolveConstrainedPath(fieldPath string, candidatePath string, manifestDirectoryPath string, validationIssues *[]string) string {
	resolvedPath := filepath.Clean(filepath.Join(manifestDirectoryPath, candidatePath))
	relativePath, error := filepath.Rel(manifestDirectoryPath, resolvedPath)
	if error != nil {
		*validationIssues = append(*validationIssues, fmt.Sprintf("%s must stay within %s.", fieldPath, manifestDirectoryPath))
		return resolvedPath
	}

	if relativePath == ".." || strings.HasPrefix(relativePath, fmt.Sprintf("..%c", filepath.Separator)) {
		*validationIssues = append(*validationIssues, fmt.Sprintf("%s must stay within %s.", fieldPath, manifestDirectoryPath))
	}

	return resolvedPath
}

func validateHealthHTTP(serviceName string, rawURL string, validationIssues *[]string) {
	parsedURL, error := url.Parse(rawURL)
	if error != nil || !parsedURL.IsAbs() || parsedURL.Host == "" {
		*validationIssues = append(*validationIssues, fmt.Sprintf("services.%s.health.http must be an absolute URL, received: %s", serviceName, rawURL))
		return
	}

	hostname := parsedURL.Hostname()
	if hostname != "127.0.0.1" && hostname != "localhost" && hostname != "::1" {
		*validationIssues = append(*validationIssues, fmt.Sprintf("services.%s.health.http must target 127.0.0.1, localhost, or ::1.", serviceName))
	}
}

func readFixedPortClaimKeys(bindHost string, port int) []string {
	return []string{fmt.Sprintf("%s:%d", readFixedPortClaimScope(bindHost), port)}
}

func readFixedPortClaimScope(bindHost string) string {
	if bindHost == "127.0.0.1" || bindHost == "0.0.0.0" {
		return "ipv4"
	}

	if bindHost == "::1" || bindHost == "::" {
		return "ipv6"
	}

	return bindHost
}

func hasFixedPortConflict(claims map[string]struct{}, fixedPortClaimKeys []string) bool {
	for _, fixedPortClaimKey := range fixedPortClaimKeys {
		if _, ok := claims[fixedPortClaimKey]; ok {
			return true
		}
	}

	return false
}

func validateRoutePath(serviceName string, rawPath string, validationIssues *[]string) *string {
	if !strings.HasPrefix(rawPath, "/") {
		*validationIssues = append(*validationIssues, fmt.Sprintf("services.%s.path must start with '/'.", serviceName))
		return nil
	}

	if rawPath == "/" || rawPath == "/*" {
		normalizedPath := "/"
		return &normalizedPath
	}

	if strings.Contains(rawPath, "*") {
		wildcardBasePath := rawPath
		if strings.HasSuffix(rawPath, "/*") {
			wildcardBasePath = strings.TrimSuffix(rawPath, "/*")
		}

		if !strings.HasSuffix(rawPath, "/*") || strings.Contains(wildcardBasePath, "*") {
			*validationIssues = append(*validationIssues, fmt.Sprintf("services.%s.path must be '/' or a leading-slash path with an optional trailing '/*'.", serviceName))
			return nil
		}
	}

	normalizedPath := rawPath
	return &normalizedPath
}

func readConflictingRoutePath(existingPaths []string, candidatePath string) string {
	for _, existingPath := range existingPaths {
		if doRoutePathsConflict(existingPath, candidatePath) {
			return existingPath
		}
	}

	return ""
}

func doRoutePathsConflict(leftPath string, rightPath string) bool {
	if leftPath == rightPath {
		return true
	}

	if leftPath == "/" || rightPath == "/" {
		return false
	}

	leftRoutePath := parseValidatedRoutePath(leftPath)
	rightRoutePath := parseValidatedRoutePath(rightPath)

	if leftRoutePath.kind == "prefix" && rightRoutePath.kind == "prefix" {
		return leftRoutePath.basePath == rightRoutePath.basePath ||
			strings.HasPrefix(leftRoutePath.basePath, rightRoutePath.basePath+"/") ||
			strings.HasPrefix(rightRoutePath.basePath, leftRoutePath.basePath+"/")
	}

	if leftRoutePath.kind == "exact" && rightRoutePath.kind == "exact" {
		return leftRoutePath.basePath == rightRoutePath.basePath
	}

	if leftRoutePath.kind == "exact" && rightRoutePath.kind == "prefix" {
		return strings.HasPrefix(leftRoutePath.basePath, rightRoutePath.basePath+"/")
	}

	return strings.HasPrefix(rightRoutePath.basePath, leftRoutePath.basePath+"/")
}

type validatedRoutePath struct {
	basePath string
	kind     string
}

func parseValidatedRoutePath(path string) validatedRoutePath {
	if strings.HasSuffix(path, "/*") {
		return validatedRoutePath{basePath: strings.TrimSuffix(path, "/*"), kind: "prefix"}
	}

	return validatedRoutePath{basePath: path, kind: "exact"}
}

func allowKeys(value map[string]any, allowedKeys []string, path string, schemaIssues *[]string) {
	allowedKeySet := map[string]struct{}{}
	for _, allowedKey := range allowedKeys {
		allowedKeySet[allowedKey] = struct{}{}
	}

	unknownKeys := []string{}
	for key := range value {
		if _, ok := allowedKeySet[key]; ok {
			continue
		}
		unknownKeys = append(unknownKeys, key)
	}
	sort.Strings(unknownKeys)

	for _, unknownKey := range unknownKeys {
		issuePath := path
		if issuePath == "" {
			issuePath = "manifest"
		}
		*schemaIssues = append(*schemaIssues, fmt.Sprintf("%s Unrecognized key: \"%s\"", issuePath, unknownKey))
	}
}

func readMap(rawValue any, path string, schemaIssues *[]string) (map[string]any, bool) {
	value, ok := rawValue.(map[string]any)
	if !ok {
		*schemaIssues = append(*schemaIssues, fmt.Sprintf("%s must be a table.", path))
		return nil, false
	}

	return value, true
}

func readRequiredNonEmptyString(value map[string]any, key string, schemaIssues *[]string) (string, bool) {
	rawValue, ok := value[key]
	if !ok {
		*schemaIssues = append(*schemaIssues, fmt.Sprintf("%s Expected a non-empty string.", key))
		return "", false
	}

	stringValue, ok := rawValue.(string)
	if !ok || strings.TrimSpace(stringValue) == "" {
		*schemaIssues = append(*schemaIssues, fmt.Sprintf("%s Expected a non-empty string.", key))
		return "", false
	}

	return stringValue, true
}

func readOptionalNonEmptyString(value map[string]any, key string, schemaIssues *[]string) (string, bool) {
	rawValue, ok := value[key]
	if !ok {
		return "", false
	}

	stringValue, ok := rawValue.(string)
	if !ok || strings.TrimSpace(stringValue) == "" {
		*schemaIssues = append(*schemaIssues, fmt.Sprintf("%s Expected a non-empty string.", key))
		return "", false
	}

	return stringValue, true
}

func readOptionalString(value map[string]any, key string, schemaIssues *[]string) (string, bool) {
	rawValue, ok := value[key]
	if !ok {
		return "", false
	}

	stringValue, ok := rawValue.(string)
	if !ok {
		*schemaIssues = append(*schemaIssues, fmt.Sprintf("%s must be a string.", key))
		return "", false
	}

	return stringValue, true
}

func readOptionalBool(value map[string]any, key string, schemaIssues *[]string) (bool, bool) {
	rawValue, ok := value[key]
	if !ok {
		return false, false
	}

	boolValue, ok := rawValue.(bool)
	if !ok {
		*schemaIssues = append(*schemaIssues, fmt.Sprintf("%s must be a boolean.", key))
		return false, false
	}

	return boolValue, true
}

func readOptionalPort(value map[string]any, key string, path string, schemaIssues *[]string) (int, bool) {
	rawValue, ok := value[key]
	if !ok {
		return 0, false
	}

	portValue, ok := readPortNumber(rawValue)
	if !ok || portValue < 1 || portValue > 65535 {
		*schemaIssues = append(*schemaIssues, fmt.Sprintf("%s must be an integer between 1 and 65535.", path))
		return 0, false
	}

	return portValue, true
}

func readOptionalStringArray(value map[string]any, key string, schemaIssues *[]string) ([]string, bool) {
	rawValue, ok := value[key]
	if !ok {
		return nil, false
	}

	arrayValue, ok := rawValue.([]any)
	if !ok {
		*schemaIssues = append(*schemaIssues, fmt.Sprintf("%s must be a string array.", key))
		return nil, false
	}

	result := make([]string, 0, len(arrayValue))
	for _, item := range arrayValue {
		stringValue, ok := item.(string)
		if !ok || strings.TrimSpace(stringValue) == "" {
			*schemaIssues = append(*schemaIssues, fmt.Sprintf("%s must contain only non-empty strings.", key))
			return nil, false
		}
		result = append(result, stringValue)
	}

	if len(result) == 0 {
		*schemaIssues = append(*schemaIssues, fmt.Sprintf("%s must contain at least one string.", key))
		return nil, false
	}

	return result, true
}

func readOptionalStringMap(value map[string]any, key string, schemaIssues *[]string) (map[string]string, bool) {
	rawValue, ok := value[key]
	if !ok {
		return nil, false
	}

	mapValue, ok := rawValue.(map[string]any)
	if !ok {
		*schemaIssues = append(*schemaIssues, fmt.Sprintf("%s must be a string map.", key))
		return nil, false
	}

	result := map[string]string{}
	keys := make([]string, 0, len(mapValue))
	for itemKey := range mapValue {
		keys = append(keys, itemKey)
	}
	sort.Strings(keys)

	for _, itemKey := range keys {
		stringValue, ok := mapValue[itemKey].(string)
		if !ok {
			*schemaIssues = append(*schemaIssues, fmt.Sprintf("%s.%s must be a string.", key, itemKey))
			return nil, false
		}
		result[itemKey] = stringValue
	}

	return result, true
}

func readRequiredCommand(value map[string]any, key string, schemaIssues *[]string) ([]string, bool) {
	rawValue, ok := value[key]
	if !ok {
		*schemaIssues = append(*schemaIssues, fmt.Sprintf("%s must be a non-empty string or string array.", key))
		return nil, false
	}

	if stringValue, ok := rawValue.(string); ok {
		command := strings.Fields(stringValue)
		if len(command) == 0 {
			*schemaIssues = append(*schemaIssues, fmt.Sprintf("%s Expected a non-empty string.", key))
			return nil, false
		}
		return command, true
	}

	command, ok := readOptionalStringArray(value, key, schemaIssues)
	if !ok {
		return nil, false
	}

	return command, true
}

func readOptionalCommand(value map[string]any, key string, schemaIssues *[]string) ([]string, bool) {
	rawValue, ok := value[key]
	if !ok {
		return nil, false
	}

	if stringValue, ok := rawValue.(string); ok {
		command := strings.Fields(stringValue)
		if len(command) == 0 {
			*schemaIssues = append(*schemaIssues, fmt.Sprintf("%s Expected a non-empty string.", key))
			return nil, false
		}
		return command, true
	}

	command, ok := readOptionalStringArray(value, key, schemaIssues)
	if !ok {
		return nil, false
	}

	return command, true
}

func readOptionalServicePort(value map[string]any, key string, schemaIssues *[]string) (*PortConfig, bool) {
	rawValue, ok := value[key]
	if !ok {
		return nil, false
	}

	if stringValue, ok := rawValue.(string); ok {
		if stringValue != "auto" {
			*schemaIssues = append(*schemaIssues, fmt.Sprintf("%s must be an integer between 1 and 65535 or \"auto\".", key))
			return nil, false
		}
		return &PortConfig{Auto: true}, true
	}

	portValue, ok := readPortNumber(rawValue)
	if !ok || portValue < 1 || portValue > 65535 {
		*schemaIssues = append(*schemaIssues, fmt.Sprintf("%s must be an integer between 1 and 65535 or \"auto\".", key))
		return nil, false
	}

	return &PortConfig{Number: portValue}, true
}

func readOptionalHealth(value map[string]any, key string, schemaIssues *[]string) (*HealthConfig, bool) {
	rawValue, ok := value[key]
	if !ok {
		return nil, false
	}

	healthValue, ok := readMap(rawValue, key, schemaIssues)
	if !ok {
		return nil, false
	}

	allowKeys(healthValue, []string{"http", "interval", "process", "retries", "tcp", "timeout"}, key, schemaIssues)

	result := &HealthConfig{}
	kinds := 0
	if tcpValue, ok := healthValue["tcp"]; ok {
		portValue, portOK := readPortNumber(tcpValue)
		if !portOK || portValue < 1 || portValue > 65535 {
			*schemaIssues = append(*schemaIssues, fmt.Sprintf("%s.tcp must be an integer between 1 and 65535.", key))
		} else {
			result.TCP = &portValue
			kinds += 1
		}
	}

	if httpValue, ok := healthValue["http"]; ok {
		stringValue, ok := httpValue.(string)
		if !ok {
			*schemaIssues = append(*schemaIssues, fmt.Sprintf("%s.http must be a string.", key))
		} else {
			result.HTTP = &stringValue
			kinds += 1
		}
	}

	if processValue, ok := healthValue["process"]; ok {
		boolValue, ok := processValue.(bool)
		if !ok || !boolValue {
			*schemaIssues = append(*schemaIssues, fmt.Sprintf("%s.process must be true.", key))
		} else {
			result.Process = true
			kinds += 1
		}
	}

	for _, timedKey := range []string{"interval", "timeout", "retries"} {
		if timedValue, ok := healthValue[timedKey]; ok {
			intValue, intOK := readInteger(timedValue)
			minimum := 1
			if timedKey == "retries" {
				minimum = 0
			}
			if !intOK || intValue < minimum {
				*schemaIssues = append(*schemaIssues, fmt.Sprintf("%s.%s must be an integer >= %d.", key, timedKey, minimum))
				continue
			}

			switch timedKey {
			case "interval":
				result.Interval = &intValue
			case "timeout":
				result.Timeout = &intValue
			case "retries":
				result.Retries = &intValue
			}
		}
	}

	if kinds != 1 {
		*schemaIssues = append(*schemaIssues, fmt.Sprintf("%s must define exactly one of tcp, http, or process.", key))
		return nil, false
	}

	return result, true
}

func readOptionalServiceLifecycle(value map[string]any, key string, schemaIssues *[]string) (ServiceLifecycleConfig, bool) {
	result := ServiceLifecycleConfig{Mode: "foreground"}
	rawValue, ok := value["lifecycle"]
	if !ok {
		return result, false
	}

	lifecycleValue, ok := readMap(rawValue, key, schemaIssues)
	if !ok {
		return result, false
	}

	allowKeys(lifecycleValue, []string{"mode", "start", "status", "stop"}, key, schemaIssues)

	if modeValue, ok := lifecycleValue["mode"]; ok {
		mode, ok := modeValue.(string)
		if !ok || (mode != "foreground" && mode != "daemon") {
			*schemaIssues = append(*schemaIssues, fmt.Sprintf("%s.mode must be one of foreground or daemon.", key))
		} else {
			result.Mode = mode
		}
	}

	result.Start, _ = readOptionalCommandForPath(lifecycleValue, "start", key+".start", schemaIssues)
	result.Status, _ = readOptionalCommandForPath(lifecycleValue, "status", key+".status", schemaIssues)
	result.Stop, _ = readOptionalCommandForPath(lifecycleValue, "stop", key+".stop", schemaIssues)

	return result, true
}

func readOptionalCommandForPath(value map[string]any, key string, fieldPath string, schemaIssues *[]string) ([]string, bool) {
	rawValue, ok := value[key]
	if !ok {
		return nil, false
	}

	if stringValue, ok := rawValue.(string); ok {
		command := strings.Fields(stringValue)
		if len(command) == 0 {
			*schemaIssues = append(*schemaIssues, fmt.Sprintf("%s Expected a non-empty string.", fieldPath))
			return nil, false
		}
		return command, true
	}

	rawArray, ok := rawValue.([]any)
	if !ok || len(rawArray) == 0 {
		*schemaIssues = append(*schemaIssues, fmt.Sprintf("%s must be a non-empty string or string array.", fieldPath))
		return nil, false
	}

	command := make([]string, 0, len(rawArray))
	for _, item := range rawArray {
		stringItem, ok := item.(string)
		if !ok || strings.TrimSpace(stringItem) == "" {
			*schemaIssues = append(*schemaIssues, fmt.Sprintf("%s must be a non-empty string or string array.", fieldPath))
			return nil, false
		}
		command = append(command, stringItem)
	}

	return command, true
}

func readPortNumber(rawValue any) (int, bool) {
	intValue, ok := readInteger(rawValue)
	if !ok {
		return 0, false
	}

	return intValue, true
}

func readInteger(rawValue any) (int, bool) {
	switch value := rawValue.(type) {
	case int64:
		return int(value), true
	case int32:
		return int(value), true
	case int:
		return value, true
	default:
		return 0, false
	}
}

func isAllowedBindHost(value string) bool {
	return value == "127.0.0.1" || value == "0.0.0.0" || value == "::1" || value == "::"
}

func isSupportedEditor(value string) bool {
	return value == "cursor" || value == "neovim" || value == "vscode" || value == "vscode-insiders" || value == "webstorm"
}

func isValidHost(host string) bool {
	return host == "localhost" || hostPattern.MatchString(host)
}

func contains(values []string, value string) bool {
	for _, item := range values {
		if item == value {
			return true
		}
	}

	return false
}

func isValidShortcut(s string) bool {
	if len(s) == 0 {
		return false
	}
	parts := strings.Split(s, "+")
	if len(parts) == 0 {
		return false
	}
	for _, p := range parts {
		if p == "" {
			return false
		}
		for _, char := range p {
			if !((char >= 'a' && char <= 'z') || (char >= '0' && char <= '9')) {
				return false
			}
		}
	}
	return true
}
