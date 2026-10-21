package caddy

import (
	"crypto/x509"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/cliout"
	"golang.org/x/term"
)

// UntrustedRootCertificateWarning says what an untrusted managed local CA means
// and how to trust it.
const UntrustedRootCertificateWarning = "managed caddy local CA is not trusted, so browsers will reject devhost HTTPS certificates. Run 'devhost caddy trust' to trust it."

// RootCertificateTrust is whether the system trusts the managed local CA.
type RootCertificateTrust int

const (
	// RootCertificateMissing means Caddy has not created its local CA yet.
	RootCertificateMissing RootCertificateTrust = iota
	RootCertificateUntrusted
	RootCertificateTrusted
)

// ReadRootCertificateTrust verifies the managed root certificate at path against
// the system roots, as Caddy does before it installs the certificate.
func ReadRootCertificateTrust(path string) (RootCertificateTrust, error) {
	contents, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return RootCertificateMissing, nil
	}
	if err != nil {
		return RootCertificateMissing, fmt.Errorf("read managed caddy root certificate: %w", err)
	}
	block, _ := pem.Decode(contents)
	if block == nil {
		return RootCertificateMissing, fmt.Errorf("read managed caddy root certificate %s: no PEM certificate", path)
	}
	certificate, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		return RootCertificateMissing, fmt.Errorf("parse managed caddy root certificate %s: %w", path, err)
	}
	if chains, err := certificate.Verify(x509.VerifyOptions{}); err != nil || len(chains) == 0 {
		return RootCertificateUntrusted, nil
	}
	return RootCertificateTrusted, nil
}

// RootCertificateTrustWarning returns what a stack that joins a running Caddy
// says about the managed local CA at path, or "" when the system trusts it or
// Caddy has not created it. Caddy does not install the CA when it loads a
// configuration (skip_install_trust), so nothing else would say so.
func RootCertificateTrustWarning(path string) string {
	trust, err := ReadRootCertificateTrust(path)
	if err != nil {
		return rootCertificateTrustCheckWarning(err)
	}
	if trust == RootCertificateUntrusted {
		return UntrustedRootCertificateWarning
	}
	return ""
}

func rootCertificateTrustCheckWarning(err error) string {
	return fmt.Sprintf("managed caddy could not check whether its local CA is trusted: %v", err)
}

// canPromptForPassword reports whether a person can answer sudo's password
// prompt: an agent cannot, and nobody can without a terminal.
func canPromptForPassword() bool {
	return !cliout.IsAgentMode() && term.IsTerminal(int(os.Stdin.Fd()))
}

// installManagedCaddyTrust runs caddy trust in the foreground. sudo writes its
// password prompt to the terminal itself, so the prompt carries the caddy log
// prefix through SUDO_PROMPT, where % starts an escape.
func installManagedCaddyTrust(
	logWriter io.Writer,
	adminAddress string,
	runManagedCaddyCommand func([]string, ManagedCaddyCommandOptions) CommandResult,
) (CommandResult, error) {
	if err := cliout.WriteLog(logWriter, "devhost", "managed caddy is installing its local CA into the system trust store so browsers accept devhost HTTPS certificates. This may ask for your password."); err != nil {
		return CommandResult{}, fmt.Errorf("log managed caddy trust installation: %w", err)
	}
	prompt := strings.ReplaceAll(cliout.Prefix(logWriter, caddyOutputLabel), "%", "%%") + "Password: "
	return runManagedCaddyCommand([]string{"trust"}, ManagedCaddyCommandOptions{AdminAddress: adminAddress, Environment: []string{"SUDO_PROMPT=" + prompt}}), nil
}
