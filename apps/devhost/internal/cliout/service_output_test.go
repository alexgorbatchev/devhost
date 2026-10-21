package cliout

import (
	"bytes"
	"errors"
	"io"
	"os"
	"strings"
	"testing"
)

func TestServiceOutput(t *testing.T) {
	for _, tc := range []struct {
		name, agent, columns, input, want string
	}{
		{"human aligned", "0", "100", "[api] ready\n[frontend] started\n", "api      | ready\nfrontend | started\n"},
		{"wrap", "0", "16", "[api] abcdefghij\n", "api      | abcde\n         | fghij\n"},
		{"preserve spaces", "0", "16", "[api] abcde  xyz\n", "api      | abcde\n         |   xyz\n"},
		{"unicode", "0", "16", "[api] 界界界é\n", "api      | 界界\n         | 界é\n"},
		{"child ANSI", "0", "16", "[api] \x1b[31mabcdefghij\x1b[0m\n", "api      | \x1b[31mabcde\n         | fghij\x1b[0m\n"},
		{"empty line", "0", "16", "[api] \n", "api      | \n"},
		{"unknown width", "0", "", "[api] abcdefghijklmnopqrstuvwxyz\n", "api      | abcdefghijklmnopqrstuvwxyz\n"},
		{"narrow terminal", "0", "3", "[api] ready\n", "api      | ready\n"},
		{"agent", "1", "3", "[api] abcdefghij\n[frontend] started\n", "api: abcdefghij\nfrontend: started\n"},
		{"truthy agent", "yes", "17", "[api] abcdefghij\n", "api: abcdefghij\n"},
		{"agent child prefix", "1", "3", "[api] [child] \x1b[31mready\x1b[0m\n", "api: [child] \x1b[31mready\x1b[0m\n"},
		{"agent passthrough", "1", "3", "unprefixed diagnostic\n", "unprefixed diagnostic\n"},
		{"passthrough", "0", "17", "unprefixed diagnostic\n", "unprefixed diagnostic\n"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("AGENT", tc.agent)
			t.Setenv("COLUMNS", tc.columns)
			var output bytes.Buffer
			stdout, _ := ServiceOutputWriters(&output, io.Discard, []string{"api", "frontend"})
			if n, err := io.WriteString(stdout, tc.input); err != nil || n != len(tc.input) {
				t.Fatalf("Write = %d, %v", n, err)
			}
			if got := output.String(); got != tc.want {
				t.Fatalf("output = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestServiceOutputPrefix(t *testing.T) {
	for _, tc := range []struct {
		name, agent, want string
		layout            bool
	}{
		{"human aligned", "0", "caddy    | ", true},
		{"agent", "1", "caddy: ", true},
		{"writer without layout", "0", "[caddy] ", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("AGENT", tc.agent)
			var output bytes.Buffer
			var writer io.Writer = &output
			if tc.layout {
				writer, _ = ServiceOutputWriters(&output, io.Discard, []string{"api", "frontend"})
			}
			if got := Prefix(writer, "caddy"); got != tc.want {
				t.Fatalf("Prefix = %q, want %q", got, tc.want)
			}
			if output.Len() != 0 {
				t.Fatalf("Prefix wrote %q", output.String())
			}
		})
	}
}

func TestServiceOutputSharedStreamsAndReload(t *testing.T) {
	t.Setenv("AGENT", "0")
	t.Setenv("COLUMNS", "100")
	var output bytes.Buffer
	stdout, stderr := ServiceOutputWriters(&output, &output, []string{"api", "frontend"})
	for _, w := range []io.Writer{stdout, stderr} {
		if _, err := io.WriteString(w, "[new-service] ready\n[api] ready\n"); err != nil {
			t.Fatal(err)
		}
	}
	if got, want := output.String(), strings.Repeat("new-service | ready\napi         | ready\n", 2); got != want {
		t.Fatalf("output = %q, want %q", got, want)
	}
}

func TestServiceOutputWriteFailure(t *testing.T) {
	t.Setenv("AGENT", "0")
	f, err := os.CreateTemp(t.TempDir(), "closed-output")
	if err != nil {
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}
	stdout, _ := ServiceOutputWriters(f, io.Discard, []string{"api"})
	_, err = io.WriteString(stdout, "[api] ready\n")
	if !errors.Is(err, os.ErrClosed) {
		t.Fatalf("Write error = %v", err)
	}
}
