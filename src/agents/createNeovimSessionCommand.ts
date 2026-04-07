import type { ISourceLocation } from "../devtools/shared/sourceLocation";
import { resolveSourceFilePath } from "../utils/resolveSourceFilePath";

export function createNeovimSessionCommand(source: ISourceLocation, projectRootPath: string): string[] {
  const sourcePath: string = resolveSourceFilePath(source.fileName, projectRootPath);
  const columnNumber: number = source.columnNumber ?? 1;

  return ["nvim", "-c", `call cursor(${source.lineNumber}, ${columnNumber})`, "--", sourcePath];
}
