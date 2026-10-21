package services

import (
	"os"
	"strings"
	"testing"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/devtools"
)

func readConfigurationStatus(t *testing.T, f *reloadStackFixture, source devtools.ConfigurationSource) devtools.ConfigurationStatus {
	t.Helper()
	health, err := f.control.GetHealthResponse()
	if err != nil {
		t.Fatal(err)
	}
	for _, status := range health.Configuration {
		if status.Source == source {
			return status
		}
	}
	return devtools.ConfigurationStatus{Source: source}
}

func TestConfigurationStatusCountsReloadsAndReportsTheLastRejection(t *testing.T) {
	body := reloadServiceBody("web", "original", "reload.localhost")
	f := startReloadStack(t, body)
	// The stack checks both sources once it is up.
	waitForCondition(t, stackChangeTimeout, func() bool {
		return readConfigurationStatus(t, f, devtools.ConfigurationSourceManifest).Reloads > 0 &&
			readConfigurationStatus(t, f, devtools.ConfigurationSourceConfig).Reloads > 0
	})
	started := readConfigurationStatus(t, f, devtools.ConfigurationSourceManifest)
	if started.Error != "" {
		t.Fatalf("a running stack reports %q", started.Error)
	}

	f.write(t, "\n[services.web]\ncommand = [")
	waitForCondition(t, stackChangeTimeout, func() bool {
		status := readConfigurationStatus(t, f, devtools.ConfigurationSourceManifest)
		return status.Reloads > started.Reloads && strings.Contains(status.Error, "Failed to parse")
	})
	rejected := readConfigurationStatus(t, f, devtools.ConfigurationSourceManifest)

	configStarted := readConfigurationStatus(t, f, devtools.ConfigurationSourceConfig)
	if err := os.WriteFile(f.configPath, []byte("[caddy]\nhttpsPort = 0\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	waitForCondition(t, stackChangeTimeout, func() bool {
		status := readConfigurationStatus(t, f, devtools.ConfigurationSourceConfig)
		return status.Reloads > configStarted.Reloads && strings.Contains(status.Error, "caddy.httpsPort must be an integer")
	})

	f.write(t, body)
	waitForCondition(t, stackChangeTimeout, func() bool {
		status := readConfigurationStatus(t, f, devtools.ConfigurationSourceManifest)
		return status.Reloads > rejected.Reloads && status.Error == ""
	})
	if status := readConfigurationStatus(t, f, devtools.ConfigurationSourceConfig); status.Error == "" {
		t.Fatal("an accepted manifest reload cleared the rejection of the config file")
	}
}
