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
		`name = "{{ env.STACK_NAME }}"`,
		"",
		"[annotation]",
		`defaultAction = "open-code"`,
		"",
		"[[annotation.actions]]",
		`id = "open-code"`,
		`kind = "command"`,
		`label = "{{ env.ACTION_LABEL }}"`,
		`[annotation.actions.command]`,
		`command = ["bun", "run", "{{ env.TASK_NAME }}"]`,
		`cwd = "{{ env.SERVICE_DIR }}"`,
		`[annotation.actions.command.env]`,
		`TARGET_HOST = "https://{{ env.PUBLIC_HOST }}"`,
		"",
		"[services.web]",
		`command = ["bun", "run", "{{ env.TASK_NAME }}"]`,
		`cwd = "{{ env.SERVICE_DIR }}"`,
		`host = "{{ env.PUBLIC_HOST }}"`,
		`path = "/{{ env.API_PREFIX }}/*"`,
		`port = 3000`,
		"",
		"[services.web.env]",
		`PUBLIC_URL = "https://{{ env.PUBLIC_HOST }}"`,
		"",
		"[services.web.health]",
		`http = "http://{{ env.HEALTH_HOST }}:{{ env.HEALTH_PORT }}/healthz"`,
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
		`host = "{{ env.MISSING_PUBLIC_HOST }}"`,
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

func TestReadManifestPreservesUnsupportedInterpolationSequences(t *testing.T) {
	t.Setenv("PUBLIC_HOST", "devhost-storybook-devbox.cvb.lol")

	temporaryDirectoryPath := t.TempDir()
	manifestPath := filepath.Join(temporaryDirectoryPath, "devhost.toml")
	manifestText := strings.Join([]string{
		`name = "hello-stack"`,
		"",
		"[services.web]",
		`command = ["/bin/sh", "-c", "echo $$ $1 $? $0 ${} $PUBLIC_HOST ${PUBLIC_HOST} {{}} {{ nope }} {{ env. }} {{ env.BROKEN-NAME }} {{ env.PUBLIC_HOST }}"]`,
		`host = "{{ env.PUBLIC_HOST }}"`,
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

	want := "echo $$ $1 $? $0 ${} $PUBLIC_HOST ${PUBLIC_HOST} {{}} {{ nope }} {{ env. }} {{ env.BROKEN-NAME }} devhost-storybook-devbox.cvb.lol"
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
		`name = "hello{{ env.STACK_SUFFIX }}-stack"`,
		"",
		"[services.web]",
		`command = ["bun", "run", "dev"]`,
		`host = "web.localhost"`,
		`path = "/{{ env.STACK_SUFFIX }}api/*"`,
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

func TestReadManifestContinuesAfterUnterminatedInterpolationSequence(t *testing.T) {
	t.Setenv("PUBLIC_HOST", "devhost-storybook-devbox.cvb.lol")

	temporaryDirectoryPath := t.TempDir()
	manifestPath := filepath.Join(temporaryDirectoryPath, "devhost.toml")
	manifestText := strings.Join([]string{
		`name = "hello-stack"`,
		"",
		"[services.web]",
		`command = ["/bin/sh", "-c", "echo {{ env.BROKEN still {{ env.PUBLIC_HOST }}"]`,
		`host = "{{ env.PUBLIC_HOST }}"`,
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

	want := "echo {{ env.BROKEN still {{ env.PUBLIC_HOST }}"
	if commandValue[2] != want {
		t.Fatalf("service command[2] = %#v, want %q", commandValue[2], want)
	}
}

func TestReadManifestContinuesAfterMalformedInterpolationSequenceBeforeLaterClosingBrace(t *testing.T) {
	t.Setenv("PUBLIC_HOST", "devhost-storybook-devbox.cvb.lol")

	temporaryDirectoryPath := t.TempDir()
	manifestPath := filepath.Join(temporaryDirectoryPath, "devhost.toml")
	manifestText := strings.Join([]string{
		`name = "hello-stack"`,
		"",
		"[services.web]",
		`command = ["/bin/sh", "-c", "echo {{ env.BROKEN still {{ env.PUBLIC_HOST } }} {{ env.PUBLIC_HOST }}"]`,
		`host = "{{ env.PUBLIC_HOST }}"`,
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

	want := "echo {{ env.BROKEN still {{ env.PUBLIC_HOST } }} devhost-storybook-devbox.cvb.lol"
	if commandValue[2] != want {
		t.Fatalf("service command[2] = %#v, want %q", commandValue[2], want)
	}
}

func TestReadManifestContinuesAfterMalformedInterpolationSequenceBeforeNestedPlaceholder(t *testing.T) {
	t.Setenv("PUBLIC_HOST", "devhost-storybook-devbox.cvb.lol")

	temporaryDirectoryPath := t.TempDir()
	manifestPath := filepath.Join(temporaryDirectoryPath, "devhost.toml")
	manifestText := strings.Join([]string{
		`name = "hello-stack"`,
		"",
		"[services.web]",
		`command = ["/bin/sh", "-c", "echo {{ env.BROKEN-{{ env.PUBLIC_HOST }} }} {{ env.PUBLIC_HOST }}"]`,
		`host = "{{ env.PUBLIC_HOST }}"`,
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

	want := "echo {{ env.BROKEN-{{ env.PUBLIC_HOST }} }} devhost-storybook-devbox.cvb.lol"
	if commandValue[2] != want {
		t.Fatalf("service command[2] = %#v, want %q", commandValue[2], want)
	}
}

func TestReadManifestWithIncludes(t *testing.T) {
	t.Parallel()

	tmpDir := t.TempDir()

	// Create sub-directory for app1
	app1Dir := filepath.Join(tmpDir, "packages", "app1")
	if err := os.MkdirAll(app1Dir, 0o755); err != nil {
		t.Fatal(err)
	}

	// Create sub-directory for app2
	app2Dir := filepath.Join(tmpDir, "packages", "app2")
	if err := os.MkdirAll(app2Dir, 0o755); err != nil {
		t.Fatal(err)
	}

	// Root manifest
	rootPath := filepath.Join(tmpDir, "devhost.toml")
	rootText := strings.Join([]string{
		`name = "root-stack"`,
		`includes = ["packages/*/devhost.toml"]`,
		"",
		`[services.root-service]`,
		`command = ["echo", "root"]`,
		`port = 8080`,
	}, "\n")
	if err := os.WriteFile(rootPath, []byte(rootText), 0o644); err != nil {
		t.Fatal(err)
	}

	// App1 manifest
	app1Path := filepath.Join(app1Dir, "devhost.toml")
	app1Text := strings.Join([]string{
		`[services.app1-service]`,
		`command = ["echo", "app1"]`,
		`cwd = "src"`,
		`watch = ["src/"]`,
		`port = 8081`,
	}, "\n")
	if err := os.WriteFile(app1Path, []byte(app1Text), 0o644); err != nil {
		t.Fatal(err)
	}

	// App2 manifest (no explicit cwd)
	app2Path := filepath.Join(app2Dir, "devhost.toml")
	app2Text := strings.Join([]string{
		`[services.app2-service]`,
		`command = ["echo", "app2"]`,
		`port = 8082`,
	}, "\n")
	if err := os.WriteFile(app2Path, []byte(app2Text), 0o644); err != nil {
		t.Fatal(err)
	}

	// Read and parse
	rawManifest, err := ReadManifest(rootPath)
	if err != nil {
		t.Fatalf("unexpected error reading manifest with includes: %v", err)
	}

	// Check name
	name, ok := rawManifest.value["name"].(string)
	if !ok || name != "root-stack" {
		t.Fatalf("name = %q, want %q", name, "root-stack")
	}

	// Check services are merged
	services, ok := rawManifest.value["services"].(map[string]any)
	if !ok {
		t.Fatal("missing services table")
	}

	// Verify app1 service (relative path rewriting for cwd and watch)
	app1Service, ok := services["app1-service"].(map[string]any)
	if !ok {
		t.Fatal("missing app1-service")
	}
	// cwd "src" under packages/app1 must be rewritten relative to rootDir
	wantCwd := filepath.Join("packages", "app1", "src")
	if app1Service["cwd"] != wantCwd {
		t.Fatalf("app1-service cwd = %q, want %q", app1Service["cwd"], wantCwd)
	}

	// watch "src/" under packages/app1 must be rewritten
	watchArr, ok := app1Service["watch"].([]any)
	if !ok || len(watchArr) != 1 {
		t.Fatalf("app1-service watch = %#v, want array with 1 element", app1Service["watch"])
	}
	wantWatch := filepath.Join("packages", "app1", "src")
	if watchArr[0] != wantWatch {
		t.Fatalf("app1-service watch[0] = %q, want %q", watchArr[0], wantWatch)
	}

	// Verify app2 service (default cwd should default to packages/app2)
	app2Service, ok := services["app2-service"].(map[string]any)
	if !ok {
		t.Fatal("missing app2-service")
	}
	wantApp2Cwd := filepath.Join("packages", "app2")
	if app2Service["cwd"] != wantApp2Cwd {
		t.Fatalf("app2-service cwd = %q, want %q", app2Service["cwd"], wantApp2Cwd)
	}

	// Verify root-service is untouched
	rootService, ok := services["root-service"].(map[string]any)
	if !ok {
		t.Fatal("missing root-service")
	}
	if rootService["cwd"] != nil {
		t.Fatalf("root-service cwd = %#v, want nil", rootService["cwd"])
	}
}

func TestReadManifestConflictError(t *testing.T) {
	t.Parallel()

	tmpDir := t.TempDir()

	rootPath := filepath.Join(tmpDir, "devhost.toml")
	rootText := strings.Join([]string{
		`name = "conflict-stack"`,
		`includes = ["app.toml"]`,
		"",
		`[services.dup-service]`,
		`command = ["echo", "root"]`,
		`port = 8080`,
	}, "\n")
	if err := os.WriteFile(rootPath, []byte(rootText), 0o644); err != nil {
		t.Fatal(err)
	}

	appPath := filepath.Join(tmpDir, "app.toml")
	appText := strings.Join([]string{
		`[services.dup-service]`,
		`command = ["echo", "app"]`,
		`port = 8081`,
	}, "\n")
	if err := os.WriteFile(appPath, []byte(appText), 0o644); err != nil {
		t.Fatal(err)
	}

	_, err := ReadManifest(rootPath)
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if !strings.Contains(err.Error(), `service "dup-service" is defined multiple times`) {
		t.Fatalf("unexpected error message: %v", err)
	}
}

func TestReadManifestCyclicSafety(t *testing.T) {
	t.Parallel()

	tmpDir := t.TempDir()

	manifest1Path := filepath.Join(tmpDir, "manifest1.toml")
	manifest1Text := strings.Join([]string{
		`name = "cyclic-stack"`,
		`includes = ["manifest2.toml"]`,
		"",
		`[services.svc1]`,
		`command = ["echo", "svc1"]`,
		`port = 8081`,
	}, "\n")
	if err := os.WriteFile(manifest1Path, []byte(manifest1Text), 0o644); err != nil {
		t.Fatal(err)
	}

	manifest2Path := filepath.Join(tmpDir, "manifest2.toml")
	manifest2Text := strings.Join([]string{
		`includes = ["manifest1.toml"]`,
		"",
		`[services.svc2]`,
		`command = ["echo", "svc2"]`,
		`port = 8082`,
	}, "\n")
	if err := os.WriteFile(manifest2Path, []byte(manifest2Text), 0o644); err != nil {
		t.Fatal(err)
	}

	rawManifest, err := ReadManifest(manifest1Path)
	if err != nil {
		t.Fatalf("expected graceful handle, got error: %v", err)
	}

	services, ok := rawManifest.value["services"].(map[string]any)
	if !ok {
		t.Fatal("missing services")
	}
	if _, exists := services["svc1"]; !exists {
		t.Fatal("missing svc1")
	}
	if _, exists := services["svc2"]; !exists {
		t.Fatal("missing svc2")
	}
}

func TestReadManifestGlobalSettingsOverrideNotAllowed(t *testing.T) {
	t.Parallel()

	tmpDir := t.TempDir()

	rootPath := filepath.Join(tmpDir, "devhost.toml")
	rootText := strings.Join([]string{
		`name = "root-stack"`,
		`includes = ["sub.toml"]`,
		"",
		`[caddy.global]`,
		`http = true`,
		"",
		`[services.root-svc]`,
		`command = ["echo", "root"]`,
		`port = 8080`,
	}, "\n")
	if err := os.WriteFile(rootPath, []byte(rootText), 0o644); err != nil {
		t.Fatal(err)
	}

	subPath := filepath.Join(tmpDir, "sub.toml")
	subText := strings.Join([]string{
		`name = "sub-stack"`,
		"",
		`[caddy.global]`,
		`http = false`,
		`httpPort = 8081`,
		"",
		`[devtools.shortcuts]`,
		`restartServices = "ctrl+q"`,
		"",
		`[services.sub-svc]`,
		`command = ["echo", "sub"]`,
		`port = 8082`,
	}, "\n")
	if err := os.WriteFile(subPath, []byte(subText), 0o644); err != nil {
		t.Fatal(err)
	}

	rawManifest, err := ReadManifest(rootPath)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// name must remain "root-stack"
	name, ok := rawManifest.value["name"].(string)
	if !ok || name != "root-stack" {
		t.Fatalf("name = %q, want %q", name, "root-stack")
	}

	// caddy.global.http must remain true, and other fields must not be inherited
	caddyVal, ok := rawManifest.value["caddy"].(map[string]any)
	if !ok {
		t.Fatal("missing caddy table")
	}
	globalVal, ok := caddyVal["global"].(map[string]any)
	if !ok {
		t.Fatal("missing caddy.global table")
	}
	httpVal, ok := globalVal["http"].(bool)
	if !ok || !httpVal {
		t.Fatalf("caddy.global.http = %v, want true", globalVal["http"])
	}
	if _, exists := globalVal["httpPort"]; exists {
		t.Fatalf("sub-manifest caddy.global.httpPort was unexpectedly merged")
	}

	// devtools must not be inherited from sub-manifest
	if _, exists := rawManifest.value["devtools"]; exists {
		t.Fatalf("sub-manifest devtools was unexpectedly merged")
	}

	// services must still be merged
	services, ok := rawManifest.value["services"].(map[string]any)
	if !ok {
		t.Fatal("missing services table")
	}
	if _, exists := services["root-svc"]; !exists {
		t.Fatal("missing root-svc")
	}
	if _, exists := services["sub-svc"]; !exists {
		t.Fatal("missing sub-svc")
	}
}
