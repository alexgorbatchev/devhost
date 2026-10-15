package cli

import (
	"io"
	"testing"
)

func TestServeArguments(t *testing.T) {
	t.Setenv("DEVHOST_MANIFEST", "/missing/devhost.toml")
	for _, tt := range []struct {
		name  string
		args  []string
		dir   string
		valid bool
	}{
		{"cwd", []string{"serve", "--domain", "notes.localhost"}, "", true},
		{"domain shorthand", []string{"serve", "-d", "notes.localhost"}, "", true},
		{"directory", []string{"serve", "--dir", "my notes", "--domain", "notes.localhost"}, "my notes", true},
		{"port", []string{"serve", "--port", "3000", "--domain", "notes.localhost"}, "", true},
		{"port shorthand", []string{"serve", "-p", "3000", "--domain", "notes.localhost"}, "", true},
		{"both", []string{"serve", "--dir", ".", "--port", "3000", "--domain", "notes.localhost"}, "", false},
		{"empty dir with port", []string{"serve", "--dir=", "--port", "3000", "--domain", "notes.localhost"}, "", false},
		{"zero port", []string{"serve", "--port", "0", "--domain", "notes.localhost"}, "", false},
		{"negative port", []string{"serve", "--port=-1", "--domain", "notes.localhost"}, "", false},
		{"large port", []string{"serve", "--port", "65536", "--domain", "notes.localhost"}, "", false},
		{"non-numeric port", []string{"serve", "--port", "abc", "--domain", "notes.localhost"}, "", false},
		{"positional dir", []string{"serve", ".", "--domain", "notes.localhost"}, "", false},
		{"missing domain", []string{"serve"}, "", false},
		{"URL", []string{"serve", "--domain", "https://notes.localhost"}, "", false},
		{"domain port", []string{"serve", "--domain", "notes.localhost:443"}, "", false},
		{"extra directory", []string{"serve", "one", "two", "--domain", "notes.localhost"}, "", false},
		{"manifest flag", []string{"serve", "--domain", "notes.localhost", "--manifest", "devhost.toml"}, "", false},
		{"removed command", []string{"files", "serve", "--domain", "notes.localhost"}, "", false},
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
			if got.Kind != KindServe || got.Directory != tt.dir || got.Domain != "notes.localhost" || got.ManifestPath != nil {
				t.Fatalf("parsed arguments = %#v", got)
			}
			wantPort := 0
			if tt.name == "port" || tt.name == "port shorthand" {
				wantPort = 3000
			}
			if got.Port != wantPort {
				t.Fatalf("port = %d, want %d", got.Port, wantPort)
			}
		})
	}
}
