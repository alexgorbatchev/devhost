package services

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/cliout"
)

func TestDetachedStartRejectsUnsupportedPlatforms(t *testing.T) {
	for _, goos := range []string{"linux", "darwin"} {
		if err := checkDetachPlatform(goos); err != nil {
			t.Fatalf("checkDetachPlatform(%q) = %v, want nil", goos, err)
		}
	}
	f := newDetachFixture(t, "exit")
	f.options.goos = "windows"
	err := StartDetachedStack(context.Background(), f.options)
	if err == nil || err.Error() != "devhost start --detach runs on Linux and macOS, not windows" {
		t.Fatalf("error = %v, want the platform rejection", err)
	}
	// The rejection comes before anything is created or launched.
	for _, path := range []string{filepath.Dir(f.logPath), filepath.Join(f.directory, "pid")} {
		if _, err := os.Stat(path); !errors.Is(err, os.ErrNotExist) {
			t.Fatalf("%s exists after the rejection: %v", path, err)
		}
	}
	t.Setenv("AGENT", "0")
	var output bytes.Buffer
	cliout.WriteFailure(&output, err)
	want := "devhost | [ERROR] devhost start --detach runs on Linux and macOS, not windows\n" +
		"devhost | [INFO] Run devhost start without --detach and keep its terminal open.\n"
	if output.String() != want {
		t.Fatalf("failure line = %q, want %q", output.String(), want)
	}
}
