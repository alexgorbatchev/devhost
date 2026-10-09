package services

import (
	"fmt"
	"io"
)

// Shutdown announces a service before forwarding the user's signal, then again
// encounters it during deferred cleanup. Keep one progress entry for both steps.
type shutdownProgress struct {
	writer    io.Writer
	label     string
	announced map[string]bool
}

func newShutdownProgress(writer io.Writer, label string) *shutdownProgress {
	return &shutdownProgress{writer: writer, label: label, announced: map[string]bool{}}
}

func (p *shutdownProgress) stopping(name string) {
	if p.announced[name] {
		return
	}
	p.announced[name] = true
	writeLogLine(p.writer, p.label, fmt.Sprintf("Stopping service %s...", name))
}

func (p *shutdownProgress) stopped(name string, err error) {
	if err == nil {
		writeLogLine(p.writer, p.label, fmt.Sprintf("Stopped service %s.", name))
	}
}
