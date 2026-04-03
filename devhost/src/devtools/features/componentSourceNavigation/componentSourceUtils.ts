import type { DevtoolsComponentEditor } from "../../../devtoolsComponentEditor";
import { cleanSourcePath, type ISourceLocation } from "../../shared/sourceLocation";

export function formatComponentSourcePath(source: ISourceLocation, projectRootPath: string): string {
  const displayPath: string = createDisplaySourcePath(source.fileName, projectRootPath);
  const columnSuffix: string = source.columnNumber === undefined ? "" : `:${source.columnNumber}`;

  return `${displayPath}:${source.lineNumber}${columnSuffix}`;
}

export function createComponentSourceUrl(
  source: ISourceLocation,
  editor: DevtoolsComponentEditor,
  projectRootPath: string,
): string {
  const absoluteSourcePath: string = resolveSourceFilePath(source.fileName, projectRootPath);
  const editorProtocolPath: string = toEditorProtocolPath(absoluteSourcePath);
  const encodedPath: string = encodeURI(editorProtocolPath);
  const lineNumber: number = source.lineNumber;
  const columnNumber: number = source.columnNumber ?? 1;

  switch (editor) {
    case "cursor": {
      const fileUrl: string = toFileUrl(absoluteSourcePath);
      return `cursor://open?url=${encodeURIComponent(fileUrl)}&line=${lineNumber}&column=${columnNumber}`;
    }
    case "vscode-insiders":
      return `vscode-insiders://file/${encodedPath}:${lineNumber}:${columnNumber}`;
    case "webstorm":
      return `webstorm://open?file=${encodeURIComponent(absoluteSourcePath)}&line=${lineNumber}`;
    case "vscode":
    default:
      return `vscode://file/${encodedPath}:${lineNumber}:${columnNumber}`;
  }
}

function createDisplaySourcePath(rawFileName: string, projectRootPath: string): string {
  const resolvedSourcePath: string = resolveSourceFilePath(rawFileName, projectRootPath);
  const projectRelativePath: string | undefined = toProjectRelativePath(resolvedSourcePath, projectRootPath);

  if (projectRelativePath !== undefined) {
    return projectRelativePath;
  }

  return inferProjectRelativePath(cleanSourcePath(rawFileName));
}

function inferProjectRelativePath(rawPath: string): string {
  const normalizedPath: string = normalizeFilePath(rawPath).replace(/^\.\//, "");
  const pathSegments: string[] = normalizedPath.split("/").filter((segment: string): boolean => {
    return segment.length > 0;
  });
  let matchIndex: number = -1;

  for (let segmentIndex: number = 0; segmentIndex < pathSegments.length; segmentIndex += 1) {
    const segment: string = pathSegments[segmentIndex];

    if (segment === "src" || segment === "app" || segment === "pages") {
      matchIndex = segmentIndex;
    }
  }

  if (matchIndex !== -1) {
    return pathSegments.slice(matchIndex).join("/");
  }

  return normalizedPath;
}

function toProjectRelativePath(sourcePath: string, projectRootPath: string): string | undefined {
  const normalizedProjectRootPath: string = normalizeFilePath(projectRootPath).replace(/\/+$/, "");

  if (normalizedProjectRootPath.length === 0) {
    return undefined;
  }

  const normalizedSourcePath: string = normalizeFilePath(sourcePath);

  if (normalizedSourcePath === normalizedProjectRootPath) {
    return "";
  }

  const projectRootPrefix: string = `${normalizedProjectRootPath}/`;

  if (!normalizedSourcePath.startsWith(projectRootPrefix)) {
    return undefined;
  }

  return normalizedSourcePath.slice(projectRootPrefix.length);
}

function toEditorProtocolPath(filePath: string): string {
  return normalizeFilePath(filePath);
}

function toFileUrl(filePath: string): string {
  const normalizedPath: string = normalizeFilePath(filePath);

  if (isWindowsDrivePath(normalizedPath)) {
    return `file:///${normalizedPath}`;
  }

  if (normalizedPath.startsWith("/")) {
    return `file://${normalizedPath}`;
  }

  return `file:///${normalizedPath}`;
}

function resolveSourceFilePath(rawFileName: string, projectRootPath: string): string {
  const normalizedSourcePath: string = normalizeFilePath(cleanSourcePath(rawFileName));

  if (isAbsoluteFilePath(normalizedSourcePath)) {
    return normalizedSourcePath;
  }

  if (projectRootPath.length === 0) {
    return normalizedSourcePath;
  }

  return joinFilePaths(projectRootPath, normalizedSourcePath);
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
        joinedSegments.length > 1 ||
        (joinedSegments.length === 1 && !isWindowsDrivePath(joinedSegments[0]));

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

function isAbsoluteFilePath(path: string): boolean {
  return path.startsWith("/") || isWindowsDrivePath(path) || path.startsWith("//");
}

function isWindowsDrivePath(path: string): boolean {
  return /^[A-Za-z]:\//.test(path);
}

function normalizeFilePath(path: string): string {
  return path.replace(/\\/g, "/");
}
