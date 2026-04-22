package caddy

import (
	"fmt"
	"io"
	"os"
)

type PrivilegedPortsDependencies struct {
	DownloadCaddy         func(io.Writer, string, string, Paths, DownloadDependencies) error
	DownloadDependencies  DownloadDependencies
	HasManagedCaddyBinary func(string) bool
	IsRootUser            func() bool
	RunCommand            func([]string, RunCommandOptions) CommandResult
}

func ConfigureManagedCaddyPrivilegedPorts(
	logWriter io.Writer,
	runtimeOS string,
	runtimeArch string,
	paths Paths,
	dependencies PrivilegedPortsDependencies,
) (int, error) {
	if runtimeOS == "darwin" {
		if error := logInfo(logWriter, "managed caddy does not need privileged-port setup on macOS."); error != nil {
			return 0, fmt.Errorf("log macOS privileged-port skip: %w", error)
		}
		return 0, nil
	}

	if runtimeOS != "linux" {
		return 0, fmt.Errorf("Managed Caddy privileged-port setup is currently supported on Linux only.")
	}

	hasManagedCaddyBinary := dependencies.HasManagedCaddyBinary
	if hasManagedCaddyBinary == nil {
		hasManagedCaddyBinary = defaultHasManagedCaddyBinary
	}

	downloadCaddy := dependencies.DownloadCaddy
	if downloadCaddy == nil {
		downloadCaddy = DownloadCaddy
	}

	isRootUser := dependencies.IsRootUser
	if isRootUser == nil {
		isRootUser = defaultIsRootUser
	}

	runCommand := dependencies.RunCommand
	if runCommand == nil {
		runCommand = RunCommand
	}

	if !hasManagedCaddyBinary(paths.ExecutablePath) {
		message := fmt.Sprintf("managed caddy binary not found at %s. Downloading it first.", paths.ExecutablePath)
		if error := logInfo(logWriter, message); error != nil {
			return 0, fmt.Errorf("log missing managed caddy binary: %w", error)
		}

		if error := downloadCaddy(logWriter, runtimeOS, runtimeArch, paths, dependencies.DownloadDependencies); error != nil {
			return 0, error
		}
	}

	message := "managed caddy privileged-port setup may prompt for your password because granting low-port bind capability is privileged."
	if error := logInfo(logWriter, message); error != nil {
		return 0, fmt.Errorf("log privileged-port warning: %w", error)
	}

	commandArguments := []string{"sudo", "setcap", "cap_net_bind_service=+ep", paths.ExecutablePath}
	if isRootUser() {
		commandArguments = []string{"setcap", "cap_net_bind_service=+ep", paths.ExecutablePath}
	}

	result := runCommand(commandArguments, RunCommandOptions{InheritStdio: true})
	if !result.Success {
		return 0, fmt.Errorf("Managed Caddy privileged-port setup failed. Check that `sudo` and `setcap` are available, then try again.")
	}

	message = fmt.Sprintf("managed caddy low-port binding enabled for %s", paths.ExecutablePath)
	if error := logInfo(logWriter, message); error != nil {
		return 0, fmt.Errorf("log privileged-port success: %w", error)
	}

	return 0, nil
}

func defaultHasManagedCaddyBinary(executablePath string) bool {
	_, error := os.Stat(executablePath)
	return error == nil
}

func defaultIsRootUser() bool {
	return os.Geteuid() == 0
}
