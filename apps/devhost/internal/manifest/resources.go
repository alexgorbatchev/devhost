package manifest

import (
	"fmt"
	"time"
)

const (
	defaultResourcePollInterval     = 2 * time.Second
	defaultDiskResourcePollInterval = time.Minute
	// A reading costs a few file reads and system calls; polling faster than this would only make the toolbar flicker.
	minResourcePollInterval = 250 * time.Millisecond
)

func validateDevtoolsResources(rawValue any, schemaIssues *[]string) DevtoolsResourcesConfig {
	result := DevtoolsResourcesConfig{
		Enabled: true,
		CPU:     DevtoolsResourceConfig{Enabled: true, PollInterval: defaultResourcePollInterval},
		Memory:  DevtoolsResourceConfig{Enabled: true, PollInterval: defaultResourcePollInterval},
		Disk:    DevtoolsResourceConfig{Enabled: true, PollInterval: defaultDiskResourcePollInterval},
	}
	if rawValue == nil {
		return result
	}

	const path = "devtools.resources"
	value, ok := readMap(rawValue, path, schemaIssues)
	if !ok {
		return result
	}
	allowKeys(value, []string{"cpu", "disk", "enabled", "memory", "pollInterval"}, path, schemaIssues)

	if enabled, ok := readOptionalBool(value, "enabled", schemaIssues); ok {
		result.Enabled = enabled
	}
	if pollInterval, ok := readOptionalPollInterval(value, path, schemaIssues); ok {
		result.CPU.PollInterval = pollInterval
		result.Memory.PollInterval = pollInterval
		result.Disk.PollInterval = pollInterval
	}

	readouts := []struct {
		key    string
		config *DevtoolsResourceConfig
	}{
		{"cpu", &result.CPU},
		{"memory", &result.Memory},
		{"disk", &result.Disk},
	}
	for _, readout := range readouts {
		rawReadout := value[readout.key]
		if rawReadout == nil {
			continue
		}
		readoutPath := path + "." + readout.key
		readoutValue, ok := readMap(rawReadout, readoutPath, schemaIssues)
		if !ok {
			continue
		}
		allowKeys(readoutValue, []string{"enabled", "pollInterval"}, readoutPath, schemaIssues)
		if enabled, ok := readOptionalBool(readoutValue, "enabled", schemaIssues); ok {
			readout.config.Enabled = enabled
		}
		if pollInterval, ok := readOptionalPollInterval(readoutValue, readoutPath, schemaIssues); ok {
			readout.config.PollInterval = pollInterval
		}
	}

	return result
}

func readOptionalPollInterval(value map[string]any, path string, schemaIssues *[]string) (time.Duration, bool) {
	rawValue, ok := value["pollInterval"]
	if !ok {
		return 0, false
	}

	keyPath := path + ".pollInterval"
	text, ok := rawValue.(string)
	if !ok {
		*schemaIssues = append(*schemaIssues, fmt.Sprintf("%s must be a duration string such as \"2s\".", keyPath))
		return 0, false
	}
	pollInterval, err := time.ParseDuration(text)
	if err != nil {
		*schemaIssues = append(*schemaIssues, fmt.Sprintf("%s must be a valid duration: %v", keyPath, err))
		return 0, false
	}
	if pollInterval < minResourcePollInterval {
		*schemaIssues = append(*schemaIssues, fmt.Sprintf("%s must be at least %s.", keyPath, minResourcePollInterval))
		return 0, false
	}

	return pollInterval, true
}
