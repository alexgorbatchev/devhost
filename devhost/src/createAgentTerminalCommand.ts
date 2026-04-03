import type { IStartAgentTerminalSessionRequest } from "./devtools/features/terminalSessions/types";
import { createAnnotationAgentPrompt } from "./createAnnotationAgentPrompt";
import { createPiAgentCommand } from "./createPiAgentCommand";

type AgentTerminalCommandBuilder = (request: IStartAgentTerminalSessionRequest) => string[];

const agentTerminalCommandBuilderByLauncher: Record<IStartAgentTerminalSessionRequest["launcher"], AgentTerminalCommandBuilder> = {
  pi: (request: IStartAgentTerminalSessionRequest): string[] => {
    return createPiAgentCommand(createAnnotationAgentPrompt(request.annotation));
  },
};

export function createAgentTerminalCommand(request: IStartAgentTerminalSessionRequest): string[] {
  return agentTerminalCommandBuilderByLauncher[request.launcher](request);
}
