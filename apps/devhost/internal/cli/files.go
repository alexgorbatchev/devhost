package cli

import (
	"fmt"

	"github.com/GiGurra/boa/pkg/boa"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/manifest"
	"github.com/spf13/cobra"
)

type filesServeOptions struct {
	Domain    string `descr:"Hostname to serve, e.g. notes.localhost (required)." name:"domain" short:"d" optional:"true"`
	Directory string `descr:"Directory to serve; omit to use the current directory." name:"directory" positional:"true" optional:"true"`
}

func createFilesCommand(result *CommandLineArguments) boa.CmdT[boa.NoParams] {
	return boa.CmdT[boa.NoParams]{
		Use: "files", Short: "Serve files without a manifest", Args: rejectUnknownCommand,
		SubCmds: boa.SubCmds(boa.CmdT[filesServeOptions]{
			Use: "serve", Short: "Serve a directory behind a local HTTPS hostname",
			Long: `Serve static files from a directory without devhost.toml.
Omit the directory to serve the current folder.

--domain is required; the hostname must point here.
Caddy starts automatically if needed and stays running
after Ctrl+C removes this session's routes.

Directories show index.html, then index.md, then a listing.
Markdown uses GitHub styling with a remembered source toggle.
Hidden files and symlinks outside the directory are excluded.`,
			RunFuncE: func(options *filesServeOptions, _ *cobra.Command, _ []string) error {
				if !manifest.IsValidHost(options.Domain) {
					return fmt.Errorf("--domain requires a hostname without scheme, port, or path, e.g. notes.localhost")
				}
				*result = CommandLineArguments{Kind: KindFilesServe, Directory: options.Directory, Domain: options.Domain}
				return nil
			},
		}),
	}
}
