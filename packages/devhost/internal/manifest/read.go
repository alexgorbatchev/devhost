package manifest

import (
	"errors"
	"fmt"
	"os"
	"regexp"
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

	return RawManifest{
		serviceOrder: readServiceOrder(manifestText),
		value:        manifestValue,
	}, nil
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
