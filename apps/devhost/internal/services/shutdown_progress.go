package services

import (
	"fmt"
	"io"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/cliout"
)

// Shutdown announces a service before forwarding the user's signal, then again
// encounters it during deferred cleanup. Keep one progress entry for both steps.
// label reads the stack's name when a line is written, since a reload can rename it.
type shutdownProgress struct {
	writer    io.Writer
	label     func() string
	announced map[string]bool
}

func newShutdownProgress(writer io.Writer, label func() string) *shutdownProgress {
	return &shutdownProgress{writer: writer, label: label, announced: map[string]bool{}}
}

func (p *shutdownProgress) stopping(name string) {
	if p.announced[name] {
		return
	}
	p.announced[name] = true
	cliout.Log(p.writer, p.label(), fmt.Sprintf("Stopping service %s...", name))
}

func (p *shutdownProgress) stopped(name string, err error) {
	if err == nil {
		cliout.Log(p.writer, p.label(), fmt.Sprintf("Stopped service %s.", name))
	}
}
