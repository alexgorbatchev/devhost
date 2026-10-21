package cliout

import (
	"errors"
	"io"
	"strings"
	"testing"
)

func TestDiagnosticsShareLayoutAndFoldPaths(t *testing.T) {
	t.Setenv("HOME", "/home/dev")
	t.Setenv("COLUMNS", "0")
	for _, agent := range []string{"0", "1"} {
		t.Setenv("AGENT", agent)
		var output strings.Builder
		_, writer := ServiceOutputWriters(&output, &output, []string{"devhost", "long-service"})
		WriteFailure(writer, errors.New("open /home/dev/project/file; sibling /home/developer/file\nroot /home/dev"))
		got := output.String()
		if strings.Contains(got, "/home/dev/") || !strings.Contains(got, "~/project/file") || !strings.Contains(got, "/home/developer/file") {
			t.Fatalf("wrong folding: %s", got)
		}
		for line := range strings.SplitSeq(strings.TrimSpace(got), "\n") {
			prefix := "devhost      | "
			if agent == "1" {
				prefix = "devhost: "
			}
			if !strings.HasPrefix(line, prefix) {
				t.Errorf("missing shared prefix %q in %q", prefix, line)
			}
		}
	}
}

func TestLogPreservesDataAndChildOutput(t *testing.T) {
	t.Setenv("HOME", "/home/dev")
	t.Setenv("AGENT", "1")
	var output strings.Builder
	writer, _ := ServiceOutputWriters(&output, io.Discard, []string{"worker"})
	if err := WriteChildLine(writer, Prefix(nil, "worker")+"/home/dev/raw"); err != nil {
		t.Fatal(err)
	}
	if got := output.String(); got != "worker: /home/dev/raw\n" {
		t.Fatalf("child output changed: %q", got)
	}
	output.Reset()
	if err := WriteData(&output, []byte("42\t/home/dev/devhost.toml\n")); err != nil {
		t.Fatal(err)
	}
	if got := output.String(); got != "42\t/home/dev/devhost.toml\n" {
		t.Fatalf("command data changed: %q", got)
	}
}

func TestOutputWriteErrors(t *testing.T) {
	for _, write := range []func(io.Writer) error{
		func(w io.Writer) error { return WriteLog(w, "devhost", "message") },
		func(w io.Writer) error { return WriteChildLine(w, "child") },
		func(w io.Writer) error { return WriteData(w, []byte("data")) },
	} {
		reader, writer := io.Pipe()
		if err := reader.Close(); err != nil {
			t.Fatal(err)
		}
		if err := write(writer); !errors.Is(err, io.ErrClosedPipe) {
			t.Errorf("write error = %v", err)
		}
		if err := writer.Close(); err != nil {
			t.Fatal(err)
		}
	}
}
