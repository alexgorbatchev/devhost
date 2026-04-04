import type { ITerminalSessionCommand } from "./ITerminalSessionCommand";
import { createAgentTerminalCommand } from "./createAgentTerminalCommand";
import { createEditorTerminalCommand } from "./createEditorTerminalCommand";
import type { DevtoolsComponentEditor } from "../devtools-server/devtoolsComponentEditor";
import type { StartTerminalSessionRequest } from "../devtools/features/terminalSessions/types";
import type { ValidatedDevhostAgent } from "../types/stackTypes";

interface ICreateTerminalSessionCommandOptions {
  agent: ValidatedDevhostAgent;
  componentEditor: DevtoolsComponentEditor;
  projectRootPath: string;
  request: StartTerminalSessionRequest;
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
