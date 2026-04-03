import { cleanSourcePath } from "./devtools/shared/sourceLocation";

export function resolveSourceFilePath(rawFileName: string, projectRootPath: string): string {
  const normalizedSourcePath: string = normalizeFilePath(cleanSourcePath(rawFileName));

  if (isAbsoluteFilePath(normalizedSourcePath)) {
    return normalizedSourcePath;
  }

  if (projectRootPath.length === 0) {
    return normalizedSourcePath;
  }

  return joinFilePaths(projectRootPath, normalizedSourcePath);
}

export function isWindowsDrivePath(path: string): boolean {
  return /^[A-Za-z]:\//.test(path);
}

export function normalizeFilePath(path: string): string {
  return path.replace(/\\/g, "/");
}

function isAbsoluteFilePath(path: string): boolean {
  return path.startsWith("/") || isWindowsDrivePath(path) || path.startsWith("//");
}

function joinFilePaths(basePath: string, relativePath: string): string {
  const normalizedBasePath: string = normalizeFilePath(basePath).replace(/\/+$/, "");
  const normalizedRelativePath: string = normalizeFilePath(relativePath);
  const baseHasLeadingSlash: boolean = normalizedBasePath.startsWith("/");
  const baseSegments: string[] = normalizedBasePath.split("/").filter((segment: string): boolean => {
    return segment.length > 0;
  });
  const relativeSegments: string[] = normalizedRelativePath.split("/");
  const joinedSegments: string[] = [...baseSegments];

  for (const segment of relativeSegments) {
    if (segment.length === 0 || segment === ".") {
      continue;
    }

    if (segment === "..") {
      const canPopSegment: boolean =
        joinedSegments.length > 1 || (joinedSegments.length === 1 && !isWindowsDrivePath(joinedSegments[0]));

      if (canPopSegment) {
        joinedSegments.pop();
      }

      continue;
    }

    joinedSegments.push(segment);
  }

  const joinedPath: string = joinedSegments.join("/");

  return baseHasLeadingSlash ? `/${joinedPath}` : joinedPath;
}
