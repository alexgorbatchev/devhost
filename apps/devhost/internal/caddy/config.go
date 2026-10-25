package caddy

import (
	"fmt"
	"os"
)

// ManagedCaddyGlobalSettings are the listeners of the managed Caddy that every
// stack on the machine shares, set by the devhost config file.
type ManagedCaddyGlobalSettings struct {
	AdminAddress              string
	BindHost                  string
	HTTPEnabled               bool
	HTTPPort                  int
	HTTPSPort                 int
	StackDirectoryHost        string
	StackDirectoryAllowRemote bool
}

// DefaultManagedCaddyGlobalSettings are the listeners the managed Caddy uses
// when the devhost config file sets none.
func DefaultManagedCaddyGlobalSettings() ManagedCaddyGlobalSettings {
	return ManagedCaddyGlobalSettings{
		AdminAddress: DefaultManagedCaddyAdminAddress,
		BindHost:     defaultManagedCaddyBindHost,
		HTTPPort:     defaultManagedCaddyHTTPPort,
		HTTPSPort:    defaultManagedCaddyHTTPSPort,
	}
}

// EnsureManagedCaddyConfig creates the managed Caddy state directories and
// renders its Caddyfile and not-found site. A running Caddy keeps the settings
// recorded as applied; settings are what a Caddy that has not started yet uses.
func EnsureManagedCaddyConfig(paths Paths, settings ManagedCaddyGlobalSettings, runtimeOS string) error {
	directories := []string{
		paths.CaddyDirectoryPath,
		paths.RoutesDirectoryPath,
		paths.HostClaimsDirectoryPath,
		paths.PortClaimsDirectoryPath,
		paths.RegistrationsDirectoryPath,
		paths.StacksDirectoryPath,
		paths.StorageDirectoryPath,
	}
	for _, directoryPath := range directories {
		if err := os.MkdirAll(directoryPath, 0o755); err != nil {
			return fmt.Errorf("create managed caddy directory %s: %w", directoryPath, err)
		}
	}

	return withRouteMutationLock(paths, func() error {
		running, err := readRunningSettings(paths, settings)
		if err != nil {
			return err
		}
		if err := syncManagedCaddyNotFoundSite(paths.RoutesDirectoryPath, running); err != nil {
			return err
		}

		return writeManagedCaddyfile(paths, running, runtimeOS)
	})
}
