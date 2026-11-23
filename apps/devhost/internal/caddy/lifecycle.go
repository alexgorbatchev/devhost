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
	ReadManagedCaddyProcess  func() (ManagedCaddyProcess, error)
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
	readManagedCaddyProcess  func() (ManagedCaddyProcess, error)
	removeManagedPidFile     func() error
	runManagedCaddyCommand   func([]string, ManagedCaddyCommandOptions) CommandResult
	runtimeOS                string
	// settings are what a new Caddy starts with.
	settings        ManagedCaddyGlobalSettings
	previousProcess ManagedCaddyProcess
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
		readManagedCaddyProcess:  dependencies.ReadManagedCaddyProcess,
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
	if l.readRootCertificateTrust == nil {
		l.readRootCertificateTrust = func() (RootCertificateTrust, error) {
			return ReadRootCertificateTrust(paths.RootCertificatePath)
		}
	}
	if l.readManagedCaddyProcess == nil {
		l.readManagedCaddyProcess = func() (ManagedCaddyProcess, error) {
			return readManagedCaddyProcess(paths)
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

	var exitCode int
	err = withRouteMutationLock(paths, func() error {
		// Another process may have started or moved Caddy while config was
		// prepared. Read the applied address again after taking the lock.
		running, err := readRunningSettings(paths, settings)
		if err != nil {
			return err
		}
		l.adminAddress = ResolveManagedCaddyAdminAddress(running.AdminAddress)
		switch action {
		case LifecycleStart:
			exitCode, err = l.start()
		case LifecycleStop:
			exitCode, err = l.stop()
		case LifecycleTrust:
			// Trust can prompt; leave it outside the shared route lock.
		default:
			err = fmt.Errorf("unsupported managed caddy lifecycle action: %s", action)
		}
		return err
	})
	if err == nil && action == LifecycleStart {
		err = l.trustAfterStart()
	}
	if err == nil && action == LifecycleTrust {
		return l.trust()
	}
	return exitCode, err
}

func (l managedCaddyLifecycle) isAvailable() bool {
	if l.isManagedCaddyAvailable != nil {
		return l.isManagedCaddyAvailable()
	}
	return EnsureManagedCaddyAdminAvailable(CreateCaddyAdminAPIURL(l.adminAddress), AdminAvailabilityDependencies{}) == nil
}

func (l *managedCaddyLifecycle) start() (int, error) {
	if l.isAvailable() {
		if !l.hasManagedPidFile() {
			return 0, errors.New(foreignManagedCaddyError)
		}
		restart, err := l.needsRestart()
		if err != nil {
			return 0, err
		}
		if !restart {
			if err := l.reloadSettings(); err != nil {
				return 0, err
			}
			if err := cliout.WriteLog(l.logWriter, "devhost", fmt.Sprintf("managed caddy is already running with %s", l.paths.CaddyfilePath)); err != nil {
				return 0, fmt.Errorf("log managed caddy already running: %w", err)
			}
			return 0, nil
		}
		if err := cliout.WriteLog(l.logWriter, "devhost", "Restarting shared Caddy for an updated runtime policy. Proxy connections briefly drop."); err != nil {
			return 0, err
		}
		l.previousProcess, err = l.readManagedCaddyProcess()
		if err != nil {
			return 0, err
		}
		if _, err := l.stop(); err != nil {
			return 0, err
		}
	}

	l.adminAddress = ResolveManagedCaddyAdminAddress(l.settings.AdminAddress)
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

	return 0, nil
}

func (l *managedCaddyLifecycle) reloadSettings() error {
	running, err := readRunningSettings(l.paths, l.settings)
	if err != nil {
		return err
	}
	if err := renderManagedCaddySettings(l.paths, l.settings, l.runtimeOS); err != nil {
		return errors.Join(err, renderManagedCaddySettings(l.paths, running, l.runtimeOS))
	}
	result := l.runManagedCaddyCommand([]string{"reload"}, ManagedCaddyCommandOptions{AdminAddress: l.adminAddress})
	if !result.Success {
		return errors.Join(logManagedCaddyFailure(l.logWriter, "reload", result), renderManagedCaddySettings(l.paths, running, l.runtimeOS))
	}
	l.adminAddress = ResolveManagedCaddyAdminAddress(l.settings.AdminAddress)
	if err := writeAppliedManagedCaddySettings(l.paths, l.settings); err != nil {
		return err
	}
	return l.writeSuccessfulOutput(result)
}

func (l managedCaddyLifecycle) needsRestart() (bool, error) {
	owner, err := l.readManagedCaddyProcess()
	if err != nil {
		return false, err
	}
	record, err := readManagedCaddyRuntime(l.paths)
	if err != nil {
		return false, err
	}
	if record.ManagedCaddyProcess == owner {
		return record.Generation < managedCaddyRestartGeneration, nil
	}
	if err := verifyLegacyManagedCaddyProcess(l.paths, owner); err != nil {
		return false, err
	}
	return true, nil
}

// The caller holds the route lock across stop, start, readiness and recording.
// Reloads never write this process generation; only a fresh start can apply it.
func (l managedCaddyLifecycle) startProcess() CommandResult {
	if err := renderManagedCaddySettings(l.paths, l.settings, l.runtimeOS); err != nil {
		return CommandResult{Stderr: []byte(err.Error())}
	}
	result := l.runManagedCaddyCommand([]string{"start", "--pidfile", l.paths.PidFilePath}, ManagedCaddyCommandOptions{})
	if !result.Success {
		return result
	}
	if !l.isAvailable() {
		return CommandResult{Stderr: []byte("managed Caddy did not become ready after start")}
	}
	owner, err := l.readManagedCaddyProcess()
	if err == nil && owner == l.previousProcess {
		err = errors.New("managed Caddy did not start a fresh process; runtime policy remains unapplied")
	}
	if err == nil {
		err = writeAppliedManagedCaddySettings(l.paths, l.settings)
	}
	if err == nil {
		err = writeManagedCaddyRuntime(l.paths, owner)
	}
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
	isManagedProcessAvailable := l.isAvailable()
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
	if !l.isAvailable() {
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
