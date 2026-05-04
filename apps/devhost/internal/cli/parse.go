package cli

import (
	"fmt"
	"strings"

	"github.com/GiGurra/boa/pkg/boa"
	"github.com/spf13/cobra"
)

type Kind string

const (
	KindManifest           Kind = "manifest"
	KindVersion            Kind = "version"
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

type CommandLineArguments struct {
	Kind         Kind
	ManifestPath *string
	Action       CaddyLifecycleAction
	SSHTarget    string
}

const caddyActionListText = "start, stop, trust, download, privileged-ports, print-root-cert, or trust-remote"

func ParseCommandLineArguments(rawArguments []string) (CommandLineArguments, error) {
	if HasVersionFlag(rawArguments) {
		return CommandLineArguments{Kind: KindVersion}, nil
	}

	result := CommandLineArguments{}
	error := createRootCommand(&result).RunArgsE(rawArguments)
	if error != nil {
		return CommandLineArguments{}, normalizeParseError(error)
	}

	return result, nil
}

type manifestOptions struct {
	ManifestPath *string `descr:"Explicit path to devhost.toml." env:"DEVHOST_MANIFEST" name:"manifest"`
}

type trustRemoteOptions struct {
	SSHTarget string `descr:"SSH target used to fetch the remote managed Caddy root certificate." positional:"true" optional:"true"`
}

func createRootCommand(result *CommandLineArguments) boa.CmdT[manifestOptions] {
	return boa.CmdT[manifestOptions]{
		Use:   "devhost",
		Short: "Start a devhost stack or manage shared Caddy.",
		Args:  cobra.NoArgs,
		RunFuncE: func(options *manifestOptions, _ *cobra.Command, _ []string) error {
			if error := validateManifestPath(options.ManifestPath); error != nil {
				return error
			}

			*result = CommandLineArguments{Kind: KindManifest, ManifestPath: options.ManifestPath}
			return nil
		},
		SubCmds: boa.SubCmds(
			createCaddyCommand(result),
		),
	}
}

func createCaddyCommand(result *CommandLineArguments) boa.CmdT[boa.NoParams] {
	return boa.CmdT[boa.NoParams]{
		Use:   "caddy",
		Short: "Manage the shared devhost Caddy instance.",
		Args:  cobra.NoArgs,
		RunFuncE: func(_ *boa.NoParams, _ *cobra.Command, _ []string) error {
			return fmt.Errorf("Expected a caddy action: %s.", caddyActionListText)
		},
		SubCmds: boa.SubCmds(
			createCaddyLifecycleCommand(result, CaddyStart),
			createCaddyLifecycleCommand(result, CaddyStop),
			createCaddyLifecycleCommand(result, CaddyTrust),
			createCaddyNoArgsCommand(result, string(CaddyDownload), KindCaddyLifecycle, CaddyDownload),
			createCaddyNoArgsCommand(result, string(CaddyPrivilegedPorts), KindCaddyLifecycle, CaddyPrivilegedPorts),
			createCaddyNoArgsCommand(result, "print-root-cert", KindCaddyPrintRootCert, ""),
			createTrustRemoteCommand(result),
		),
	}
}

func createCaddyLifecycleCommand(result *CommandLineArguments, action CaddyLifecycleAction) boa.CmdT[manifestOptions] {
	return boa.CmdT[manifestOptions]{
		Use:   string(action),
		Short: fmt.Sprintf("Run `devhost caddy %s`.", action),
		Args:  cobra.NoArgs,
		RunFuncE: func(options *manifestOptions, _ *cobra.Command, _ []string) error {
			if error := validateManifestPath(options.ManifestPath); error != nil {
				return error
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

func createCaddyNoArgsCommand(
	result *CommandLineArguments,
	use string,
	kind Kind,
	action CaddyLifecycleAction,
) boa.CmdT[boa.NoParams] {
	return boa.CmdT[boa.NoParams]{
		Use:   use,
		Short: fmt.Sprintf("Run `devhost caddy %s`.", use),
		Args:  cobra.NoArgs,
		RunFunc: func(_ *boa.NoParams, _ *cobra.Command, _ []string) {
			*result = CommandLineArguments{Kind: kind, Action: action}
		},
	}
}

func createTrustRemoteCommand(result *CommandLineArguments) boa.CmdT[trustRemoteOptions] {
	return boa.CmdT[trustRemoteOptions]{
		Use:   "trust-remote <ssh-target>",
		Short: "Trust the managed Caddy root certificate from a remote machine.",
		RunFuncE: func(options *trustRemoteOptions, _ *cobra.Command, _ []string) error {
			if options.SSHTarget == "" {
				return fmt.Errorf("Expected an SSH target. Example: devhost caddy trust-remote devbox")
			}

			*result = CommandLineArguments{Kind: KindCaddyTrustRemote, SSHTarget: options.SSHTarget}
			return nil
		},
	}
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

func normalizeParseError(error error) error {
	message := error.Error()
	if strings.HasPrefix(message, "unknown flag: ") {
		return fmt.Errorf("unknown option: %s", strings.TrimPrefix(message, "unknown flag: "))
	}

	if strings.HasPrefix(message, "flag needs an argument: ") {
		return fmt.Errorf("option requires argument: %s", strings.TrimPrefix(message, "flag needs an argument: "))
	}

	return error
}
