package cli

import (
	cobrahelptree "github.com/alexgorbatchev/cobra-help-tree/v2"
	"github.com/spf13/cobra"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/skill"
)

const (
	manifestEnvironmentVariable    = "DEVHOST_MANIFEST"
	idleTimeoutEnvironmentVariable = "DEVHOST_IDLE_TIMEOUT"
	sshTargetDescription           = "SSH host that runs devhost, e.g. devbox or user@devbox"
	serviceArgumentDescription     = "Services to start; all of them when none is named"
	// stopPickedStackCommand stops a stack chosen from the running ones: the
	// listing goes through a picker, and the second field of the picked line is
	// the manifest devhost stop takes.
	stopPickedStackCommand = `devhost stop --manifest "$(devhost stack list | fzf | cut -f2)"`
)

var manifestEnvironmentSpec = cobrahelptree.EnvSpec{
	Name:        manifestEnvironmentVariable,
	Description: "Same as --manifest; the flag wins when both are set",
}

// installHelp replaces cobra's flat help and usage screens with command trees
// for the whole command hierarchy, and records in result that help was printed
// so the caller does not go on to run a command.
func installHelp(rootCommand *cobra.Command, result *CommandLineArguments) error {
	// Skill adds the skill command and opens every agent help screen with an alert
	// that sends the agent to it.
	options := cobrahelptree.HelpOptions{Catalog: createHelpCatalog(), Skill: skill.Document()}
	if err := cobrahelptree.SetupWithOptions(rootCommand, options); err != nil {
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
				{Command: "devhost start web", Comment: "run web and what it depends on"},
			},
		},
		serviceCommandPath + " " + serviceListCommandName: manifestOnly,
		rootCommandName + " " + startCommandName: {
			Args: []cobrahelptree.ArgSpec{{Name: "[service...]", Description: serviceArgumentDescription}},
			Env: []cobrahelptree.EnvSpec{
				manifestEnvironmentSpec,
				{
					Name:        idleTimeoutEnvironmentVariable,
					Description: "Same as --idle-timeout; the flag wins when both are set",
				},
			},
		},
		rootCommandName + " " + stopCommandName: {
			Env: []cobrahelptree.EnvSpec{manifestEnvironmentSpec},
			Quickstart: []cobrahelptree.QuickstartItem{
				{Command: "devhost stop", Comment: "stop the stack of this folder"},
				{Command: stopPickedStackCommand, Comment: "pick one"},
			},
		},
		stackCommandPath + " " + stackListCommandName: {
			Quickstart: []cobrahelptree.QuickstartItem{
				{Command: "devhost stack list", Comment: "PID, tab, manifest per line"},
				{Command: "devhost stack list | cut -f2", Comment: "manifests only"},
				{Command: stopPickedStackCommand, Comment: "pick one to stop"},
			},
		},
		caddyCommandPath + " " + trustRemoteCommandName: {
			Args: []cobrahelptree.ArgSpec{{Name: "<ssh-target>", Description: sshTargetDescription}},
		},
	}

	for _, action := range []CaddyLifecycleAction{CaddyStart, CaddyStop, CaddyTrust} {
		catalog[caddyCommandPath+" "+string(action)] = manifestOnly
	}

	return catalog
}
