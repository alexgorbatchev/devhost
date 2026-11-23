package app

import (
	"context"
	"io"
	"os"
	"os/signal"
	"syscall"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/cli"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/cliout"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/services"
)

func runServeCommand(arguments cli.CommandLineArguments, cwd string, stdout, stderr io.Writer) int {
	environment := readEnvironment()
	launch := services.TakeLaunchMetadata(environment)
	m, err := services.ResolveServeCommand(services.ServeCommandOptions{Directory: cwd, Command: arguments.Command, Name: arguments.ServeName, Session: arguments.Session, StartupTimeout: arguments.StartupTimeout, Environment: environment})
	if err != nil {
		return fail(stderr, err)
	}
	logStdout, logStderr := cliout.ServiceOutputWriters(stdout, stderr, []string{m.Name, "command", "devhost", "caddy"})
	if arguments.Detach {
		args := []string{"serve", "--session-id", m.Name, "--startup-timeout", arguments.StartupTimeout.String(), "--"}
		args = append(args, arguments.Command...)
		signals := make(chan os.Signal, 1)
		signal.Notify(signals, syscall.SIGINT, syscall.SIGHUP, syscall.SIGTERM)
		defer signal.Stop(signals)
		if err := services.StartDetachedStack(context.Background(), services.DetachedStartOptions{Manifest: m, Arguments: args, Directory: cwd, Environment: environment, Signals: signals, Stdout: logStdout, Stderr: logStderr}); err != nil {
			return fail(stderr, err)
		}
		return 0
	}
	cliout.Log(logStdout, m.Name, "Session: "+m.Name)
	cliout.Log(logStdout, m.Name, "Stop: devhost stop --session "+m.Name)
	code, err := services.StartServeCommand(&m, arguments.StartupTimeout, services.StartStackOptions{Environment: environment, Launch: launch, LogWriter: logStdout, ServiceStdoutWriter: logStdout, ServiceStderrWriter: logStderr, CaddyOutputWriters: caddy.RouteCommandOutputWriters{StdoutWriter: logStdout, StderrWriter: logStderr, Quiet: true}})
	if err != nil {
		return fail(stderr, err)
	}
	return code
}
