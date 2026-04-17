import type { IManagedCaddyPaths } from "./caddyPaths";
import { managedCaddyAdminAddress } from "./caddyPaths";
import { createManagedCaddyNotFoundSitePaths } from "./createManagedCaddyNotFoundSitePaths";
import { defaultManagedCaddyBindHost, resolveManagedCaddyBindDirective } from "./resolveManagedCaddyBindDirective";

export function renderManagedCaddyfile(
  paths: IManagedCaddyPaths,
  platform: NodeJS.Platform = process.platform,
  enableHttp: boolean = false,
  bindHost: string = defaultManagedCaddyBindHost,
): string {
  const routesGlobPath: string = `${paths.routesDirectoryPath}/*.caddy`;
  const bindDirective: string | null = resolveManagedCaddyBindDirective(platform, bindHost);
  const notFoundSitePaths = createManagedCaddyNotFoundSitePaths(paths.caddyDirectoryPath);

  return [
    "{",
    `    admin ${managedCaddyAdminAddress}`,
    "    auto_https disable_redirects",
    bindDirective,
    "    persist_config off",
    `    storage file_system ${quoteCaddyToken(paths.storageDirectoryPath)}`,
    "}",
    "",
    `import ${quoteCaddyToken(routesGlobPath)}`,
    "",
    ...(enableHttp ? renderFallbackSiteBlock("http://", notFoundSitePaths.directoryPath) : []),
    "https:// {",
    "    tls internal {",
    "        on_demand",
    "    }",
    "",
    `    root * ${quoteCaddyToken(notFoundSitePaths.directoryPath)}`,
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
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

function renderFallbackSiteBlock(siteAddress: string, directoryPath: string): string[] {
  return [
    `${siteAddress} {`,
    `    root * ${quoteCaddyToken(directoryPath)}`,
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
  ];
}

function quoteCaddyToken(value: string): string {
  return JSON.stringify(value);
}
