package cliout

import (
	"fmt"
	"io"
	"strings"
)

// WriteLog writes devhost-owned diagnostics through the shared record format.
// A stack's output writer supplies its layout; plain writers retain the record
// form for captured diagnostics and nonterminal consumers.
func WriteLog(writer io.Writer, label, message string) error {
	if writer == nil {
		return nil
	}
	for line := range strings.SplitSeq(strings.TrimSuffix(FoldPaths(message), "\n"), "\n") {
		if err := WriteChildLine(writer, Prefix(nil, label)+line); err != nil {
			return err
		}
	}
	return nil
}

// Log is best-effort diagnostic output when the caller cannot recover a write failure.
func Log(writer io.Writer, label, message string) {
	_ = WriteLog(writer, label, message)
}

// WriteChildLine preserves a child's text and canonical record for retained logs.
func WriteChildLine(writer io.Writer, line string) error {
	_, err := fmt.Fprintln(writer, line)
	return err
}

// WriteData emits command results byte-for-byte, without diagnostic formatting.
// Use it for machine-readable lists and certificates, never for log messages.
func WriteData(writer io.Writer, data []byte) error {
	n, err := writer.Write(data)
	if err == nil && n != len(data) {
		return io.ErrShortWrite
	}
	return err
}

func diagnosticWriter(writer io.Writer) io.Writer {
	if _, ok := writer.(*serviceOutputWriter); ok {
		return writer
	}
	_, result := ServiceOutputWriters(io.Discard, writer, []string{"devhost"})
	return result
}

// WriteWarning reports a warning with the same prefix and path rules as failures.
func WriteWarning(writer io.Writer, message string) {
	Log(diagnosticWriter(writer), "devhost", Warning(message))
}
