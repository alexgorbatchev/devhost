package manifest

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/BurntSushi/toml"
)

var duplicateTableIndicatorPattern = regexp.MustCompile(`(?i)(already been defined|duplicate|redefine)`)
var parseErrorLinePattern = regexp.MustCompile(`line (\d+)`)

func ReadManifest(manifestPath string) (RawManifest, error) {
	visited := map[string]bool{}
	manifestValue, serviceOrder, err := loadAndMergeManifests(manifestPath, "", visited)
	if err != nil {
		return RawManifest{}, err
	}

	interpolatedManifestValue, undefinedVariables := interpolateManifestValue(manifestValue)
	if len(undefinedVariables) > 0 {
		return RawManifest{}, fmt.Errorf("Failed to read %s: undefined environment variables: %s", manifestPath, strings.Join(undefinedVariables, ", "))
	}
	manifestMap, ok := interpolatedManifestValue.(map[string]any)
	if !ok {
		return RawManifest{}, fmt.Errorf("Failed to read %s: manifest root must decode to a table.", manifestPath)
	}

	return RawManifest{
		serviceOrder: serviceOrder,
		value:        manifestMap,
	}, nil
}

func loadAndMergeManifests(manifestPath string, rootManifestDir string, visited map[string]bool) (map[string]any, []string, error) {
	absPath, err := filepath.Abs(manifestPath)
	if err != nil {
		return nil, nil, fmt.Errorf("resolve manifest absolute path: %w", err)
	}

	if visited[absPath] {
		return map[string]any{}, nil, nil
	}
	visited[absPath] = true

	manifestBytes, err := os.ReadFile(absPath)
	if err != nil {
		return nil, nil, fmt.Errorf("read manifest %s: %w", absPath, err)
	}

	manifestText := string(manifestBytes)
	manifestValue := map[string]any{}
	if _, err := toml.Decode(manifestText, &manifestValue); err != nil {
		return nil, nil, fmt.Errorf("Failed to parse %s: %s", absPath, formatManifestParseError(manifestText, err))
	}

	serviceOrder := readServiceOrder(manifestText)
	manifestDir := filepath.Dir(absPath)

	if rootManifestDir == "" {
		rootManifestDir = manifestDir
	}

	rawIncludes, ok := manifestValue["includes"]
	if ok {
		includePatterns := []string{}
		switch val := rawIncludes.(type) {
		case string:
			includePatterns = []string{val}
		case []any:
			for _, item := range val {
				if strItem, ok := item.(string); ok {
					includePatterns = append(includePatterns, strItem)
				} else {
					return nil, nil, fmt.Errorf("includes must contain only strings")
				}
			}
		default:
			return nil, nil, fmt.Errorf("includes must be a string or string array")
		}

		for _, pattern := range includePatterns {
			globPattern := pattern
			if !filepath.IsAbs(pattern) {
				globPattern = filepath.Join(manifestDir, pattern)
			}

			matches, err := filepath.Glob(globPattern)
			if err != nil {
				return nil, nil, fmt.Errorf("invalid glob pattern %q: %w", pattern, err)
			}

			sort.Strings(matches)

			for _, match := range matches {
				matchAbs, err := filepath.Abs(match)
				if err != nil {
					return nil, nil, fmt.Errorf("resolve include absolute path: %w", err)
				}

				subManifest, subServiceOrder, err := loadAndMergeManifests(matchAbs, rootManifestDir, visited)
				if err != nil {
					return nil, nil, err
				}

				if len(subManifest) == 0 {
					continue
				}

				subManifestCopy := copyMap(subManifest)
				preparedSub := prepareSubManifest(subManifestCopy, rootManifestDir, filepath.Dir(matchAbs))

				if subServices, ok := preparedSub["services"].(map[string]any); ok {
					if _, exists := manifestValue["services"]; !exists {
						manifestValue["services"] = map[string]any{}
					}
					mergedServices, ok := manifestValue["services"].(map[string]any)
					if !ok {
						return nil, nil, fmt.Errorf("services in %s must be a table", absPath)
					}

					for serviceName, serviceVal := range subServices {
						if _, exists := mergedServices[serviceName]; exists {
							return nil, nil, fmt.Errorf("service %q is defined multiple times (conflict in %s)", serviceName, matchAbs)
						}
						mergedServices[serviceName] = serviceVal
					}
				}

				for _, serviceName := range subServiceOrder {
					if !contains(serviceOrder, serviceName) {
						serviceOrder = append(serviceOrder, serviceName)
					}
				}

				if subAnnotation, ok := preparedSub["annotation"].(map[string]any); ok {
					if subActions, ok := subAnnotation["actions"]; ok {
						if _, exists := manifestValue["annotation"]; !exists {
							manifestValue["annotation"] = map[string]any{}
						}
						annotationMap, ok := manifestValue["annotation"].(map[string]any)
						if !ok {
							return nil, nil, fmt.Errorf("annotation in %s must be a table", absPath)
						}

						var existingActions []any
						if rawActions, ok := annotationMap["actions"].([]any); ok {
							existingActions = rawActions
						} else if rawActions, ok := annotationMap["actions"].([]map[string]any); ok {
							existingActions = make([]any, len(rawActions))
							for i, act := range rawActions {
								existingActions[i] = act
							}
						}

						switch val := subActions.(type) {
						case []any:
							existingActions = append(existingActions, val...)
						case []map[string]any:
							for _, act := range val {
								existingActions = append(existingActions, act)
							}
						}

						annotationMap["actions"] = existingActions
					}
				}
			}
		}
	}

	return manifestValue, serviceOrder, nil
}

func prepareSubManifest(subManifest map[string]any, rootDir, subDir string) map[string]any {
	if services, ok := subManifest["services"].(map[string]any); ok {
		for _, serviceVal := range services {
			if serviceMap, ok := serviceVal.(map[string]any); ok {
				if _, exists := serviceMap["cwd"]; !exists {
					serviceMap["cwd"] = "."
				}
			}
		}
	}

	if annotation, ok := subManifest["annotation"].(map[string]any); ok {
		if actions, ok := annotation["actions"].([]any); ok {
			for _, actionVal := range actions {
				if actionMap, ok := actionVal.(map[string]any); ok {
					if cmdVal, ok := actionMap["command"].(map[string]any); ok {
						if _, exists := cmdVal["cwd"]; !exists {
							cmdVal["cwd"] = "."
						}
					}
					if agentVal, ok := actionMap["agent"].(map[string]any); ok {
						if _, exists := agentVal["cwd"]; !exists {
							agentVal["cwd"] = "."
						}
					}
				}
			}
		} else if actions, ok := annotation["actions"].([]map[string]any); ok {
			for _, actionMap := range actions {
				if cmdVal, ok := actionMap["command"].(map[string]any); ok {
					if _, exists := cmdVal["cwd"]; !exists {
						cmdVal["cwd"] = "."
					}
				}
				if agentVal, ok := actionMap["agent"].(map[string]any); ok {
					if _, exists := agentVal["cwd"]; !exists {
						agentVal["cwd"] = "."
					}
				}
			}
		}
	}

	rewritten := rewritePaths(rootDir, subDir, subManifest)
	return rewritten.(map[string]any)
}

func rewritePaths(rootManifestDir, subManifestDir string, value any) any {
	switch item := value.(type) {
	case map[string]any:
		result := make(map[string]any, len(item))
		for k, v := range item {
			if k == "cwd" {
				if str, ok := v.(string); ok && !filepath.IsAbs(str) && !strings.Contains(str, "{{") {
					absPath := filepath.Join(subManifestDir, str)
					relPath, err := filepath.Rel(rootManifestDir, absPath)
					if err == nil {
						result[k] = relPath
					} else {
						result[k] = absPath
					}
					continue
				}
			}
			if k == "watch" {
				if arr, ok := v.([]any); ok {
					newArr := make([]any, len(arr))
					for i, elem := range arr {
						if str, ok := elem.(string); ok && !filepath.IsAbs(str) && !strings.Contains(str, "{{") {
							absPath := filepath.Join(subManifestDir, str)
							relPath, err := filepath.Rel(rootManifestDir, absPath)
							if err == nil {
								newArr[i] = relPath
							} else {
								newArr[i] = absPath
							}
						} else {
							newArr[i] = elem
						}
					}
					result[k] = newArr
					continue
				} else if arr, ok := v.([]string); ok {
					newArr := make([]any, len(arr))
					for i, elem := range arr {
						if !filepath.IsAbs(elem) && !strings.Contains(elem, "{{") {
							absPath := filepath.Join(subManifestDir, elem)
							relPath, err := filepath.Rel(rootManifestDir, absPath)
							if err == nil {
								newArr[i] = relPath
							} else {
								newArr[i] = absPath
							}
						} else {
							newArr[i] = elem
						}
					}
					result[k] = newArr
					continue
				}
			}
			result[k] = rewritePaths(rootManifestDir, subManifestDir, v)
		}
		return result
	case []any:
		result := make([]any, len(item))
		for i, v := range item {
			result[i] = rewritePaths(rootManifestDir, subManifestDir, v)
		}
		return result
	case []map[string]any:
		result := make([]map[string]any, len(item))
		for i, v := range item {
			if rewritten, ok := rewritePaths(rootManifestDir, subManifestDir, v).(map[string]any); ok {
				result[i] = rewritten
			} else {
				result[i] = v
			}
		}
		return result
	default:
		return value
	}
}

func copyMap(m map[string]any) map[string]any {
	if m == nil {
		return nil
	}
	result := make(map[string]any, len(m))
	for k, v := range m {
		switch val := v.(type) {
		case map[string]any:
			result[k] = copyMap(val)
		case []any:
			result[k] = copySlice(val)
		default:
			result[k] = v
		}
	}
	return result
}

func copySlice(s []any) []any {
	if s == nil {
		return nil
	}
	result := make([]any, len(s))
	for i, v := range s {
		switch val := v.(type) {
		case map[string]any:
			result[i] = copyMap(val)
		case []any:
			result[i] = copySlice(val)
		default:
			result[i] = v
		}
	}
	return result
}

func interpolateManifestValue(value any) (any, []string) {
	undefinedVariableSet := map[string]struct{}{}
	interpolatedValue := interpolateManifestItem(value, undefinedVariableSet)
	undefinedVariables := make([]string, 0, len(undefinedVariableSet))
	for name := range undefinedVariableSet {
		undefinedVariables = append(undefinedVariables, name)
	}
	sort.Strings(undefinedVariables)
	return interpolatedValue, undefinedVariables
}

func interpolateManifestItem(value any, undefinedVariableSet map[string]struct{}) any {
	switch item := value.(type) {
	case string:
		return interpolateManifestString(item, undefinedVariableSet)
	case []any:
		result := make([]any, len(item))
		for index, child := range item {
			result[index] = interpolateManifestItem(child, undefinedVariableSet)
		}
		return result
	case []map[string]any:
		result := make([]map[string]any, len(item))
		for index, child := range item {
			interpolatedChild, ok := interpolateManifestItem(child, undefinedVariableSet).(map[string]any)
			if ok {
				result[index] = interpolatedChild
				continue
			}
			result[index] = child
		}
		return result
	case map[string]any:
		result := make(map[string]any, len(item))
		for key, child := range item {
			result[key] = interpolateManifestItem(child, undefinedVariableSet)
		}
		return result
	default:
		return value
	}
}

func interpolateManifestString(value string, undefinedVariableSet map[string]struct{}) string {
	var builder strings.Builder
	builder.Grow(len(value))

	for index := 0; index < len(value); {
		if value[index] != '{' || index+1 >= len(value) || value[index+1] != '{' {
			builder.WriteByte(value[index])
			index += 1
			continue
		}

		if interpolatedValue, nextIndex, ok := readTemplateEnvVar(value, index, undefinedVariableSet); ok {
			builder.WriteString(interpolatedValue)
			index = nextIndex
			continue
		}

		builder.WriteByte(value[index])
		index += 1
	}

	return builder.String()
}

func readTemplateEnvVar(value string, index int, undefinedVariableSet map[string]struct{}) (string, int, bool) {
	if index+1 >= len(value) || value[index] != '{' || value[index+1] != '{' {
		return "", index, false
	}

	closingDelimiterIndex := strings.Index(value[index+2:], "}}")
	if closingDelimiterIndex < 0 {
		return value[index:], len(value), true
	}
	closingDelimiterIndex += index + 2

	rawExpression := value[index+2 : closingDelimiterIndex]
	trimmedExpression := strings.TrimSpace(rawExpression)
	if !strings.HasPrefix(trimmedExpression, "env.") {
		return value[index : closingDelimiterIndex+2], closingDelimiterIndex + 2, true
	}

	name := strings.TrimSpace(strings.TrimPrefix(trimmedExpression, "env."))
	if !isValidEnvVarName(name) {
		return value[index : closingDelimiterIndex+2], closingDelimiterIndex + 2, true
	}

	interpolatedValue := lookupInterpolatedValue(name, undefinedVariableSet)
	return interpolatedValue, closingDelimiterIndex + 2, true
}

func lookupInterpolatedValue(name string, undefinedVariableSet map[string]struct{}) string {
	value, ok := os.LookupEnv(name)
	if ok {
		return value
	}

	undefinedVariableSet[name] = struct{}{}
	return ""
}

func isValidEnvVarName(name string) bool {
	if name == "" || !isValidEnvVarNameStart(name[0]) {
		return false
	}

	for index := 1; index < len(name); index += 1 {
		if !isValidEnvVarNameContinue(name[index]) {
			return false
		}
	}

	return true
}

func isValidEnvVarNameStart(value byte) bool {
	return value == '_' || value >= 'A' && value <= 'Z' || value >= 'a' && value <= 'z'
}

func isValidEnvVarNameContinue(value byte) bool {
	return isValidEnvVarNameStart(value) || value >= '0' && value <= '9'
}

func formatManifestParseError(manifestText string, error error) string {
	duplicateTableMessage := getDuplicateTableMessage(manifestText, error)
	if duplicateTableMessage != "" {
		return duplicateTableMessage
	}

	return error.Error()
}

func getDuplicateTableMessage(manifestText string, error error) string {
	errorMessage := error.Error()
	if !duplicateTableIndicatorPattern.MatchString(errorMessage) {
		return ""
	}

	lineNumber, ok := readParseErrorLine(error)
	if !ok {
		return ""
	}

	currentTable, ok := findNearestTableDeclaration(strings.Split(manifestText, "\n"), lineNumber)
	if !ok {
		return ""
	}

	originalTable, ok := findPreviousTableDeclaration(strings.Split(manifestText, "\n"), currentTable)
	if !ok {
		return ""
	}

	return fmt.Sprintf(
		"TOML table %s is declared more than once (lines %d and %d). Merge those settings into a single table instead of repeating the header.",
		currentTable.Header,
		originalTable.Line,
		currentTable.Line,
	)
}

func readParseErrorLine(error error) (int, bool) {
	var parseError toml.ParseError
	if errors.As(error, &parseError) {
		return parseError.Position.Line, true
	}

	match := parseErrorLinePattern.FindStringSubmatch(error.Error())
	if match == nil {
		return 0, false
	}

	lineNumber, convError := strconv.Atoi(match[1])
	if convError != nil {
		return 0, false
	}

	return lineNumber, true
}

type tableDeclaration struct {
	Header string
	Line   int
}

var tableHeaderPattern = regexp.MustCompile(`^\[([^\]]+)\](?:\s+#.*)?$`)
var serviceHeaderPattern = regexp.MustCompile(`^\[services\.([^\]]+)\](?:\s+#.*)?$`)

func findNearestTableDeclaration(lines []string, startLine int) (tableDeclaration, bool) {
	if startLine > len(lines) {
		startLine = len(lines)
	}

	for lineNumber := startLine; lineNumber >= 1; lineNumber -= 1 {
		trimmedLine := strings.TrimSpace(lines[lineNumber-1])
		if !tableHeaderPattern.MatchString(trimmedLine) {
			continue
		}

		return tableDeclaration{Header: trimmedLine, Line: lineNumber}, true
	}

	return tableDeclaration{}, false
}

func findPreviousTableDeclaration(lines []string, table tableDeclaration) (tableDeclaration, bool) {
	for lineNumber := table.Line - 1; lineNumber >= 1; lineNumber -= 1 {
		trimmedLine := strings.TrimSpace(lines[lineNumber-1])
		if trimmedLine != table.Header {
			continue
		}

		return tableDeclaration{Header: trimmedLine, Line: lineNumber}, true
	}

	return tableDeclaration{}, false
}

func readServiceOrder(manifestText string) []string {
	seenServiceNames := map[string]struct{}{}
	serviceOrder := []string{}

	for lineIndex, rawLine := range strings.Split(manifestText, "\n") {
		_ = lineIndex
		trimmedLine := strings.TrimSpace(rawLine)
		match := serviceHeaderPattern.FindStringSubmatch(trimmedLine)
		if match == nil {
			continue
		}

		serviceName := match[1]
		if _, ok := seenServiceNames[serviceName]; ok {
			continue
		}

		seenServiceNames[serviceName] = struct{}{}
		serviceOrder = append(serviceOrder, serviceName)
	}

	return serviceOrder
}
