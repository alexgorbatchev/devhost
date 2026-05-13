package manifest

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestReadManifestParsesFixtureShape(t *testing.T) {
	t.Parallel()

	manifestPath := filepath.Join("..", "..", "devhost.example.toml")
	rawManifest, error := ReadManifest(manifestPath)
	if error != nil {
		t.Fatalf("ReadManifest(...) unexpected error = %v", error)
	}

	name, ok := rawManifest.value["name"].(string)
	if !ok || name != "hello-stack" {
		t.Fatalf("raw manifest name = %#v, want %q", rawManifest.value["name"], "hello-stack")
	}

	servicesValue, ok := rawManifest.value["services"].(map[string]any)
	if !ok {
		t.Fatalf("raw manifest services = %#v, want map", rawManifest.value["services"])
	}

	if _, ok := servicesValue["web"]; !ok {
		t.Fatalf("raw manifest services missing %q", "web")
	}

	if len(rawManifest.serviceOrder) == 0 || rawManifest.serviceOrder[0] != "web" {
		t.Fatalf("serviceOrder = %#v, want first service %q", rawManifest.serviceOrder, "web")
	}
}

func TestReadManifestWrapsParseFailures(t *testing.T) {
	t.Parallel()

	temporaryDirectoryPath := t.TempDir()
	manifestPath := filepath.Join(temporaryDirectoryPath, "devhost.toml")
	if error := os.WriteFile(manifestPath, []byte("name = [\n"), 0o644); error != nil {
		t.Fatalf("WriteFile(...) error = %v", error)
	}

	_, error := ReadManifest(manifestPath)
	if error == nil {
		t.Fatal("ReadManifest(...) error = nil, want parse error")
	}

	if !strings.HasPrefix(error.Error(), "Failed to parse "+manifestPath+":") {
		t.Fatalf("ReadManifest(...) error = %q, want prefix %q", error.Error(), "Failed to parse "+manifestPath+":")
	}
}

func TestReadManifestExplainsDuplicateTables(t *testing.T) {
	t.Parallel()

	temporaryDirectoryPath := t.TempDir()
	manifestPath := filepath.Join(temporaryDirectoryPath, "devhost.toml")
	manifestText := strings.Join([]string{
		"[services.devhost-www]",
		`command = "bun dev"`,
		`cwd = "/tmp/react-starter-kit"`,
		`host = "test.localhost"`,
		"",
		"[services.devhost-www]",
		"primary = true",
		`command = "bun dev"`,
	}, "\n")
	if error := os.WriteFile(manifestPath, []byte(manifestText), 0o644); error != nil {
		t.Fatalf("WriteFile(...) error = %v", error)
	}

	_, error := ReadManifest(manifestPath)
	if error == nil {
		t.Fatal("ReadManifest(...) error = nil, want duplicate table error")
	}

	want := "Failed to parse " + manifestPath + ": TOML table [services.devhost-www] is declared more than once (lines 1 and 6). Merge those settings into a single table instead of repeating the header."
	if error.Error() != want {
		t.Fatalf("ReadManifest(...) error = %q, want %q", error.Error(), want)
	}
}

func TestReadManifestInterpolatesEnvironmentVariablesInAllStringFields(t *testing.T) {
	t.Setenv("STACK_NAME", "storybook-stack")
	t.Setenv("PUBLIC_HOST", "devhost-storybook-devbox.cvb.lol")
	t.Setenv("SERVICE_DIR", "frontend")
	t.Setenv("TASK_NAME", "storybook")
	t.Setenv("API_PREFIX", "api")
	t.Setenv("HEALTH_HOST", "127.0.0.1")
	t.Setenv("HEALTH_PORT", "4010")
	t.Setenv("ACTION_LABEL", "Open Code")

	temporaryDirectoryPath := t.TempDir()
	manifestPath := filepath.Join(temporaryDirectoryPath, "devhost.toml")
	manifestText := strings.Join([]string{
		`name = "$STACK_NAME"`,
		"",
		"[annotation]",
		`defaultAction = "open-code"`,
		"",
		"[[annotation.actions]]",
		`id = "open-code"`,
		`kind = "command"`,
		`label = "$ACTION_LABEL"`,
		`[annotation.actions.command]`,
		`command = ["bun", "run", "$TASK_NAME"]`,
		`cwd = "$SERVICE_DIR"`,
		`[annotation.actions.command.env]`,
		`TARGET_HOST = "https://${PUBLIC_HOST}"`,
		"",
		"[services.web]",
		`command = ["bun", "run", "$TASK_NAME"]`,
		`cwd = "$SERVICE_DIR"`,
		`host = "${PUBLIC_HOST}"`,
		`path = "/${API_PREFIX}/*"`,
		`port = 3000`,
		"",
		"[services.web.env]",
		`PUBLIC_URL = "https://${PUBLIC_HOST}"`,
		"",
		"[services.web.health]",
		`http = "http://${HEALTH_HOST}:${HEALTH_PORT}/healthz"`,
	}, "\n")
	if error := os.WriteFile(manifestPath, []byte(manifestText), 0o644); error != nil {
		t.Fatalf("WriteFile(...) error = %v", error)
	}

	rawManifest, error := ReadManifest(manifestPath)
	if error != nil {
		t.Fatalf("ReadManifest(...) unexpected error = %v", error)
	}

	name, ok := rawManifest.value["name"].(string)
	if !ok || name != "storybook-stack" {
		t.Fatalf("raw manifest name = %#v, want %q", rawManifest.value["name"], "storybook-stack")
	}

	annotationValue, ok := rawManifest.value["annotation"].(map[string]any)
	if !ok {
		t.Fatalf("raw manifest annotation = %#v, want map", rawManifest.value["annotation"])
	}
	actionsValue, ok := annotationValue["actions"].([]map[string]any)
	if !ok || len(actionsValue) != 1 {
		t.Fatalf("raw manifest annotation actions = %#v, want one action", annotationValue["actions"])
	}
	action := actionsValue[0]
	if action["label"] != "Open Code" {
		t.Fatalf("annotation action label = %#v, want %q", action["label"], "Open Code")
	}
	commandValue, ok := action["command"].(map[string]any)
	if !ok {
		t.Fatalf("annotation action command = %#v, want map", action["command"])
	}
	command, ok := commandValue["command"].([]any)
	if !ok || len(command) != 3 || command[2] != "storybook" {
		t.Fatalf("annotation action command = %#v, want interpolated array", commandValue["command"])
	}
	if commandValue["cwd"] != "frontend" {
		t.Fatalf("annotation action cwd = %#v, want %q", commandValue["cwd"], "frontend")
	}
	commandEnv, ok := commandValue["env"].(map[string]any)
	if !ok || commandEnv["TARGET_HOST"] != "https://devhost-storybook-devbox.cvb.lol" {
		t.Fatalf("annotation action env = %#v, want interpolated host", commandValue["env"])
	}

	servicesValue, ok := rawManifest.value["services"].(map[string]any)
	if !ok {
		t.Fatalf("raw manifest services = %#v, want map", rawManifest.value["services"])
	}
	webService, ok := servicesValue["web"].(map[string]any)
	if !ok {
		t.Fatalf("raw manifest web service = %#v, want map", servicesValue["web"])
	}
	if webService["cwd"] != "frontend" {
		t.Fatalf("service cwd = %#v, want %q", webService["cwd"], "frontend")
	}
	if webService["host"] != "devhost-storybook-devbox.cvb.lol" {
		t.Fatalf("service host = %#v, want %q", webService["host"], "devhost-storybook-devbox.cvb.lol")
	}
	if webService["path"] != "/api/*" {
		t.Fatalf("service path = %#v, want %q", webService["path"], "/api/*")
	}
	serviceCommand, ok := webService["command"].([]any)
	if !ok || len(serviceCommand) != 3 || serviceCommand[2] != "storybook" {
		t.Fatalf("service command = %#v, want interpolated array", webService["command"])
	}
	serviceEnv, ok := webService["env"].(map[string]any)
	if !ok || serviceEnv["PUBLIC_URL"] != "https://devhost-storybook-devbox.cvb.lol" {
		t.Fatalf("service env = %#v, want interpolated URL", webService["env"])
	}
	healthValue, ok := webService["health"].(map[string]any)
	if !ok || healthValue["http"] != "http://127.0.0.1:4010/healthz" {
		t.Fatalf("service health = %#v, want interpolated URL", webService["health"])
	}
}

func TestReadManifestRejectsUndefinedEnvironmentVariables(t *testing.T) {
	temporaryDirectoryPath := t.TempDir()
	manifestPath := filepath.Join(temporaryDirectoryPath, "devhost.toml")
	manifestText := strings.Join([]string{
		`name = "hello-stack"`,
		"",
		"[services.web]",
		`command = ["bun", "run", "dev"]`,
		`host = "${MISSING_PUBLIC_HOST}"`,
		`port = 3000`,
	}, "\n")
	if error := os.WriteFile(manifestPath, []byte(manifestText), 0o644); error != nil {
		t.Fatalf("WriteFile(...) error = %v", error)
	}

	_, error := ReadManifest(manifestPath)
	if error == nil {
		t.Fatal("ReadManifest(...) error = nil, want undefined variable error")
	}

	if !strings.Contains(error.Error(), "undefined environment variables: MISSING_PUBLIC_HOST") {
		t.Fatalf("ReadManifest(...) error = %q, want undefined variable detail", error.Error())
	}
}

func TestReadManifestPreservesUnsupportedDollarSequences(t *testing.T) {
	t.Setenv("PUBLIC_HOST", "devhost-storybook-devbox.cvb.lol")

	temporaryDirectoryPath := t.TempDir()
	manifestPath := filepath.Join(temporaryDirectoryPath, "devhost.toml")
	manifestText := strings.Join([]string{
		`name = "hello-stack"`,
		"",
		"[services.web]",
		`command = ["/bin/sh", "-c", "echo $$ $1 $? $0 ${} $PUBLIC_HOST ${BROKEN-$PUBLIC_HOST} ${BROKEN-$MISSING} ${BROKEN-${PUBLIC_HOST}} ${BROKEN-${MISSING}} ${PUBLIC_HOST}"]`,
		`host = "${PUBLIC_HOST}"`,
		`port = 3000`,
	}, "\n")
	if error := os.WriteFile(manifestPath, []byte(manifestText), 0o644); error != nil {
		t.Fatalf("WriteFile(...) error = %v", error)
	}

	rawManifest, error := ReadManifest(manifestPath)
	if error != nil {
		t.Fatalf("ReadManifest(...) unexpected error = %v", error)
	}

	servicesValue, ok := rawManifest.value["services"].(map[string]any)
	if !ok {
		t.Fatalf("raw manifest services = %#v, want map", rawManifest.value["services"])
	}
	webService, ok := servicesValue["web"].(map[string]any)
	if !ok {
		t.Fatalf("raw manifest web service = %#v, want map", servicesValue["web"])
	}
	commandValue, ok := webService["command"].([]any)
	if !ok || len(commandValue) != 3 {
		t.Fatalf("service command = %#v, want array", webService["command"])
	}

	want := "echo $$ $1 $? $0 ${} devhost-storybook-devbox.cvb.lol ${BROKEN-$PUBLIC_HOST} ${BROKEN-$MISSING} ${BROKEN-${PUBLIC_HOST}} ${BROKEN-${MISSING}} devhost-storybook-devbox.cvb.lol"
	if commandValue[2] != want {
		t.Fatalf("service command[2] = %#v, want %q", commandValue[2], want)
	}
	if webService["host"] != "devhost-storybook-devbox.cvb.lol" {
		t.Fatalf("service host = %#v, want %q", webService["host"], "devhost-storybook-devbox.cvb.lol")
	}
}

func TestReadManifestAllowsDefinedEmptyEnvironmentVariables(t *testing.T) {
	t.Setenv("STACK_SUFFIX", "")

	temporaryDirectoryPath := t.TempDir()
	manifestPath := filepath.Join(temporaryDirectoryPath, "devhost.toml")
	manifestText := strings.Join([]string{
		`name = "hello${STACK_SUFFIX}-stack"`,
		"",
		"[services.web]",
		`command = ["bun", "run", "dev"]`,
		`host = "web.localhost"`,
		`path = "/${STACK_SUFFIX}api/*"`,
		`port = 3000`,
	}, "\n")
	if error := os.WriteFile(manifestPath, []byte(manifestText), 0o644); error != nil {
		t.Fatalf("WriteFile(...) error = %v", error)
	}

	rawManifest, error := ReadManifest(manifestPath)
	if error != nil {
		t.Fatalf("ReadManifest(...) unexpected error = %v", error)
	}

	if rawManifest.value["name"] != "hello-stack" {
		t.Fatalf("raw manifest name = %#v, want %q", rawManifest.value["name"], "hello-stack")
	}
	servicesValue, ok := rawManifest.value["services"].(map[string]any)
	if !ok {
		t.Fatalf("raw manifest services = %#v, want map", rawManifest.value["services"])
	}
	webService, ok := servicesValue["web"].(map[string]any)
	if !ok {
		t.Fatalf("raw manifest web service = %#v, want map", servicesValue["web"])
	}
	if webService["path"] != "/api/*" {
		t.Fatalf("service path = %#v, want %q", webService["path"], "/api/*")
	}
}

func TestReadManifestContinuesAfterUnterminatedBracketedSequence(t *testing.T) {
	t.Setenv("PUBLIC_HOST", "devhost-storybook-devbox.cvb.lol")

	temporaryDirectoryPath := t.TempDir()
	manifestPath := filepath.Join(temporaryDirectoryPath, "devhost.toml")
	manifestText := strings.Join([]string{
		`name = "hello-stack"`,
		"",
		"[services.web]",
		`command = ["/bin/sh", "-c", "echo ${BROKEN- still $PUBLIC_HOST"]`,
		`host = "${PUBLIC_HOST}"`,
		`port = 3000`,
	}, "\n")
	if error := os.WriteFile(manifestPath, []byte(manifestText), 0o644); error != nil {
		t.Fatalf("WriteFile(...) error = %v", error)
	}

	rawManifest, error := ReadManifest(manifestPath)
	if error != nil {
		t.Fatalf("ReadManifest(...) unexpected error = %v", error)
	}

	servicesValue, ok := rawManifest.value["services"].(map[string]any)
	if !ok {
		t.Fatalf("raw manifest services = %#v, want map", rawManifest.value["services"])
	}
	webService, ok := servicesValue["web"].(map[string]any)
	if !ok {
		t.Fatalf("raw manifest web service = %#v, want map", servicesValue["web"])
	}
	commandValue, ok := webService["command"].([]any)
	if !ok || len(commandValue) != 3 {
		t.Fatalf("service command = %#v, want array", webService["command"])
	}

	want := "echo ${BROKEN- still $PUBLIC_HOST"
	if commandValue[2] != want {
		t.Fatalf("service command[2] = %#v, want %q", commandValue[2], want)
	}
}

func TestReadManifestContinuesAfterMalformedBracketedSequenceBeforeLaterClosingBrace(t *testing.T) {
	t.Setenv("PUBLIC_HOST", "devhost-storybook-devbox.cvb.lol")

	temporaryDirectoryPath := t.TempDir()
	manifestPath := filepath.Join(temporaryDirectoryPath, "devhost.toml")
	manifestText := strings.Join([]string{
		`name = "hello-stack"`,
		"",
		"[services.web]",
		`command = ["/bin/sh", "-c", "echo ${BROKEN- still $PUBLIC_HOST } ${PUBLIC_HOST}"]`,
		`host = "${PUBLIC_HOST}"`,
		`port = 3000`,
	}, "\n")
	if error := os.WriteFile(manifestPath, []byte(manifestText), 0o644); error != nil {
		t.Fatalf("WriteFile(...) error = %v", error)
	}

	rawManifest, error := ReadManifest(manifestPath)
	if error != nil {
		t.Fatalf("ReadManifest(...) unexpected error = %v", error)
	}

	servicesValue, ok := rawManifest.value["services"].(map[string]any)
	if !ok {
		t.Fatalf("raw manifest services = %#v, want map", rawManifest.value["services"])
	}
	webService, ok := servicesValue["web"].(map[string]any)
	if !ok {
		t.Fatalf("raw manifest web service = %#v, want map", servicesValue["web"])
	}
	commandValue, ok := webService["command"].([]any)
	if !ok || len(commandValue) != 3 {
		t.Fatalf("service command = %#v, want array", webService["command"])
	}

	want := "echo ${BROKEN- still $PUBLIC_HOST } devhost-storybook-devbox.cvb.lol"
	if commandValue[2] != want {
		t.Fatalf("service command[2] = %#v, want %q", commandValue[2], want)
	}
}

func TestReadManifestContinuesAfterMalformedBracketedSequenceBeforeNestedBracketedPlaceholder(t *testing.T) {
	t.Setenv("PUBLIC_HOST", "devhost-storybook-devbox.cvb.lol")

	temporaryDirectoryPath := t.TempDir()
	manifestPath := filepath.Join(temporaryDirectoryPath, "devhost.toml")
	manifestText := strings.Join([]string{
		`name = "hello-stack"`,
		"",
		"[services.web]",
		`command = ["/bin/sh", "-c", "echo ${BROKEN-${PUBLIC_HOST}} ${PUBLIC_HOST}"]`,
		`host = "${PUBLIC_HOST}"`,
		`port = 3000`,
	}, "\n")
	if error := os.WriteFile(manifestPath, []byte(manifestText), 0o644); error != nil {
		t.Fatalf("WriteFile(...) error = %v", error)
	}

	rawManifest, error := ReadManifest(manifestPath)
	if error != nil {
		t.Fatalf("ReadManifest(...) unexpected error = %v", error)
	}

	servicesValue, ok := rawManifest.value["services"].(map[string]any)
	if !ok {
		t.Fatalf("raw manifest services = %#v, want map", rawManifest.value["services"])
	}
	webService, ok := servicesValue["web"].(map[string]any)
	if !ok {
		t.Fatalf("raw manifest web service = %#v, want map", servicesValue["web"])
	}
	commandValue, ok := webService["command"].([]any)
	if !ok || len(commandValue) != 3 {
		t.Fatalf("service command = %#v, want array", webService["command"])
	}

	want := "echo ${BROKEN-${PUBLIC_HOST}} devhost-storybook-devbox.cvb.lol"
	if commandValue[2] != want {
		t.Fatalf("service command[2] = %#v, want %q", commandValue[2], want)
	}
}
