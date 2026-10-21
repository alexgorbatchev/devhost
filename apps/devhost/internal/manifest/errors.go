package manifest

import (
	"errors"
	"fmt"
	"strings"

	"github.com/BurntSushi/toml"
)

// ParseError reports a manifest file that is not valid TOML, at the line and column where parsing stopped. Line and
// Column are zero when the parser gave no position.
type ParseError struct {
	Path   string
	Line   int
	Column int
	err    error
	text   string
}

func newParseError(path string, manifestText string, err error) *ParseError {
	parseError := &ParseError{Path: path, err: err, text: formatManifestParseError(manifestText, err)}
	var tomlError toml.ParseError
	if errors.As(err, &tomlError) {
		parseError.Line, parseError.Column = tomlError.Position.Line, tomlError.Position.Col
	}
	return parseError
}

func (e *ParseError) Error() string {
	return fmt.Sprintf("Failed to parse %s: %s", e.Path, e.text)
}

func (e *ParseError) Unwrap() error {
	return e.err
}

// ValidationError lists every problem a manifest's settings have. Each issue starts with the key path it concerns.
type ValidationError struct {
	Heading string
	Issues  []string
}

func (e *ValidationError) Error() string {
	return e.Heading + ":\n" + strings.Join(e.Issues, "\n")
}
