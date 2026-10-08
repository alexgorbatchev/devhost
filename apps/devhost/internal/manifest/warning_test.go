package manifest

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"testing"
)

func TestValidateManifestWarnsAboutAWatchPathOutsideTheManifestDirectory(t *testing.T) {
	manifestDirectoryPath := t.TempDir()
	message := fmt.Sprintf("services.web.watch path %q resolves outside the manifest directory %q\n", "../shared", manifestDirectoryPath)

	tests := []struct {
		name  string
		agent string
		want  string
	}{
		{name: "for a person", agent: "0", want: "[WARN] " + message},
		{name: "for an agent", agent: "1", want: "WARN: " + message},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("AGENT", tc.agent)

			got := captureStderr(t, func() {
				_, err := ValidateManifest(filepath.Join(manifestDirectoryPath, "devhost.toml"), RawManifest{value: map[string]any{
					"name": "shop",
					"services": map[string]any{"web": map[string]any{
						"command": []any{"server"},
						"health":  map[string]any{"process": true},
						"watch":   []any{"../shared"},
					}},
				}})
				if err != nil {
					t.Fatalf("ValidateManifest(...) unexpected error = %v", err)
				}
			})

			if got != tc.want {
				t.Fatalf("ValidateManifest(...) wrote %q to stderr, want %q", got, tc.want)
			}
		})
	}
}

// captureStderr returns what run writes to the process's standard error. It
// replaces os.Stderr, so the calling test must not be parallel.
func captureStderr(t *testing.T, run func()) string {
	t.Helper()

	reader, writer, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}

	original := os.Stderr
	os.Stderr = writer
	run()
	os.Stderr = original

	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}

	output, err := io.ReadAll(reader)
	if err != nil {
		t.Fatal(err)
	}

	return string(output)
}
