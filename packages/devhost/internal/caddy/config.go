package caddy

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

type ManagedCaddyConfigFallback struct {
	AdminAddress string
	BindHost     string
	HTTPEnabled  bool
	HTTPPort     int
	HTTPSPort    int
	RuntimeOS    string
}

type managedCaddyGlobalSettings struct {
	AdminAddress string
	BindHost     string
	HTTPEnabled  bool
	HTTPPort     int
	HTTPSPort    int
}

func ensureManagedCaddyConfig(paths Paths, fallback ManagedCaddyConfigFallback) error {
	directories := []string{
		paths.CaddyDirectoryPath,
		paths.RoutesDirectoryPath,
		paths.HostClaimsDirectoryPath,
		paths.PortClaimsDirectoryPath,
		paths.RegistrationsDirectoryPath,
		paths.StorageDirectoryPath,
	}
	for _, directoryPath := range directories {
		if error := os.MkdirAll(directoryPath, 0o755); error != nil {
			return fmt.Errorf("create managed caddy directory %s: %w", directoryPath, error)
		}
	}

	globalSettings, error := readManagedCaddyGlobalSettings(paths, fallback)
	if error != nil {
		return error
	}

	if error := syncManagedCaddyNotFoundSite(paths.RoutesDirectoryPath, globalSettings.HTTPSPort); error != nil {
		return error
	}

	caddyfile, error := renderManagedCaddyfile(renderManagedCaddyfileOptions{
		AdminAddress: globalSettings.AdminAddress,
		BindHost:     globalSettings.BindHost,
		EnableHTTP:   globalSettings.HTTPEnabled,
		HTTPPort:     globalSettings.HTTPPort,
		HTTPSPort:    globalSettings.HTTPSPort,
		Paths:        paths,
		RuntimeOS:    fallback.RuntimeOS,
	})
	if error != nil {
		return error
	}

	if error := os.WriteFile(paths.CaddyfilePath, []byte(caddyfile), 0o644); error != nil {
		return fmt.Errorf("write managed caddyfile %s: %w", paths.CaddyfilePath, error)
	}

	return nil
}

func readManagedCaddyGlobalSettings(paths Paths, fallback ManagedCaddyConfigFallback) (managedCaddyGlobalSettings, error) {
	entries, error := os.ReadDir(paths.RegistrationsDirectoryPath)
	if error != nil {
		return managedCaddyGlobalSettings{}, fmt.Errorf("read managed caddy registrations directory %s: %w", paths.RegistrationsDirectoryPath, error)
	}

	httpEnabled := false
	optedInAdminAddresses := map[string]struct{}{}
	optedInBindHosts := map[string]struct{}{}
	optedInHTTPPorts := map[int]struct{}{}
	optedInHTTPSPorts := map[int]struct{}{}

	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}

		registrationPath := filepath.Join(paths.RegistrationsDirectoryPath, entry.Name())
		registrationText, error := os.ReadFile(registrationPath)
		if error != nil {
			return managedCaddyGlobalSettings{}, fmt.Errorf("read managed caddy registration %s: %w", registrationPath, error)
		}

		var registration map[string]any
		if error := json.Unmarshal(registrationText, &registration); error != nil {
			return managedCaddyGlobalSettings{}, fmt.Errorf("parse managed caddy registration %s: %w", registrationPath, error)
		}

		if _, ok := registration["appBindHost"].(string); !ok {
			continue
		}

		if enabled, ok := registration["httpEnabled"].(bool); ok && enabled {
			httpEnabled = true
		}
		if adminAddress, ok := registration["caddyAdminAddress"].(string); ok {
			optedInAdminAddresses[adminAddress] = struct{}{}
		}
		if bindHost, ok := registration["caddyBindHost"].(string); ok {
			optedInBindHosts[bindHost] = struct{}{}
		}
		if httpPort, ok := readRegistrationNumber(registration["caddyHttpPort"]); ok {
			optedInHTTPPorts[httpPort] = struct{}{}
		}
		if httpsPort, ok := readRegistrationNumber(registration["caddyHttpsPort"]); ok {
			optedInHTTPSPorts[httpsPort] = struct{}{}
		}
	}

	if len(optedInAdminAddresses) > 1 {
		return managedCaddyGlobalSettings{}, fmt.Errorf("Managed Caddy admin address is inconsistent across active stacks: %s.", joinSortedStrings(optedInAdminAddresses))
	}
	if len(optedInBindHosts) > 1 {
		return managedCaddyGlobalSettings{}, fmt.Errorf("Managed Caddy bind host is inconsistent across active stacks: %s.", joinSortedStrings(optedInBindHosts))
	}
	if len(optedInHTTPPorts) > 1 {
		return managedCaddyGlobalSettings{}, fmt.Errorf("Managed Caddy HTTP port is inconsistent across active stacks: %s.", joinSortedInts(optedInHTTPPorts))
	}
	if len(optedInHTTPSPorts) > 1 {
		return managedCaddyGlobalSettings{}, fmt.Errorf("Managed Caddy HTTPS port is inconsistent across active stacks: %s.", joinSortedInts(optedInHTTPSPorts))
	}

	settings := managedCaddyGlobalSettings{
		AdminAddress: DefaultManagedCaddyAdminAddress,
		BindHost:     defaultManagedCaddyBindHost,
		HTTPEnabled:  httpEnabled,
		HTTPPort:     defaultManagedCaddyHTTPPort,
		HTTPSPort:    defaultManagedCaddyHTTPSPort,
	}
	if adminAddress := firstString(optedInAdminAddresses); adminAddress != "" {
		settings.AdminAddress = adminAddress
	} else if strings.TrimSpace(fallback.AdminAddress) != "" {
		settings.AdminAddress = ResolveManagedCaddyAdminAddress(fallback.AdminAddress)
	}
	if bindHost := firstString(optedInBindHosts); bindHost != "" {
		settings.BindHost = bindHost
	} else if fallback.BindHost != "" {
		settings.BindHost = fallback.BindHost
	}
	if httpPort, ok := firstInt(optedInHTTPPorts); ok {
		settings.HTTPPort = httpPort
	} else if fallback.HTTPPort != 0 {
		settings.HTTPPort = fallback.HTTPPort
	}
	if httpsPort, ok := firstInt(optedInHTTPSPorts); ok {
		settings.HTTPSPort = httpsPort
	} else if fallback.HTTPSPort != 0 {
		settings.HTTPSPort = fallback.HTTPSPort
	}
	if !settings.HTTPEnabled && fallback.HTTPEnabled {
		settings.HTTPEnabled = true
	}

	return settings, nil
}

func readRegistrationNumber(value any) (int, bool) {
	floatValue, ok := value.(float64)
	if !ok || math.Trunc(floatValue) != floatValue {
		return 0, false
	}

	return int(floatValue), true
}

func joinSortedStrings(values map[string]struct{}) string {
	items := make([]string, 0, len(values))
	for value := range values {
		items = append(items, value)
	}
	sort.Strings(items)
	return strings.Join(items, ", ")
}

func joinSortedInts(values map[int]struct{}) string {
	items := make([]int, 0, len(values))
	for value := range values {
		items = append(items, value)
	}
	sort.Ints(items)
	parts := make([]string, 0, len(items))
	for _, value := range items {
		parts = append(parts, fmt.Sprintf("%d", value))
	}
	return strings.Join(parts, ", ")
}

func firstString(values map[string]struct{}) string {
	for value := range values {
		return value
	}

	return ""
}

func firstInt(values map[int]struct{}) (int, bool) {
	for value := range values {
		return value, true
	}

	return 0, false
}
