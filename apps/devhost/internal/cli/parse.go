package cli

import (
	"fmt"
	"io"
	"strings"

	"github.com/GiGurra/boa/pkg/boa"
	"github.com/spf13/cobra"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/version"
)

type Kind string

const (
	KindStart Kind = "start"
	// KindHelp, KindVersion, and KindCompletion mean the requested output has
	// already been written to stdout.
	KindHelp               Kind = "help"
	KindVersion            Kind = "version"
	KindCompletion         Kind = "completion"
	KindStop               Kind = "stop"
	KindCaddyLifecycle     Kind = "caddy-lifecycle"
	KindCaddyPrintRootCert Kind = "caddy-print-root-cert"
	KindCaddyTrustRemote   Kind = "caddy-trust-remote"
)

type CaddyLifecycleAction string

const (
	CaddyStart           CaddyLifecycleAction = "start"
	CaddyStop            CaddyLifecycleAction = "stop"
	CaddyTrust           CaddyLifecycleAction = "trust"
	CaddyDownload        CaddyLifecycleAction = "download"
	CaddyPrivilegedPorts CaddyLifecycleAction = "privileged-ports"
)

const (
	rootCommandName          = "devhost"
	startCommandName         = "start"
	stopCommandName          = "stop"
	caddyCommandName         = "caddy"
	caddyCommandPath         = rootCommandName + " " + caddyCommandName
	printRootCertCommandName = "print-root-cert"
	trustRemoteCommandName   = "trust-remote"
	versionTemplate          = "{{.Version}}\n"
	cobraVersionFlagName     = "version"
	// cobraCompletionCommandName is the name cobra gives the command it adds to the
	// root for printing shell completion scripts. Cobra does not export it.
	cobraCompletionCommandName = "completion"
)

type CommandLineArguments struct {
	Kind         Kind
	ManifestPath *string
	Action       CaddyLifecycleAction
	SSHTarget    string
	Debug        bool
	IdleTimeout  string
}

// ParseCommandLineArguments resolves rawArguments into the command to run. Help
// screens, the version, and shell completion output are written to stdout and
// reported as KindHelp, KindVersion, and KindCompletion; stderr receives cobra's
// diagnostics.
func ParseCommandLineArguments(rawArguments []string, stdout io.Writer, stderr io.Writer) (CommandLineArguments, error) {
	result := CommandLineArguments{}

	rootDefinition := createRootCommand(&result)
	rootDefinition.RawArgs = rawArguments
	rootCommand, err := rootDefinition.ToCobraE()
	if err != nil {
		return CommandLineArguments{}, fmt.Errorf("building command line: %w", err)
	}

	if err := installHelp(rootCommand, &result); err != nil {
		return CommandLineArguments{}, fmt.Errorf("installing help screens: %w", err)
	}

	rootCommand.SetVersionTemplate(versionTemplate)
	rootCommand.SetOut(stdout)
	rootCommand.SetErr(stderr)
	rootCommand.SilenceUsage = true
	rootCommand.SilenceErrors = true

	executedCommand, err := rootCommand.ExecuteC()
	if err != nil {
		return CommandLineArguments{}, normalizeParseError(err)
	}

	if printedVersion(executedCommand) {
		return CommandLineArguments{Kind: KindVersion}, nil
	}

	if result.Kind == "" && ranShellCompletion(executedCommand) {
		return CommandLineArguments{Kind: KindCompletion}, nil
	}

	return result, nil
}

// ranShellCompletion reports whether cobra ran one of the completion commands it
// generates: a script printer under "completion", or the hidden request command
// those scripts call back into. Neither runs a devhost command function, so
// nothing else records that they ran. Help for these commands is recorded by
// installHelp and is not a completion run.
func ranShellCompletion(command *cobra.Command) bool {
	if command.Name() == cobra.ShellCompRequestCmd {
		return true
	}

	parent := command.Parent()
	return parent != nil && parent.Name() == cobraCompletionCommandName && parent.Parent() == command.Root()
}

// printedVersion reports whether cobra handled --version, which it does
// without running the command or any hook boa exposes.
func printedVersion(command *cobra.Command) bool {
	if command.Version == "" {
		return false
	}

	requested, err := command.Flags().GetBool(cobraVersionFlagName)
	return err == nil && requested
}

type startOptions struct {
	ManifestOptions
	Debug       bool   `descr:"Show Caddy's output while the stack runs." name:"debug"`
	IdleTimeout string `descr:"Stop the stack after this long without traffic, e.g. 30s or 1m." env:"DEVHOST_IDLE_TIMEOUT" name:"idle-timeout" optional:"true"`
}

// ManifestOptions is for commands that only locate a manifest; they must not
// accept stack flags they would ignore. It is exported because startOptions
// embeds it and boa fills flags through reflection, which cannot set fields
// reached through an unexported embedded struct.
type ManifestOptions struct {
	ManifestPath *string `descr:"Path to the devhost.toml file to use." env:"DEVHOST_MANIFEST" name:"manifest"`
}

type trustRemoteOptions struct {
	SSHTarget string `descr:"SSH host that runs devhost, e.g. devbox or user@devbox." positional:"true"`
}

// createRootCommand has no run function of its own, so boa prints its help when
// it is invoked without a subcommand and rejects unknown subcommands. The caddy group
// follows the same rule.
func createRootCommand(result *CommandLineArguments) boa.CmdT[boa.NoParams] {
	return boa.CmdT[boa.NoParams]{
		Use:     rootCommandName,
		Short:   "Run your project's services behind local HTTPS hostnames",
		Version: version.String(),
		SubCmds: boa.SubCmds(
			createCaddyCommand(result),
			createStartCommand(result),
			createStopCommand(result),
		),
	}
}

func createStartCommand(result *CommandLineArguments) boa.CmdT[startOptions] {
	return boa.CmdT[startOptions]{
		Use:   startCommandName,
		Short: "Start every service in devhost.toml",
		Long:  startDescription,
		Args:  cobra.NoArgs,
		RunFuncE: func(options *startOptions, _ *cobra.Command, _ []string) error {
			if err := validateManifestPath(options.ManifestPath); err != nil {
				return err
			}

			*result = CommandLineArguments{
				Kind:         KindStart,
				ManifestPath: options.ManifestPath,
				Debug:        options.Debug,
				IdleTimeout:  options.IdleTimeout,
			}
			return nil
		},
	}
}

// Long descriptions are printed verbatim, so their lines are kept short enough
// not to wrap in a 60-column terminal.
const startDescription = `Start every service in devhost.toml behind local HTTPS
hostnames. Routes are removed when the stack exits.

Without --manifest, devhost uses the nearest devhost.toml in
the current folder or a parent folder. Hostnames must
already point to this machine; *.localhost names need no
DNS setup.`

const stopDescription = `Stop the running stack for this project.

Processes that do not exit within 15 seconds are
force-killed.`

const caddyDescription = `devhost sends every stack through one shared Caddy server.
Download and trust it once, then start it before running
a stack.`

func createStopCommand(result *CommandLineArguments) boa.CmdT[ManifestOptions] {
	return boa.CmdT[ManifestOptions]{
		Use:   stopCommandName,
		Short: "Stop the running stack for this project",
		Long:  stopDescription,
		Args:  cobra.NoArgs,
		RunFuncE: func(options *ManifestOptions, _ *cobra.Command, _ []string) error {
			if err := validateManifestPath(options.ManifestPath); err != nil {
				return err
			}

			*result = CommandLineArguments{Kind: KindStop, ManifestPath: options.ManifestPath}
			return nil
		},
	}
}

func createCaddyCommand(result *CommandLineArguments) boa.CmdT[boa.NoParams] {
	return boa.CmdT[boa.NoParams]{
		Use:   caddyCommandName,
		Short: "Set up and control the shared HTTPS proxy",
		Long:  caddyDescription,
		SubCmds: boa.SubCmds(
			createCaddyLifecycleCommand(result, CaddyStart, "Start the shared Caddy server"),
			createCaddyLifecycleCommand(result, CaddyStop, "Stop the shared Caddy server"),
			createCaddyLifecycleCommand(result, CaddyTrust, "Trust Caddy's certificate on this machine (asks for your password)"),
			createCaddyNoArgsCommand(result, caddyNoArgsCommand{
				use:         string(CaddyDownload),
				description: "Download the Caddy server devhost uses",
				kind:        KindCaddyLifecycle,
				action:      CaddyDownload,
			}),
			createCaddyNoArgsCommand(result, caddyNoArgsCommand{
				use:         string(CaddyPrivilegedPorts),
				description: "Let Caddy listen on low ports without root (Linux)",
				kind:        KindCaddyLifecycle,
				action:      CaddyPrivilegedPorts,
			}),
			createCaddyNoArgsCommand(result, caddyNoArgsCommand{
				use:         printRootCertCommandName,
				description: "Print Caddy's root certificate",
				kind:        KindCaddyPrintRootCert,
			}),
			createTrustRemoteCommand(result),
		),
	}
}

func createCaddyLifecycleCommand(result *CommandLineArguments, action CaddyLifecycleAction, description string) boa.CmdT[ManifestOptions] {
	return boa.CmdT[ManifestOptions]{
		Use:   string(action),
		Short: description,
		Args:  cobra.NoArgs,
		RunFuncE: func(options *ManifestOptions, _ *cobra.Command, _ []string) error {
			if err := validateManifestPath(options.ManifestPath); err != nil {
				return err
			}

			*result = CommandLineArguments{
				Kind:         KindCaddyLifecycle,
				Action:       action,
				ManifestPath: options.ManifestPath,
			}
			return nil
		},
	}
}

type caddyNoArgsCommand struct {
	use         string
	description string
	kind        Kind
	action      CaddyLifecycleAction
}

func createCaddyNoArgsCommand(result *CommandLineArguments, definition caddyNoArgsCommand) boa.CmdT[boa.NoParams] {
	return boa.CmdT[boa.NoParams]{
		Use:   definition.use,
		Short: definition.description,
		Args:  cobra.NoArgs,
		RunFunc: func(_ *boa.NoParams, _ *cobra.Command, _ []string) {
			*result = CommandLineArguments{Kind: definition.kind, Action: definition.action}
		},
	}
}

func createTrustRemoteCommand(result *CommandLineArguments) boa.CmdT[trustRemoteOptions] {
	return boa.CmdT[trustRemoteOptions]{
		Use:   trustRemoteCommandName,
		Short: "Trust another machine's Caddy certificate over SSH (macOS)",
		Args:  requireSSHTarget,
		RunFunc: func(options *trustRemoteOptions, _ *cobra.Command, _ []string) {
			*result = CommandLineArguments{Kind: KindCaddyTrustRemote, SSHTarget: options.SSHTarget}
		},
	}
}

// requireSSHTarget replaces boa's positional count check, which boa only installs
// when Args is unset, so that a missing target gets an example instead of a bare
// argument count.
func requireSSHTarget(command *cobra.Command, arguments []string) error {
	if len(arguments) == 0 {
		return fmt.Errorf("Expected an SSH target. Example: devhost caddy trust-remote devbox")
	}

	return cobra.ExactArgs(1)(command, arguments)
}

func validateManifestPath(manifestPath *string) error {
	if manifestPath == nil {
		return nil
	}

	if !strings.HasSuffix(*manifestPath, "devhost.toml") {
		return fmt.Errorf("--manifest must point to a file named devhost.toml, received: %s", *manifestPath)
	}

	return nil
}

func normalizeParseError(err error) error {
	message := err.Error()
	if strings.HasPrefix(message, "unknown flag: ") {
		return fmt.Errorf("unknown option: %s", strings.TrimPrefix(message, "unknown flag: "))
	}

	if strings.HasPrefix(message, "flag needs an argument: ") {
		return fmt.Errorf("option requires argument: %s", strings.TrimPrefix(message, "flag needs an argument: "))
	}

	return err
}
