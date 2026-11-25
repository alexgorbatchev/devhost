package services

import (
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/config"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/devtools"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/manifest"
)

func TestConfigEditorReadsDuringAnOperationWhileValidationWaits(t *testing.T) {
	dir := t.TempDir()
	root := filepath.Join(dir, "devhost.toml")
	include := filepath.Join(dir, "included.toml")
	r := &stackRuntime{
		ready:         true,
		configured:    &manifest.Manifest{ManifestPath: root},
		manifestWatch: &manifestWatcher{inputs: manifest.Inputs{Files: []string{root, include}}},
		configPath:    filepath.Join(dir, "config.toml"),
	}
	r.operationMu.Lock()
	var release sync.Once
	unlock := func() { release.Do(r.operationMu.Unlock) }
	var workers sync.WaitGroup
	t.Cleanup(func() { unlock(); workers.Wait() })
	read := make(chan error, 1)
	workers.Go(func() {
		files, err := r.configFiles()
		want := []devtools.ConfigFileRef{
			{Path: root, Kind: devtools.ConfigFileKindManifest},
			{Path: include, Kind: devtools.ConfigFileKindInclude},
			{Path: r.configPath, Kind: devtools.ConfigFileKindConfig},
		}
		if err == nil && !slices.Equal(files, want) {
			err = errors.New("read omitted the accepted manifest, include or machine configuration")
		}
		read <- err
	})
	validation := make(chan error, 1)
	validationStarted := make(chan struct{})
	workers.Go(func() {
		close(validationStarted)
		validation <- r.checkConfigFile(r.configPath, []byte("[caddy]\nhttpsPort=0\n"))
	})
	select {
	case err := <-read:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("read-only configuration discovery waited for the lifecycle operation")
	}
	<-validationStarted
	select {
	case err := <-validation:
		t.Fatalf("validation escaped lifecycle serialization: %v", err)
	case <-time.After(50 * time.Millisecond):
	}
	unlock()
	select {
	case err := <-validation:
		var issues *config.ValidationError
		if !errors.As(err, &issues) {
			t.Fatalf("validation = %v, want invalid Caddy configuration", err)
		}
	case <-time.After(time.Second):
		t.Fatal("validation did not resume after the lifecycle operation")
	}
}

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
