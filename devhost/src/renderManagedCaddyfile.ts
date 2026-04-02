import type { IManagedCaddyPaths } from "./caddyPaths";
import { managedCaddyAdminAddress } from "./caddyPaths";
import { resolveManagedCaddyBindDirective } from "./resolveManagedCaddyBindDirective";

export function renderManagedCaddyfile(
  paths: IManagedCaddyPaths,
  platform: NodeJS.Platform = process.platform,
): string {
  const routesGlobPath: string = `${paths.routesDirectoryPath}/*.caddy`;
  const bindDirective: string | null = resolveManagedCaddyBindDirective(platform);

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
    "https:// {",
    "    tls internal {",
    "        on_demand",
    "    }",
    "",
    '    respond "No devhost route is registered for {host}." 404',
    "}",
    "",
  ].filter((line): line is string => line !== null).join("\n");
}

function quoteCaddyToken(value: string): string {
  return JSON.stringify(value);
}
