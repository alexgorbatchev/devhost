package services

import (
	"strings"
	"testing"

	"github.com/alexgorbatchev/devhost/packages/devhost/internal/caddy"
)

func TestReadLoopbackBindHostAmbiguityWarning(t *testing.T) {
	t.Parallel()

	createProbe := func(values map[string]*loopbackProbe) func(string, int) *loopbackProbe {
		return func(host string, port int) *loopbackProbe {
			return values["http://"+caddyAddress(host, port)+"/"]
		}
	}

	t.Run("returns recommendation when localhost matches opposite loopback listener", func(t *testing.T) {
		t.Parallel()

		warning := readLoopbackBindHostAmbiguityWarning(createRoutedResolvedService(), 443, loopbackWarningDependencies{
			probeHTTPResponse: createProbe(map[string]*loopbackProbe{
				"http://localhost:5173/": {Status: 200},
				"http://127.0.0.1:5173/": {Status: 302, Location: stringPointer("/api")},
				"http://[::1]:5173/":     {Status: 200},
			}),
		})

		if warning == "" {
			t.Fatalf("ReadLoopbackBindHostAmbiguityWarning(...) = empty, want warning")
		}
		if !containsText(warning, "services.toolbar-test.port = 5173 is ambiguous") {
			t.Fatalf("warning = %q, want ambiguity message", warning)
		}
		if !containsText(warning, `Consider setting services.toolbar-test.bindHost = "::1".`) {
			t.Fatalf("warning = %q, want bind host recommendation", warning)
		}
	})

	t.Run("returns empty when localhost and routed upstream behave the same", func(t *testing.T) {
		t.Parallel()

		warning := readLoopbackBindHostAmbiguityWarning(createRoutedResolvedService(), 443, loopbackWarningDependencies{
			probeHTTPResponse: createProbe(map[string]*loopbackProbe{
				"http://localhost:5173/": {Status: 200},
				"http://127.0.0.1:5173/": {Status: 200},
				"http://[::1]:5173/":     {Status: 200},
			}),
		})

		if warning != "" {
			t.Fatalf("ReadLoopbackBindHostAmbiguityWarning(...) = %q, want empty", warning)
		}
	})

	t.Run("returns empty for unrouted services", func(t *testing.T) {
		t.Parallel()

		service := createRoutedResolvedService()
		service.Host = nil
		warning := readLoopbackBindHostAmbiguityWarning(service, 443, loopbackWarningDependencies{probeHTTPResponse: createProbe(map[string]*loopbackProbe{})})
		if warning != "" {
			t.Fatalf("ReadLoopbackBindHostAmbiguityWarning(...) = %q, want empty", warning)
		}
	})
}

func createRoutedResolvedService() ResolvedService {
	return ResolvedService{
		BindHost:   "127.0.0.1",
		Command:    []string{"bun", "dev"},
		Cwd:        "/tmp/project",
		DependsOn:  []string{},
		Env:        map[string]string{},
		Health:     ResolvedHealthConfig{Host: stringPointer("127.0.0.1"), Interval: 200, Kind: "tcp", Port: intPointer(5173), Retries: 0, Timeout: 30000},
		Host:       stringPointer("test.localhost"),
		Name:       "toolbar-test",
		Path:       stringPointer("/"),
		Port:       intPointer(5173),
		PortSource: "fixed",
	}
}

func caddyAddress(host string, port int) string {
	return caddy.FormatProxyAddress(host, port)
}

func containsText(value string, substring string) bool {
	return strings.Contains(value, substring)
}
