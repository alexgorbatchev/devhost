package cli

import (
	"fmt"
	"path/filepath"

	"github.com/spf13/cobra"
)

// The connector is a child of devhost, with its own process lifetime. Keeping
// dispatch in Cobra gives its private arguments the ordinary parser checks.
func createRemoteWorkerCommand(result *CommandLineArguments) *cobra.Command {
	var stateDirectory string
	command := &cobra.Command{
		Use: "_remote-worker", Hidden: true, Args: cobra.NoArgs,
		RunE: func(_ *cobra.Command, _ []string) error {
			if !filepath.IsAbs(stateDirectory) {
				return fmt.Errorf("--state-dir must name an absolute devhost state directory")
			}
			*result = CommandLineArguments{Kind: KindRemoteWorker, RemoteStateDirectory: stateDirectory}
			return nil
		},
	}
	command.Flags().StringVar(&stateDirectory, "state-dir", "", "Devhost state directory owned by the connector.")
	return command
}
