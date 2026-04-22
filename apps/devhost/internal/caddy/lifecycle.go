package caddy

import (
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
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
			error := os.Remove(paths.PidFilePath)
			if error != nil && !os.IsNotExist(error) {
				return error
			}
			return nil
		}
	}
	runManagedCaddyCommand := dependencies.RunManagedCaddyCommand
	if runManagedCaddyCommand == nil {
		runManagedCaddyCommand = func(arguments []string, options ManagedCaddyCommandOptions) CommandResult {
			options.RuntimeOS = runtimeOS
			return RunManagedCaddyCommand(paths, arguments, options, ManagedCaddyCommandDependencies{})
		}
	}

	if error := ensureConfig(); error != nil {
		return 0, error
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
		if error := logInfo(logWriter, "managed caddy may prompt for your password on first start so it can install its local CA into the system trust store."); error != nil {
			return 0, fmt.Errorf("log managed caddy first-start trust warning: %w", error)
		}
	}

	if isManagedCaddyAvailable() {
		if hasManagedPidFile() {
			if error := logInfo(logWriter, fmt.Sprintf("managed caddy is already running with %s", paths.CaddyfilePath)); error != nil {
				return 0, fmt.Errorf("log managed caddy already running: %w", error)
			}
			return 0, nil
		}

		return 0, errors.New(foreignManagedCaddyError)
	}

	result := runManagedCaddyCommand([]string{"start", "--pidfile", paths.PidFilePath}, ManagedCaddyCommandOptions{InheritStdio: true})
	if !result.Success {
		return 0, errors.New(CreateManagedCaddyStartErrorMessage(result, runtimeOS))
	}

	if error := logInfo(logWriter, fmt.Sprintf("managed caddy started with %s", paths.CaddyfilePath)); error != nil {
		return 0, fmt.Errorf("log managed caddy start success: %w", error)
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
			if error := removeManagedPidFile(); error != nil {
				return 0, fmt.Errorf("remove stale managed caddy pid file: %w", error)
			}
			if error := logInfo(logWriter, "managed caddy is not running. Removed the stale pid file."); error != nil {
				return 0, fmt.Errorf("log managed caddy stale pidfile cleanup: %w", error)
			}
			return 0, nil
		}

		if error := logInfo(logWriter, "managed caddy is not running."); error != nil {
			return 0, fmt.Errorf("log managed caddy not running: %w", error)
		}
		return 0, nil
	}

	if !isManagedProcessKnown {
		return 0, errors.New(foreignManagedCaddyError)
	}

	result := runManagedCaddyCommand([]string{"stop"}, ManagedCaddyCommandOptions{AdminAddress: adminAddress})
	if !result.Success {
		return 0, errors.New(CreateManagedCaddyCommandErrorMessage("stop", result))
	}

	if error := removeManagedPidFile(); error != nil {
		return 0, fmt.Errorf("remove managed caddy pid file after stop: %w", error)
	}
	if error := logInfo(logWriter, "managed caddy stopped."); error != nil {
		return 0, fmt.Errorf("log managed caddy stop success: %w", error)
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
	if error := logInfo(logWriter, "managed caddy trust may prompt for your password because installing a root CA into the system trust store is privileged."); error != nil {
		return 0, fmt.Errorf("log managed caddy trust warning: %w", error)
	}

	if !isManagedCaddyAvailable() {
		return 0, errors.New("Managed Caddy is not running. Run 'devhost caddy start' first.")
	}
	if !hasManagedPidFile() {
		return 0, errors.New(foreignManagedCaddyError)
	}

	result := runManagedCaddyCommand([]string{"trust"}, ManagedCaddyCommandOptions{AdminAddress: adminAddress, InheritStdio: true})
	if !result.Success {
		return 0, errors.New(CreateManagedCaddyCommandErrorMessage("trust", result))
	}

	if error := logInfo(logWriter, "managed caddy local CA trusted."); error != nil {
		return 0, fmt.Errorf("log managed caddy trust success: %w", error)
	}

	return 0, nil
}

func CreateManagedCaddyStartErrorMessage(result CommandResult, runtimeOS string) string {
	baseMessage := CreateManagedCaddyCommandErrorMessage("start", result)
	combinedOutput := strings.Join(filterEmptyStrings([]string{strings.TrimSpace(string(result.Stderr)), strings.TrimSpace(string(result.Stdout))}), "\n")
	if !strings.Contains(combinedOutput, "bind: permission denied") || !strings.Contains(combinedOutput, ":443") {
		return baseMessage
	}

	bindDirective, error := ResolveManagedCaddyBindDirective(runtimeOS, defaultManagedCaddyBindHost)
	if error == nil && bindDirective == "" {
		return baseMessage + "\nmacOS allows rootless binds on :443 only with wildcard listeners, not loopback-specific ones."
	}

	return baseMessage + "\nOpening HTTPS on :443 requires privileged-port setup on this platform. Run 'devhost caddy privileged-ports' to configure the managed Caddy binary."
}

func filterEmptyStrings(values []string) []string {
	filteredValues := make([]string, 0, len(values))
	for _, value := range values {
		if value != "" {
			filteredValues = append(filteredValues, value)
		}
	}

	return filteredValues
}
