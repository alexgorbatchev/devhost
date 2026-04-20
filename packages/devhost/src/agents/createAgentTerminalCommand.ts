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

  const sessionFiles = createAgentSessionFiles({
    annotation: options.request.annotation,
    displayName: options.agent.displayName,
    projectRootPath: options.projectRootPath,
    prompt,
    stackName: options.stackName,
  });

  if (options.agent.kind === "pi") {
    const promptFilePath: string = readRequiredSessionFilePath(
      sessionFiles.env.DEVHOST_AGENT_PROMPT_FILE,
      "DEVHOST_AGENT_PROMPT_FILE",
    );
    return {
      cleanup: sessionFiles.cleanup,
      command: createPiAgentCommand(promptFilePath),
      cwd: options.projectRootPath,
      env: sessionFiles.env,
    };
  }

  if (options.agent.kind === "claude-code") {
    const promptFilePath: string = readRequiredSessionFilePath(
      sessionFiles.env.DEVHOST_AGENT_PROMPT_FILE,
      "DEVHOST_AGENT_PROMPT_FILE",
    );
    const settingsFilePath: string = readRequiredSessionFilePath(
      sessionFiles.env.DEVHOST_AGENT_CLAUDE_SETTINGS_FILE,
      "DEVHOST_AGENT_CLAUDE_SETTINGS_FILE",
    );
    return {
      cleanup: sessionFiles.cleanup,
      command: createClaudeCodeAgentCommand(promptFilePath, settingsFilePath),
      cwd: options.projectRootPath,
      env: sessionFiles.env,
    };
  }

  if (options.agent.kind === "opencode") {
    const promptFilePath: string = readRequiredSessionFilePath(
      sessionFiles.env.DEVHOST_AGENT_PROMPT_FILE,
      "DEVHOST_AGENT_PROMPT_FILE",
    );
    if (sessionFiles.env.DEVHOST_AGENT_OPENCODE_CONFIG_FILE) {
      sessionFiles.env.OPENCODE_CONFIG = sessionFiles.env.DEVHOST_AGENT_OPENCODE_CONFIG_FILE;
    }
    return {
      cleanup: sessionFiles.cleanup,
      command: createOpenCodeAgentCommand(promptFilePath),
      cwd: options.projectRootPath,
      env: sessionFiles.env,
    };
  }

  if (options.agent.kind !== "configured") {
    sessionFiles.cleanup();
    throw new Error(`Unsupported agent adapter: ${options.agent.kind}`);
  }

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

function readRequiredSessionFilePath(filePath: string | undefined, variableName: string): string {
  if (filePath === undefined) {
    throw new Error(`Expected ${variableName} to be populated for the selected agent session.`);
  }

  return filePath;
}
