import { formatHomePath } from "../../shared/formatHomePath";

/** Shows a configuration file relative to the project root, or else relative to the home directory. */
export function formatConfigFilePath(path: string, projectRootPath: string, homeDirectoryPath: string): string {
  const projectPath: string = projectRootPath.replace(/\/+$/, "");

  if (projectPath.length > 0 && path.startsWith(`${projectPath}/`)) {
    return path.slice(projectPath.length + 1);
  }

  return formatHomePath(path, homeDirectoryPath);
}
