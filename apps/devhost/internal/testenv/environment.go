package testenv

import "os"

// InheritIsolation keeps test binaries launched as services in their parent's
// owned home and scratch directories, while preserving explicit test overrides.
func InheritIsolation(environment map[string]string) map[string]string {
	result := make(map[string]string, len(environment)+9)
	for _, name := range []string{"HOME", "XDG_CONFIG_HOME", "XDG_STATE_HOME", "DEVHOST_CONFIG_DIR", "DEVHOST_STATE_DIR", "TMPDIR", "GOTMPDIR", "DEVHOST_TEST_RUN_ID", isolatedHomeVariable} {
		if value, ok := os.LookupEnv(name); ok {
			result[name] = value
		}
	}
	for name, value := range environment {
		result[name] = value
	}
	return result
}
