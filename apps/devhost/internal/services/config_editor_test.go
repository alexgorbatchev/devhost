package services

import (
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/config"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/devtools"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/manifest"
)

// withWebSetting adds a setting to the web service of a reloadServiceBody.
func withWebSetting(body, setting string) string {
	return strings.Replace(body, "[services.web.env]", setting+"\n[services.web.env]", 1)
}

func TestConfigEditorListsTheFilesTheStackReads(t *testing.T) {
	body := reloadServiceBody("web", "original", "reload.localhost")
	f := startReloadStack(t, body)
	includePath := filepath.Join(filepath.Dir(f.path), "extra.toml")
	if err := os.WriteFile(includePath, []byte(reloadServiceBody("extra", "included", "extra.localhost")), 0o600); err != nil {
		t.Fatal(err)
	}
	f.header = strings.Replace(f.header, "[worktrees]", "includes = [\"extra.toml\"]\n[worktrees]", 1)
	f.write(t, body)
	waitForCondition(t, stackChangeTimeout, func() bool { return f.logs.contains("configuration reloaded") })

	files, err := f.control.ListConfigFiles()
	if err != nil {
		t.Fatal(err)
	}
	rootPath, err := filepath.Abs(f.path)
	if err != nil {
		t.Fatal(err)
	}
	want := []devtools.ConfigFileRef{
		{Path: rootPath, Kind: devtools.ConfigFileKindManifest},
		{Path: includePath, Kind: devtools.ConfigFileKindInclude},
		{Path: f.configPath, Kind: devtools.ConfigFileKindConfig},
	}
	if !slices.Equal(files, want) {
		t.Fatalf("files = %#v, want %#v", files, want)
	}
}

func TestConfigEditorChecksWhatAReloadChecksWithoutApplyingIt(t *testing.T) {
	body := reloadServiceBody("web", "original", "reload.localhost")
	f := startReloadStack(t, body)
	route := readRestartRoute(t, filepath.Join(f.paths.RegistrationsDirectoryPath, "reload.localhost_web_2f.json"))
	pid := reloadPID(t, route.AppPort)
	rootPath, err := filepath.Abs(f.path)
	if err != nil {
		t.Fatal(err)
	}
	var parseError *manifest.ParseError
	var manifestIssues *manifest.ValidationError
	var configIssues *config.ValidationError
	for _, tc := range []struct {
		name, path, content string
		isRejected          func(error) bool
	}{
		{"valid content", rootPath, f.header + reloadServiceBody("web", "edited", "reload.localhost"), func(err error) bool { return err == nil }},
		{"a syntax error", rootPath, f.header + "[services.web]\ncommand = [", func(err error) bool { return errors.As(err, &parseError) }},
		{"an unknown setting", rootPath, f.header + withWebSetting(body, "unknown = true"), func(err error) bool { return errors.As(err, &manifestIssues) }},
		{"a dependency cycle", rootPath, f.header + withWebSetting(body, `dependsOn = ["web"]`), func(err error) bool { return err != nil && strings.Contains(err.Error(), "Dependency cycle detected") }},
		{"a missing working directory", rootPath, f.header + withWebSetting(body, `cwd = "missing"`), func(err error) bool {
			return err != nil && strings.Contains(err.Error(), "cannot access working directory")
		}},
		{"invalid shared settings", f.configPath, "[caddy]\nhttpsPort = 0\n", func(err error) bool { return errors.As(err, &configIssues) }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if err := f.control.CheckConfigFile(tc.path, []byte(tc.content)); !tc.isRejected(err) {
				t.Fatalf("check = %v", err)
			}
		})
	}
	if reloadPID(t, route.AppPort) != pid || f.logs.contains("configuration reloaded") {
		t.Fatal("a check applied the content")
	}
}
