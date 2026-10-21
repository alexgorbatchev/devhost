package cliout

import (
	"io"
	"math"
	"os"
	"slices"
	"strconv"
	"strings"
	"sync"

	"github.com/charmbracelet/x/ansi"
	"github.com/lucasb-eyer/go-colorful"
	"golang.org/x/term"
)

const (
	serviceSeparator = " | "
	// Space adjacent hues around the color wheel rather than assigning similar
	// colors to services that start together.
	serviceHueStep    = 137.508
	serviceSaturation = 0.7
	serviceLightness  = 0.6
)

type serviceOutputLayout struct {
	mu     sync.Mutex
	agent  bool
	width  int
	styles map[string]ansi.Style
}

type serviceOutputWriter struct {
	writer io.Writer
	layout *serviceOutputLayout
	color  bool
}

// ServiceOutputWriters formats the complete, prefixed stack and child records
// emitted by the supervisor. One layout belongs to one stack and is shared by both
// streams; retained diagnostics and browser logs keep their original records.
func ServiceOutputWriters(stdout, stderr io.Writer, names []string) (io.Writer, io.Writer) {
	layout := &serviceOutputLayout{agent: IsAgentMode(), styles: make(map[string]ansi.Style)}
	names = slices.Clone(names)
	slices.Sort(names)
	for _, name := range names {
		layout.register(name)
	}
	return newServiceOutputWriter(stdout, layout), newServiceOutputWriter(stderr, layout)
}

// Prefix returns the label writer puts before a record from name. It is for text
// that another process writes to the terminal on devhost's behalf, such as a
// password prompt, so that text lines up with the records around it. A writer
// without the shared layout gets the record form itself.
func Prefix(writer io.Writer, name string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		name = "devhost"
	}
	record := "[" + name + "] "
	w, ok := writer.(*serviceOutputWriter)
	if !ok {
		return record
	}
	w.layout.mu.Lock()
	defer w.layout.mu.Unlock()
	return w.format(record)
}

func newServiceOutputWriter(writer io.Writer, layout *serviceOutputLayout) *serviceOutputWriter {
	w := &serviceOutputWriter{writer: writer, layout: layout}
	if f, ok := writer.(*os.File); ok {
		w.color = !layout.agent && term.IsTerminal(int(f.Fd())) && os.Getenv("NO_COLOR") == "" && os.Getenv("TERM") != "dumb"
	}
	return w
}

func (l *serviceOutputLayout) register(name string) ansi.Style {
	if style, ok := l.styles[name]; ok {
		return style
	}
	hue := math.Mod(float64(len(l.styles))*serviceHueStep, 360)
	style := ansi.NewStyle().Bold().ForegroundColor(colorful.Hsl(hue, serviceSaturation, serviceLightness))
	l.styles[name] = style
	l.width = max(l.width, ansi.StringWidth(name))
	return style
}

func (w *serviceOutputWriter) Write(p []byte) (int, error) {
	w.layout.mu.Lock()
	defer w.layout.mu.Unlock()

	var output strings.Builder
	for line := range strings.SplitAfterSeq(string(p), "\n") {
		output.WriteString(w.format(line))
	}
	if _, err := io.WriteString(w.writer, output.String()); err != nil {
		return 0, err
	}
	return len(p), nil
}

func (w *serviceOutputWriter) format(line string) string {
	name, text, ok := strings.Cut(line, "] ")
	if !ok || !strings.HasPrefix(name, "[") {
		return line
	}
	name = strings.TrimPrefix(name, "[")
	if w.layout.agent {
		return name + ": " + text
	}
	style := w.layout.register(name)
	padding := strings.Repeat(" ", w.layout.width-ansi.StringWidth(name))
	continuation := strings.Repeat(" ", w.layout.width) + serviceSeparator
	if w.color {
		name = style.Styled(name)
	}
	newline := ""
	if strings.HasSuffix(text, "\n") {
		text = strings.TrimSuffix(text, "\n")
		newline = "\n"
	}
	available := serviceOutputWidth(w.writer) - ansi.StringWidth(continuation)
	if available > 0 {
		text = ansi.Hardwrap(text, available, true)
	}
	return name + padding + serviceSeparator + strings.ReplaceAll(text, "\n", "\n"+continuation) + newline
}

func serviceOutputWidth(writer io.Writer) int {
	if f, ok := writer.(*os.File); ok {
		if width, _, err := term.GetSize(int(f.Fd())); err == nil && width > 0 {
			return width
		}
	}
	if width, err := strconv.Atoi(os.Getenv("COLUMNS")); err == nil && width > 0 {
		return width
	}
	return 0
}
