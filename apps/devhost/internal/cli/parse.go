package cli

import (
	"errors"
	"fmt"
	"io"
	"slices"
	"strconv"
	"strings"

	"github.com/GiGurra/boa/pkg/boa"
	"github.com/spf13/cobra"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/cliout"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/version"
)

type Kind string

const (
	KindStart Kind = "start"
	KindServe Kind = "serve"
	// KindHelp, KindVersion, KindCompletion, and KindSkill mean the requested
	// output has already been written to stdout.
	KindHelp               Kind = "help"
	KindVersion            Kind = "version"
	KindCompletion         Kind = "completion"
	KindSkill              Kind = "skill"
	KindStop               Kind = "stop"
	KindServiceList        Kind = "service-list"
	KindStackList          Kind = "stack-list"
	KindStackFind          Kind = "stack-find"
	KindStackRestart       Kind = "stack-restart"
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
	serviceCommandName       = "service"
	serviceCommandPath       = rootCommandName + " " + serviceCommandName
	serviceListCommandName   = "list"
	stackCommandName         = "stack"
	stackCommandPath         = rootCommandName + " " + stackCommandName
	stackListCommandName     = "list"
	caddyCommandName         = "caddy"
	caddyCommandPath         = rootCommandName + " " + caddyCommandName
	printRootCertCommandName = "print-root-cert"
	trustRemoteCommandName   = "trust-remote"
	versionTemplate          = "{{.Version}}\n"
	cobraVersionFlagName     = "version"
	// cobraCompletionCommandName is the name cobra gives the command it adds to the
	// root for printing shell completion scripts. Cobra does not export it.
	cobraCompletionCommandName = "completion"
	// skillCommandName is the name cobra-help-tree gives the command it adds to the
	// root for printing the skill. The library does not export it.
	skillCommandName = "skill"
)

type CommandLineArguments struct {
	Kind         Kind
	Directory    string
	Port         int
	Domain       string
	ManifestPath *string
	Action       CaddyLifecycleAction
	SSHTarget    string
	Debug        bool
	IdleTimeout  string
	// Services names the services or groups devhost start was asked for; empty means all services.
	Services []string
	// Startable limits devhost service list to the services that start only when named.
	Startable bool
	Worktrees bool
	Query     string
	All       bool
}

// ParseCommandLineArguments resolves rawArguments into the command to run. Help
// screens, the version, shell completion output, and the skill are written to
// stdout and reported as KindHelp, KindVersion, KindCompletion, and KindSkill;
// stderr receives cobra's diagnostics. A command line that cannot be run is
// returned as a *cliout.Failure whose hint names the help screen of the command
// that rejected it.
func ParseCommandLineArguments(rawArguments []string, stdout io.Writer, stderr io.Writer) (CommandLineArguments, error) {
	result := CommandLineArguments{}

	rootCommand, err := newRootCommand(&result, rawArguments)
	if err != nil {
		return CommandLineArguments{}, err
	}

	rootCommand.SetVersionTemplate(versionTemplate)
	rootCommand.SetOut(stdout)
	rootCommand.SetErr(stderr)
	rootCommand.SilenceUsage = true
	rootCommand.SilenceErrors = true

	executedCommand, err := rootCommand.ExecuteC()
	if err != nil {
		return CommandLineArguments{}, &cliout.Failure{
			Err:  normalizeParseError(err),
			Hint: fmt.Sprintf("Run %q for usage.", executedCommand.CommandPath()+" --help"),
		}
	}

	if printedVersion(executedCommand) {
		return CommandLineArguments{Kind: KindVersion}, nil
	}

	if result.Kind == "" && ranShellCompletion(executedCommand) {
		return CommandLineArguments{Kind: KindCompletion}, nil
	}

	if result.Kind == "" && printedSkill(executedCommand) {
		return CommandLineArguments{Kind: KindSkill}, nil
	}

	return result, nil
}

// newRootCommand builds the command tree devhost executes: its own commands,
// which record what to run in result, and the help screens with the skill
// command they add. The tests read the interface off the same tree.
func newRootCommand(result *CommandLineArguments, rawArguments []string) (*cobra.Command, error) {
	rootDefinition := createRootCommand(result)
	rootDefinition.RawArgs = rawArguments
	rootCommand, err := rootDefinition.ToCobraE()
	if err != nil {
		return nil, fmt.Errorf("building command line: %w", err)
	}

	if err := installHelp(rootCommand, result); err != nil {
		return nil, fmt.Errorf("installing help screens: %w", err)
	}

	return rootCommand, nil
}

// printedSkill reports whether the skill command ran. The help library adds it
// to the root and prints the guide itself, so like the completion commands it
// runs no devhost command function that could record it.
func printedSkill(command *cobra.Command) bool {
	return command.Name() == skillCommandName && command.Parent() == command.Root()
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
	Debug       bool     `descr:"Show Caddy's output while the stack runs." name:"debug"`
	IdleTimeout string   `descr:"Stop the stack after this long without traffic, e.g. 30s or 1m." env:"DEVHOST_IDLE_TIMEOUT" name:"idle-timeout" optional:"true"`
	Services    []string `descr:"Services or groups; omit to start every service." name:"service" optional:"true" positional:"true"`
}

type serviceListOptions struct {
	ManifestOptions
	Startable bool `descr:"List only the services that start when named." name:"startable"`
}

type stopOptions struct {
	ManifestOptions
	Worktrees bool `descr:"Stop stacks in every worktree of this Git repository." name:"worktrees"`
}

type stackFindOptions struct {
	Query string `descr:"URL, hostname, stack name, or partial name to find." positional:"true"`
}

type stackRestartOptions struct {
	ManifestOptions
	All bool `descr:"Restart every stack and serve session in this state directory." name:"all"`
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
// it is invoked without a subcommand. The caddy group follows the same rule.
func createRootCommand(result *CommandLineArguments) boa.CmdT[boa.NoParams] {
	return boa.CmdT[boa.NoParams]{
		Use:     rootCommandName,
		Short:   "Run your project's services behind local HTTPS hostnames",
		Version: version.String(),
		Args:    rejectUnknownCommand,
		SubCmds: boa.SubCmds(
			createServeCommand(result),
			createCaddyCommand(result),
			createServiceCommand(result),
			createStackCommand(result),
			createStartCommand(result),
			createStopCommand(result),
		),
	}
}

func createStartCommand(result *CommandLineArguments) boa.CmdT[startOptions] {
	return boa.CmdT[startOptions]{
		Use:   startCommandName,
		Short: "Start the services in devhost.toml",
		Long:  startDescription,
		RunFuncE: func(options *startOptions, _ *cobra.Command, _ []string) error {
			if err := validateManifestPath(options.ManifestPath); err != nil {
				return err
			}

			*result = CommandLineArguments{
				Kind:         KindStart,
				ManifestPath: options.ManifestPath,
				Debug:        options.Debug,
				IdleTimeout:  options.IdleTimeout,
				Services:     options.Services,
			}
			return nil
		},
	}
}

// Long descriptions are printed verbatim, so their lines are kept short enough
// not to wrap in a 60-column terminal.
const startDescription = `Start every service in devhost.toml behind local HTTPS
hostnames. Routes are removed when the stack exits.

Name services or groups from [groups] to start their services,
what they depend on, and the services marked alwaysStart.
The rest can be started later from the Services panel.

Without --manifest, devhost uses the nearest devhost.toml in
the current folder or a parent folder. Hostnames must
already point to this machine; *.localhost names need no
DNS setup.`

const stopDescription = `Stop the running stack for this project.

With --worktrees, stop every stack whose root manifest is
in this Git repository, including its linked worktrees.
Other repositories and the shared Caddy stay running.

Processes that do not exit within 15 seconds are
force-killed.

To stop a stack started somewhere else, pass its manifest
with --manifest. "devhost stack list" prints the manifest of
every running stack.`

const caddyDescription = `devhost sends every stack through one shared Caddy server.
Download and trust it once, then start it before running
a stack.`

func createStopCommand(result *CommandLineArguments) boa.CmdT[stopOptions] {
	return boa.CmdT[stopOptions]{
		Use:   stopCommandName,
		Short: "Stop the running stack for this project",
		Long:  stopDescription,
		Args:  cobra.NoArgs,
		RunFuncE: func(options *stopOptions, _ *cobra.Command, _ []string) error {
			if err := validateManifestPath(options.ManifestPath); err != nil {
				return err
			}

			*result = CommandLineArguments{Kind: KindStop, ManifestPath: options.ManifestPath, Worktrees: options.Worktrees}
			return nil
		},
	}
}

const serviceDescription = `Inspect the services devhost.toml defines.`

const serviceListDescription = `Print the name of every service in devhost.toml, one per
line in alphabetical order.

With --startable, leave out the services marked alwaysStart,
which start whether or not they are named. Pipe the output
into a picker to choose what devhost start runs.`

func createServiceCommand(result *CommandLineArguments) boa.CmdT[boa.NoParams] {
	return boa.CmdT[boa.NoParams]{
		Use:   serviceCommandName,
		Short: "Inspect the services in devhost.toml",
		Long:  serviceDescription,
		Args:  rejectUnknownCommand,
		SubCmds: boa.SubCmds(
			boa.CmdT[serviceListOptions]{
				Use:   serviceListCommandName,
				Short: "Print the service names in devhost.toml",
				Long:  serviceListDescription,
				Args:  cobra.NoArgs,
				RunFuncE: func(options *serviceListOptions, _ *cobra.Command, _ []string) error {
					if err := validateManifestPath(options.ManifestPath); err != nil {
						return err
					}

					*result = CommandLineArguments{
						Kind:         KindServiceList,
						ManifestPath: options.ManifestPath,
						Startable:    options.Startable,
					}
					return nil
				},
			},
		),
	}
}

const stackDescription = `Inspect the stacks running on this machine.`

const stackListDescription = `Print manifest-backed stacks on this machine, one per line:
its PID, a tab, and the absolute path of its devhost.toml.

Stop one of them from any folder by passing its path to
devhost stop --manifest. File sessions use Ctrl+C instead.`

func createStackCommand(result *CommandLineArguments) boa.CmdT[boa.NoParams] {
	return boa.CmdT[boa.NoParams]{
		Use:   stackCommandName,
		Short: "Inspect the stacks running on this machine",
		Long:  stackDescription,
		Args:  rejectUnknownCommand,
		SubCmds: boa.SubCmds(
			boa.CmdT[stackFindOptions]{
				Use:   "find",
				Short: "Print the PID and manifest of matching running stacks",
				Long:  "Find running stacks by URL, hostname, stack name, or manifest path.\nURLs match their hostname exactly; other queries match case-insensitive\nsubstrings. Print every match once as PID, tab, absolute manifest path.\nNo matches produces empty output and succeeds.",
				RunFunc: func(params *stackFindOptions, _ *cobra.Command, _ []string) {
					*result = CommandLineArguments{Kind: KindStackFind, Query: params.Query}
				},
			},
			boa.CmdT[stackRestartOptions]{
				Use:   "restart",
				Short: "Restart running stacks with this devhost executable",
				Long:  stackRestartDescription,
				Args:  cobra.NoArgs,
				RunFuncE: func(options *stackRestartOptions, _ *cobra.Command, _ []string) error {
					if options.All && options.ManifestPath != nil {
						return fmt.Errorf("--all and --manifest (or DEVHOST_MANIFEST) are mutually exclusive")
					}
					if err := validateManifestPath(options.ManifestPath); err != nil {
						return err
					}
					*result = CommandLineArguments{Kind: KindStackRestart, All: options.All, ManifestPath: options.ManifestPath}
					return nil
				},
			},
			boa.CmdT[boa.NoParams]{
				Use:   stackListCommandName,
				Short: "Print the PID and manifest of running stacks",
				Long:  stackListDescription,
				Args:  cobra.NoArgs,
				RunFunc: func(_ *boa.NoParams, _ *cobra.Command, _ []string) {
					*result = CommandLineArguments{Kind: KindStackList}
				},
			},
		),
	}
}

const stackRestartDescription = `Restart this project's running stack with the devhost
executable running this command. Use --all for every stack
and standalone serve session in the same state directory.

Capture each process's arguments, working directory, and
environment before stopping it. Replacements run in the
background, with closed input and private log files whose
paths are printed. Saved worktree choices are restored;
services started later in the UI follow the launch selection.

Stacks stop gracefully, one at a time. A stack still stopping
after 15 seconds is left alone and reported as a failure.
The shared Caddy stays running. A successful restart means
the new control server registered; services may be starting.`

func createCaddyCommand(result *CommandLineArguments) boa.CmdT[boa.NoParams] {
	return boa.CmdT[boa.NoParams]{
		Use:   caddyCommandName,
		Short: "Set up and control the shared HTTPS proxy",
		Long:  caddyDescription,
		Args:  rejectUnknownCommand,
		SubCmds: boa.SubCmds(
			// The shared Caddy's settings come from the devhost config file, the
			// same for every stack, so its lifecycle commands take no manifest.
			createCaddyNoArgsCommand(result, caddyNoArgsCommand{use: string(CaddyStart), description: "Start the shared Caddy server", kind: KindCaddyLifecycle, action: CaddyStart}),
			createCaddyNoArgsCommand(result, caddyNoArgsCommand{use: string(CaddyStop), description: "Stop the shared Caddy server", kind: KindCaddyLifecycle, action: CaddyStop}),
			createCaddyNoArgsCommand(result, caddyNoArgsCommand{use: string(CaddyTrust), description: "Trust Caddy's certificate on this machine (asks for your password)", kind: KindCaddyLifecycle, action: CaddyTrust}),
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

// suggestionDistance is how many edits may separate a mistyped command from one
// suggested for it. It is cobra's default, which cobra applies only inside the
// argument check that rejectUnknownCommand replaces.
const suggestionDistance = 2

// rejectUnknownCommand is the argument check of a command group. boa installs one
// of its own when Args is unset; this one also names the commands the argument
// resembles or begins.
func rejectUnknownCommand(command *cobra.Command, arguments []string) error {
	if len(arguments) == 0 {
		return nil
	}

	message := fmt.Sprintf("unknown command %q for %q", arguments[0], command.CommandPath())

	command.SuggestionsMinimumDistance = suggestionDistance
	suggestions := command.SuggestionsFor(arguments[0])
	if len(suggestions) == 0 {
		return errors.New(message)
	}

	// Sorted and deduplicated because cobra lists a command once per rule it matches,
	// in the order the commands were registered.
	slices.Sort(suggestions)
	suggestions = slices.Compact(suggestions)
	for i, suggestion := range suggestions {
		suggestions[i] = strconv.Quote(suggestion)
	}

	return fmt.Errorf("%s; did you mean %s?", message, strings.Join(suggestions, " or "))
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
