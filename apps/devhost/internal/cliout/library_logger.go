package cliout

import (
	"log/slog"
	"strings"
)

type lineWriter func(string)

func (write lineWriter) Write(data []byte) (int, error) {
	write(strings.TrimRight(string(data), "\n"))
	return len(data), nil
}

// NewLibraryLogger gives a library that takes a structured logger the injected log
// function, so its warnings reach the same place as devhost's own. Libraries report
// routine progress below that level, which would only be noise here.
func NewLibraryLogger(write func(string)) *slog.Logger {
	handler := slog.NewTextHandler(lineWriter(write), &slog.HandlerOptions{
		Level: slog.LevelWarn,
		ReplaceAttr: func(_ []string, attribute slog.Attr) slog.Attr {
			if attribute.Key == slog.TimeKey {
				return slog.Attr{}
			}
			return attribute
		},
	})
	return slog.New(handler)
}
