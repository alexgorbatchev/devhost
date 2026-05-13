package manifest

import (
	"errors"
	"fmt"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/BurntSushi/toml"
)

var duplicateTableIndicatorPattern = regexp.MustCompile(`(?i)(already been defined|duplicate|redefine)`)
var parseErrorLinePattern = regexp.MustCompile(`line (\d+)`)

func ReadManifest(manifestPath string) (RawManifest, error) {
	manifestBytes, error := os.ReadFile(manifestPath)
	if error != nil {
		return RawManifest{}, fmt.Errorf("read manifest %s: %w", manifestPath, error)
	}

	manifestText := string(manifestBytes)
	manifestValue := map[string]any{}
	if _, error := toml.Decode(manifestText, &manifestValue); error != nil {
		return RawManifest{}, fmt.Errorf("Failed to parse %s: %s", manifestPath, formatManifestParseError(manifestText, error))
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
		serviceOrder: readServiceOrder(manifestText),
		value:        manifestMap,
	}, nil
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
		if value[index] != '$' {
			builder.WriteByte(value[index])
			index += 1
			continue
		}

		if interpolatedValue, nextIndex, ok := readBracketedEnvVar(value, index, undefinedVariableSet); ok {
			builder.WriteString(interpolatedValue)
			index = nextIndex
			continue
		}

		if interpolatedValue, nextIndex, ok := readBareEnvVar(value, index, undefinedVariableSet); ok {
			builder.WriteString(interpolatedValue)
			index = nextIndex
			continue
		}

		builder.WriteByte(value[index])
		index += 1
	}

	return builder.String()
}

func readBracketedEnvVar(value string, index int, undefinedVariableSet map[string]struct{}) (string, int, bool) {
	if index+1 >= len(value) || value[index+1] != '{' {
		return "", index, false
	}

	closingBraceIndex := strings.IndexByte(value[index+2:], '}')
	if closingBraceIndex < 0 {
		return value[index:], len(value), true
	}
	closingBraceIndex += index + 2

	name := value[index+2 : closingBraceIndex]
	if !isValidEnvVarName(name) {
		return value[index : closingBraceIndex+1], closingBraceIndex + 1, true
	}

	interpolatedValue := lookupInterpolatedValue(name, undefinedVariableSet)
	return interpolatedValue, closingBraceIndex + 1, true
}

func readBareEnvVar(value string, index int, undefinedVariableSet map[string]struct{}) (string, int, bool) {
	nameStart := index + 1
	if nameStart >= len(value) || !isValidEnvVarNameStart(value[nameStart]) {
		return "", index, false
	}

	nameEnd := nameStart + 1
	for nameEnd < len(value) && isValidEnvVarNameContinue(value[nameEnd]) {
		nameEnd += 1
	}

	name := value[nameStart:nameEnd]
	interpolatedValue := lookupInterpolatedValue(name, undefinedVariableSet)
	return interpolatedValue, nameEnd, true
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
