package caddy

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

const defaultMacOSSystemKeychainPath = "/Library/Keychains/System.keychain"

type TrustRemoteDependencies struct {
	CreateTemporaryCertificateFile func([]byte) (string, error)
	InstallTrustedCertificate      func(string) error
	IsRootUser                     func() bool
	RemoveTemporaryCertificateFile func(string) error
	RunCommand                     func([]string, RunCommandOptions) CommandResult
	SystemKeychainPath             string
}

func TrustManagedCaddyRemoteCertificate(
	sshTarget string,
	logWriter io.Writer,
	runtimeOS string,
	dependencies TrustRemoteDependencies,
) (int, error) {
	if runtimeOS != "darwin" {
		return 0, fmt.Errorf("Managed Caddy remote trust is currently supported on macOS only.")
	}

	if error := logInfo(logWriter, "managed caddy remote trust may prompt for your password because installing a root CA into the system trust store is privileged."); error != nil {
		return 0, fmt.Errorf("log remote trust warning: %w", error)
	}

	certificate, readError := ReadRemoteManagedCaddyRootCertificate(sshTarget, dependencies)
	if readError != nil {
		return 0, readError
	}

	createTemporaryCertificateFile := dependencies.CreateTemporaryCertificateFile
	if createTemporaryCertificateFile == nil {
		createTemporaryCertificateFile = defaultCreateTemporaryCertificateFile
	}

	removeTemporaryCertificateFile := dependencies.RemoveTemporaryCertificateFile
	if removeTemporaryCertificateFile == nil {
		removeTemporaryCertificateFile = defaultRemoveTemporaryCertificateFile
	}

	installTrustedCertificate := dependencies.InstallTrustedCertificate
	if installTrustedCertificate == nil {
		installTrustedCertificate = func(certificatePath string) error {
			return installTrustedMacOSCertificate(certificatePath, dependencies)
		}
	}

	certificateFingerprint := sha256.Sum256(certificate)
	temporaryCertificatePath, createError := createTemporaryCertificateFile(certificate)
	if createError != nil {
		return 0, fmt.Errorf("create temporary remote certificate file: %w", createError)
	}

	defer func() {
		_ = removeTemporaryCertificateFile(temporaryCertificatePath)
	}()

	message := fmt.Sprintf("managed caddy remote root sha256 from %s: %s", sshTarget, hex.EncodeToString(certificateFingerprint[:]))
	if error := logInfo(logWriter, message); error != nil {
		return 0, fmt.Errorf("log remote certificate fingerprint: %w", error)
	}

	if error := installTrustedCertificate(temporaryCertificatePath); error != nil {
		return 0, error
	}

	message = fmt.Sprintf("managed caddy local CA from %s trusted.", sshTarget)
	if error := logInfo(logWriter, message); error != nil {
		return 0, fmt.Errorf("log remote trust success: %w", error)
	}

	return 0, nil
}

func ReadRemoteManagedCaddyRootCertificate(sshTarget string, dependencies TrustRemoteDependencies) ([]byte, error) {
	runCommand := dependencies.RunCommand
	if runCommand == nil {
		runCommand = RunCommand
	}

	result := runCommand([]string{"ssh", sshTarget, "devhost", "caddy", "print-root-cert"}, RunCommandOptions{})
	if !result.Success {
		baseMessage := fmt.Sprintf("Failed to fetch the managed Caddy root certificate from %s. Check SSH access and confirm 'devhost' is installed on the remote host.", sshTarget)
		return nil, errors.New(createExternalCommandErrorMessage(baseMessage, result))
	}

	return result.Stdout, nil
}

func installTrustedMacOSCertificate(certificatePath string, dependencies TrustRemoteDependencies) error {
	isRootUser := dependencies.IsRootUser
	if isRootUser == nil {
		isRootUser = defaultIsRootUser
	}

	keychainPath := dependencies.SystemKeychainPath
	if keychainPath == "" {
		keychainPath = defaultMacOSSystemKeychainPath
	}

	runCommand := dependencies.RunCommand
	if runCommand == nil {
		runCommand = RunCommand
	}

	commandArguments := []string{"sudo", "security", "add-trusted-cert", "-d", "-r", "trustRoot", "-k", keychainPath, certificatePath}
	if isRootUser() {
		commandArguments = []string{"security", "add-trusted-cert", "-d", "-r", "trustRoot", "-k", keychainPath, certificatePath}
	}

	result := runCommand(commandArguments, RunCommandOptions{InheritStdio: true})
	if !result.Success {
		return fmt.Errorf("Failed to install the fetched managed Caddy root certificate into the macOS system keychain.")
	}

	return nil
}

func defaultCreateTemporaryCertificateFile(certificate []byte) (string, error) {
	temporaryDirectoryPath, error := os.MkdirTemp("", "devhost-caddy-remote-trust-")
	if error != nil {
		return "", error
	}

	certificatePath := filepath.Join(temporaryDirectoryPath, "root.crt")
	if error := os.WriteFile(certificatePath, certificate, 0o644); error != nil {
		return "", error
	}

	return certificatePath, nil
}

func defaultRemoveTemporaryCertificateFile(certificatePath string) error {
	return os.RemoveAll(filepath.Dir(certificatePath))
}

func createExternalCommandErrorMessage(baseMessage string, result CommandResult) string {
	combinedOutput := []string{}
	stderr := strings.TrimSpace(string(result.Stderr))
	if stderr != "" {
		combinedOutput = append(combinedOutput, stderr)
	}
	stdout := strings.TrimSpace(string(result.Stdout))
	if stdout != "" {
		combinedOutput = append(combinedOutput, stdout)
	}

	if len(combinedOutput) == 0 {
		return baseMessage
	}

	return fmt.Sprintf("%s\n%s", baseMessage, strings.Join(combinedOutput, "\n"))
}
