package cli

import (
	"io"
	"strings"
	"testing"
)

func TestRemoteStartParsesWithDetachedServiceSelection(t *testing.T) {
	t.Setenv("DEVHOST_MANIFEST", "")
	got, err := ParseCommandLineArguments([]string{"start", "--remote", "--detach", "web"}, io.Discard, io.Discard)
	if err != nil {
		t.Fatal(err)
	}
	if got.Kind != KindStart || !got.Remote || !got.Detach || len(got.Services) != 1 || got.Services[0] != "web" {
		t.Fatalf("remote start = %#v", got)
	}
}

func TestRemoteWorkerUsesPrivateAbsoluteStateDirectory(t *testing.T) {
	got, err := ParseCommandLineArguments([]string{"_remote-worker", "--state-dir", t.TempDir()}, io.Discard, io.Discard)
	if err != nil || got.Kind != KindRemoteWorker || got.RemoteStateDirectory == "" {
		t.Fatalf("worker = %#v, %v", got, err)
	}
	for _, directory := range []string{"", "relative"} {
		_, err := ParseCommandLineArguments([]string{"_remote-worker", "--state-dir", directory}, io.Discard, io.Discard)
		if err == nil {
			t.Errorf("worker accepted state directory %q", directory)
		}
	}
}

func TestRemoteFlagIsScopedToStart(t *testing.T) {
	for _, args := range [][]string{{"stop", "--remote"}, {"serve", "--remote"}, {"caddy", "start", "--remote"}} {
		_, err := ParseCommandLineArguments(args, io.Discard, io.Discard)
		if err == nil || !strings.Contains(err.Error(), "unknown option: --remote") {
			t.Errorf("%q error = %v", args, err)
		}
	}
}

func TestLocalStartAndConflictingModes(t *testing.T) {
	for _, flag := range []string{"--local", "-l"} {
		got, err := ParseCommandLineArguments([]string{"start", flag, "--detach", "web"}, io.Discard, io.Discard)
		if err != nil || !got.Local || got.Remote || !got.Detach || len(got.Services) != 1 || got.Services[0] != "web" {
			t.Fatalf("local start %s: %#v, %v", flag, got, err)
		}
	}
	if _, err := ParseCommandLineArguments([]string{"start", "--local", "--remote"}, io.Discard, io.Discard); err == nil || !strings.Contains(err.Error(), "mutually exclusive") {
		t.Fatalf("conflicting modes: %v", err)
	}
}
