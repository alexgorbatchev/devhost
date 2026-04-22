package cli

const HelpText = `Usage:
  devhost
  devhost --manifest ./devhost.toml
  devhost caddy start|stop|trust|download|privileged-ports|print-root-cert
  devhost caddy trust-remote <ssh-target>

Options:
  --manifest  Explicit path to devhost.toml. Can also be set with DEVHOST_MANIFEST.

Environment:
  DEVHOST_MANIFEST  Behaves like --manifest.

Behavior:
  - If --manifest is omitted, devhost searches for devhost.toml from the current directory upward.
  - Routed HTML document navigations may receive an injected devtools overlay.
  - Managed Caddy state lives under the devhost state directory and is shared across stacks.
  - Managed Caddy trust and privileged-port setup are separate explicit commands.
  - Configure your wildcard/local DNS so routed hostnames resolve to this machine.
  - The managed Caddy admin API defaults to 127.0.0.1:20197.
  - Route registrations are removed automatically when a stack exits.
`

func HasHelpFlag(rawArguments []string) bool {
	for _, rawArgument := range rawArguments {
		if rawArgument == "--help" || rawArgument == "-h" {
			return true
		}
	}

	return false
}
