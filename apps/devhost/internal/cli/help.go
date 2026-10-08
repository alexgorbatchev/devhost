package cli

import (
	cobrahelptree "github.com/alexgorbatchev/cobra-help-tree/v2"
	"github.com/spf13/cobra"
)

const (
	manifestEnvironmentVariable    = "DEVHOST_MANIFEST"
	idleTimeoutEnvironmentVariable = "DEVHOST_IDLE_TIMEOUT"
	sshTargetDescription           = "SSH host that runs devhost, e.g. devbox or user@devbox"
)

var manifestEnvironmentSpec = cobrahelptree.EnvSpec{
	Name:        manifestEnvironmentVariable,
	Description: "Same as --manifest; the flag wins when both are set",
}

// installHelp replaces cobra's flat help and usage screens with command trees
// for the whole command hierarchy, and records in result that help was printed
// so the caller does not go on to run a command.
func installHelp(rootCommand *cobra.Command, result *CommandLineArguments) error {
	if err := cobrahelptree.SetupWithOptions(rootCommand, cobrahelptree.HelpOptions{Catalog: createHelpCatalog()}); err != nil {
		return err
	}

	renderHelp := rootCommand.HelpFunc()
	rootCommand.SetHelpFunc(func(command *cobra.Command, arguments []string) {
		renderHelp(command, arguments)
		*result = CommandLineArguments{Kind: KindHelp}
	})

	return nil
}

func createHelpCatalog() cobrahelptree.TechCatalog {
	manifestOnly := cobrahelptree.TechInfo{Env: []cobrahelptree.EnvSpec{manifestEnvironmentSpec}}

	catalog := cobrahelptree.TechCatalog{
		rootCommandName: {
			Quickstart: []cobrahelptree.QuickstartItem{
				{Command: "devhost caddy download", Comment: "one-time setup"},
				{Command: "devhost caddy trust", Comment: "one-time setup"},
				{Command: "devhost caddy start", Comment: "start the shared proxy"},
				{Command: "devhost start", Comment: "run the stack in devhost.toml"},
			},
		},
		rootCommandName + " " + startCommandName: {
			Env: []cobrahelptree.EnvSpec{
				manifestEnvironmentSpec,
				{
					Name:        idleTimeoutEnvironmentVariable,
					Description: "Same as --idle-timeout; the flag wins when both are set",
				},
			},
		},
		rootCommandName + " " + stopCommandName: manifestOnly,
		caddyCommandPath + " " + trustRemoteCommandName: {
			Args: []cobrahelptree.ArgSpec{{Name: "<ssh-target>", Description: sshTargetDescription}},
		},
	}

	for _, action := range []CaddyLifecycleAction{CaddyStart, CaddyStop, CaddyTrust} {
		catalog[caddyCommandPath+" "+string(action)] = manifestOnly
	}

	return catalog
}
