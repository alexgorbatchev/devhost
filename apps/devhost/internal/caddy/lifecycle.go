package caddy

import (
	"errors"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/cliout"
)

type LifecycleAction string

const (
	LifecycleStart LifecycleAction = "start"
	LifecycleStop  LifecycleAction = "stop"
	LifecycleTrust LifecycleAction = "trust"
)

const foreignManagedCaddyError = "A Caddy admin API is already listening on the devhost-managed address, but it was not started by devhost."

type ManagedCaddyLifecycleDependencies struct {
	EnsureManagedCaddyConfig func() error
	HasManagedPidFile        func() bool
	HasManagedRootCert       func() bool
	IsManagedCaddyAvailable  func() bool
	RemoveManagedPidFile     func() error
	RunManagedCaddyCommand   func([]string, ManagedCaddyCommandOptions) CommandResult
	RuntimeOS                string
}

func RunManagedCaddyLifecycleCommand(
	action LifecycleAction,
	logWriter io.Writer,
	paths Paths,
	fallback ManagedCaddyConfigFallback,
	dependencies ManagedCaddyLifecycleDependencies,
) (int, error) {
	managedCaddyAdminAddress := ResolveManagedCaddyAdminAddress(fallback.AdminAddress)
	runtimeOS := dependencies.RuntimeOS

	ensureConfig := dependencies.EnsureManagedCaddyConfig
	if ensureConfig == nil {
		ensureConfig = func() error {
			fallback.RuntimeOS = runtimeOS
			fallback.AdminAddress = managedCaddyAdminAddress
			return ensureManagedCaddyConfig(paths, fallback)
		}
	}
	hasManagedPidFile := dependencies.HasManagedPidFile
	if hasManagedPidFile == nil {
		hasManagedPidFile = func() bool {
			return pathExists(paths.PidFilePath)
		}
	}
	hasManagedRootCert := dependencies.HasManagedRootCert
	if hasManagedRootCert == nil {
		hasManagedRootCert = func() bool {
			return pathExists(paths.RootCertificatePath)
		}
	}
	isManagedCaddyAvailable := dependencies.IsManagedCaddyAvailable
	if isManagedCaddyAvailable == nil {
		isManagedCaddyAvailable = func() bool {
			return EnsureManagedCaddyAdminAvailable(CreateCaddyAdminAPIURL(managedCaddyAdminAddress), AdminAvailabilityDependencies{}) == nil
		}
	}
	removeManagedPidFile := dependencies.RemoveManagedPidFile
	if removeManagedPidFile == nil {
		removeManagedPidFile = func() error {
			err := os.Remove(paths.PidFilePath)
			if err != nil && !os.IsNotExist(err) {
				return err
			}
			return nil
		}
	}
	runManagedCaddyCommand := dependencies.RunManagedCaddyCommand
	if runManagedCaddyCommand == nil {
		runManagedCaddyCommand = func(arguments []string, options ManagedCaddyCommandOptions) CommandResult {
			options.RuntimeOS = runtimeOS
			result := RunManagedCaddyCommand(paths, arguments, options, ManagedCaddyCommandDependencies{})
			if result.Success {
				if err := writeManagedCaddyCommandOutput(logWriter, result); err != nil {
					return commandFailure(err)
				}
			}
			return result
		}
	}

	if err := ensureConfig(); err != nil {
		return 0, err
	}

	switch action {
	case LifecycleStart:
		return startManagedCaddy(logWriter, paths, runtimeOS, managedCaddyAdminAddress, hasManagedPidFile, hasManagedRootCert, isManagedCaddyAvailable, runManagedCaddyCommand)
	case LifecycleStop:
		return stopManagedCaddy(logWriter, managedCaddyAdminAddress, hasManagedPidFile, isManagedCaddyAvailable, removeManagedPidFile, runManagedCaddyCommand)
	case LifecycleTrust:
		return trustManagedCaddy(logWriter, managedCaddyAdminAddress, hasManagedPidFile, isManagedCaddyAvailable, runManagedCaddyCommand)
	default:
		return 0, fmt.Errorf("unsupported managed caddy lifecycle action: %s", action)
	}
}

func startManagedCaddy(
	logWriter io.Writer,
	paths Paths,
	runtimeOS string,
	adminAddress string,
	hasManagedPidFile func() bool,
	hasManagedRootCert func() bool,
	isManagedCaddyAvailable func() bool,
	runManagedCaddyCommand func([]string, ManagedCaddyCommandOptions) CommandResult,
) (int, error) {
	if !hasManagedRootCert() {
		if err := logInfo(logWriter, "managed caddy may prompt for your password on first start so it can install its local CA into the system trust store."); err != nil {
			return 0, fmt.Errorf("log managed caddy first-start trust warning: %w", err)
		}
	}

	if isManagedCaddyAvailable() {
		if hasManagedPidFile() {
			if err := logInfo(logWriter, fmt.Sprintf("managed caddy is already running with %s", paths.CaddyfilePath)); err != nil {
				return 0, fmt.Errorf("log managed caddy already running: %w", err)
			}
			return 0, nil
		}

		return 0, errors.New(foreignManagedCaddyError)
	}

	result := runManagedCaddyCommand([]string{"start", "--pidfile", paths.PidFilePath}, ManagedCaddyCommandOptions{})
	if !result.Success {
		failure, handled := managedCaddyStartFailure(result, runtimeOS, paths.CaddyDirectoryPath)
		if !handled || cliout.IsAgentMode() {
			if err := writeManagedCaddyCommandOutput(logWriter, result); err != nil {
				return 0, err
			}
		}
		return 0, failure
	}

	if err := logInfo(logWriter, fmt.Sprintf("managed caddy started with %s", paths.CaddyfilePath)); err != nil {
		return 0, fmt.Errorf("log managed caddy start success: %w", err)
	}

	_ = adminAddress
	return 0, nil
}

func stopManagedCaddy(
	logWriter io.Writer,
	adminAddress string,
	hasManagedPidFile func() bool,
	isManagedCaddyAvailable func() bool,
	removeManagedPidFile func() error,
	runManagedCaddyCommand func([]string, ManagedCaddyCommandOptions) CommandResult,
) (int, error) {
	isManagedProcessKnown := hasManagedPidFile()
	isManagedProcessAvailable := isManagedCaddyAvailable()
	if !isManagedProcessAvailable {
		if isManagedProcessKnown {
			if err := removeManagedPidFile(); err != nil {
				return 0, fmt.Errorf("remove stale managed caddy pid file: %w", err)
			}
			if err := logInfo(logWriter, "managed caddy is not running. Removed the stale pid file."); err != nil {
				return 0, fmt.Errorf("log managed caddy stale pidfile cleanup: %w", err)
			}
			return 0, nil
		}

		if err := logInfo(logWriter, "managed caddy is not running."); err != nil {
			return 0, fmt.Errorf("log managed caddy not running: %w", err)
		}
		return 0, nil
	}

	if !isManagedProcessKnown {
		return 0, errors.New(foreignManagedCaddyError)
	}

	result := runManagedCaddyCommand([]string{"stop"}, ManagedCaddyCommandOptions{AdminAddress: adminAddress})
	if !result.Success {
		return 0, logManagedCaddyFailure(logWriter, "stop", result)
	}

	if err := removeManagedPidFile(); err != nil {
		return 0, fmt.Errorf("remove managed caddy pid file after stop: %w", err)
	}
	if err := logInfo(logWriter, "managed caddy stopped."); err != nil {
		return 0, fmt.Errorf("log managed caddy stop success: %w", err)
	}

	return 0, nil
}

func trustManagedCaddy(
	logWriter io.Writer,
	adminAddress string,
	hasManagedPidFile func() bool,
	isManagedCaddyAvailable func() bool,
	runManagedCaddyCommand func([]string, ManagedCaddyCommandOptions) CommandResult,
) (int, error) {
	if err := logInfo(logWriter, "managed caddy trust may prompt for your password because installing a root CA into the system trust store is privileged."); err != nil {
		return 0, fmt.Errorf("log managed caddy trust warning: %w", err)
	}

	if !isManagedCaddyAvailable() {
		return 0, errors.New("Managed Caddy is not running. Run 'devhost caddy start' first.")
	}
	if !hasManagedPidFile() {
		return 0, errors.New(foreignManagedCaddyError)
	}

	result := runManagedCaddyCommand([]string{"trust"}, ManagedCaddyCommandOptions{AdminAddress: adminAddress})
	if !result.Success {
		return 0, logManagedCaddyFailure(logWriter, "trust", result)
	}

	if err := logInfo(logWriter, "managed caddy local CA trusted."); err != nil {
		return 0, fmt.Errorf("log managed caddy trust success: %w", err)
	}

	return 0, nil
}

func logManagedCaddyFailure(writer io.Writer, action string, result CommandResult) error {
	if err := writeManagedCaddyCommandOutput(writer, result); err != nil {
		return err
	}
	return fmt.Errorf("Caddy %s failed. Check the Caddy diagnostics above.", action)
}

func writeManagedCaddyCommandOutput(writer io.Writer, result CommandResult) error {
	if err := writeCommandOutput(writer, result.Stderr); err != nil {
		return err
	}
	return writeCommandOutput(writer, result.Stdout)
}

func managedCaddyStartFailure(result CommandResult, runtimeOS, directory string) (*cliout.Failure, bool) {
	output := string(result.Stderr) + "\n" + string(result.Stdout)
	handled := strings.Contains(output, ":443: bind: permission denied")
	failure := &cliout.Failure{Summary: "Caddy start failed.", Hint: "Check the Caddy logs in " + directory + "."}
	if handled {
		if runtimeOS == "darwin" {
			failure.Summary = "Caddy cannot bind HTTPS port 443 to loopback without privileges on macOS."
			failure.Hint = "Use wildcard listeners by omitting caddy.global.bindHost, or use a privileged launcher for loopback-only HTTPS."
		} else {
			failure.Summary = "Caddy cannot listen on HTTPS port 443 without privileged-port setup."
			failure.Hint = "Run 'devhost caddy privileged-ports', then 'devhost caddy start'."
		}
	}
	failure.Err = errors.New(failure.Summary + " " + failure.Hint)
	return failure, handled
}
