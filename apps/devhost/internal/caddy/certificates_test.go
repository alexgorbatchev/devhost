package caddy

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy/caddytest"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/nettest"
)

func TestManagedCertificatesOnlyForConfiguredHosts(t *testing.T) {
	executable, err := exec.LookPath("caddy")
	if err != nil {
		t.Skip("native Caddy is unavailable")
	}
	paths := CreateManagedCaddyPaths(t.TempDir())
	ports := nettest.ReservePorts(t, 2)
	settings := DefaultManagedCaddyGlobalSettings()
	settings.AdminAddress = caddytest.UnusedAdminAddress(t)
	settings.BindHost = "127.0.0.1"
	settings.HTTPSPort, settings.HTTPPort = ports[0], ports[1]
	settings.HTTPEnabled = true
	if err := EnsureManagedCaddyConfig(paths, settings, runtime.GOOS); err != nil {
		t.Fatal(err)
	}
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		fmt.Fprint(w, "configured project")
	}))
	t.Cleanup(backend.Close)
	backendPort, err := strconv.Atoi(strings.TrimPrefix(backend.URL, "http://127.0.0.1:"))
	if err != nil {
		t.Fatal(err)
	}
	for i, host := range []string{"project.localhost", "web--devbox.example.com", "explicit.example.net"} {
		snippet, err := renderHostRouteSnippet([]routeRegistration{{Host: host, Path: "/", ServiceName: "web", AppBindHost: "127.0.0.1", AppPort: backendPort}}, settings.HTTPEnabled, settings.HTTPPort, settings.HTTPSPort, paths.RoutesDirectoryPath)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(paths.RoutesDirectoryPath, fmt.Sprintf("project%d.caddy", i)), []byte(snippet), 0600); err != nil {
			t.Fatal(err)
		}
	}
	start := func() {
		t.Helper()
		result := RunCommand([]string{executable, "start", "--pidfile", paths.PidFilePath, "--config", paths.CaddyfilePath, "--adapter", "caddyfile"}, RunCommandOptions{Background: true, WorkingDir: paths.CaddyDirectoryPath})
		if !result.Success {
			t.Fatalf("start isolated Caddy: %s", result.Stderr)
		}
	}
	stop := func() {
		t.Helper()
		result := RunCommand([]string{executable, "stop", "--address", settings.AdminAddress}, RunCommandOptions{})
		if !result.Success {
			t.Fatalf("stop isolated Caddy: %s", result.Stderr)
		}
	}
	t.Cleanup(func() {
		if err := EnsureManagedCaddyAdminAvailable(CreateCaddyAdminAPIURL(settings.AdminAddress), AdminAvailabilityDependencies{}); err == nil {
			stop()
		}
	})
	start()
	root, err := os.ReadFile(filepath.Join(paths.StorageDirectoryPath, "pki", "authorities", "local", "root.crt"))
	if err != nil {
		t.Fatal(err)
	}
	roots := x509.NewCertPool()
	if !roots.AppendCertsFromPEM(root) {
		t.Fatal("missing disposable Caddy root")
	}
	connect := func(host string) (*tls.Conn, error) {
		return tls.DialWithDialer(&net.Dialer{Timeout: time.Second}, "tcp", fmt.Sprintf("127.0.0.1:%d", settings.HTTPSPort), &tls.Config{ServerName: host, RootCAs: roots})
	}
	transport := &http.Transport{
		TLSClientConfig: &tls.Config{RootCAs: roots},
		DialContext: func(ctx context.Context, network, _ string) (net.Conn, error) {
			return (&net.Dialer{}).DialContext(ctx, network, fmt.Sprintf("127.0.0.1:%d", settings.HTTPSPort))
		},
	}
	t.Cleanup(transport.CloseIdleConnections)
	httpsClient := &http.Client{Transport: transport, Timeout: time.Second}
	assertConfigured := func() {
		t.Helper()
		for _, host := range []string{"project.localhost", "web--devbox.example.com", "explicit.example.net", settings.StackDirectoryHostname()} {
			deadline := time.Now().Add(10 * time.Second)
			for {
				conn, err := connect(host)
				if err == nil {
					conn.Close()
					response, err := httpsClient.Get(fmt.Sprintf("https://%s:%d/", host, settings.HTTPSPort))
					if err != nil {
						t.Fatalf("configured hostname %s: %v", host, err)
					}
					body, err := io.ReadAll(response.Body)
					response.Body.Close()
					want := "configured project"
					if host == settings.StackDirectoryHostname() {
						want = "No stacks running"
					}
					if err != nil || response.StatusCode != http.StatusOK || !strings.Contains(string(body), want) {
						t.Fatalf("configured hostname %s: status=%d error=%v, missing %q", host, response.StatusCode, err, want)
					}
					break
				}
				if time.Now().After(deadline) {
					t.Fatalf("configured hostname %s failed verified TLS: %v", host, err)
				}
				time.Sleep(25 * time.Millisecond)
			}
		}
	}
	assertUnknown := func(hosts ...string) {
		t.Helper()
		for _, host := range hosts {
			if conn, err := connect(host); err == nil {
				conn.Close()
				t.Errorf("unconfigured hostname %s completed verified TLS", host)
			}
		}
	}
	assertConfigured()
	assertUnknown("tracker.example.com", "unknown.localhost", "deep.unknown.localhost")
	// Seed certificates using the previous unrestricted configuration, then
	// upgrade through reload and restart without deleting storage or its CA.
	fixed, err := os.ReadFile(paths.CaddyfilePath)
	if err != nil {
		t.Fatal(err)
	}
	legacy := strings.Replace(string(fixed), "    tls internal\n", "    tls internal {\n        on_demand\n    }\n", 1)
	if err := os.WriteFile(paths.CaddyfilePath, []byte(legacy), 0600); err != nil {
		t.Fatal(err)
	}
	reload := func() {
		t.Helper()
		result := RunCommand([]string{executable, "reload", "--address", settings.AdminAddress, "--config", paths.CaddyfilePath, "--adapter", "caddyfile"}, RunCommandOptions{})
		if !result.Success {
			t.Fatalf("reload isolated Caddy: %s", result.Stderr)
		}
	}
	reload()
	conn, err := connect("tracker.example.com")
	if err != nil {
		t.Fatalf("seed legacy on-demand certificate: %v", err)
	}
	conn.Close()
	if err := os.WriteFile(paths.CaddyfilePath, fixed, 0600); err != nil {
		t.Fatal(err)
	}
	reload()
	assertConfigured()
	assertUnknown("fresh.example.com", "unknown.localhost", "deep.unknown.localhost")
	// Caddy retains previously issued on-demand certificates in memory through
	// reloads. A process restart clears that cache without changing trust.
	conn, err = connect("tracker.example.com")
	if err != nil {
		t.Fatalf("cached legacy certificate after reload: %v", err)
	}
	conn.Close()
	before, err := readManagedCaddyProcess(paths)
	if err != nil {
		t.Fatal(err)
	}
	// Concurrent upgraded clients share one automatic restart, including the
	// legacy case with no generation record. Use the native executable without
	// installing this disposable CA into the machine's trust store.
	if err := os.Symlink(executable, paths.ExecutablePath); err != nil {
		t.Fatal(err)
	}
	var workers sync.WaitGroup
	var starts, stops atomic.Int32
	failures := make(chan error, 8)
	for range 8 {
		workers.Go(func() {
			_, err := RunManagedCaddyLifecycleCommand(LifecycleStart, io.Discard, paths, settings, ManagedCaddyLifecycleDependencies{
				CanPromptForPassword:     func() bool { return false },
				ReadRootCertificateTrust: func() (RootCertificateTrust, error) { return RootCertificateTrusted, nil },
				RunManagedCaddyCommand: func(arguments []string, options ManagedCaddyCommandOptions) CommandResult {
					if arguments[0] == "start" {
						starts.Add(1)
					}
					if arguments[0] == "stop" {
						stops.Add(1)
					}
					return RunManagedCaddyCommand(paths, arguments, options, ManagedCaddyCommandDependencies{})
				},
			})
			failures <- err
		})
	}
	workers.Wait()
	close(failures)
	for err := range failures {
		if err != nil {
			t.Fatal(err)
		}
	}
	if starts.Load() != 1 || stops.Load() != 1 {
		t.Fatalf("concurrent clients started %d and stopped %d proxies", starts.Load(), stops.Load())
	}
	after, err := readManagedCaddyProcess(paths)
	if err != nil {
		t.Fatal(err)
	}
	if before == after {
		t.Fatal("legacy Caddy was not restarted")
	}
	record, err := readManagedCaddyRuntime(paths)
	if err != nil || record.ManagedCaddyProcess != after || record.Generation != managedCaddyRestartGeneration {
		t.Fatalf("runtime after restart: %+v, %v", record, err)
	}
	rootAfter, err := os.ReadFile(paths.RootCertificatePath)
	if err != nil || string(rootAfter) != string(root) {
		t.Fatalf("restart changed CA: %v", err)
	}
	if restarted, err := EnsureManagedCaddyRuntime(paths, settings, io.Discard, true); err != nil || restarted {
		t.Fatal(err)
	}
	reused, err := readManagedCaddyProcess(paths)
	if err != nil || reused != after {
		t.Fatalf("current Caddy restarted: %+v, %v", reused, err)
	}
	// A reloadable settings change keeps both the process and its generation.
	settings.StackDirectoryAllowRemote = true
	if changed, err := ApplyManagedCaddySettings(paths, settings, RouteCommandOutputWriters{}); err != nil || !changed {
		t.Fatalf("reload settings: %t, %v", changed, err)
	}
	reloaded, err := readManagedCaddyRuntime(paths)
	if err != nil || reloaded != record {
		t.Fatalf("reload changed runtime proof: %+v, %v", reloaded, err)
	}
	// Exercise the stack-start entry point as well as explicit caddy start.
	// A legacy process without a runtime receipt must be upgraded here too.
	if err := os.Remove(managedCaddyRuntimePath(paths)); err != nil {
		t.Fatal(err)
	}
	if restarted, err := EnsureManagedCaddyRuntime(paths, settings, io.Discard, true); err != nil || !restarted {
		t.Fatalf("stack-start runtime upgrade: restarted=%t error=%v", restarted, err)
	}
	stackProcess, err := readManagedCaddyProcess(paths)
	if err != nil || stackProcess == after {
		t.Fatalf("stack-start did not replace legacy process: %+v, %v", stackProcess, err)
	}
	stackRecord, err := readManagedCaddyRuntime(paths)
	if err != nil || stackRecord.ManagedCaddyProcess != stackProcess || stackRecord.Generation != managedCaddyRestartGeneration {
		t.Fatalf("stack-start runtime receipt: %+v, %v", stackRecord, err)
	}
	assertConfigured()
	assertUnknown("tracker.example.com", "fresh.example.com", "unknown.localhost", "deep.unknown.localhost")
	client := &http.Client{Timeout: time.Second}
	response, err := client.Get(fmt.Sprintf("http://127.0.0.1:%d/", settings.HTTPPort))
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil || response.StatusCode != http.StatusNotFound || !strings.Contains(string(body), "No active devhost route matched") {
		t.Fatalf("HTTP unknown-host fallback: status=%d error=%v", response.StatusCode, err)
	}
}
