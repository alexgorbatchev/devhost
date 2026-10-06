package caddy

import (
	"strings"
	"testing"
)

func TestProxyLocalOriginRoute(t *testing.T) {
	for _, path := range []string{"/", "/api/*"} {
		t.Run(path, func(t *testing.T) {
			options := ActivateRouteOptions{AppBindHost: "::", AppPort: 3100, Host: "app.example.test", Path: path, ServiceName: "web", ProxyLocalOrigin: true}
			registration := mustParseRouteRegistration(t, createRouteRegistrationText(options, "/project/devhost.toml"))
			snippet, err := renderHostRouteSnippet([]routeRegistration{registration}, true, 8080, 4443, t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			for _, want := range []string{
				"header_up Host [::1]:3100",
				`header_up Origin "^.+$" "http://[::1]:3100"`,
				`respond @devhost_foreign_origin "Origin does not match the routed host" 403`,
			} {
				if !strings.Contains(snippet, want) {
					t.Fatalf("missing %q in route:\n%s", want, snippet)
				}
			}
		})
	}
}

func TestProxyLocalOriginDocumentAndDefault(t *testing.T) {
	registration := routeRegistration{AppBindHost: "127.0.0.1", AppPort: 3200, DocumentInjectionPort: new(3300), ProxyLocalOrigin: true}
	lines, err := renderDocumentProxyHandleLines(registration)
	if err != nil {
		t.Fatal(err)
	}
	snippet := strings.Join(lines, "\n")
	if strings.Contains(snippet, "header_up Host") {
		t.Fatal("document hop lost public Host")
	}
	if !strings.Contains(snippet, `header_up Origin "^.+$" "http://127.0.0.1:3200"`) {
		t.Fatal("document Origin did not use app address")
	}
	if !strings.Contains(snippet, foreignOriginMatcher) {
		t.Fatal("document hop omitted Origin validation")
	}
	registration.ProxyLocalOrigin = false
	lines, err = renderServiceProxyLines(registration, "127.0.0.1:3200", true)
	if err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(lines, "\n"); got != "reverse_proxy 127.0.0.1:3200" {
		t.Fatalf("opt-out proxy = %q", got)
	}
}
