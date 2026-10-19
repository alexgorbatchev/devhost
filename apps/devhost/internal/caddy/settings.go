package caddy

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
)

type appliedSettingsJSON struct {
	AdminAddress string `json:"adminAddress"`
	BindHost     string `json:"bindHost"`
	HTTPEnabled  bool   `json:"httpEnabled"`
	HTTPPort     int    `json:"httpPort"`
	HTTPSPort    int    `json:"httpsPort"`
}

// ReadAppliedManagedCaddySettings returns the listener settings the managed
// Caddy runs, as the last start or reload devhost made of it recorded them. ok
// is false when no record exists, as before the first start.
func ReadAppliedManagedCaddySettings(paths Paths) (settings ManagedCaddyGlobalSettings, ok bool, err error) {
	text, err := os.ReadFile(paths.AppliedSettingsPath)
	if errors.Is(err, fs.ErrNotExist) {
		return ManagedCaddyGlobalSettings{}, false, nil
	}
	if err != nil {
		return ManagedCaddyGlobalSettings{}, false, fmt.Errorf("read applied managed Caddy settings: %w", err)
	}
	var value appliedSettingsJSON
	if err := json.Unmarshal(text, &value); err != nil {
		return ManagedCaddyGlobalSettings{}, false, fmt.Errorf("parse applied managed Caddy settings %s: %w", paths.AppliedSettingsPath, err)
	}

	return ManagedCaddyGlobalSettings(value), true, nil
}

// readRunningSettings returns the settings route changes render: the ones Caddy
// runs. Without a record, Caddy is about to start from the settings given.
func readRunningSettings(paths Paths, fallback ManagedCaddyGlobalSettings) (ManagedCaddyGlobalSettings, error) {
	settings, ok, err := ReadAppliedManagedCaddySettings(paths)
	if err != nil || ok {
		return settings, err
	}

	return fallback, nil
}

func writeAppliedManagedCaddySettings(paths Paths, settings ManagedCaddyGlobalSettings) error {
	text, err := json.MarshalIndent(appliedSettingsJSON(settings), "", "  ")
	if err != nil {
		return fmt.Errorf("encode applied managed Caddy settings: %w", err)
	}
	// Readers outside the lock, such as the devtools origin check, never see a
	// partly written record.
	temporaryPath := paths.AppliedSettingsPath + ".tmp"
	if err := os.WriteFile(temporaryPath, text, 0o644); err != nil {
		return fmt.Errorf("write applied managed Caddy settings: %w", err)
	}
	if err := os.Rename(temporaryPath, paths.AppliedSettingsPath); err != nil {
		return fmt.Errorf("record applied managed Caddy settings: %w", err)
	}

	return nil
}

func removeAppliedManagedCaddySettings(paths Paths) error {
	if err := removeIfExists(paths.AppliedSettingsPath); err != nil {
		return fmt.Errorf("remove applied managed Caddy settings: %w", err)
	}

	return nil
}

// withRouteMutationLock serializes changes to the shared Caddy configuration
// across every devhost process using this state directory.
func withRouteMutationLock(paths Paths, mutate func() error) error {
	return withFileLock(filepath.Join(paths.CaddyDirectoryPath, "routes.lock"), "managed Caddy routes", mutate)
}

// ApplyManagedCaddySettings moves the managed Caddy to settings. It renders the
// Caddyfile, every host route, and the not-found site for them, reloads Caddy
// through the admin address Caddy runs, and records settings as applied. When
// Caddy rejects them it keeps its running configuration, and the files are
// rendered for that configuration again. changed is false when Caddy already
// runs settings, as when another stack applied the same change first.
func ApplyManagedCaddySettings(paths Paths, settings ManagedCaddyGlobalSettings, outputWriters RouteCommandOutputWriters) (changed bool, err error) {
	err = withRouteMutationLock(paths, func() error {
		running, ok, err := ReadAppliedManagedCaddySettings(paths)
		if err != nil {
			return err
		}
		if ok && running == settings {
			return nil
		}
		if !ok {
			running = settings
		}
		if err := renderManagedCaddySettings(paths, settings, runtime.GOOS); err != nil {
			return errors.Join(err, renderManagedCaddySettings(paths, running, runtime.GOOS))
		}
		if err := reloadManagedCaddy(running.AdminAddress, paths.RoutesDirectoryPath, outputWriters); err != nil {
			return errors.Join(err, renderManagedCaddySettings(paths, running, runtime.GOOS))
		}
		changed = true
		return writeAppliedManagedCaddySettings(paths, settings)
	})

	return changed, err
}

func renderManagedCaddySettings(paths Paths, settings ManagedCaddyGlobalSettings, runtimeOS string) error {
	if err := syncManagedCaddyGlobalState(paths.RoutesDirectoryPath, settings, runtimeOS); err != nil {
		return err
	}

	return syncManagedCaddyNotFoundSite(paths.RoutesDirectoryPath, settings.HTTPSPort)
}

func writeManagedCaddyfile(paths Paths, settings ManagedCaddyGlobalSettings, runtimeOS string) error {
	if runtimeOS == "" {
		runtimeOS = runtime.GOOS
	}
	caddyfile, err := renderManagedCaddyfile(renderManagedCaddyfileOptions{
		AdminAddress: settings.AdminAddress,
		BindHost:     settings.BindHost,
		EnableHTTP:   settings.HTTPEnabled,
		HTTPPort:     settings.HTTPPort,
		HTTPSPort:    settings.HTTPSPort,
		Paths:        paths,
		RuntimeOS:    runtimeOS,
	})
	if err != nil {
		return err
	}
	if err := os.WriteFile(paths.CaddyfilePath, []byte(caddyfile), 0o644); err != nil {
		return fmt.Errorf("write managed caddyfile %s: %w", paths.CaddyfilePath, err)
	}

	return nil
}
