export interface ISourceLocation {
  columnNumber?: number;
  componentName?: string;
  fileName: string;
  lineNumber: number;
}

export function cleanSourcePath(rawPath: string): string {
  return rawPath
    .replace(/[?#].*$/, "")
    .replace(/^turbopack:\/\/\/\[project\]\//, "")
    .replace(/^webpack-internal:\/\/\/\.\//, "")
    .replace(/^webpack-internal:\/\/\//, "")
    .replace(/^webpack:\/\/\/\.\//, "")
    .replace(/^webpack:\/\/\//, "")
    .replace(/^turbopack:\/\/\//, "")
    .replace(/^https?:\/\/[^/]+\//, "")
    .replace(/^file:\/\/\//, "/")
    .replace(/^\([^)]+\)\/\.\//, "")
    .replace(/^\.\//, "");
}

export function normalizeSourceLocation(sourceLocation: ISourceLocation): ISourceLocation {
  return {
    columnNumber: sourceLocation.columnNumber,
    componentName: sourceLocation.componentName,
    fileName: cleanSourcePath(sourceLocation.fileName),
    lineNumber: sourceLocation.lineNumber,
  };
}
