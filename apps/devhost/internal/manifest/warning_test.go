package manifest

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestValidateManifestWatchPathsUseServiceCwd(t *testing.T) {
	root := t.TempDir()
	tests := []struct {
		name, cwd, watch string
		warn             bool
	}{
		{name: "sibling inside project", cwd: "apps/playground", watch: "../../packages/connector/src"},
		{name: "sibling outside project", cwd: "apps/playground", watch: "../../../shared", warn: true},
		{name: "absolute inside project", cwd: "apps/playground", watch: filepath.Join(root, "packages", "connector", "src")},
		{name: "absolute outside project", cwd: "apps/playground", watch: t.TempDir(), warn: true},
		{name: "absolute cwd outside project", cwd: t.TempDir(), watch: "src", warn: true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := captureStderr(t, func() {
				_, err := ValidateManifest(filepath.Join(root, "devhost.toml"), RawManifest{value: map[string]any{
					"name": "shop",
					"services": map[string]any{"web": map[string]any{
						"command": []any{"server"},
						"health":  map[string]any{"process": true},
						"cwd":     tc.cwd,
						"watch":   []any{tc.watch},
					}},
				}})
				if err != nil {
					t.Fatal(err)
				}
			})
			if tc.warn {
				if !strings.Contains(got, "resolves outside the manifest directory") {
					t.Fatalf("missing watch warning: %q", got)
				}
			} else if got != "" {
				t.Fatalf("unexpected watch warning: %q", got)
			}
		})
	}
}

func TestValidateManifestWarnsAboutAWatchPathOutsideTheManifestDirectory(t *testing.T) {
	manifestDirectoryPath := t.TempDir()
	message := fmt.Sprintf("services.web.watch path %q resolves outside the manifest directory %q\n", "../shared", manifestDirectoryPath)

	tests := []struct {
		name  string
		agent string
		want  string
	}{
		{name: "for a person", agent: "0", want: "devhost | [WARN] " + message},
		{name: "for an agent", agent: "1", want: "devhost: WARN: " + message},
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
	defer reader.Close()
	defer writer.Close()

	original := os.Stderr
	defer func() { os.Stderr = original }()
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
