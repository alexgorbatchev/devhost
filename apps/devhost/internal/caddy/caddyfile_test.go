package caddy

import (
	"strings"
	"testing"
)

func TestRenderManagedCaddyfile(t *testing.T) {
	t.Parallel()

	paths := CreateManagedCaddyPaths("/tmp/devhost state")
	macOSCaddyfile, error := renderManagedCaddyfile(renderManagedCaddyfileOptions{Paths: paths, RuntimeOS: "darwin"})
	if error != nil {
		t.Fatalf("renderManagedCaddyfile(...) unexpected error = %v", error)
	}

	if macOSCaddyfile != strings.Join([]string{
		"{",
		"    admin 127.0.0.1:20197",
		"    auto_https disable_redirects",
		"    log {",
		"        output discard",
		"    }",
		"    persist_config off",
		`    storage file_system "/tmp/devhost state/caddy/storage"`,
		"}",
		"",
		`import "/tmp/devhost state/caddy/routes/*.caddy"`,
		"",
		"https:// {",
		"    tls internal {",
		"        on_demand",
		"    }",
		"",
		`    root * "/tmp/devhost state/caddy/route-not-found"`,
		"",
		"    @devhost_route_not_found_asset file {path}",
		"    handle @devhost_route_not_found_asset {",
		"        file_server",
		"    }",
		"",
		"    handle {",
		"        error 404",
		"    }",
		"",
		"    handle_errors 404 {",
		"        rewrite /index.html",
		"        file_server",
		"    }",
		"}",
		"",
	}, "\n") {
		t.Fatalf("renderManagedCaddyfile(...) macOS output = %q", macOSCaddyfile)
	}

	linuxCaddyfile, error := renderManagedCaddyfile(renderManagedCaddyfileOptions{Paths: paths, RuntimeOS: "linux"})
	if error != nil {
		t.Fatalf("renderManagedCaddyfile(...) unexpected error = %v", error)
	}
	if !strings.Contains(linuxCaddyfile, "    default_bind 127.0.0.1 [::1]") {
		t.Fatalf("renderManagedCaddyfile(...) linux output missing default bind directive: %q", linuxCaddyfile)
	}
	if !strings.Contains(linuxCaddyfile, strings.Join([]string{
		"    log {",
		"        output discard",
		"    }",
	}, "\n")) {
		t.Fatalf("renderManagedCaddyfile(...) linux output missing quiet managed caddy logger: %q", linuxCaddyfile)
	}

	httpCaddyfile, error := renderManagedCaddyfile(renderManagedCaddyfileOptions{EnableHTTP: true, HTTPPort: 8080, HTTPSPort: 4443, Paths: paths, RuntimeOS: "linux"})
	if error != nil {
		t.Fatalf("renderManagedCaddyfile(...) unexpected error = %v", error)
	}
	if !strings.Contains(httpCaddyfile, "http://:8080 {") || !strings.Contains(httpCaddyfile, "https://:4443 {") {
		t.Fatalf("renderManagedCaddyfile(...) custom port output = %q", httpCaddyfile)
	}
	if !strings.Contains(httpCaddyfile, "    admin 127.0.0.1:20197") {
		t.Fatalf("renderManagedCaddyfile(...) default admin missing from output = %q", httpCaddyfile)
	}

	customCaddyfile, error := renderManagedCaddyfile(renderManagedCaddyfileOptions{AdminAddress: "127.0.0.1:22000", BindHost: "0.0.0.0", Paths: paths, RuntimeOS: "linux"})
	if error != nil {
		t.Fatalf("renderManagedCaddyfile(...) unexpected error = %v", error)
	}
	if !strings.Contains(customCaddyfile, "    admin 127.0.0.1:22000") || !strings.Contains(customCaddyfile, "    default_bind 0.0.0.0 [::]") {
		t.Fatalf("renderManagedCaddyfile(...) custom output = %q", customCaddyfile)
	}
}
