package services

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestStartServiceProcessReportsStartupContext(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "file")
	if err := os.WriteFile(file, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	missing := filepath.Join(dir, "missing")
	tests := []struct {
		name    string
		cwd     string
		command string
		want    []string
		wantErr error
	}{
		{
			name:    "missing working directory",
			cwd:     missing,
			command: os.Args[0],
			want:    []string{"start service garaje", "services.garaje.cwd", "working directory", missing},
			wantErr: os.ErrNotExist,
		},
		{
			name:    "working directory is a file",
			cwd:     file,
			command: os.Args[0],
			want:    []string{"start service garaje", "services.garaje.cwd", file, "not a directory"},
		},
		{
			name:    "missing executable with valid working directory",
			cwd:     dir,
			command: missing,
			want:    []string{"start service garaje", "executable", missing, "working directory", dir},
			wantErr: os.ErrNotExist,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			service := ResolvedService{Name: "garaje", Cwd: tt.cwd, Command: []string{tt.command}}
			started, err := startServiceProcess(ResolvedManifest{}, service, processStartOptions{})
			if started != nil || err == nil {
				t.Fatalf("startServiceProcess = %v, %v; want no process and an error", started, err)
			}
			for _, want := range tt.want {
				if !strings.Contains(err.Error(), want) {
					t.Errorf("error %q does not contain %q", err, want)
				}
			}
			if tt.wantErr != nil && !errors.Is(err, tt.wantErr) {
				t.Errorf("error %v does not wrap %v", err, tt.wantErr)
			}
		})
	}
}
