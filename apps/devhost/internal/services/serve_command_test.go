package services

import (
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"
)

func TestServeCommandNameInference(t *testing.T) {
	root := t.TempDir()
	makeRepo := func(name string) string {
		dir := filepath.Join(root, name)
		if err := os.MkdirAll(dir, 0o700); err != nil {
			t.Fatal(err)
		}
		if out, err := exec.Command("git", "init", dir).CombinedOutput(); err != nil {
			t.Fatalf("git init: %s %v", out, err)
		}
		if err := os.WriteFile(filepath.Join(dir, "start.ts"), []byte(""), 0o600); err != nil {
			t.Fatal(err)
		}
		return dir
	}
	cwd := makeRepo("checkout")
	other := makeRepo("other")
	if out, err := exec.Command("git", "-C", other, "remote", "add", "origin", "git@example.com:owner/Real_App.git").CombinedOutput(); err != nil {
		t.Fatalf("remote: %s %v", out, err)
	}
	for _, test := range []struct {
		command []string
		want    string
	}{
		{[]string{"bun", "start.ts"}, "checkout"},
		{[]string{"bun", filepath.Join(other, "start.ts")}, "Real_App"},
		{[]string{"/bin/sh", "-c", "bun '" + filepath.Join(other, "start.ts") + "'"}, "Real_App"},
		{[]string{"bun", "start.ts", "--config", filepath.Join(other, "start.ts")}, "checkout"},
		{[]string{"bun", "start.ts", filepath.Join(other, "start.ts")}, "checkout"},
		{[]string{"bun", "run", "dev"}, "checkout"},
	} {
		if got := inferServeName(cwd, test.command); got != test.want {
			t.Errorf("%v = %q, want %q", test.command, got, test.want)
		}
	}
	if got := inferServeName(root, []string{"bun", "run", "dev"}); got != filepath.Base(root) {
		t.Errorf("cwd fallback: %q", got)
	}
	for name, want := range map[string]string{"My_App!": "my-app", "../../": "app", "é": "app"} {
		if got := serveNameLabel(name); got != want {
			t.Errorf("label %q = %q", name, got)
		}
	}
	if got := serveNameLabel(strings.Repeat("a", 100)); len(got) != 48 {
		t.Errorf("long label: %q", got)
	}
	config := filepath.Join(t.TempDir(), "config.toml")
	if err := os.WriteFile(config, []byte("domainSuffix = '.test.localhost'\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	env := map[string]string{"DEVHOST_CONFIG_DIR": filepath.Dir(config)}
	options := ServeCommandOptions{Directory: cwd, Command: []string{"bun", "start.ts"}, Name: "My_App!", StartupTimeout: time.Second, Environment: env}
	first, err := ResolveServeCommand(options)
	if err != nil {
		t.Fatal(err)
	}
	second, err := ResolveServeCommand(options)
	if err != nil {
		t.Fatal(err)
	}
	if first.Name == second.Name || !strings.HasPrefix(first.Name, "my-app-") || first.DomainSuffix != ".test.localhost" {
		t.Fatalf("sessions %#v %#v", first, second)
	}
	if err := os.WriteFile(config, []byte("domainSuffix = '--machine.localhost'\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	options.Name = strings.Repeat("a", 100)
	qualified, err := ResolveServeCommand(options)
	if err != nil {
		t.Fatal(err)
	}
	host := qualified.Name + "-65535" + qualified.DomainSuffix
	if label, _, _ := strings.Cut(host, "."); len(label) != 63 {
		t.Fatalf("qualified hostname exceeds DNS label limit: %s", host)
	}
}

func TestPreserveServeSession(t *testing.T) {
	for _, args := range [][]string{{"serve", "bun start.ts"}, {"serve", "--", "bun", "start.ts"}} {
		got := preserveServeSession(args, "app-12345678")
		if !slices.Equal(got[1:3], []string{"--session-id", "app-12345678"}) || !slices.Equal(preserveServeSession(got, "app-12345678"), got) {
			t.Fatalf("preserved: %v", got)
		}
	}
	for _, args := range [][]string{{"serve", "-dnotes.localhost"}, {"serve", "--domain=notes.localhost"}, {"serve", "-d", "notes.localhost"}} {
		if got := preserveServeSession(args, "serve-notes.localhost"); !slices.Equal(got, args) {
			t.Fatalf("file session changed: %v", got)
		}
	}
}
