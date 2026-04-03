import type { ITerminalSessionCommand } from "./ITerminalSessionCommand";
import { createAgentTerminalCommand } from "./createAgentTerminalCommand";
import { createEditorTerminalCommand } from "./createEditorTerminalCommand";
import type { DevtoolsComponentEditor } from "./devtoolsComponentEditor";
import type { IStartTerminalSessionRequest } from "./devtools/features/terminalSessions/types";
import type { IValidatedDevhostAgent } from "./stackTypes";

interface ICreateTerminalSessionCommandOptions {
  agent: IValidatedDevhostAgent;
  componentEditor: DevtoolsComponentEditor;
  projectRootPath: string;
  request: IStartTerminalSessionRequest;
  stackName: string;
}

export function createTerminalSessionCommand(options: ICreateTerminalSessionCommandOptions): ITerminalSessionCommand {
  if (options.request.kind === "agent") {
    return createAgentTerminalCommand({
      agent: options.agent,
      projectRootPath: options.projectRootPath,
      request: options.request,
      stackName: options.stackName,
    });
  }

  return createEditorTerminalCommand({
    componentEditor: options.componentEditor,
    projectRootPath: options.projectRootPath,
    request: options.request,
  });
}
