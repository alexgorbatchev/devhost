package caddy

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestResolveManagedCaddyExecutablePath(t *testing.T) {
	t.Parallel()

	paths := Paths{CaddyDirectoryPath: "/tmp/caddy"}
	if got := ResolveManagedCaddyExecutablePath(paths, "darwin", func(path string) (os.FileInfo, error) {
		if path != filepath.Join("/tmp/caddy", "caddy") {
			t.Fatalf("ResolveManagedCaddyExecutablePath(...) stat path = %q, want %q", path, filepath.Join("/tmp/caddy", "caddy"))
		}
		return nil, nil
	}); got != filepath.Join("/tmp/caddy", "caddy") {
		t.Fatalf("ResolveManagedCaddyExecutablePath(...) = %q, want %q", got, filepath.Join("/tmp/caddy", "caddy"))
	}

	if got := ResolveManagedCaddyExecutablePath(paths, "linux", func(string) (os.FileInfo, error) {
		return nil, os.ErrNotExist
	}); got != "caddy" {
		t.Fatalf("ResolveManagedCaddyExecutablePath(...) = %q, want %q", got, "caddy")
	}
}

func TestCreateManagedCaddyCommandArguments(t *testing.T) {
	t.Parallel()

	paths := CreateManagedCaddyPaths("/tmp/devhost-state")
	got := CreateManagedCaddyCommandArguments(paths, []string{"stop"}, ManagedCaddyCommandOptions{AdminAddress: "127.0.0.1:22000"})
	want := []string{"stop", "--address", "127.0.0.1:22000", "--config", paths.CaddyfilePath, "--adapter", "caddyfile"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("CreateManagedCaddyCommandArguments(...) = %#v, want %#v", got, want)
	}
}

func TestRunManagedCaddyCommand(t *testing.T) {
	t.Parallel()

	paths := CreateManagedCaddyPaths("/tmp/devhost-state")
	var gotArguments []string
	var gotOptions RunCommandOptions

	result := RunManagedCaddyCommand(paths, []string{"trust"}, ManagedCaddyCommandOptions{AdminAddress: "127.0.0.1:22000", InheritStdio: true, RuntimeOS: "linux"}, ManagedCaddyCommandDependencies{
		RunCommand: func(arguments []string, options RunCommandOptions) CommandResult {
			gotArguments = append([]string{}, arguments...)
			gotOptions = options
			return CommandResult{Success: true}
		},
		Stat: func(path string) (os.FileInfo, error) {
			if path != filepath.Join(paths.CaddyDirectoryPath, "caddy") {
				t.Fatalf("RunManagedCaddyCommand(...) stat path = %q, want %q", path, filepath.Join(paths.CaddyDirectoryPath, "caddy"))
			}
			return nil, nil
		},
	})

	if !result.Success {
		t.Fatal("RunManagedCaddyCommand(...) success = false, want true")
	}

	wantArguments := []string{filepath.Join(paths.CaddyDirectoryPath, "caddy"), "trust", "--address", "127.0.0.1:22000", "--config", paths.CaddyfilePath, "--adapter", "caddyfile"}
	if !reflect.DeepEqual(gotArguments, wantArguments) {
		t.Fatalf("RunManagedCaddyCommand(...) arguments = %#v, want %#v", gotArguments, wantArguments)
	}

	if gotOptions.WorkingDir != paths.CaddyDirectoryPath || !gotOptions.InheritStdio {
		t.Fatalf("RunManagedCaddyCommand(...) options = %#v, want working dir %q and inherit stdio", gotOptions, paths.CaddyDirectoryPath)
	}
}

func TestCreateManagedCaddyCommandErrorMessage(t *testing.T) {
	t.Parallel()

	if got := CreateManagedCaddyCommandErrorMessage("start", CommandResult{Success: false}); got != "Caddy start failed." {
		t.Fatalf("CreateManagedCaddyCommandErrorMessage(...) = %q, want %q", got, "Caddy start failed.")
	}

	got := CreateManagedCaddyCommandErrorMessage("stop", CommandResult{
		Stderr:  []byte("some error\n"),
		Stdout:  []byte("some output\n"),
		Success: false,
	})
	if got != "Caddy stop failed.\nsome error\nsome output" {
		t.Fatalf("CreateManagedCaddyCommandErrorMessage(...) = %q, want %q", got, "Caddy stop failed.\nsome error\nsome output")
	}
}
