import type { DevtoolsComponentEditor } from "./devtoolsComponentEditor";
import type { IStartTerminalSessionRequest } from "./devtools/features/terminalSessions/types";
import { createNeovimSessionCommand } from "./createNeovimSessionCommand";
import { createPiAnnotationPrompt } from "./createPiAnnotationPrompt";
import { createPiTerminalSessionCommand } from "./createPiTerminalSessionCommand";

interface ICreateTerminalSessionCommandOptions {
  componentEditor: DevtoolsComponentEditor;
  projectRootPath: string;
  request: IStartTerminalSessionRequest;
}

export function createTerminalSessionCommand(options: ICreateTerminalSessionCommandOptions): string[] {
  if (options.request.kind === "pi-annotation") {
    return createPiTerminalSessionCommand(createPiAnnotationPrompt(options.request.annotation));
  }

  if (options.componentEditor !== "neovim") {
    throw new Error('Component source terminal sessions require devtoolsComponentEditor = "neovim".');
  }

  return createNeovimSessionCommand(options.request.source, options.projectRootPath);
}
