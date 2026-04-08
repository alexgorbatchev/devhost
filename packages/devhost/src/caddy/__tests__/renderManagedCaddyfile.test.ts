import { describe, expect, test } from "bun:test";

import { createManagedCaddyPaths } from "../caddyPaths";
import { renderManagedCaddyfile } from "../renderManagedCaddyfile";

describe("renderManagedCaddyfile", () => {
  test("renders the macOS rootless caddyfile without a loopback bind directive", () => {
    const paths = createManagedCaddyPaths("/tmp/devhost state");

    expect(renderManagedCaddyfile(paths, "darwin")).toBe(
      [
        "{",
        "    admin 127.0.0.1:20193",
        "    auto_https disable_redirects",
        "    persist_config off",
        '    storage file_system "/tmp/devhost state/caddy/storage"',
        "}",
        "",
        'import "/tmp/devhost state/caddy/routes/*.caddy"',
        "",
        "https:// {",
        "    tls internal {",
        "        on_demand",
        "    }",
        "",
        '    root * "/tmp/devhost state/caddy/route-not-found"',
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
      ].join("\n"),
    );
  });

  test("renders the non-macOS caddyfile with loopback-only binding", () => {
    const paths = createManagedCaddyPaths("/tmp/devhost state");

    expect(renderManagedCaddyfile(paths, "linux")).toBe(
      [
        "{",
        "    admin 127.0.0.1:20193",
        "    auto_https disable_redirects",
        "    default_bind 127.0.0.1 [::1]",
        "    persist_config off",
        '    storage file_system "/tmp/devhost state/caddy/storage"',
        "}",
        "",
        'import "/tmp/devhost state/caddy/routes/*.caddy"',
        "",
        "https:// {",
        "    tls internal {",
        "        on_demand",
        "    }",
        "",
        '    root * "/tmp/devhost state/caddy/route-not-found"',
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
      ].join("\n"),
    );
  });
});
