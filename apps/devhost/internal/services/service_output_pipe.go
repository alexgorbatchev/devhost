package services

import (
	"io"
	"os"
	"sync"
)

// serviceOutputPipe is a parent-owned OS pipe for one service output stream. The child receives writer as its
// stdout/stderr; the parent reads reader to EOF, which only arrives once every holder of the write end has exited.
type serviceOutputPipe struct {
	reader *os.File
	writer *os.File
}

func newServiceOutputPipe() (serviceOutputPipe, error) {
	reader, writer, err := os.Pipe()
	return serviceOutputPipe{reader: reader, writer: writer}, err
}

// Close errors are ignored: the only possible failure is os.ErrClosed from a close that already happened.
func (p serviceOutputPipe) closeWriter() {
	_ = p.writer.Close()
}

func (p serviceOutputPipe) close() {
	_ = p.reader.Close()
	_ = p.writer.Close()
}

func pipeServiceOutput(
	reader *os.File,
	prefix string,
	writer io.Writer,
	attemptOutput *attemptOutputLines,
	onLine func(string),
	wg *sync.WaitGroup,
) {
	defer func() { _ = reader.Close() }()
	pipeProcessOutput(reader, prefix, writer, attemptOutput, onLine, wg)
}
