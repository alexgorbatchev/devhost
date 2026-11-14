package app

import (
	"context"
	"io"
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
	if arguments.IdleTimeout != "" {
		args = append(args, "--idle-timeout", arguments.IdleTimeout)
	}
	args = append(args, "--")
	args = append(args, arguments.Services...)
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGHUP, syscall.SIGTERM)
	defer stop()
	logStdout, logStderr := cliout.ServiceOutputWriters(stdout, stderr, []string{"devhost"})
	if err := services.StartDetachedStack(ctx, services.DetachedStartOptions{Manifest: manifest, Arguments: args, Directory: cwd, Environment: readEnvironment(), Stdout: logStdout, Stderr: logStderr}); err != nil {
		return fail(stderr, err)
	}
	return 0
}
