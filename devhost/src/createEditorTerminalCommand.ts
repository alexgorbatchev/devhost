import type { DevtoolsComponentEditor } from "./devtoolsComponentEditor";
import type { IStartEditorTerminalSessionRequest } from "./devtools/features/terminalSessions/types";
import { createNeovimSessionCommand } from "./createNeovimSessionCommand";

interface ICreateEditorTerminalCommandOptions {
  componentEditor: DevtoolsComponentEditor;
  projectRootPath: string;
  request: IStartEditorTerminalSessionRequest;
}

type EditorTerminalCommandBuilder = (options: ICreateEditorTerminalCommandOptions) => string[];

const editorTerminalCommandBuilderByLauncher: Record<IStartEditorTerminalSessionRequest["launcher"], EditorTerminalCommandBuilder> = {
  neovim: (options: ICreateEditorTerminalCommandOptions): string[] => {
    if (options.componentEditor !== "neovim") {
      throw new Error('Editor terminal sessions require devtoolsComponentEditor = "neovim".');
    }

    return createNeovimSessionCommand(options.request.source, options.projectRootPath);
  },
};

export function createEditorTerminalCommand(options: ICreateEditorTerminalCommandOptions): string[] {
  return editorTerminalCommandBuilderByLauncher[options.request.launcher](options);
}
