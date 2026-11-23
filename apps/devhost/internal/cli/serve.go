package cli

import (
	"fmt"
	"strings"
	"time"

	"github.com/GiGurra/boa/pkg/boa"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/manifest"
	"github.com/spf13/cobra"
)

type serveOptions struct {
	Domain         string   `descr:"Hostname for files or an existing port, e.g. notes.localhost." name:"domain" short:"d" optional:"true"`
	Directory      string   `descr:"Directory to serve; defaults to the current directory." name:"dir" optional:"true"`
	Port           int      `descr:"Existing local HTTP service port (1-65535); exclusive with --dir." name:"port" short:"p" optional:"true"`
	Command        []string `descr:"Quoted shell command, or argv after --." positional:"true" optional:"true"`
	Name           string   `descr:"App name for generated command hostnames." name:"name" short:"n" optional:"true"`
	Detach         bool     `descr:"Run the command in the background after its first HTTP route is ready." name:"detach"`
	StartupTimeout string   `descr:"Time to wait for the command's first HTTP listener." name:"startup-timeout" default:"30s"`
	SessionID      string   `descr:"Preserve a command session's generated hostname label." name:"session-id" optional:"true"`
}

func createServeCommand(result *CommandLineArguments) boa.CmdT[serveOptions] {
	return boa.CmdT[serveOptions]{
		Use: "serve", Short: "Serve files, a local port, or a command over HTTPS",
		PostCreateFunc: func(_ *serveOptions, cmd *cobra.Command) error {
			cmd.MarkFlagsMutuallyExclusive("dir", "port")
			if err := cmd.Flags().MarkHidden("session-id"); err != nil {
				return err
			}
			return cmd.MarkFlagDirname("dir")
		},
		Long: `Launch a command and discover its HTTP listeners:
  devhost serve "bun start.ts"
  devhost serve --detach -- bun start.ts

Generated hostnames use the app name, a session ID, and
the machine's local domain suffix. Multiple HTTP ports
receive port-qualified hostnames. --name overrides the
inferred app name. Ctrl+C stops the command and its routes.

Serve files or an existing local HTTP port without a
manifest. Use --dir for files or --port for a service on
127.0.0.1. With neither option, serve the current
directory. --dir and --port are mutually exclusive.

Files and existing ports require --domain; the hostname
must point here.
Caddy starts automatically if needed and stays running
after Ctrl+C removes this session's routes.
An existing service keeps running after the session stops.

Directories show index.html, index.md, README.md, or
readme.md, else a listing. Markdown uses GitHub styling
with a remembered source toggle. Hidden files and symlinks
outside the directory are excluded.`,
		RunFuncE: func(options *serveOptions, cmd *cobra.Command, _ []string) error {
			if len(options.Command) > 0 {
				for _, flag := range []string{"dir", "port", "domain"} {
					if cmd.Flags().Changed(flag) {
						return fmt.Errorf("command serving and --%s are mutually exclusive", flag)
					}
				}
				command := options.Command
				if cmd.ArgsLenAtDash() < 0 {
					if len(command) != 1 || strings.TrimSpace(command[0]) == "" {
						return fmt.Errorf("pass one quoted command, or use -- before command arguments")
					}
					command = []string{"/bin/sh", "-c", command[0]}
				}
				timeout, err := time.ParseDuration(options.StartupTimeout)
				if err != nil || timeout <= 0 {
					return fmt.Errorf("--startup-timeout requires a positive duration, e.g. 30s")
				}
				if options.SessionID != "" && (!manifest.IsValidHost(options.SessionID+".localhost") || strings.Contains(options.SessionID, ".") || len(options.SessionID) > 57) {
					return fmt.Errorf("invalid command session label")
				}
				*result = CommandLineArguments{Kind: KindServe, Command: command, ServeName: options.Name, Session: options.SessionID, Detach: options.Detach, StartupTimeout: timeout}
				return nil
			}
			for _, flag := range []string{"name", "detach", "startup-timeout", "session-id"} {
				if cmd.Flags().Changed(flag) {
					return fmt.Errorf("--%s requires a command", flag)
				}
			}
			if !manifest.IsValidHost(options.Domain) {
				return fmt.Errorf("--domain requires a hostname without scheme, port, or path, e.g. notes.localhost")
			}
			if cmd.Flags().Changed("port") {
				if options.Port < 1 || options.Port > 65535 {
					return fmt.Errorf("--port must be between 1 and 65535")
				}
			}
			*result = CommandLineArguments{Kind: KindServe, Directory: options.Directory, Domain: options.Domain, Port: options.Port}
			return nil
		},
	}
}
