package cliout

import (
	"bufio"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/charmbracelet/x/ansi"
	"github.com/creack/pty"
)

func TestServiceOutputTerminal(t *testing.T) {
	for _, tc := range []struct {
		name, agent, noColor, term string
		colored                    bool
	}{
		{"colors", "0", "", "xterm-256color", true},
		{"NO_COLOR", "0", "1", "xterm-256color", false},
		{"dumb", "0", "", "dumb", false},
		{"agent", "1", "", "xterm-256color", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("AGENT", tc.agent)
			// The terminal's current size takes precedence over an inherited value.
			t.Setenv("COLUMNS", "100")
			t.Setenv("NO_COLOR", tc.noColor)
			t.Setenv("TERM", tc.term)
			master, terminal, err := pty.Open()
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { master.Close(); terminal.Close() })
			resize := func(cols uint16) {
				t.Helper()
				if err := pty.Setsize(terminal, &pty.Winsize{Rows: 24, Cols: cols}); err != nil {
					t.Fatal(err)
				}
			}
			resize(16)
			stdout, stderr := ServiceOutputWriters(terminal, terminal, []string{"api", "frontend"})
			reader := bufio.NewReader(master)
			writeRead := func(writer io.Writer, input string, lines int) string {
				t.Helper()
				if _, err := io.WriteString(writer, input); err != nil {
					t.Fatal(err)
				}
				result := make(chan string, 1)
				go func() {
					var output strings.Builder
					for range lines {
						line, err := reader.ReadString('\n')
						if err != nil {
							result <- "read error: " + err.Error()
							return
						}
						output.WriteString(strings.ReplaceAll(line, "\r\n", "\n"))
					}
					result <- output.String()
				}()
				select {
				case output := <-result:
					return output
				case <-time.After(3 * time.Second):
					t.Fatal("terminal output timed out")
					return ""
				}
			}
			lines, wantFirst, wantSecond := 2, "api      | abcde\n         | fghij\n", "api      | abcdefghij\n"
			if tc.agent == "1" {
				lines, wantFirst, wantSecond = 1, "api: abcdefghij\n", "api: abcdefghij\n"
			}
			first := writeRead(stdout, "[api] abcdefghij\n", lines)
			if got := ansi.Strip(first); got != wantFirst {
				t.Fatalf("wrapped output = %q", got)
			}
			if colored := first != ansi.Strip(first); colored != tc.colored {
				t.Fatalf("colored = %v, want %v", colored, tc.colored)
			}
			resize(100)
			second := writeRead(stderr, "[api] abcdefghij\n", 1)
			if got := ansi.Strip(second); got != wantSecond {
				t.Fatalf("resized output = %q", got)
			}
			firstPrefix, _, _ := strings.Cut(first, "api")
			secondPrefix, _, _ := strings.Cut(second, "api")
			if firstPrefix != secondPrefix {
				t.Fatal("service color differs between streams")
			}
			third := writeRead(stdout, "[frontend] ready\n", 1)
			thirdPrefix, _, _ := strings.Cut(third, "frontend")
			if tc.colored && firstPrefix == thirdPrefix {
				t.Fatal("services have the same color")
			}
		})
	}
}
