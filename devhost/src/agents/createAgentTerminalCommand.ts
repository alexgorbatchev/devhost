import type { ITerminalSessionCommand } from "./ITerminalSessionCommand";
import { createAgentSessionFiles } from "./createAgentSessionFiles";
import { createAnnotationAgentPrompt } from "./createAnnotationAgentPrompt";
import { createClaudeCodeAgentCommand } from "./createClaudeCodeAgentCommand";
import { createOpenCodeAgentCommand } from "./createOpenCodeAgentCommand";
import { createPiAgentCommand } from "./createPiAgentCommand";
import type { IStartAgentTerminalSessionRequest } from "../devtools/features/terminalSessions/types";
import type { ValidatedDevhostAgent } from "../types/stackTypes";

interface ICreateAgentTerminalCommandOptions {
  agent: ValidatedDevhostAgent;
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

  if (options.agent.kind === "claude-code") {
    return {
      cleanup: (): void => {},
      command: createClaudeCodeAgentCommand(prompt),
      cwd: options.projectRootPath,
      env: {},
    };
  }

  if (options.agent.kind === "opencode") {
    return {
      cleanup: (): void => {},
      command: createOpenCodeAgentCommand(prompt),
      cwd: options.projectRootPath,
      env: {},
    };
  }

  if (options.agent.kind !== "configured") {
    throw new Error(`Unsupported agent adapter: ${options.agent.kind}`);
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
