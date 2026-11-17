package app

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	chserver "github.com/jpillora/chisel/server"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/manifest"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/nettest"
)

func TestRemoteStartRequiresMachineConfiguration(t *testing.T) {
	f := newDetachedFixture(t, 10000)
	var output strings.Builder
	if code := Run([]string{"start", "--remote", "--detach", "web"}, f.directory, &output, &output); code == 0 || !strings.Contains(output.String(), "remote previews are not configured") {
		t.Fatalf("unconfigured remote start = %d: %s", code, &output)
	}
	assertDetachedStopped(t, f)
}

func TestRemoteDetachedStartReloadAndModeOwnership(t *testing.T) {
	f := newDetachedFixture(t, 10000)
	f.healthy.Store(true)
	relay, err := chserver.NewServer(&chserver.Config{Reverse: true, Auth: "preview:test-password"})
	if err != nil {
		t.Fatal(err)
	}
	relayPort := nettest.ReservePort(t)
	if err := relay.Start("127.0.0.1", strconv.Itoa(relayPort)); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := relay.Close(); err != nil {
			t.Error(err)
		}
		if err := relay.Wait(); err != nil {
			t.Error(err)
		}
	})
	credential := filepath.Join(f.directory, "remote.auth")
	if err := os.WriteFile(credential, []byte("preview:test-password\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	configPath := filepath.Join(os.Getenv("DEVHOST_CONFIG_DIR"), "config.toml")
	contents, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatal(err)
	}
	contents = append(contents, []byte(fmt.Sprintf("\n[remote]\nserverURL = %q\ncredentialFile = %q\nfingerprint = %q\nremotePort = %d\ndomainSuffix = %q\n", "http://127.0.0.1:"+strconv.Itoa(relayPort), credential, relay.GetFingerprint(), nettest.ReservePort(t), "--laptop.preview.example.com"))...)
	if err := os.WriteFile(configPath, contents, 0o600); err != nil {
		t.Fatal(err)
	}
	manifest, err := os.ReadFile(f.manifest)
	if err != nil {
		t.Fatal(err)
	}
	manifest = []byte(strings.Replace(string(manifest), "[services.web.env]", "[services.web.env]\nDEVHOST_TEST_REMOTE_ORIGIN = \"{{ services.web.host }}\"", 1))
	manifest = []byte(strings.ReplaceAll(string(manifest), "detached-test.localhost", "detached-test"))
	if err := os.WriteFile(f.manifest, manifest, 0o600); err != nil {
		t.Fatal(err)
	}
	// This cleanup precedes the relay's shutdown even when an assertion fails.
	t.Cleanup(func() {
		stacks, err := caddy.ReadLiveStacks(caddy.CreateManagedCaddyPaths(f.state))
		if err != nil {
			t.Error(err)
			return
		}
		if len(stacks) > 0 {
			var output strings.Builder
			if code := Run([]string{"stop", "--manifest", f.manifest}, f.directory, &output, &output); code != 0 {
				t.Errorf("remote cleanup: %s", &output)
			}
		}
	})
	f.run(t, "start", "--local", "--detach", "web")
	var localMismatch strings.Builder
	if code := Run([]string{"start", "--remote", "--detach", "web"}, f.directory, &localMismatch, &localMismatch); code == 0 || !strings.Contains(localMismatch.String(), "different remote preview mode") {
		t.Fatalf("remote start adopted local stack = %d: %s", code, &localMismatch)
	}
	f.run(t, "stop", "--manifest", f.manifest)
	wantHost := "detached-test--laptop.preview.example.com"
	output := f.run(t, "start", "--detach", "web")
	stack := f.stack(t)
	if !stack.Remote || !stack.Ready || !strings.Contains(output, "https://"+wantHost) || strings.Contains(output, "https://detached-test.localhost") {
		t.Fatalf("remote startup = %#v\n%s", stack, output)
	}
	if got, err := os.ReadFile(filepath.Join(f.directory, "remote-origin")); err != nil || string(got) != wantHost {
		t.Fatalf("launched service origin = %s, error %v", got, err)
	}
	if output := f.run(t, "start", "--detach", "web"); !strings.Contains(output, "Already running") || !strings.Contains(output, "https://"+wantHost) {
		t.Fatalf("repeated remote start = %s", output)
	}
	var mismatch strings.Builder
	if code := Run([]string{"start", "--local", "--detach", "web"}, f.directory, &mismatch, &mismatch); code == 0 || !strings.Contains(mismatch.String(), "different remote preview mode") {
		t.Fatalf("local start adopted remote stack = %d: %s", code, &mismatch)
	}
	manifest = []byte(strings.ReplaceAll(string(manifest), "detached-test", "renamed"))
	if err := os.WriteFile(f.manifest, manifest, 0o600); err != nil {
		t.Fatal(err)
	}
	wantHost = "renamed--laptop.preview.example.com"
	deadline := time.Now().Add(15 * time.Second)
	for {
		origin, err := os.ReadFile(filepath.Join(f.directory, "remote-origin"))
		stacks, stackErr := caddy.ReadLiveStacks(caddy.CreateManagedCaddyPaths(f.state))
		if err == nil && string(origin) == wantHost && stackErr == nil && len(stacks) == 1 && len(stacks[0].URLs) == 1 && stacks[0].URLs[0] == "https://"+wantHost {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("remote reload did not publish its canonical origin: origin %s (%v), stacks %#v (%v)", origin, err, stacks, stackErr)
		}
		time.Sleep(20 * time.Millisecond)
	}
	f.run(t, "stop", "--manifest", f.manifest)
	assertDetachedStopped(t, f)
	if _, err := os.Stat(filepath.Join(f.state, "remote", "worker.json")); !os.IsNotExist(err) {
		t.Fatalf("remote worker survived final stack cleanup: %v", err)
	}
}

func TestStartSelectsConfiguredRoutingMode(t *testing.T) {
	t.Setenv("DEVHOST_CONFIG_DIR", t.TempDir())
	path := filepath.Join(os.Getenv("DEVHOST_CONFIG_DIR"), "config.toml")
	source := manifest.Manifest{ServiceOrder: []string{"web"}, Services: map[string]manifest.ValidatedService{"web": {Name: "web", Health: &manifest.HealthConfig{Process: true}, Hosts: []string{"web"}, Path: new("/*")}}}
	remoteConfig := `[remote]
serverURL = "https://relay.example.com"
credentialFile = "relay.auth"
fingerprint = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
remotePort = 18081
domainSuffix = "--laptop.preview.example.com"
`
	for _, tc := range []struct {
		name, content, host, failure    string
		forceRemote, forceLocal, remote bool
	}{
		{name: "unconfigured", host: "web.localhost"},
		{name: "local suffix", content: `domainSuffix = "--devbox.example.com"`, host: "web--devbox.example.com"},
		{name: "automatic relay", content: remoteConfig, host: "web--laptop.preview.example.com", remote: true},
		{name: "forced relay", content: remoteConfig, host: "web--laptop.preview.example.com", forceRemote: true, remote: true},
		{name: "forced local", content: "domainSuffix = \"--devbox.example.com\"\n" + remoteConfig, host: "web--devbox.example.com", forceLocal: true},
		{name: "required missing relay", forceRemote: true, failure: "not configured"},
		{name: "incomplete enrollment", content: "[remote]", failure: "remote.serverURL"},
		{name: "local with broken config", content: "[remote]", forceLocal: true, failure: "remote.serverURL"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if err := os.WriteFile(path, []byte(tc.content), 0o600); err != nil {
				t.Fatal(err)
			}
			got, err := resolveStartManifest(source, nil, tc.forceRemote, tc.forceLocal)
			if tc.failure != "" {
				if err == nil || !strings.Contains(err.Error(), tc.failure) {
					t.Fatalf("mode selection error: %v", err)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if (got.Remote != nil) != tc.remote || got.Services["web"].Hosts[0] != tc.host {
				t.Fatalf("selected routing: %#v", got)
			}
		})
	}
}
