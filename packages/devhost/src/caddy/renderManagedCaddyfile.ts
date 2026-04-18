import { dedentTemplate } from "@alexgorbatchev/dedent-string";

import type { IManagedCaddyPaths } from "./caddyPaths";
import {
  defaultManagedCaddyHttpPort,
  defaultManagedCaddyHttpsPort,
  formatManagedCaddySiteAddress,
} from "./managedCaddyPorts";
import { managedCaddyAdminAddress } from "./caddyPaths";
import { createManagedCaddyNotFoundSitePaths } from "./createManagedCaddyNotFoundSitePaths";
import { defaultManagedCaddyBindHost, resolveManagedCaddyBindDirective } from "./resolveManagedCaddyBindDirective";

export interface IRenderManagedCaddyfileOptions {
  bindHost?: string;
  enableHttp?: boolean;
  httpPort?: number;
  httpsPort?: number;
  paths: IManagedCaddyPaths;
  platform?: NodeJS.Platform;
}

export function renderManagedCaddyfile({
  bindHost = defaultManagedCaddyBindHost,
  enableHttp = false,
  httpPort = defaultManagedCaddyHttpPort,
  httpsPort = defaultManagedCaddyHttpsPort,
  paths,
  platform = process.platform,
}: IRenderManagedCaddyfileOptions): string {
  const routesGlobPath: string = `${paths.routesDirectoryPath}/*.caddy`;
  const bindDirective: string | null = resolveManagedCaddyBindDirective(platform, bindHost);
  const notFoundSitePaths = createManagedCaddyNotFoundSitePaths(paths.caddyDirectoryPath);
  const bindDirectiveSection: string = bindDirective === null ? "" : `\n${bindDirective}`;
  const globalOptionsBlock: string = dedentTemplate(
    `
      {
          admin {managedCaddyAdminAddress}
          auto_https disable_redirects{bindDirectiveSection}
          persist_config off
          storage file_system {storageDirectoryPath}
      }
    `,
    {
      bindDirectiveSection,
      managedCaddyAdminAddress,
      storageDirectoryPath: quoteCaddyToken(paths.storageDirectoryPath),
    },
  );
  const httpFallbackSiteBlock: string = enableHttp
    ? dedentTemplate(
        `
          {siteAddress} {
              root * {directoryPath}

              @devhost_route_not_found_asset file {path}
              handle @devhost_route_not_found_asset {
                  file_server
              }

              handle {
                  error 404
              }

              handle_errors 404 {
                  rewrite /index.html
                  file_server
              }
          }
        `,
        {
          directoryPath: quoteCaddyToken(notFoundSitePaths.directoryPath),
          siteAddress: formatManagedCaddySiteAddress("http", httpPort),
        },
      )
    : "";
  const httpsFallbackSiteBlock: string = dedentTemplate(
    `
      {siteAddress} {
          tls internal {
              on_demand
          }

          root * {directoryPath}

          @devhost_route_not_found_asset file {path}
          handle @devhost_route_not_found_asset {
              file_server
          }

          handle {
              error 404
          }

          handle_errors 404 {
              rewrite /index.html
              file_server
          }
      }
    `,
    {
      directoryPath: quoteCaddyToken(notFoundSitePaths.directoryPath),
      siteAddress: formatManagedCaddySiteAddress("https", httpsPort),
    },
  );
  const fallbackSiteBlocks: string = enableHttp
    ? `${httpFallbackSiteBlock}\n\n${httpsFallbackSiteBlock}`
    : httpsFallbackSiteBlock;

  return `${dedentTemplate(
    `
      {globalOptionsBlock}

      import {routesGlobPath}

      {fallbackSiteBlocks}
    `,
    {
      fallbackSiteBlocks,
      globalOptionsBlock,
      routesGlobPath: quoteCaddyToken(routesGlobPath),
    },
  )}\n`;
}

function quoteCaddyToken(value: string): string {
  return JSON.stringify(value);
}
