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
	CanPromptForPassword     func() bool
	EnsureManagedCaddyConfig func() error
	HasManagedPidFile        func() bool
	IsManagedCaddyAvailable  func() bool
	// Quiet leaves out the output of Caddy commands that succeed, for a stack
	// that starts the shared Caddy as part of its own startup.
	Quiet                    bool
	ReadRootCertificateTrust func() (RootCertificateTrust, error)
	RemoveManagedPidFile     func() error
	RunManagedCaddyCommand   func([]string, ManagedCaddyCommandOptions) CommandResult
	RuntimeOS                string
}

type managedCaddyLifecycle struct {
	adminAddress             string
	canPromptForPassword     func() bool
	hasManagedPidFile        func() bool
	isManagedCaddyAvailable  func() bool
	logWriter                io.Writer
	paths                    Paths
	quiet                    bool
	readRootCertificateTrust func() (RootCertificateTrust, error)
	removeManagedPidFile     func() error
	runManagedCaddyCommand   func([]string, ManagedCaddyCommandOptions) CommandResult
	runtimeOS                string
	// settings are what a new Caddy starts with.
	settings ManagedCaddyGlobalSettings
}

// RunManagedCaddyLifecycleCommand starts, stops, or trusts the managed Caddy.
// A running Caddy is reached through the admin address recorded as applied;
// settings, from the devhost config file, are what a new Caddy starts with.
func RunManagedCaddyLifecycleCommand(
	action LifecycleAction,
	logWriter io.Writer,
	paths Paths,
	settings ManagedCaddyGlobalSettings,
	dependencies ManagedCaddyLifecycleDependencies,
) (int, error) {
	running, err := readRunningSettings(paths, settings)
	if err != nil {
		return 0, err
	}
	l := managedCaddyLifecycle{
		adminAddress:             ResolveManagedCaddyAdminAddress(running.AdminAddress),
		canPromptForPassword:     dependencies.CanPromptForPassword,
		hasManagedPidFile:        dependencies.HasManagedPidFile,
		isManagedCaddyAvailable:  dependencies.IsManagedCaddyAvailable,
		logWriter:                logWriter,
		paths:                    paths,
		quiet:                    dependencies.Quiet,
		readRootCertificateTrust: dependencies.ReadRootCertificateTrust,
		removeManagedPidFile:     dependencies.RemoveManagedPidFile,
		runManagedCaddyCommand:   dependencies.RunManagedCaddyCommand,
		runtimeOS:                dependencies.RuntimeOS,
		settings:                 settings,
	}

	ensureConfig := dependencies.EnsureManagedCaddyConfig
	if ensureConfig == nil {
		ensureConfig = func() error {
			return EnsureManagedCaddyConfig(paths, settings, l.runtimeOS)
		}
	}
	if l.canPromptForPassword == nil {
		l.canPromptForPassword = canPromptForPassword
	}
	if l.hasManagedPidFile == nil {
		l.hasManagedPidFile = func() bool {
			return pathExists(paths.PidFilePath)
		}
	}
	if l.isManagedCaddyAvailable == nil {
		l.isManagedCaddyAvailable = func() bool {
			return EnsureManagedCaddyAdminAvailable(CreateCaddyAdminAPIURL(l.adminAddress), AdminAvailabilityDependencies{}) == nil
		}
	}
	if l.readRootCertificateTrust == nil {
		l.readRootCertificateTrust = func() (RootCertificateTrust, error) {
			return ReadRootCertificateTrust(paths.RootCertificatePath)
		}
	}
	if l.removeManagedPidFile == nil {
		l.removeManagedPidFile = func() error {
			err := os.Remove(paths.PidFilePath)
			if err != nil && !os.IsNotExist(err) {
				return err
			}
			return nil
		}
	}
	if l.runManagedCaddyCommand == nil {
		l.runManagedCaddyCommand = func(arguments []string, options ManagedCaddyCommandOptions) CommandResult {
			options.RuntimeOS = l.runtimeOS
			return RunManagedCaddyCommand(paths, arguments, options, ManagedCaddyCommandDependencies{})
		}
	}

	if err := ensureConfig(); err != nil {
		return 0, err
	}

	switch action {
	case LifecycleStart:
		return l.start()
	case LifecycleStop:
		return l.stop()
	case LifecycleTrust:
		return l.trust()
	default:
		return 0, fmt.Errorf("unsupported managed caddy lifecycle action: %s", action)
	}
}

func (l managedCaddyLifecycle) start() (int, error) {
	if l.isManagedCaddyAvailable() {
		if !l.hasManagedPidFile() {
			return 0, errors.New(foreignManagedCaddyError)
		}
		if err := cliout.WriteLog(l.logWriter, "devhost", fmt.Sprintf("managed caddy is already running with %s", l.paths.CaddyfilePath)); err != nil {
			return 0, fmt.Errorf("log managed caddy already running: %w", err)
		}
		return 0, l.trustAfterStart()
	}

	result := l.startProcess()
	if !result.Success {
		failure, handled := managedCaddyStartFailure(result, l.runtimeOS, l.paths.CaddyDirectoryPath)
		if !handled || cliout.IsAgentMode() {
			if err := writeManagedCaddyCommandOutput(l.logWriter, result); err != nil {
				return 0, err
			}
		}
		return 0, failure
	}
	if err := l.writeSuccessfulOutput(result); err != nil {
		return 0, err
	}

	if err := cliout.WriteLog(l.logWriter, "devhost", fmt.Sprintf("managed caddy started with %s", l.paths.CaddyfilePath)); err != nil {
		return 0, fmt.Errorf("log managed caddy start success: %w", err)
	}

	return 0, l.trustAfterStart()
}

// startProcess renders every route for the settings, starts Caddy with them,
// and records them as applied once Caddy runs. The route lock keeps another
// stack from rendering routes for other settings in between.
func (l managedCaddyLifecycle) startProcess() CommandResult {
	var result CommandResult
	err := withRouteMutationLock(l.paths, func() error {
		if err := renderManagedCaddySettings(l.paths, l.settings, l.runtimeOS); err != nil {
			return err
		}
		result = l.runManagedCaddyCommand([]string{"start", "--pidfile", l.paths.PidFilePath}, ManagedCaddyCommandOptions{})
		if !result.Success {
			return nil
		}
		return writeAppliedManagedCaddySettings(l.paths, l.settings)
	})
	if err != nil {
		return CommandResult{Stderr: []byte(err.Error())}
	}
	return result
}

// forget removes the pid file and the applied settings of a Caddy that no
// longer runs, so the next start uses the configured settings.
func (l managedCaddyLifecycle) forget() error {
	if err := l.removeManagedPidFile(); err != nil {
		return err
	}
	return removeAppliedManagedCaddySettings(l.paths)
}

// trustAfterStart installs the local CA once Caddy runs, which is when Caddy
// has created it. A start still succeeds without trust: HTTPS works, and a
// browser warns about the certificate until 'devhost caddy trust' succeeds.
func (l managedCaddyLifecycle) trustAfterStart() error {
	trust, err := l.readRootCertificateTrust()
	if err != nil {
		return l.warn(rootCertificateTrustCheckWarning(err))
	}
	if trust != RootCertificateUntrusted {
		return nil
	}
	if !l.canPromptForPassword() {
		return l.warn(UntrustedRootCertificateWarning)
	}

	result, err := installManagedCaddyTrust(l.logWriter, l.adminAddress, l.runManagedCaddyCommand)
	if err != nil {
		return err
	}
	if !result.Success {
		if err := writeManagedCaddyCommandOutput(l.logWriter, result); err != nil {
			return err
		}
		return l.warn(UntrustedRootCertificateWarning)
	}
	if err := l.writeSuccessfulOutput(result); err != nil {
		return err
	}
	if err := cliout.WriteLog(l.logWriter, "devhost", "managed caddy local CA trusted."); err != nil {
		return fmt.Errorf("log managed caddy trust success: %w", err)
	}
	return nil
}

func (l managedCaddyLifecycle) stop() (int, error) {
	isManagedProcessKnown := l.hasManagedPidFile()
	isManagedProcessAvailable := l.isManagedCaddyAvailable()
	if !isManagedProcessAvailable {
		if isManagedProcessKnown {
			if err := l.forget(); err != nil {
				return 0, fmt.Errorf("remove stale managed caddy pid file: %w", err)
			}
			if err := cliout.WriteLog(l.logWriter, "devhost", "managed caddy is not running. Removed the stale pid file."); err != nil {
				return 0, fmt.Errorf("log managed caddy stale pidfile cleanup: %w", err)
			}
			return 0, nil
		}

		if err := cliout.WriteLog(l.logWriter, "devhost", "managed caddy is not running."); err != nil {
			return 0, fmt.Errorf("log managed caddy not running: %w", err)
		}
		return 0, nil
	}

	if !isManagedProcessKnown {
		return 0, errors.New(foreignManagedCaddyError)
	}

	result := l.runManagedCaddyCommand([]string{"stop"}, ManagedCaddyCommandOptions{AdminAddress: l.adminAddress})
	if !result.Success {
		return 0, logManagedCaddyFailure(l.logWriter, "stop", result)
	}
	if err := l.writeSuccessfulOutput(result); err != nil {
		return 0, err
	}

	if err := l.forget(); err != nil {
		return 0, fmt.Errorf("remove managed caddy pid file after stop: %w", err)
	}
	if err := cliout.WriteLog(l.logWriter, "devhost", "managed caddy stopped."); err != nil {
		return 0, fmt.Errorf("log managed caddy stop success: %w", err)
	}

	return 0, nil
}

func (l managedCaddyLifecycle) trust() (int, error) {
	if !l.isManagedCaddyAvailable() {
		return 0, errors.New("Managed Caddy is not running. Run 'devhost caddy start' first.")
	}
	if !l.hasManagedPidFile() {
		return 0, errors.New(foreignManagedCaddyError)
	}

	trust, err := l.readRootCertificateTrust()
	if err != nil {
		return 0, err
	}
	if trust == RootCertificateTrusted {
		if err := cliout.WriteLog(l.logWriter, "devhost", "managed caddy local CA is already trusted."); err != nil {
			return 0, fmt.Errorf("log managed caddy trust state: %w", err)
		}
		return 0, nil
	}

	// A missing certificate is left to caddy trust, which reads the local CA
	// from the admin API rather than from storage.
	result, err := installManagedCaddyTrust(l.logWriter, l.adminAddress, l.runManagedCaddyCommand)
	if err != nil {
		return 0, err
	}
	if !result.Success {
		return 0, logManagedCaddyFailure(l.logWriter, "trust", result)
	}
	if err := l.writeSuccessfulOutput(result); err != nil {
		return 0, err
	}

	if err := cliout.WriteLog(l.logWriter, "devhost", "managed caddy local CA trusted."); err != nil {
		return 0, fmt.Errorf("log managed caddy trust success: %w", err)
	}

	return 0, nil
}

func (l managedCaddyLifecycle) writeSuccessfulOutput(result CommandResult) error {
	if l.quiet {
		return nil
	}
	return writeManagedCaddyCommandOutput(l.logWriter, result)
}

func (l managedCaddyLifecycle) warn(message string) error {
	if err := cliout.WriteLog(l.logWriter, "devhost", cliout.Warning(message)); err != nil {
		return fmt.Errorf("log managed caddy warning: %w", err)
	}
	return nil
}

func logManagedCaddyFailure(writer io.Writer, action string, result CommandResult) error {
	if err := writeManagedCaddyCommandOutput(writer, result); err != nil {
		return err
	}
	return fmt.Errorf("Caddy %s failed. Check the Caddy diagnostics above.", action)
}

func writeManagedCaddyCommandOutput(writer io.Writer, result CommandResult) error {
	if err := writeCaddyOutput(writer, result.Stderr, !result.Success); err != nil {
		return err
	}
	return writeCaddyOutput(writer, result.Stdout, !result.Success)
}

func managedCaddyStartFailure(result CommandResult, runtimeOS, directory string) (*cliout.Failure, bool) {
	output := string(result.Stderr) + "\n" + string(result.Stdout)
	handled := strings.Contains(output, ":443: bind: permission denied")
	failure := &cliout.Failure{Summary: "Caddy start failed.", Hint: "Check the Caddy logs in " + directory + "."}
	if handled {
		if runtimeOS == "darwin" {
			failure.Summary = "Caddy cannot bind HTTPS port 443 to loopback without privileges on macOS."
			failure.Hint = "Use wildcard listeners by leaving bindHost out of the [caddy] table of config.toml, or use a privileged launcher for loopback-only HTTPS."
		} else {
			failure.Summary = "Caddy cannot listen on HTTPS port 443 without privileged-port setup."
			failure.Hint = "Run 'devhost caddy privileged-ports', then 'devhost caddy start'."
		}
	}
	failure.Err = errors.New(failure.Summary + " " + failure.Hint)
	return failure, handled
}
