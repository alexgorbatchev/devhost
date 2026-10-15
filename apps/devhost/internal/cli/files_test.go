package cli

import (
	"io"
	"testing"
)

func TestFilesServeArguments(t *testing.T) {
	t.Setenv("DEVHOST_MANIFEST", "/missing/devhost.toml")
	for _, tt := range []struct {
		name  string
		args  []string
		dir   string
		valid bool
	}{
		{"cwd", []string{"files", "serve", "--domain", "notes.localhost"}, "", true},
		{"domain shorthand", []string{"files", "serve", "-d", "notes.localhost"}, "", true},
		{"directory", []string{"files", "serve", "my notes", "--domain", "notes.localhost"}, "my notes", true},
		{"missing domain", []string{"files", "serve"}, "", false},
		{"URL", []string{"files", "serve", "--domain", "https://notes.localhost"}, "", false},
		{"port", []string{"files", "serve", "--domain", "notes.localhost:443"}, "", false},
		{"extra directory", []string{"files", "serve", "one", "two", "--domain", "notes.localhost"}, "", false},
		{"manifest flag", []string{"files", "serve", "--domain", "notes.localhost", "--manifest", "devhost.toml"}, "", false},
	} {
		t.Run(tt.name, func(t *testing.T) {
			got, err := ParseCommandLineArguments(tt.args, io.Discard, io.Discard)
			if !tt.valid {
				if err == nil {
					t.Fatal("expected argument error")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if got.Kind != KindFilesServe || got.Directory != tt.dir || got.Domain != "notes.localhost" || got.ManifestPath != nil {
				t.Fatalf("parsed arguments = %#v", got)
			}
		})
	}
}
