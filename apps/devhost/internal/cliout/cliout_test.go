package cliout

import (
	"errors"
	"fmt"
	"strings"
	"testing"
)

func TestWriteFailure(t *testing.T) {
	cause := errors.New("open /srv/devhost.toml: no such file or directory")
	wrapped := fmt.Errorf("read manifest /srv/devhost.toml: %w", cause)

	tests := []struct {
		name  string
		agent string
		err   error
		want  string
	}{
		{
			name:  "a person reads a plain error in full",
			agent: "0",
			err:   wrapped,
			want:  "[ERROR] read manifest /srv/devhost.toml: open /srv/devhost.toml: no such file or directory\n",
		},
		{
			name:  "a person reads the summary and the hint",
			agent: "0",
			err:   &Failure{Err: wrapped, Summary: "manifest file not found: /srv/devhost.toml", Hint: "Check the path."},
			want:  "[ERROR] manifest file not found: /srv/devhost.toml\n[INFO] Check the path.\n",
		},
		{
			name:  "a person reads the error itself when there is no summary",
			agent: "0",
			err:   &Failure{Err: errors.New("unknown option: --bogus"), Hint: "Run \"devhost --help\" for usage."},
			want:  "[ERROR] unknown option: --bogus\n[INFO] Run \"devhost --help\" for usage.\n",
		},
		{
			name:  "an unset variable means a person",
			agent: "",
			err:   cause,
			want:  "[ERROR] open /srv/devhost.toml: no such file or directory\n",
		},
		{
			name:  "an agent reads the whole error and nothing else",
			agent: "1",
			err:   &Failure{Err: wrapped, Summary: "manifest file not found: /srv/devhost.toml", Hint: "Check the path."},
			want:  "ERR: read manifest /srv/devhost.toml: open /srv/devhost.toml: no such file or directory\n",
		},
		{
			name:  "true selects agent output",
			agent: "true",
			err:   cause,
			want:  "ERR: open /srv/devhost.toml: no such file or directory\n",
		},
		{
			name:  "yes selects agent output",
			agent: "yes",
			err:   cause,
			want:  "ERR: open /srv/devhost.toml: no such file or directory\n",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("AGENT", tc.agent)

			var output strings.Builder
			WriteFailure(&output, tc.err)

			if output.String() != tc.want {
				t.Fatalf("WriteFailure(%v) wrote %q, want %q", tc.err, output.String(), tc.want)
			}
		})
	}
}

func TestFailureKeepsTheErrorItCarries(t *testing.T) {
	t.Parallel()

	cause := errors.New("no such file or directory")
	failure := &Failure{Err: fmt.Errorf("read manifest: %w", cause), Summary: "manifest file not found"}

	if failure.Error() != "read manifest: no such file or directory" {
		t.Fatalf("Error() = %q, want the carried error's text", failure.Error())
	}

	if !errors.Is(failure, cause) {
		t.Fatalf("errors.Is(failure, cause) = false, want the carried error's chain")
	}
}

func TestWarning(t *testing.T) {
	tests := []struct {
		name  string
		agent string
		want  string
	}{
		{name: "for a person", agent: "0", want: "[WARN] the watch path is outside the project"},
		{name: "for an agent", agent: "1", want: "WARN: the watch path is outside the project"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("AGENT", tc.agent)

			if got := Warning("the watch path is outside the project"); got != tc.want {
				t.Fatalf("Warning(...) = %q, want %q", got, tc.want)
			}
		})
	}
}
