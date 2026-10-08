// Package cliout formats what devhost prints outside its logs for the reader the
// AGENT environment variable names: a person at a terminal, or an agent that
// reads the output as text.
package cliout

import (
	"errors"
	"fmt"
	"io"

	cobrahelptree "github.com/alexgorbatchev/cobra-help-tree/v2"
)

// Failure is an error with what a person needs beside it. An agent is shown Err
// in full, which is also what Error returns.
type Failure struct {
	Err error
	// Summary replaces Err for a person when Err repeats itself or names
	// internals. Empty means Err reads well as it is.
	Summary string
	// Hint is what a person can do next. Optional.
	Hint string
}

func (f *Failure) Error() string {
	return f.Err.Error()
}

func (f *Failure) Unwrap() error {
	return f.Err
}

// IsAgentMode reports whether output is for an agent. It is the test the help
// screens apply, so every screen and line of one run is written for one reader.
func IsAgentMode() bool {
	return cobrahelptree.IsAgentMode()
}

// WriteFailure writes err as the last thing a failed command says. A person gets
// a tagged line and, when the error carries one, a hint; an agent gets the whole
// error on one line.
func WriteFailure(writer io.Writer, err error) {
	// The writes are unchecked: this is the report of a failure, and nothing is
	// left to report a failed write to.
	if IsAgentMode() {
		_, _ = fmt.Fprintf(writer, "ERR: %s\n", err.Error())
		return
	}

	message := err.Error()
	hint := ""

	var failure *Failure
	if errors.As(err, &failure) {
		hint = failure.Hint
		if failure.Summary != "" {
			message = failure.Summary
		}
	}

	_, _ = fmt.Fprintf(writer, "[ERROR] %s\n", message)
	if hint != "" {
		_, _ = fmt.Fprintf(writer, "[INFO] %s\n", hint)
	}
}

// Warning returns message as a warning line.
func Warning(message string) string {
	if IsAgentMode() {
		return "WARN: " + message
	}

	return "[WARN] " + message
}
