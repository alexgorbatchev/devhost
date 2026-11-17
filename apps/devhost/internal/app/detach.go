package app

import (
	"context"
	"io"
	"os"
	"os/signal"
	"syscall"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/cli"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/cliout"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/services"
)

func runDetachedStart(arguments cli.CommandLineArguments, manifest services.ResolvedManifest, cwd string, stdout, stderr io.Writer) int {
	args := []string{"start", "--manifest", manifest.ManifestPath}
	if arguments.Debug {
		args = append(args, "--debug")
	}
	if arguments.Remote {
		args = append(args, "--remote")
	}
	if arguments.IdleTimeout != "" {
		args = append(args, "--idle-timeout", arguments.IdleTimeout)
	}
	args = append(args, "--")
	args = append(args, arguments.Services...)
	// A signal before the stack is ready stops the start; one received while
	// the command waits for a failed supervisor's cleanup ends that wait, so a
	// slow cleanup never holds the terminal.
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, syscall.SIGINT, syscall.SIGHUP, syscall.SIGTERM)
	defer signal.Stop(signals)
	logStdout, logStderr := cliout.ServiceOutputWriters(stdout, stderr, []string{"devhost"})
	if err := services.StartDetachedStack(context.Background(), services.DetachedStartOptions{Manifest: manifest, Arguments: args, Directory: cwd, Environment: readEnvironment(), Signals: signals, Stdout: logStdout, Stderr: logStderr}); err != nil {
		return fail(stderr, err)
	}
	return 0
}
