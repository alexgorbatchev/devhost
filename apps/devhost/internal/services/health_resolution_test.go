package services

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/manifest"
)

func readHealthManifest(t *testing.T, body string) manifest.Manifest {
	t.Helper()
	path := filepath.Join(t.TempDir(), "devhost.toml")
	if err := os.WriteFile(path, []byte("name = \"health-tests\"\n"+body), 0600); err != nil {
		t.Fatal(err)
	}
	raw, err := manifest.ReadManifest(path)
	if err != nil {
		t.Fatal(err)
	}
	got, err := manifest.ValidateManifest(path, raw)
	if err != nil {
		t.Fatal(err)
	}
	return got
}

func TestHealthTimingResolution(t *testing.T) {
	for _, port := range []string{"\"auto\"", "3000"} {
		t.Run(port, func(t *testing.T) {
			config := readHealthManifest(t, "[services.web]\ncommand = ['server']\nport = "+port+"\n[services.web.health]\ntimeout = 60000\ninterval = 350\nretries = 4\n")
			got, err := ResolveServicePorts(config)
			if err != nil {
				t.Fatal(err)
			}
			service := got.Services["web"]
			if service.Health.Kind != HealthKindTCP || service.Health.Port == nil || *service.Health.Port != *service.Port || service.Health.Timeout != 60000 || service.Health.Interval != 350 || service.Health.Retries != 4 {
				t.Fatalf("effective health = %#v", service.Health)
			}
			clock := time.Time{}
			service.Health.Retries = 0
			err = waitForServiceHealth(context.Background(), WaitForServiceHealthOptions{Health: service.Health, ServiceName: "web"}, healthDependencies{
				now:              func() time.Time { return clock },
				sleep:            func(context.Context, time.Duration) error { clock = clock.Add(time.Second); return nil },
				canConnectToPort: func(context.Context, string, int, time.Duration) bool { return false },
			})
			if err == nil || !strings.Contains(err.Error(), "60000ms") || clock.Sub(time.Time{}) != time.Minute {
				t.Fatalf("readiness wait = %v after %s", err, clock.Sub(time.Time{}))
			}
		})
	}
}

func TestHealthHTTPResolution(t *testing.T) {
	for _, tc := range []struct{ host, address, probe string }{
		{"127.0.0.1", "127.0.0.1", "/ready%2Fcheck?mode=full"},
		{"0.0.0.0", "127.0.0.1", "{{ services.web.url }}/ready%2Fcheck?mode=full"},
		{"::", "[::1]", "/ready%2Fcheck?mode=full"},
		{"::1", "[::1]", "{{ services.web.url }}/ready%2Fcheck?mode=full"},
		{"127.0.0.1", "127.0.0.1", "http://127.0.0.1:{{ services.web.port }}/ready%2Fcheck?mode=full"},
	} {
		t.Run(tc.host+tc.probe, func(t *testing.T) {
			config := readHealthManifest(t, fmt.Sprintf("[services.web]\ncommand = ['server', '{{ services.web.url }}']\nport = 'auto'\nbindHost = %q\nhost = 'public.localhost'\nenv = { URL = '{{ services.web.url }}' }\n[services.web.health]\nhttp = %q\ntimeout = 60000\n", tc.host, tc.probe))
			got, err := ResolveServicePorts(config)
			if err != nil {
				t.Fatal(err)
			}
			service := got.Services["web"]
			base := fmt.Sprintf("http://%s:%d", tc.address, *service.Port)
			if service.Health.URL == nil || *service.Health.URL != base+"/ready%2Fcheck?mode=full" || service.Command[1] != base || service.Env["URL"] != base || service.Health.Timeout != 60000 {
				t.Fatalf("resolved service = %#v", service)
			}
		})
	}
}

func TestHealthHTTPResolutionErrors(t *testing.T) {
	for _, tc := range []struct{ probe, want string }{
		{"{{ services.missing.url }}/health", "does not exist"},
		{"{{ services.worker.url }}/health", "does not have a port"},
		{"{{ services.web.unknown }}/health", "unknown property"},
		{"http://{{ services.web.host }}:{{ services.web.port }}/health", "must target"},
		{"http://127.0.0.1:{{ services.web.port }/health", "URL"},
		{"{{ services.web.port }}/health", "absolute URL"},
		{"http://127.0.0.1:{{ services.web.port }}/%zz", "URL"},
	} {
		t.Run(tc.probe, func(t *testing.T) {
			config := readHealthManifest(t, fmt.Sprintf("[services.web]\ncommand = ['server']\nport = 'auto'\nhost = 'public.localhost'\n[services.web.health]\nhttp = %q\n[services.worker]\ncommand = ['worker']\nhealth = { process = true }\n", tc.probe))
			_, err := ResolveServicePorts(config)
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("resolution = %v, want %q", err, tc.want)
			}
		})
	}
}

func TestHealthReassignmentAndReload(t *testing.T) {
	for _, probe := range []string{"", "http = '/health'\n", "http = '{{ services.web.url }}/health'\n", "tcp = 5432\n"} {
		t.Run(probe, func(t *testing.T) {
			config := readHealthManifest(t, "[services.web]\ncommand = ['server']\nport = 'auto'\n[services.web.health]\n"+probe+"timeout = 60000\ninterval = 350\nretries = 4\n[services.consumer]\ncommand = ['server']\nport = 'auto'\nhealth = { http = '{{ services.web.url }}/health' }\n")
			initial, err := ResolveServicePorts(config)
			if err != nil {
				t.Fatal(err)
			}
			old := initial.Services["web"]
			service, next, err := ReassignAutoPort(initial, "web")
			if err != nil {
				t.Fatal(err)
			}
			if *service.Port == *old.Port || service.Health.Kind != old.Health.Kind || service.Health.Timeout != 60000 || service.Health.Interval != 350 || service.Health.Retries != 4 {
				t.Fatalf("reassigned health = %#v", service.Health)
			}
			if probe == "tcp = 5432\n" && *service.Health.Port != 5432 {
				t.Fatal("explicit TCP target changed")
			}
			wantURL := fmt.Sprintf("http://127.0.0.1:%d/health", *service.Port)
			if service.Health.Kind == HealthKindHTTP && *service.Health.URL != wantURL {
				t.Fatalf("stale URL = %s", *service.Health.URL)
			}
			if *next.Services["consumer"].Health.URL != wantURL {
				t.Fatal("consumer health reference is stale")
			}
			for _, resolve := range []func(manifest.Manifest, ResolvedManifest, []string) (ResolvedManifest, error){resolveReloadPorts, resolveStackRestartPorts} {
				reloaded, err := resolve(config, next, nil)
				if err != nil {
					t.Fatal(err)
				}
				web := reloaded.Services["web"]
				if web.Health.Timeout != 60000 || web.Health.Kind != old.Health.Kind || *reloaded.Services["consumer"].Health.URL != fmt.Sprintf("http://127.0.0.1:%d/health", *web.Port) {
					t.Fatalf("reload lost configuration: %#v", web.Health)
				}
			}
		})
	}
}

func TestHealthReassignmentWithoutSource(t *testing.T) {
	for _, inherited := range []bool{true, false} {
		t.Run(fmt.Sprint(inherited), func(t *testing.T) {
			service := createAutoPortService()
			service.Health.fixedTCPPort = !inherited
			service.Health.Timeout, service.Health.Interval, service.Health.Retries = 60000, 350, 4
			got, _, err := ReassignAutoPort(ResolvedManifest{Services: map[string]ResolvedService{"api": service}}, "api")
			if err != nil {
				t.Fatal(err)
			}
			wantPort := *service.Port
			if inherited {
				wantPort = *got.Port
			}
			if got.Health.Timeout != 60000 || got.Health.Interval != 350 || got.Health.Retries != 4 || *got.Health.Port != wantPort {
				t.Fatalf("reassignment lost health: %#v", got.Health)
			}
			if *service.Health.Port != *service.Port {
				t.Fatal("reassignment mutated the original snapshot")
			}
		})
	}
}

func TestResolvedHealthProbesRealServer(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.RequestURI != "/ready%2Fcheck?mode=full" {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()
	_, portText, err := net.SplitHostPort(server.Listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	port, err := strconv.Atoi(portText)
	if err != nil {
		t.Fatal(err)
	}
	for _, probe := range []string{"", "http = '/ready%2Fcheck?mode=full'\n", "http = '{{ services.web.url }}/ready%2Fcheck?mode=full'\n"} {
		config := readHealthManifest(t, "[services.web]\ncommand = ['server']\nport = 'auto'\n[services.web.health]\n"+probe+"timeout = 60000\n")
		got, err := resolveServicePorts(config, portResolutionOptions{Preserved: map[string]int{"web": port}})
		if err != nil {
			t.Fatal(err)
		}
		if err := WaitForServiceHealth(context.Background(), WaitForServiceHealthOptions{Health: got.Services["web"].Health, ServiceName: "web"}); err != nil {
			t.Fatal(err)
		}
	}
}

func TestHealthReassignmentKeepsExplicitProbe(t *testing.T) {
	for _, kind := range []string{HealthKindHTTP, HealthKindProcess} {
		t.Run(kind, func(t *testing.T) {
			service := createAutoPortService()
			endpoint := "http://127.0.0.1:4000/health"
			service.Health = ResolvedHealthConfig{Kind: kind, Timeout: 60000, Interval: 350, Retries: 4}
			if kind == HealthKindHTTP {
				service.Health.URL = &endpoint
			}
			got, _, err := ReassignAutoPort(ResolvedManifest{Services: map[string]ResolvedService{"api": service}}, "api")
			if err != nil {
				t.Fatal(err)
			}
			if got.Health.Kind != kind || got.Health.Timeout != 60000 || got.Health.Interval != 350 || got.Health.Retries != 4 || got.Health.Port != nil {
				t.Fatalf("explicit probe replaced: %#v", got.Health)
			}
			if kind == HealthKindHTTP && (got.Health.URL == nil || *got.Health.URL != endpoint) {
				t.Fatalf("fixed HTTP target changed: %#v", got.Health)
			}
		})
	}
}

func TestHealthReferencesStoppedService(t *testing.T) {
	config := readHealthManifest(t, "[services.web]\ncommand = ['server']\nport = 'auto'\n[services.consumer]\ncommand = ['server']\nport = 'auto'\nhealth = { http = '{{ services.web.url }}/health' }\n")
	initial, err := ResolveRequestedServicePorts(config, []string{"consumer"})
	if err != nil {
		t.Fatal(err)
	}
	web, ok := initial.Stopped["web"]
	if !ok || web.Port == nil {
		t.Fatal("reference started the stopped service")
	}
	want := fmt.Sprintf("http://127.0.0.1:%d/health", *web.Port)
	if *initial.Services["consumer"].Health.URL != want {
		t.Fatal("health reference did not resolve the stopped service's address")
	}
	started, err := resolveReloadPorts(config, initial, []string{"consumer", "web"})
	if err != nil {
		t.Fatal(err)
	}
	if *started.Services["web"].Port != *web.Port || *started.Services["consumer"].Health.URL != want {
		t.Fatal("starting the referenced service changed its health address")
	}
}
