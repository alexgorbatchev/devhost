import type { ITerminalSessionCommand } from "./ITerminalSessionCommand";
import type { DevtoolsComponentEditor } from "../devtools-server/devtoolsComponentEditor";
import type { IStartEditorTerminalSessionRequest } from "../devtools/features/terminalSessions/types";
import { createNeovimSessionCommand } from "./createNeovimSessionCommand";

interface ICreateEditorTerminalCommandOptions {
  componentEditor: DevtoolsComponentEditor;
  projectRootPath: string;
  request: IStartEditorTerminalSessionRequest;
}

export function createEditorTerminalCommand(options: ICreateEditorTerminalCommandOptions): ITerminalSessionCommand {
  if (options.request.launcher !== "neovim") {
    throw new Error(`Unsupported editor terminal launcher: ${options.request.launcher}`);
  }

  if (options.componentEditor !== "neovim") {
    throw new Error('Editor terminal sessions require devtoolsComponentEditor = "neovim".');
  }

  return {
    cleanup: (): void => {},
    command: createNeovimSessionCommand(options.request.source, options.projectRootPath),
    cwd: options.projectRootPath,
    env: {},
  };
}
