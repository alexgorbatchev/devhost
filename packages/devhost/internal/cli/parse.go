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
	manifestPath, positionals, error := parseArguments(rawArguments)
	if error != nil {
		return CommandLineArguments{}, error
	}

	isCaddyCommand := len(positionals) > 0 && positionals[0] == "caddy"
	if isCaddyCommand {
		if manifestPath != nil && !strings.HasSuffix(*manifestPath, "devhost.toml") {
			return CommandLineArguments{}, fmt.Errorf("--manifest must point to a file named devhost.toml, received: %s", *manifestPath)
		}

		if len(positionals) == 1 {
			return CommandLineArguments{}, fmt.Errorf("Expected a caddy action: %s.", caddyActionListText)
		}

		action := positionals[1]
		if action == "print-root-cert" {
			if manifestPath != nil {
				return CommandLineArguments{}, fmt.Errorf("The caddy print-root-cert command does not accept --manifest.")
			}

			if len(positionals) > 2 {
				return CommandLineArguments{}, fmt.Errorf("The caddy print-root-cert command does not accept additional arguments.")
			}

			return CommandLineArguments{Kind: KindCaddyPrintRootCert}, nil
		}

		if action == "trust-remote" {
			if manifestPath != nil {
				return CommandLineArguments{}, fmt.Errorf("The caddy trust-remote command does not accept --manifest.")
			}

			if len(positionals) == 2 {
				return CommandLineArguments{}, fmt.Errorf("Expected an SSH target. Example: devhost caddy trust-remote devbox")
			}

			if len(positionals) > 3 {
				return CommandLineArguments{}, fmt.Errorf("The caddy trust-remote command accepts exactly one SSH target.")
			}

			return CommandLineArguments{Kind: KindCaddyTrustRemote, SSHTarget: positionals[2]}, nil
		}

		parsedAction, ok := parseLifecycleAction(action)
		if !ok {
			return CommandLineArguments{}, fmt.Errorf("Unsupported caddy action: %s", action)
		}

		if len(positionals) > 2 {
			return CommandLineArguments{}, fmt.Errorf("Caddy lifecycle commands do not accept additional arguments.")
		}

		return CommandLineArguments{Action: parsedAction, Kind: KindCaddyLifecycle, ManifestPath: manifestPath}, nil
	}

	if manifestPath != nil {
		if !strings.HasSuffix(*manifestPath, "devhost.toml") {
			return CommandLineArguments{}, fmt.Errorf("--manifest must point to a file named devhost.toml, received: %s", *manifestPath)
		}

		if len(positionals) > 0 {
			return CommandLineArguments{}, fmt.Errorf("Manifest mode does not accept a child command.")
		}

		return CommandLineArguments{Kind: KindManifest, ManifestPath: manifestPath}, nil
	}

	return CommandLineArguments{Kind: KindManifest}, nil
}

type parseArgumentsOptions struct {
	ManifestPath *string `descr:"Explicit path to devhost.toml." env:"DEVHOST_MANIFEST" name:"manifest"`
}

func parseArguments(rawArguments []string) (*string, []string, error) {
	type parseArgumentsResult struct {
		manifestPath *string
		positionals  []string
	}

	result := parseArgumentsResult{}
	error := boa.CmdT[parseArgumentsOptions]{
		Use:  "devhost",
		Args: cobra.ArbitraryArgs,
		RunFuncE: func(options *parseArgumentsOptions, _ *cobra.Command, args []string) error {
			result.manifestPath = options.ManifestPath
			result.positionals = append([]string{}, args...)
			return nil
		},
	}.RunArgsE(rawArguments)
	if error != nil {
		return nil, nil, normalizeParseError(error)
	}

	return result.manifestPath, result.positionals, nil
}

func parseLifecycleAction(rawAction string) (CaddyLifecycleAction, bool) {
	switch rawAction {
	case string(CaddyStart):
		return CaddyStart, true
	case string(CaddyStop):
		return CaddyStop, true
	case string(CaddyTrust):
		return CaddyTrust, true
	case string(CaddyDownload):
		return CaddyDownload, true
	case string(CaddyPrivilegedPorts):
		return CaddyPrivilegedPorts, true
	default:
		return "", false
	}
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
