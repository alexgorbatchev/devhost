import type { DevtoolsComponentEditor } from "../../../devtoolsComponentEditor";
import {
  isWindowsDrivePath,
  normalizeFilePath,
  resolveSourceFilePath,
} from "../../../resolveSourceFilePath";
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

