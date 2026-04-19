package caddy

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const DefaultManagedCaddyAdminAddress = "127.0.0.1:20197"

type Paths struct {
	CaddyDirectoryPath         string
	CaddyfilePath              string
	ExecutablePath             string
	HostClaimsDirectoryPath    string
	PidFilePath                string
	PortClaimsDirectoryPath    string
	RegistrationsDirectoryPath string
	RootCertificatePath        string
	RoutesDirectoryPath        string
	StateDirectoryPath         string
	StorageDirectoryPath       string
}

func CreateManagedCaddyPathsForRoutesDirectory(routesDirectoryPath string) Paths {
	caddyDirectoryPath := filepath.Dir(routesDirectoryPath)
	stateDirectoryPath := filepath.Dir(caddyDirectoryPath)

	return CreateManagedCaddyPaths(stateDirectoryPath)
}

func CreateCaddyAdminAPIURL(adminAddress string) string {
	return fmt.Sprintf("http://%s/config/", adminAddress)
}

func ResolveManagedCaddyAdminAddress(manifestAdminAddress string) string {
	trimmedAdminAddress := strings.TrimSpace(manifestAdminAddress)
	if trimmedAdminAddress == "" {
		return DefaultManagedCaddyAdminAddress
	}

	return trimmedAdminAddress
}

func ResolveDevhostStateDirectoryPath(environment map[string]string) (string, error) {
	homeDirectoryPath := strings.TrimSpace(environment["HOME"])
	if homeDirectoryPath == "" {
		resolvedHomeDirectoryPath, error := os.UserHomeDir()
		if error == nil {
			homeDirectoryPath = strings.TrimSpace(resolvedHomeDirectoryPath)
		}
	}

	return resolveDevhostStateDirectoryPath(environment, homeDirectoryPath)
}

func resolveDevhostStateDirectoryPath(environment map[string]string, homeDirectoryPath string) (string, error) {
	if configuredStateDirectoryPath, ok := environment["DEVHOST_STATE_DIR"]; ok {
		trimmedStateDirectoryPath := strings.TrimSpace(configuredStateDirectoryPath)
		if trimmedStateDirectoryPath != "" {
			return trimmedStateDirectoryPath, nil
		}
	}

	if configuredXDGStateHome, ok := environment["XDG_STATE_HOME"]; ok {
		trimmedXDGStateHome := strings.TrimSpace(configuredXDGStateHome)
		if trimmedXDGStateHome != "" {
			return filepath.Join(trimmedXDGStateHome, "devhost"), nil
		}
	}

	if homeDirectoryPath == "" {
		return "", fmt.Errorf("Could not determine the devhost state directory. Set DEVHOST_STATE_DIR or HOME.")
	}

	return filepath.Join(homeDirectoryPath, ".local", "state", "devhost"), nil
}

func CreateManagedCaddyPaths(stateDirectoryPath string) Paths {
	caddyDirectoryPath := filepath.Join(stateDirectoryPath, "caddy")
	routesDirectoryPath := filepath.Join(caddyDirectoryPath, "routes")
	executableFileName := "caddy"
	if isWindows() {
		executableFileName = "caddy.exe"
	}

	return Paths{
		CaddyDirectoryPath:         caddyDirectoryPath,
		CaddyfilePath:              filepath.Join(caddyDirectoryPath, "Caddyfile"),
		ExecutablePath:             filepath.Join(caddyDirectoryPath, executableFileName),
		HostClaimsDirectoryPath:    filepath.Join(routesDirectoryPath, ".host-claims"),
		PidFilePath:                filepath.Join(caddyDirectoryPath, "caddy.pid"),
		PortClaimsDirectoryPath:    filepath.Join(caddyDirectoryPath, "port-claims"),
		RegistrationsDirectoryPath: filepath.Join(routesDirectoryPath, ".registrations"),
		RootCertificatePath:        filepath.Join(caddyDirectoryPath, "storage", "pki", "authorities", "local", "root.crt"),
		RoutesDirectoryPath:        routesDirectoryPath,
		StateDirectoryPath:         stateDirectoryPath,
		StorageDirectoryPath:       filepath.Join(caddyDirectoryPath, "storage"),
	}
}

func CreateManagedCaddyPathsFromEnvironment(environment map[string]string) (Paths, error) {
	stateDirectoryPath, error := ResolveDevhostStateDirectoryPath(environment)
	if error != nil {
		return Paths{}, error
	}

	return CreateManagedCaddyPaths(stateDirectoryPath), nil
}

func isWindows() bool {
	return os.PathSeparator == '\\'
}
