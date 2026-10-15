package cli

import (
	"fmt"

	"github.com/GiGurra/boa/pkg/boa"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/manifest"
	"github.com/spf13/cobra"
)

type serveOptions struct {
	Domain    string `descr:"Hostname to serve, e.g. notes.localhost (required)." name:"domain" short:"d" optional:"true"`
	Directory string `descr:"Directory to serve; defaults to the current directory." name:"dir" optional:"true"`
	Port      int    `descr:"Existing local HTTP service port (1-65535); exclusive with --dir." name:"port" short:"p" optional:"true"`
}

func createServeCommand(result *CommandLineArguments) boa.CmdT[serveOptions] {
	return boa.CmdT[serveOptions]{
		Use: "serve", Short: "Serve a directory or local port over HTTPS",
		Args: cobra.NoArgs,
		PostCreateFunc: func(_ *serveOptions, cmd *cobra.Command) error {
			cmd.MarkFlagsMutuallyExclusive("dir", "port")
			return cmd.MarkFlagDirname("dir")
		},
		Long: `Serve files or an existing local HTTP port without a manifest.
Use --dir for files or --port for a service on 127.0.0.1.
With neither option, serve the current directory.
--dir and --port are mutually exclusive.

--domain is required; the hostname must point here.
Caddy starts automatically if needed and stays running
after Ctrl+C removes this session's routes.
An existing service keeps running after the session stops.

Directories show index.html, then index.md, then a listing.
Markdown uses GitHub styling with a remembered source toggle.
Hidden files and symlinks outside the directory are excluded.`,
		RunFuncE: func(options *serveOptions, cmd *cobra.Command, _ []string) error {
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
