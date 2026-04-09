type EmptyCallback = () => void;
type AgentEventName = "agent_start" | "agent_end";

export interface IAgentStatusExtensionApi {
  on: (eventName: AgentEventName, handler: EmptyCallback) => void;
}

export function registerAgentStatusExtension(pi: IAgentStatusExtensionApi): void {
  pi.on("agent_start", (): void => {
    process.stdout.write("\x1b]1337;SetAgentStatus=working\x07");
  });

  pi.on("agent_end", (): void => {
    process.stdout.write("\x1b]1337;SetAgentStatus=finished\x07");
  });
}

export default registerAgentStatusExtension;
