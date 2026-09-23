package services

import (
	"bytes"
	"fmt"
	"io"
	"strings"
	"sync"
)

type lifecycleCommandOutputWriter struct {
	mu     sync.Mutex
	prefix string
	writer io.Writer
	onLine func(string)
	buf    []byte
}

func newLifecycleCommandOutputWriter(prefix string, writer io.Writer, onLine func(string)) *lifecycleCommandOutputWriter {
	return &lifecycleCommandOutputWriter{
		prefix: prefix,
		writer: writer,
		onLine: onLine,
	}
}

func (w *lifecycleCommandOutputWriter) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()

	w.buf = append(w.buf, p...)
	for {
		idx := bytes.IndexByte(w.buf, '\n')
		if idx < 0 {
			if len(w.buf) > 1024*1024 {
				w.emitLine(string(w.buf))
				w.buf = nil
			}
			break
		}
		line := string(w.buf[:idx])
		w.buf = w.buf[idx+1:]
		w.emitLine(line)
	}
	return len(p), nil
}

func (w *lifecycleCommandOutputWriter) Flush() {
	w.mu.Lock()
	defer w.mu.Unlock()

	if len(w.buf) > 0 {
		w.emitLine(string(w.buf))
		w.buf = nil
	}
}

func (w *lifecycleCommandOutputWriter) emitLine(text string) {
	line := w.prefix + strings.TrimRight(text, "\r")
	_, _ = fmt.Fprintln(w.writer, line)
	if w.onLine != nil {
		w.onLine(line)
	}
}
