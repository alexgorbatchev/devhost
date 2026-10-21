package manifest

import (
	"errors"
	"os"
	"path/filepath"
	"slices"
	"testing"
)

// Every issue names the full path of the setting it concerns, so a reader, and the config editor, can tell which
// table it is in.
func TestValidationIssuesNameTheFullPathOfTheSetting(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name, body, want string
	}{
		{"a root setting", `killZombies = "yes"`, "killZombies must be a boolean."},
		{"worktrees", "[worktrees]\nenabled = \"yes\"", "worktrees.enabled must be a boolean."},
		{"the chat toggle", "[devtools.chat]\nenabled = \"yes\"", "devtools.chat.enabled must be a boolean."},
		{"a devtools table", "[devtools.status]\nenabled = 1", "devtools.status.enabled must be a boolean."},
		{"the editor", "[devtools.editor]\nide = 3", "devtools.editor.ide must be a string."},
		{"shortcuts", "[devtools.shortcuts]\nrestartServices = 1", "devtools.shortcuts.restartServices must be a string."},
		{"the idle timeout", "[devtools]\nidleTimeout = 5", "devtools.idleTimeout must be a string."},
		{"the native browser", "[devtools.browser]\nendpoint = 1", "devtools.browser.endpoint must be a string."},
		{"a devtools toggle", "[devtools.minimap]\nenabled = 1", "devtools.minimap.enabled must be a boolean."},
		{"resource readouts", "[devtools.resources]\nenabled = 1", "devtools.resources.enabled must be a boolean."},
		{"one resource readout", "[devtools.resources.cpu]\nenabled = 1", "devtools.resources.cpu.enabled must be a boolean."},
		{"a service port", "[services.api]\ncommand = [\"bun\"]\nport = 0", `services.api.port must be an integer between 1 and 65535 or "auto".`},
		{"a service flag", "[services.api]\ncommand = [\"bun\"]\nprimary = 1", "services.api.primary must be a boolean."},
		{"a service directory", "[services.api]\ncommand = [\"bun\"]\ncwd = 1", "services.api.cwd must be a string."},
		{"service dependencies", "[services.api]\ncommand = [\"bun\"]\ndependsOn = \"web\"", "services.api.dependsOn must be a string array."},
		{"a service environment", "[services.api]\ncommand = [\"bun\"]\n[services.api.env]\nA = 1", "services.api.env.A must be a string."},
		{"a service command", "[services.api]\ncommand = 1", "services.api.command must be a string array."},
		{"service hosts", "[services.api]\ncommand = [\"bun\"]\nhost = 1", "services.api.host must be a string array."},
		{"service watch paths", "[services.api]\ncommand = [\"bun\"]\nwatch = []", "services.api.watch must contain at least one string."},
		{"a service health check", "[services.api]\ncommand = [\"bun\"]\nport = 3000\n[services.api.health]\ntcp = 3000\nprocess = true", "services.api.health must define at most one of tcp, http, or process."},
		{"a health setting", "[services.api]\ncommand = [\"bun\"]\nport = 3000\n[services.api.health]\ntcp = 0", "services.api.health.tcp must be an integer between 1 and 65535."},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			path := filepath.Join(t.TempDir(), "devhost.toml")
			// A service of its own keeps the manifest from failing only for having none.
			content := "name = \"stack\"\n" + tc.body + "\n[services.web]\ncommand = [\"bun\"]\n"
			if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
				t.Fatal(err)
			}
			raw, err := ReadManifest(path)
			if err != nil {
				t.Fatal(err)
			}
			_, err = ValidateManifest(path, raw)
			var validationError *ValidationError
			if !errors.As(err, &validationError) || !slices.Contains(validationError.Issues, tc.want) {
				t.Fatalf("issues = %v, want them to include %q", err, tc.want)
			}
		})
	}
}
