package caddy

import (
	"errors"
	"fmt"
	"os"
)

type routeRegistrationSnapshot struct {
	path     string
	contents []byte
	existed  bool
}

func ActivateRoute(options ActivateRouteOptions, manifestPath string, routesDirectoryPath string) error {
	return ActivateRoutes([]ActivateRouteOptions{options}, manifestPath, routesDirectoryPath)
}

// ActivateRoutes publishes a service's routes with one reload and restores all
// registrations together if writing, rendering, or reloading fails.
func ActivateRoutes(options []ActivateRouteOptions, manifestPath string, routesDirectoryPath string) error {
	if len(options) == 0 {
		return nil
	}
	paths := CreateManagedCaddyPathsForRoutesDirectory(routesDirectoryPath)
	previousSettings, err := readManagedCaddyGlobalSettings(paths, ManagedCaddyConfigFallback{})
	if err != nil {
		return err
	}
	snapshots, err := snapshotRouteRegistrations(options, routesDirectoryPath)
	if err != nil {
		return err
	}
	reloadAttempted := false
	rollback := func(originalError error) error {
		if restoreError := restoreRouteRegistrations(snapshots); restoreError != nil {
			return errors.Join(originalError, restoreError)
		}
		// Re-read registrations so rollback retains other stacks' current routes.
		fallback := ManagedCaddyConfigFallback{
			AdminAddress: previousSettings.AdminAddress, BindHost: previousSettings.BindHost,
			HTTPEnabled: previousSettings.HTTPEnabled, HTTPPort: previousSettings.HTTPPort, HTTPSPort: previousSettings.HTTPSPort,
		}
		nextSettings, settingsError := readManagedCaddyGlobalSettings(paths, fallback)
		if settingsError != nil {
			return errors.Join(originalError, fmt.Errorf("read restored route settings: %w", settingsError))
		}
		if syncError := syncManagedCaddyGlobalState(routesDirectoryPath, nextSettings); syncError != nil {
			return errors.Join(originalError, fmt.Errorf("restore managed Caddy configuration: %w", syncError))
		}
		if syncError := syncActivatedHostRoutes(options, routesDirectoryPath, nextSettings); syncError != nil {
			return errors.Join(originalError, fmt.Errorf("restore host routes: %w", syncError))
		}
		if syncError := syncManagedCaddyNotFoundSite(routesDirectoryPath, nextSettings.HTTPSPort); syncError != nil {
			return errors.Join(originalError, fmt.Errorf("restore not-found site: %w", syncError))
		}
		if reloadAttempted {
			for _, snapshot := range snapshots {
				if snapshot.existed {
					if reloadError := reloadManagedCaddy(nextSettings.AdminAddress, routesDirectoryPath, options[0].CaddyOutputWriters); reloadError != nil {
						return errors.Join(originalError, fmt.Errorf("reload restored Caddy configuration: %w", reloadError))
					}
					break
				}
			}
		}
		return originalError
	}
	for i, route := range options {
		if err := os.WriteFile(snapshots[i].path, []byte(createRouteRegistrationText(route, manifestPath)), 0o644); err != nil {
			return rollback(err)
		}
	}
	nextSettings, err := readManagedCaddyGlobalSettings(paths, ManagedCaddyConfigFallback{})
	if err != nil {
		return rollback(err)
	}
	if didManagedCaddyGlobalSettingsChange(previousSettings, nextSettings) {
		if err := syncManagedCaddyGlobalState(routesDirectoryPath, nextSettings); err != nil {
			return rollback(err)
		}
	} else if err := syncActivatedHostRoutes(options, routesDirectoryPath, nextSettings); err != nil {
		return rollback(err)
	}
	if err := syncManagedCaddyNotFoundSite(routesDirectoryPath, nextSettings.HTTPSPort); err != nil {
		return rollback(err)
	}
	reloadAttempted = true
	if err := reloadManagedCaddy(nextSettings.AdminAddress, routesDirectoryPath, options[0].CaddyOutputWriters); err != nil {
		return rollback(err)
	}
	return nil
}

func snapshotRouteRegistrations(options []ActivateRouteOptions, routesDirectoryPath string) ([]routeRegistrationSnapshot, error) {
	snapshots := make([]routeRegistrationSnapshot, 0, len(options))
	for _, route := range options {
		path := getRouteRegistrationPath(route.ServiceName, route.Host, route.Path, routesDirectoryPath)
		contents, err := os.ReadFile(path)
		if err != nil && !errors.Is(err, os.ErrNotExist) {
			return nil, fmt.Errorf("read previous route registration: %w", err)
		}
		snapshots = append(snapshots, routeRegistrationSnapshot{path: path, contents: contents, existed: err == nil})
	}
	return snapshots, nil
}

func restoreRouteRegistrations(snapshots []routeRegistrationSnapshot) error {
	var result error
	for _, snapshot := range snapshots {
		var err error
		if snapshot.existed {
			err = os.WriteFile(snapshot.path, snapshot.contents, 0o644)
		} else {
			err = removeIfExists(snapshot.path)
		}
		if err != nil {
			result = errors.Join(result, fmt.Errorf("restore route registration %s: %w", snapshot.path, err))
		}
	}
	return result
}

func syncActivatedHostRoutes(options []ActivateRouteOptions, routesDirectoryPath string, settings managedCaddyGlobalSettings) error {
	seenHosts := map[string]struct{}{}
	for _, route := range options {
		if _, seen := seenHosts[route.Host]; seen {
			continue
		}
		seenHosts[route.Host] = struct{}{}
		if err := syncHostRoute(route.Host, routesDirectoryPath, &settings); err != nil {
			return err
		}
	}
	return nil
}
