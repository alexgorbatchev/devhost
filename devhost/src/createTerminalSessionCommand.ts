import type { DevtoolsComponentEditor } from "./devtoolsComponentEditor";
import type { IStartTerminalSessionRequest } from "./devtools/features/terminalSessions/types";
import { createAgentTerminalCommand } from "./createAgentTerminalCommand";
import { createEditorTerminalCommand } from "./createEditorTerminalCommand";

interface ICreateTerminalSessionCommandOptions {
  componentEditor: DevtoolsComponentEditor;
  projectRootPath: string;
  request: IStartTerminalSessionRequest;
}

export function createTerminalSessionCommand(options: ICreateTerminalSessionCommandOptions): string[] {
  if (options.request.kind === "agent") {
    return createAgentTerminalCommand(options.request);
  }

  return createEditorTerminalCommand({
    componentEditor: options.componentEditor,
    projectRootPath: options.projectRootPath,
    request: options.request,
  });
}
