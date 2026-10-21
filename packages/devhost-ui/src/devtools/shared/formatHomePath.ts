/** Shortens a path inside the home directory to start with `~`. */
export function formatHomePath(path: string, homeDirectoryPath: string): string {
  const homePath = homeDirectoryPath.replace(/\/+$/, "");
  if (homePath.length === 0) return path;
  if (path === homePath) return "~";
  return path.startsWith(`${homePath}/`) ? `~${path.slice(homePath.length)}` : path;
}
