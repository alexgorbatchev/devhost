package cliout

import (
	"strings"
	"testing"
)

func TestLibraryLoggerReportsWarningsThroughTheInjectedFunction(t *testing.T) {
	var lines []string
	logger := NewLibraryLogger(func(line string) { lines = append(lines, line) })

	logger.Info("session_attached", "path", "/transcript")
	logger.Warn("tailer_failed", "err", "denied")

	if len(lines) != 1 {
		t.Fatalf("lines = %q, want only the warning", lines)
	}
	if !strings.Contains(lines[0], "tailer_failed") || !strings.Contains(lines[0], "denied") || strings.Contains(lines[0], "time=") {
		t.Fatalf("line = %q", lines[0])
	}
}
