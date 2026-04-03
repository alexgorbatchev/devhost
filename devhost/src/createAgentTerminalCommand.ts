import type { ITerminalSessionCommand } from "./ITerminalSessionCommand";
import { createAgentSessionFiles } from "./createAgentSessionFiles";
import { createAnnotationAgentPrompt } from "./createAnnotationAgentPrompt";
import { createPiAgentCommand } from "./createPiAgentCommand";
import type { IStartAgentTerminalSessionRequest } from "./devtools/features/terminalSessions/types";
import type { IValidatedDevhostAgent } from "./stackTypes";

interface ICreateAgentTerminalCommandOptions {
  agent: IValidatedDevhostAgent;
  projectRootPath: string;
  request: IStartAgentTerminalSessionRequest;
  stackName: string;
}

export function createAgentTerminalCommand(options: ICreateAgentTerminalCommandOptions): ITerminalSessionCommand {
  const prompt: string = createAnnotationAgentPrompt(options.request.annotation);

  if (options.agent.kind === "pi") {
    return {
      cleanup: (): void => {},
      command: createPiAgentCommand(prompt),
      cwd: options.projectRootPath,
      env: {},
    };
  }

  const sessionFiles = createAgentSessionFiles({
    annotation: options.request.annotation,
    displayName: options.agent.displayName,
    projectRootPath: options.projectRootPath,
    prompt,
    stackName: options.stackName,
  });

  return {
    cleanup: sessionFiles.cleanup,
    command: options.agent.command,
    cwd: options.agent.cwd,
    env: {
      ...options.agent.env,
      ...sessionFiles.env,
    },
  };
}
