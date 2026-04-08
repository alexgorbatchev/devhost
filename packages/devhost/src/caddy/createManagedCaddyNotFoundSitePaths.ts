import { join } from "node:path";

export interface IManagedCaddyNotFoundSitePaths {
  directoryPath: string;
  pagePath: string;
  stylesheetPath: string;
}

export function createManagedCaddyNotFoundSitePaths(caddyDirectoryPath: string): IManagedCaddyNotFoundSitePaths {
  const directoryPath: string = join(caddyDirectoryPath, "route-not-found");

  return {
    directoryPath,
    pagePath: join(directoryPath, "index.html"),
    stylesheetPath: join(directoryPath, "devhost-route-not-found.css"),
  };
}
